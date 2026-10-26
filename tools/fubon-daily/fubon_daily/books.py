"""Today's real 五檔 (WebSocket `books`) for every listed common stock, recorded as received during the session.

Fubon streams order books live only, so a moment not recorded is lost. The recorder logs in once, holds four
connections, writes every books message unchanged and reconnects with backoff. Turning the raw files into compact
per-stock files happens after the close (stage 2). Design: docs/superpowers/specs/2026-10-26-fubon-books-recorder-design.md.
"""
from __future__ import annotations

import gzip
import json
import threading
import zlib
from datetime import datetime, time
from pathlib import Path
from typing import Callable

from .normalize import TAIPEI

CONNECTIONS = 4
# Fubon allows 300 subscriptions a connection; 280 leaves room.
PER_CONNECTION = 280
OPEN_AT = time(8, 44)
CLOSED_CHECK = time(9, 5)
STOP_AT = time(13, 36)
SILENCE_SECONDS = 70
CONNECT_TIMEOUT = 15
BACKOFF = (10, 20, 40, 60, 120)
JITTER_SECONDS = 10
STAGGER_SECONDS = 15
FAST_FAILURES = 8
SLOW_RETRY_SECONDS = 300
# Error 1001 "Maximum number of connections reached": another program needs its connection more than we do.
FULL_WAIT_SECONDS = 300
RETRY_UNTIL = time(13, 30)
STABLE_SECONDS = 120
FLUSH_SECONDS = 5
STATUS_EVERY = 300
REFILL_WAIT = 30
REFILL_SPACING = 0.5
DOWN_NOTICE_SECONDS = 600
MIN_FREE_START = 10 * 2**30
MIN_FREE_RUN = 3 * 2**30


def split_symbols(codes: list[str], connections: int = CONNECTIONS,
                  per_connection: int = PER_CONNECTION) -> tuple[list[list[str]], list[str]]:
    """Codes come most traded first; dealt round-robin, every connection gets a share of the busy ones. Returns
    the groups and the codes that did not fit."""
    kept = codes[:connections * per_connection]
    return [kept[index::connections] for index in range(connections)], codes[len(kept):]


class RawWriter:
    """Writes records as received, one gzip file per hour. A sync flush every few seconds limits what a crash can
    lose to the lines since. A gzip cut short by a crash cannot be appended to, so a restart opens new files
    (`-2`, `-3`…) and never touches an earlier one. After a write error the writer stops and keeps what it has."""

    def __init__(self, folder: Path, name: str):
        self.folder = Path(folder)
        self.name = name
        self.error: str | None = None
        self.paths: list[Path] = []
        self._hour: str | None = None
        self._raw = None
        self._gzip: gzip.GzipFile | None = None

    def write(self, record: dict) -> int:
        if self.error:
            return 0
        line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        try:
            hour = datetime.fromtimestamp(record["r"] / 1000, TAIPEI).strftime("%H")
            if hour != self._hour:
                self._open(hour)
            self._gzip.write(line)
        except OSError as error:
            self.error = f"{type(error).__name__}: {error}"
            return 0
        return len(line)

    def flush(self) -> None:
        if self.error or self._gzip is None:
            return
        try:
            self._gzip.flush(zlib.Z_SYNC_FLUSH)  # also flushes the file underneath
        except OSError as error:
            self.error = f"{type(error).__name__}: {error}"

    def close(self) -> None:
        self._close_current()

    def _open(self, hour: str) -> None:
        self._close_current()
        self.folder.mkdir(parents=True, exist_ok=True)
        part = 1
        while True:
            path = self.folder / f"{self.name}-{hour}-{part}.jsonl.gz"
            try:
                raw = open(path, "xb")
                break
            except FileExistsError:
                part += 1
        self._raw = raw
        self._gzip = gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0)
        self._hour = hour
        self.paths.append(path)

    def _close_current(self) -> None:
        for handle in (self._gzip, self._raw):  # the gzip trailer first, then the file it does not own
            if handle is not None:
                try:
                    handle.close()
                except OSError:
                    pass
        self._gzip = self._raw = None
        self._hour = None


class Backoff:
    """How long a connection waits before its next attempt: growing waits with jitter, then a slow retry, so the
    recorder never keeps hammering Fubon (it blocks clients that open connections too often)."""

    def __init__(self, random: Callable[[], float]):
        self.random = random
        self.failures = 0
        self.up_since: float | None = None

    def failure(self, now: float, full: bool = False) -> float:
        self.up_since = None
        wait = (FULL_WAIT_SECONDS if full
                else BACKOFF[min(self.failures, len(BACKOFF) - 1)] + self.random() * JITTER_SECONDS
                if self.failures < FAST_FAILURES else SLOW_RETRY_SECONDS)
        self.failures += 1
        return wait

    def connected(self, now: float) -> None:
        self.up_since = now

    def tick(self, now: float) -> None:
        if self.up_since is not None and now - self.up_since >= STABLE_SECONDS:
            self.failures = 0


class Stream:
    """One WebSocket connection's share of the stocks. Every client attached gets a new generation, and callbacks
    from an older one (a replaced client can still deliver) are ignored. SDK callbacks arrive on SDK threads while
    the session loop flushes, so every use of the writer holds the lock."""

    def __init__(self, index: int, codes: list[str], writer: RawWriter, monotonic: Callable[[], float],
                 wall_ms: Callable[[], int]):
        self.index = index
        self.codes = list(codes)
        self.writer = writer
        self.monotonic = monotonic
        self.wall_ms = wall_ms
        self.lock = threading.Lock()
        self.client = None
        self.generation = 0
        self.down = False
        self.full = False
        self.messages = 0
        self.bytes = 0
        self.last_seen = monotonic()
        self.acknowledged: set[str] = set()
        self.acknowledged_at: int | None = None
        self.last_books: dict[str, int] = {}
        self.gaps: list[dict] = []
        self.reconnects = 0
        self.errors: list[str] = []

    def attach(self, client) -> int:
        with self.lock:
            self.generation += 1
            generation = self.generation
            self.client = client
            self.down = False
            self.full = False
            self.acknowledged = set()
            self.acknowledged_at = None
            self.last_seen = self.monotonic()
        client.on("message", lambda message: self.on_message(generation, message))
        client.on("disconnect", lambda *args: self.on_disconnect(generation, *args))
        client.on("error", lambda *args: self.on_error(generation, *args))
        return generation

    def on_message(self, generation: int, message) -> None:
        received = self.wall_ms()
        try:
            envelope = json.loads(message) if isinstance(message, (str, bytes)) else message
        except (ValueError, UnicodeDecodeError):
            return
        if not isinstance(envelope, dict):
            return
        with self.lock:
            if generation != self.generation:
                return
            self.last_seen = self.monotonic()
            event, data = envelope.get("event"), envelope.get("data")
            if event == "subscribed":
                for row in data if isinstance(data, list) else [data]:
                    if isinstance(row, dict) and isinstance(row.get("symbol"), str):
                        self.acknowledged.add(row["symbol"])
                self.acknowledged_at = received
            elif event == "data" and envelope.get("channel") == "books" and isinstance(data, dict):
                written = self.writer.write({"r": received, "d": data})
                if written:
                    self.messages += 1
                    self.bytes += written
                    if isinstance(data.get("symbol"), str):
                        self.last_books[data["symbol"]] = received
            elif event == "error":
                if isinstance(data, dict) and data.get("code") == 1001:
                    self.full = True
                self.errors = (self.errors + [json.dumps(data, ensure_ascii=False)[:200]])[-20:]

    def on_disconnect(self, generation: int, *args) -> None:
        with self.lock:
            if generation == self.generation:
                self.down = True

    def on_error(self, generation: int, *args) -> None:
        with self.lock:
            if generation == self.generation:
                self.errors = (self.errors + [" ".join(str(arg) for arg in args)[:200]])[-20:]

    def mark(self, event: str, **values) -> None:
        with self.lock:
            self.bytes += self.writer.write({"r": self.wall_ms(), "ev": event, **values})

    def silent(self, now: float) -> bool:
        return now - self.last_seen > SILENCE_SECONDS

    def flush(self) -> None:
        with self.lock:
            self.writer.flush()

    def close(self) -> None:
        with self.lock:
            self.writer.close()
