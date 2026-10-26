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
FLAG_TRIAL, FLAG_REST, FLAG_FULL, FLAG_CONTINUOUS = 1, 2, 4, 8
RAW_NAME = re.compile(r"^(conn\d+)-(\d{2})-(\d+)\.jsonl\.gz$")
EXAMPLES = 20
EMPTY = (None, None)
# Gaps run to the session's end at the latest: 13:31, after the closing auction's books at 13:30. A connection
# whose lines end before that without a stop line after it (an early stop, a crash) has the rest as a gap.
SESSION_END_MS = (4 * 60 + 31) * 60_000


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
    """One books message (or refill) as a frame; None when it is not one."""
    data = record.get("d")
    if not isinstance(data, dict) or not isinstance(data.get("symbol"), str):
        return None
    rest = record.get("src") == "rest"
    stamp = data.get("lastUpdated") if rest else data.get("time")
    if not isinstance(stamp, int) or isinstance(stamp, bool):
        if not rest:
            return None
        stamp = record["r"] * 1000  # a refill without a time of its own: when it arrived
    bids, asks = _levels(data.get("bids")), _levels(data.get("asks"))
    if bids is None or asks is None:
        return None
    return {"t": stamp // 1000 - day_open, "trial": data.get("isTrial") is True,
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
        header = json.dumps({"schema": SCHEMA, "code": code, "date": day, "sizeUnit": "unverified",
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


def iter_raw(path: Path, report: RawReport) -> Iterator[dict]:
    """A raw file's records, read a megabyte at a time (an hour of a busy connection is hundreds of MB once
    decompressed). Everything up to the last sync flush still decompresses after a crash."""
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    pending = b""
    number = 0
    with Path(path).open("rb") as handle:
        while not decompressor.eof:
            chunk = handle.read(1 << 20)
            if not chunk:
                break
            *lines, pending = (pending + decompressor.decompress(chunk)).split(b"\n")
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
    report.cut = pending != b"" or not decompressor.eof


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
    gap_from: int | None = None  # where an unrecorded stretch began, until the connection is back
    pending: dict[str, int] = field(default_factory=dict)  # stock -> its gap's start, until it is heard again
    last_r: int | None = None


def _records(name: str, paths: list[Path], result: Encoded, problem: Callable[[str], None]) -> Iterator[tuple]:
    """One connection's records as (received, connection, file name, record), in the order they were written."""
    for path in paths:
        report = RawReport()
        try:
            for record in iter_raw(path, report):
                yield record["r"], name, path.name, record
        except (OSError, zlib.error) as error:
            problem(f"{path.name}：無法解壓（{type(error).__name__}）")
        if report.cut:
            result.truncated.append(path.name)
        for number in report.bad:
            problem(f"{path.name}:{number}")


def _merged(spans: list[list[int]]) -> list[list[int]]:
    """Overlapping or touching stretches as one."""
    merged: list[list[int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _scan(raw_folder: Path, day: str, encode: bool) -> tuple[Encoded, dict[str, _Stock]]:
    """Gaps per stock (and, when encoding, each stock's rows) from every connection's lines. The connections are
    read side by side in the order their lines were received: a same-day restart splits the stocks by a fresh
    snapshot order, so a stock can change connection, and its rows must still come in the order they arrived."""
    day_open = open_ms(day)
    result = Encoded()
    stocks: dict[str, _Stock] = {}

    def problem(text: str) -> None:
        result.unparsable_count += 1
        if len(result.unparsable) < EXAMPLES:
            result.unparsable.append(text)

    def close(link: _Link, code: str, end: int) -> None:
        start = link.pending.pop(code)
        if end > start:
            result.gaps.setdefault(code, []).append([start - day_open, end - day_open])

    files = connection_files(raw_folder)
    links = {name: _Link() for name in files}
    streams = [_records(name, paths, result, problem) for name, paths in files.items()]
    for received, name, file_name, record in heapq.merge(*streams, key=lambda item: item[0]):
        link = links[name]
        event = record.get("ev")
        if event == "connected":
            if link.state in ("up", "stopped") and link.last_r is not None and link.gap_from is None:
                link.gap_from = link.last_r  # a new process: the last one ended without a down line
            if isinstance(record.get("codes"), list):
                link.codes = [code for code in record["codes"] if isinstance(code, str)]
            if link.gap_from is not None:
                # Every stock's book is unknown from the gap's start until it is heard again or refilled. Set here,
                # not at the subscribed line: books can arrive before that line is written.
                for code in link.codes:
                    link.pending.setdefault(code, link.gap_from)
                link.gap_from = None
            link.state = "connecting"
        elif event == "subscribed":
            link.state = "up"
        elif event == "down":
            since = record.get("since")
            link.gap_from = since if isinstance(since, int) and not isinstance(since, bool) else received
            link.state = "down"
        elif event == "stop":
            for code in list(link.pending):
                close(link, code, received)
            link.state = "stopped"
        elif event == "refill":
            if record.get("symbol") in link.pending:
                close(link, record["symbol"], received)
        elif "d" in record:
            frame = frame_of(record, day_open)
            if frame is None:
                problem(f"{file_name}：不是五檔資料")
            else:
                symbol = record["d"]["symbol"]
                after_gap = symbol in link.pending
                if after_gap:
                    close(link, symbol, received)
                if encode:
                    if symbol not in stocks:
                        stocks[symbol] = _Stock(symbol, day)
                    stocks[symbol].add(frame, after_gap)
        link.last_r = received
    session_end = day_open + SESSION_END_MS
    for link in links.values():
        if link.last_r is None:
            continue
        end = link.last_r
        if not (link.state == "stopped" and link.last_r >= session_end):
            # It stopped early (low disk, a failed write) or died: nothing is known after its last line.
            if link.gap_from is None:
                link.gap_from = link.last_r
            end = max(link.last_r, session_end)
        if link.gap_from is not None:
            for code in link.codes:
                link.pending.setdefault(code, link.gap_from)
        for code in list(link.pending):
            close(link, code, end)
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
