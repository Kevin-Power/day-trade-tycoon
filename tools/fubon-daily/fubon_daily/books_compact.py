"""A day's raw books files as one compact file per stock, and back (stage 2 of the books recorder).

Raw lines come from books.RawWriter: `{"r", "d"}` books messages, `{"r", "src": "rest", "d"}` refills and
`{"r", "ev", ...}` control lines. Every message becomes a row, in the order it arrived (Fubon's order; its time
very rarely goes back, 22 of 914,635 on 2026-10-22): a full frame at the first row, at each new minute and after a
gap, the changed levels otherwise. Rows are encoded and compressed as the raw lines are read, so memory stays
bounded on a full-market day (10-17 million messages). Each stock's file is then decoded on its own and compared,
by hash, with the messages that went in.
"""
from __future__ import annotations

import gzip
import hashlib
import heapq
import json
import math
import re
import zlib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterator

SCHEMA = 1
KEY_EVERY = 60_000
LEVELS = 5
# Book sizes are lots (張), confirmed on 2026-10-28..30: when a trade takes part of the best ask, that level drops
# by exactly the trade's lots (92-95% of cases, never by lots x 1000), and 0.005% of best-level sizes are
# multiples of 1000 (shares would make that nearly all).
SIZE_UNIT = "lot"
FLAG_TRIAL, FLAG_REST, FLAG_FULL, FLAG_CONTINUOUS = 1, 2, 4, 8
RAW_NAME = re.compile(r"^(conn\d+)-(\d{2})-(\d+)\.jsonl\.gz$")
EXAMPLES = 20
EMPTY = (None, None)
# Gaps run to the session's end at the latest: 13:31, after the closing auction's books at 13:30. A connection
# whose lines end before that without a stop line after it (an early stop, a crash) has the rest as a gap.
SESSION_END_MS = (4 * 60 + 31) * 60_000
SALVAGE_PIECE = 1024


@dataclass
class Encoded:
    files: dict[str, bytes] = field(default_factory=dict)
    messages: dict[str, int] = field(default_factory=dict)
    first: dict[str, int] = field(default_factory=dict)
    last: dict[str, int] = field(default_factory=dict)
    gaps: dict[str, list[list[int]]] = field(default_factory=dict)
    mismatched: list[str] = field(default_factory=list)  # stocks whose file did not decode to what went in
    unparsable: list[str] = field(default_factory=list)
    unparsable_count: int = 0
    truncated: list[str] = field(default_factory=list)


def open_ms(day: str) -> int:
    return int(datetime.fromisoformat(f"{day}T09:00:00+08:00").timestamp() * 1000)


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _levels(value: object) -> list[list] | None:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > LEVELS:
        return None
    levels = []
    for level in value:
        if not (isinstance(level, dict) and _number(level.get("price")) and _number(level.get("size"))):
            return None
        levels.append([level["price"], level["size"]])
    return levels


def frame_of(record: dict, day_open: int) -> dict | None:
    """One books message (or refill) as a frame; None when it is not one. A refill is placed when it arrived,
    which is when its book became known: its own lastUpdated can be hours earlier, inside the gap it ends (the
    raw file keeps it)."""
    data = record.get("d")
    if not isinstance(data, dict) or not isinstance(data.get("symbol"), str):
        return None
    rest = record.get("src") == "rest"
    if rest:
        t = record["r"] - day_open
    else:
        stamp = data.get("time")
        if not isinstance(stamp, int) or isinstance(stamp, bool):
            return None
        t = stamp // 1000 - day_open
    bids, asks = _levels(data.get("bids")), _levels(data.get("asks"))
    if bids is None or asks is None:
        return None
    return {"t": t, "trial": data.get("isTrial") is True,
            "continuous": data.get("isContinuous") is True, "src": "rest" if rest else "ws",
            "bids": bids, "asks": asks}


def _canonical(frame: dict) -> bytes:
    return json.dumps(frame, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _slots(frame: dict) -> list[tuple]:
    return ([tuple(level) for level in frame["bids"]] + [EMPTY] * (LEVELS - len(frame["bids"]))
            + [tuple(level) for level in frame["asks"]] + [EMPTY] * (LEVELS - len(frame["asks"])))


class _Stock:
    """One stock's rows: encoded as they arrive, compressed on the fly, hashed for the round-trip check."""

    def __init__(self, code: str, day: str):
        header = json.dumps({"schema": SCHEMA, "code": code, "date": day, "sizeUnit": SIZE_UNIT,
                             "keyEvery": KEY_EVERY}, ensure_ascii=False, separators=(",", ":"))
        self.compressor = zlib.compressobj(9, zlib.DEFLATED, 16 + zlib.MAX_WBITS)  # a gzip stream
        self.chunks = [self.compressor.compress((header[:-1] + ',"rows":[').encode("utf-8"))]
        self.digest = hashlib.sha256()
        self.count = 0
        self.first: int | None = None
        self.last: int | None = None
        self.previous_t: int | None = None
        self.previous_slots: list[tuple] | None = None

    def add(self, frame: dict, after_gap: bool) -> None:
        slots = _slots(frame)
        full = (self.previous_t is None or after_gap or frame["src"] == "rest"
                or frame["t"] // KEY_EVERY != self.previous_t // KEY_EVERY)
        flags = ((FLAG_TRIAL if frame["trial"] else 0) | (FLAG_REST if frame["src"] == "rest" else 0)
                 | (FLAG_FULL if full else 0) | (FLAG_CONTINUOUS if frame["continuous"] else 0))
        if full:
            payload = [frame["bids"], frame["asks"]]
        else:
            payload = [[index, slots[index][0], slots[index][1]] for index in range(2 * LEVELS)
                       if slots[index] != self.previous_slots[index]]
        row = [frame["t"] - (self.previous_t if self.previous_t is not None else 0), flags, payload]
        text = ("," if self.count else "") + json.dumps(row, separators=(",", ":"))
        self.chunks.append(self.compressor.compress(text.encode("utf-8")))
        self.digest.update(_canonical(frame))
        self.count += 1
        self.first = frame["t"] if self.first is None else self.first
        self.last = frame["t"]
        self.previous_t, self.previous_slots = frame["t"], slots

    def finish(self, gaps: list[list[int]]) -> bytes:
        tail = '],"gaps":' + json.dumps(gaps, separators=(",", ":")) + "}"
        self.chunks.append(self.compressor.compress(tail.encode("utf-8")))
        self.chunks.append(self.compressor.flush())
        return b"".join(self.chunks)


@dataclass
class RawReport:
    bad: list[int] = field(default_factory=list)  # line numbers that would not parse
    cut: bool = False  # a crash cut the file short (no gzip end, or half a line)


def _salvage(decompressor, chunk: bytes) -> bytes:
    """What `chunk` decompresses to before its damage, from the state before it: a kilobyte at a time, then the
    damaged kilobyte a byte at a time. zlib drops a whole call's output when it meets damage."""
    out = []
    for start in range(0, len(chunk), SALVAGE_PIECE):
        piece = chunk[start:start + SALVAGE_PIECE]
        before = decompressor.copy()
        try:
            out.append(decompressor.decompress(piece))
        except zlib.error:
            for byte in range(len(piece)):
                try:
                    out.append(before.decompress(piece[byte:byte + 1]))
                except zlib.error:
                    break
            break
    return b"".join(out)


def iter_raw(path: Path, report: RawReport) -> Iterator[dict]:
    """A raw file's records, read a megabyte at a time (an hour of a busy connection is hundreds of MB once
    decompressed). Everything up to the last sync flush still decompresses after a crash, and after damage (a
    power cut can leave zeros after the last write) everything before it does: the file then counts as cut."""
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    pending = b""
    number = 0
    damaged = False
    with Path(path).open("rb") as handle:
        while not decompressor.eof and not damaged:
            chunk = handle.read(1 << 20)
            if not chunk:
                break
            before = decompressor.copy()
            try:
                data = decompressor.decompress(chunk)
            except zlib.error:
                data, damaged = _salvage(before, chunk), True
            *lines, pending = (pending + data).split(b"\n")
            for line in lines:
                number += 1
                try:
                    record = json.loads(line)
                except ValueError:
                    report.bad.append(number)
                    continue
                if isinstance(record, dict) and isinstance(record.get("r"), int) and not isinstance(record["r"], bool):
                    yield record
                else:
                    report.bad.append(number)
    report.cut = damaged or pending != b"" or not decompressor.eof


def connection_files(raw_folder: Path) -> dict[str, list[Path]]:
    """Each connection's files in the order they were written: by hour, then part."""
    groups: dict[str, list[tuple[int, int, Path]]] = {}
    for path in Path(raw_folder).glob("*.jsonl.gz"):
        match = RAW_NAME.match(path.name)
        if match:
            groups.setdefault(match.group(1), []).append((int(match.group(2)), int(match.group(3)), path))
    return {name: [path for _, _, path in sorted(items)] for name, items in sorted(groups.items())}


@dataclass
class _Link:
    """One connection's state while its lines are read."""
    state: str = "idle"  # idle, connecting, up, down, stopped
    codes: list[str] = field(default_factory=list)
    last_r: int | None = None
    started: bool = False  # a start line came and no connected line yet


def _records(name: str, paths: list[Path], result: Encoded, problem: Callable[[str], None]) -> Iterator[tuple]:
    """One connection's records as (received, connection, file name, record), in the order they were written.
    After a file cut short or unreadable comes a `cut` record at its last good line: nothing is known from there."""
    last = None
    for path in paths:
        report = RawReport()
        lost = False
        try:
            for record in iter_raw(path, report):
                last = record["r"]
                yield last, name, path.name, record
        except (OSError, zlib.error) as error:
            problem(f"{path.name}：無法讀取（{type(error).__name__}）")
            lost = True
        if report.cut:
            result.truncated.append(path.name)
        for number in report.bad:
            problem(f"{path.name}:{number}")
        if (report.cut or lost) and last is not None:
            yield last, name, path.name, {"r": last, "ev": "cut"}


def _merged(spans: list[list[int]]) -> list[list[int]]:
    """Overlapping or touching stretches as one."""
    merged: list[list[int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _codes(record: dict) -> list[str] | None:
    value = record.get("codes")
    return [code for code in value if isinstance(code, str)] if isinstance(value, list) else None


def _scan(raw_folder: Path, day: str, encode: bool) -> tuple[Encoded, dict[str, _Stock]]:
    """Gaps per stock (and, when encoding, each stock's rows) from every connection's lines. The connections are
    read side by side in the order their lines were received: a same-day restart splits the stocks by a fresh
    snapshot order, so a stock can change connection. Each stock's book is unknown from the moment its connection
    lost it (a down line, a new process, a failed attempt, a damaged file, an early end) until the stock is heard
    again, or refilled, on whichever connection holds it then."""
    day_open = open_ms(day)
    result = Encoded()
    stocks: dict[str, _Stock] = {}
    unknown: dict[str, int] = {}  # stock -> since when its book is unknown

    def problem(text: str) -> None:
        result.unparsable_count += 1
        if len(result.unparsable) < EXAMPLES:
            result.unparsable.append(text)

    def lose(codes: list[str], since: int) -> None:
        for code in codes:
            unknown.setdefault(code, since)  # an earlier start stands

    def heard(code: str, at: int) -> bool:
        since = unknown.pop(code, None)
        if since is not None and at > since:
            result.gaps.setdefault(code, []).append([since - day_open, at - day_open])
        return since is not None

    files = connection_files(raw_folder)
    links = {name: _Link() for name in files}
    streams = [_records(name, paths, result, problem) for name, paths in files.items()]
    latest = None
    for received, name, file_name, record in heapq.merge(*streams, key=lambda item: item[0]):
        link = links[name]
        event = record.get("ev")
        codes = _codes(record)
        if event == "start":
            # A new process: what this connection held is unknown from its last line on.
            if link.last_r is not None:
                lose(link.codes, link.last_r)
            link.codes = codes if codes is not None else link.codes
            link.state, link.started = "idle", True
        elif event == "connected":
            if link.last_r is not None and (link.state == "connecting"
                                            or (record.get("generation") == 1 and not link.started)):
                # The attempt before never had its subscription confirmed, or a new process wrote no start line.
                lose(link.codes, link.last_r)
            link.codes = codes if codes is not None else link.codes
            link.state, link.started = "connecting", False
        elif event == "subscribed":
            link.state = "up"
        elif event == "down":
            since = record.get("since")
            lose(codes if codes is not None else link.codes,
                 since if isinstance(since, int) and not isinstance(since, bool) else received)
            link.state = "down"
        elif event == "stop":
            link.state = "stopped"
        elif event == "cut":
            lose(link.codes, received)
        elif event == "refill":
            if isinstance(record.get("symbol"), str):
                heard(record["symbol"], received)
        elif "d" in record:
            frame = frame_of(record, day_open)
            if frame is None:
                problem(f"{file_name}：不是五檔資料")
            else:
                symbol = record["d"]["symbol"]
                after_gap = heard(symbol, received)
                if encode:
                    if symbol not in stocks:
                        stocks[symbol] = _Stock(symbol, day)
                    stocks[symbol].add(frame, after_gap)
        link.last_r = received
        latest = received if latest is None else max(latest, received)
    session_end = day_open + SESSION_END_MS
    for link in links.values():
        if link.last_r is not None and not (link.state == "stopped" and link.last_r >= session_end):
            lose(link.codes, link.last_r)  # it stopped early (low disk, a failed write) or died
    end = session_end if latest is None else max(session_end, latest)
    for code, since in unknown.items():
        if end > since:
            result.gaps.setdefault(code, []).append([since - day_open, end - day_open])
    result.gaps = {code: _merged(spans) for code, spans in result.gaps.items()}
    return result, stocks


def iter_decode(blob: bytes) -> Iterator[dict]:
    """Every row of a compact file back as a frame: {"t", "trial", "continuous", "src", "bids", "asks"}."""
    document = json.loads(gzip.decompress(blob))
    t, slots = 0, [EMPTY] * (2 * LEVELS)
    for dt, flags, payload in document["rows"]:
        t += dt
        if flags & FLAG_FULL:
            bids, asks = payload
            slots = ([tuple(level) for level in bids] + [EMPTY] * (LEVELS - len(bids))
                     + [tuple(level) for level in asks] + [EMPTY] * (LEVELS - len(asks)))
        else:
            slots = list(slots)
            for index, price, size in payload:
                slots[index] = (price, size)
        yield {"t": t, "trial": bool(flags & FLAG_TRIAL), "continuous": bool(flags & FLAG_CONTINUOUS),
               "src": "rest" if flags & FLAG_REST else "ws",
               "bids": [list(slot) for slot in slots[:LEVELS] if slot[0] is not None],
               "asks": [list(slot) for slot in slots[LEVELS:] if slot[0] is not None]}


def decode(blob: bytes) -> list[dict]:
    return list(iter_decode(blob))


def gaps_by_symbol(raw_folder: Path, day: str) -> dict[str, list[list[int]]]:
    """Per stock, the stretches (ms after 09:00) whose books may be missing: from the last line before a drop, a
    crash or a late start (the recorder's down line) to its first books message or refill after the reconnect,
    and from an early end of the recording to 13:31. Overlapping or touching stretches are one."""
    return _scan(raw_folder, day, encode=False)[0].gaps


def encode_day(raw_folder: Path, day: str, check: Callable[[str, dict], None] | None = None) -> Encoded:
    """Every stock's compact file, each decoded on its own and compared by hash with what went in. `check` sees
    every decoded frame on the way, so publishing can look at the books without decoding them twice."""
    result, stocks = _scan(raw_folder, day, encode=True)
    for code, stock in stocks.items():
        blob = stock.finish(result.gaps.get(code, []))
        decoded = hashlib.sha256()
        for frame in iter_decode(blob):
            decoded.update(_canonical(frame))
            if check is not None:
                check(code, frame)
        if decoded.digest() != stock.digest.digest():
            result.mismatched.append(code)
        result.files[code] = blob
        result.messages[code] = stock.count
        result.first[code], result.last[code] = stock.first, stock.last
    return result
