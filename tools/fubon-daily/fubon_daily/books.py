"""Today's real 五檔 (WebSocket `books`) for every listed common stock, recorded as received during the session.

Fubon streams order books live only, so a moment not recorded is lost. The recorder logs in once, holds four
connections, writes every books message unchanged and reconnects with backoff. Turning the raw files into compact
per-stock files happens after the close (stage 2). Design: docs/superpowers/specs/2026-10-26-fubon-books-recorder-design.md.
"""
from __future__ import annotations

import gzip
import json
import random as random_module
import threading
import time as clock_time
import zlib
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Callable

from .client import ApiError, LoginError, SdkUnavailable
from .credentials import CredentialsError, Redactor, load_credentials
from .normalize import TAIPEI, ValidationError, snapshot_listing
from .notify import notify as windows_notify
from .pipeline import NOTIFY_TITLE

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
# A subscription Fubon never acknowledges is a failed attempt: heartbeats alone would keep it looking alive.
SUBSCRIBE_TIMEOUT = 20
DISCONNECT_TIMEOUT = 5
DISK_CHECK_SECONDS = 60
MESSAGE_LIMIT = 300
BOOKS_CHANNEL = "books"
RESTART_REASON = "程式重新啟動"
# Held for the whole session (about 5 h); the fetcher's 2.5 h rule would hand a running recorder's lock to a
# re-start trigger.
BOOKS_LOCK = ".books.lock"
BOOKS_LOCK_STALE_SECONDS = 7 * 3600


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

    def write_rest(self, code: str, answer: object) -> None:
        """A REST quote that refills a book after a reconnect, kept apart from the stream by `src`."""
        with self.lock:
            received = self.wall_ms()
            written = self.writer.write({"r": received, "src": "rest", "d": answer})
            if written:
                self.bytes += written
                self.last_books[code] = received

    def silent(self, now: float) -> bool:
        return now - self.last_seen > SILENCE_SECONDS

    def flush(self) -> None:
        with self.lock:
            self.writer.flush()

    def close(self) -> None:
        with self.lock:
            self.writer.close()


def run_with_timeout(call: Callable[[], object], seconds: float) -> tuple[bool, object]:
    """Runs `call` for at most `seconds` in a daemon thread: the SDK's connect() can spin forever before on_open,
    and init_realtime has no timeout. A call still running is abandoned; the caller drops that client."""
    outcome: dict = {}

    def target():
        try:
            outcome["value"] = call()
        except Exception as error:  # noqa: BLE001 - handed back to the caller
            outcome["error"] = error

    worker = threading.Thread(target=target, daemon=True)
    worker.start()
    worker.join(seconds)
    if worker.is_alive():
        return False, "逾時"
    if "error" in outcome:
        return False, outcome["error"]
    return True, outcome.get("value")


@dataclass
class BooksRuntime:
    make_client: Callable
    now: Callable[[], datetime] = field(default=lambda: datetime.now(TAIPEI))
    monotonic: Callable[[], float] = clock_time.monotonic
    sleep: Callable[[float], None] = clock_time.sleep
    notify: Callable[[str, str], bool] = windows_notify
    random: Callable[[], float] = random_module.random
    version: str = "dev"
    run_with_timeout: Callable[[Callable[[], object], float], tuple[bool, object]] = run_with_timeout
    connect_timeout: float = CONNECT_TIMEOUT


@dataclass
class Link:
    """A stream's connection state as the session loop drives it."""
    stream: Stream
    backoff: Backoff
    state: str = "pending"  # pending (never up yet), subscribing, up, down
    next_attempt: float = 0.0
    subscribing_since: float = 0.0
    down_since: float | None = None
    noticed: bool = False
    ever_up: bool = False
    refill_at: int | None = None
    base_messages: int = 0
    base_reconnects: int = 0


class Recorder:
    """One trading session: log in once, hold a connection per group of stocks, keep every books message, end at
    the stop time. Exit code 0 for ok, partial, closed and late; 1 for failed; 2 for login settings or login."""

    def __init__(self, data: Path, credentials: Path, runtime: BooksRuntime, store, stop_at: time = STOP_AT,
                 test_mode: bool = False):
        self.data = Path(data)
        self.credentials = Path(credentials)
        self.runtime = runtime
        self.store = store
        self.stop_at = stop_at
        self.test_mode = test_mode
        self.client = None
        self.links: list[Link] = []
        self.refills: list[tuple[Link, str]] = []
        self.reason: str | None = None
        self.closed = False
        self.started = runtime.now()
        self.day = self.started.date().isoformat()
        self.symbols = 0
        self.dropped: list[str] = []
        self.carried: dict | None = None
        self.last_attempt: tuple[float, int] | None = None

    # ---- small helpers ----------------------------------------------------------------------------------

    def at_today(self, moment: time) -> datetime:
        return datetime.combine(self.started.date(), moment, TAIPEI)

    def wall_ms(self) -> int:
        return int(self.runtime.now().timestamp() * 1000)

    def wall_at(self, monotonic: float) -> datetime:
        return self.runtime.now() - timedelta(seconds=self.runtime.monotonic() - monotonic)

    @staticmethod
    def iso(moment: datetime) -> str:
        return moment.isoformat(timespec="seconds")

    def log(self, message: str) -> None:
        self.store.books_log(self.day, message, self.runtime.now())

    def notice(self, body: str) -> None:
        self.runtime.notify(NOTIFY_TITLE, self.store.redact(f"{self.day} 盤中五檔：{body}")[:MESSAGE_LIMIT])

    @property
    def streams(self) -> list[Stream]:
        return [link.stream for link in self.links]

    # ---- the session --------------------------------------------------------------------------------------

    def run(self) -> int:
        stop = self.at_today(self.stop_at)
        if self.started >= stop:
            return self.late()
        earlier = self.store.read_books_status()
        today = earlier if earlier and earlier.get("date") == self.day else None
        if today and today.get("outcome") in ("closed", "ok"):
            # A re-start trigger after a holiday was called (or after the day ended): no new login.
            self.log("今天已經判定休市，這次略過" if today["outcome"] == "closed" else "今天已經錄完，這次略過")
            return 0
        free = self.store.free_bytes()
        if free < MIN_FREE_START:
            return self.fail(f"磁碟空間不足（剩 {free / 2**30:.1f} GB，至少要 {MIN_FREE_START // 2**30} GB），今天不錄", 1)
        if today and today.get("outcome") in ("running", "partial"):
            self.carried = today  # a crash, then a re-start trigger: go on with the same day
        try:
            credentials = load_credentials(self.credentials)
        except CredentialsError as error:
            return self.fail(str(error), 2)
        self.store.set_redactor(Redactor(credentials.secrets()))
        if not self.test_mode:
            opening = self.at_today(OPEN_AT)
            while self.runtime.now() < opening:
                self.runtime.sleep(min(60.0, (opening - self.runtime.now()).total_seconds()))
        self.client = self.runtime.make_client(credentials)
        try:
            try:
                note = self.client.login()
            except (LoginError, SdkUnavailable) as error:
                return self.fail(str(error), 2)
            self.log("登入成功" + (f"；{note}" if note else ""))
            codes = self.symbol_list()
            if not codes:
                return self.fail("取不到上市普通股清單（快照和最近一天的清單都沒有）", 1)
            self.symbols = len(codes)
            groups, self.dropped = split_symbols(codes)
            if self.dropped:
                self.log(f"超過 {CONNECTIONS} 條連線的容量，{len(self.dropped)} 檔沒有錄：" + "、".join(self.dropped[:10]))
            self.setup(groups)
            self.write_status("running")
            self.loop(stop)
        except Exception as error:  # noqa: BLE001 - pythonw has no console: record every failure
            self.reason = self.reason or f"未預期的錯誤：{type(error).__name__}: {error}"
            self.log(self.reason)
        finally:
            self.close_all()
        return self.conclude()

    def symbol_list(self) -> list[str]:
        try:
            _, listings = snapshot_listing(self.client.snapshot_quotes())
            codes = [item.code for item in sorted(listings, key=lambda item: item.trade_value, reverse=True)]
            if codes:
                self.log(f"股票清單：快照 {len(codes)} 檔上市普通股")
                return codes
        except (ApiError, ValidationError) as error:
            self.log(f"快照失敗（{error}），改用最近一天的全市場清單")
        codes = self.store.latest_full_market_codes() or []
        if codes:
            self.log(f"股票清單：最近一天的全市場清單 {len(codes)} 檔")
        return codes

    def setup(self, groups: list[list[str]]) -> None:
        folder = self.store.books_raw_folder(self.day)
        start = self.runtime.monotonic()
        carried = {item.get("index"): item for item in (self.carried or {}).get("connections", [])
                   if isinstance(item, dict)}
        for number, group in enumerate(groups, start=1):
            if not group:
                continue  # fewer stocks than connections: no point holding a slot
            stream = Stream(number, group, RawWriter(folder, f"conn{number}"), self.runtime.monotonic, self.wall_ms)
            link = Link(stream, Backoff(self.runtime.random), next_attempt=start)
            if self.carried:
                earlier = carried.get(number) or {}
                stream.gaps = list(earlier.get("gaps") or []) + [
                    {"from": self.carried.get("updatedAt"), "to": None, "reason": RESTART_REASON}]
                link.base_messages = int(earlier.get("messages") or 0)
                link.base_reconnects = int(earlier.get("reconnects") or 0)
            self.links.append(link)
        if self.carried:
            self.log(f"同一天重新啟動：接著 {self.carried.get('updatedAt')} 的紀錄")

    def loop(self, stop: datetime) -> None:
        last_flush = last_status = last_disk = self.runtime.monotonic()
        holiday_check = max(self.at_today(CLOSED_CHECK), self.started + timedelta(minutes=5))
        checked = self.test_mode
        # Not on a trading day's last minutes; a trial (test mode) may run at any hour.
        retry_until = stop if self.test_mode else min(self.at_today(RETRY_UNTIL), stop)
        while True:
            now, mono = self.runtime.now(), self.runtime.monotonic()
            if now >= stop:
                return
            for link in self.links:
                self.watch(link, now, mono, retry_until)
            self.refill(now)
            mono = self.runtime.monotonic()
            if mono - last_flush >= FLUSH_SECONDS:
                for stream in self.streams:
                    stream.flush()
                last_flush = mono
            failed = next((stream.writer.error for stream in self.streams if stream.writer.error), None)
            if failed:
                self.reason = f"寫入失敗，停止錄製：{failed}"
                self.log(self.reason)
                return
            if mono - last_disk >= DISK_CHECK_SECONDS:
                last_disk = mono
                free = self.store.free_bytes()
                if free < MIN_FREE_RUN:
                    self.reason = f"磁碟空間不足（剩 {free / 2**30:.1f} GB），停止錄製"
                    self.log(self.reason)
                    return
            if not checked and self.runtime.now() >= holiday_check:
                checked = True
                heard = any(link.ever_up for link in self.links)
                if heard and sum(stream.messages for stream in self.streams) == 0:
                    self.closed = True
                    return
            if mono - last_status >= STATUS_EVERY:
                self.write_status("running")
                last_status = mono
            self.runtime.sleep(1)

    # ---- one connection -------------------------------------------------------------------------------------

    def watch(self, link: Link, now: datetime, mono: float, retry_until: datetime) -> None:
        stream = link.stream
        if link.state == "up":
            link.backoff.tick(mono)
            if stream.down or stream.silent(mono):
                self.went_down(link, mono, "斷線" if stream.down else f"{SILENCE_SECONDS} 秒沒有任何訊息")
        elif link.state == "subscribing":
            if stream.acknowledged_at is not None and not stream.down:
                self.subscribed(link, mono)
            elif stream.down:
                self.failed_attempt(link, mono, "訂閱時被拒絕或斷線" + ("（連線數已滿）" if stream.full else ""))
            elif mono - link.subscribing_since > SUBSCRIBE_TIMEOUT:
                self.failed_attempt(link, mono, f"訂閱 {SUBSCRIBE_TIMEOUT} 秒沒有回應")
        if link.state in ("pending", "down"):
            if (link.down_since is not None and not link.noticed
                    and mono - link.down_since >= DOWN_NOTICE_SECONDS):
                link.noticed = True
                self.notice(f"第 {stream.index} 條連線斷線超過 {DOWN_NOTICE_SECONDS // 60} 分鐘，仍在重連")
            staggered = (self.last_attempt is None or self.last_attempt[1] == stream.index
                         or mono - self.last_attempt[0] >= STAGGER_SECONDS)
            if mono >= link.next_attempt and now < retry_until and staggered:
                self.connect(link, mono)

    def connect(self, link: Link, mono: float) -> None:
        stream = link.stream
        self.last_attempt = (mono, stream.index)
        if stream.client is not None:
            self.abandon(stream.client)
        ok, client = self.runtime.run_with_timeout(self.client.stock_stream, self.runtime.connect_timeout)
        if not ok:
            return self.failed_attempt(link, self.runtime.monotonic(), f"取得新連線失敗：{client}")
        generation = stream.attach(client)
        ok, error = self.runtime.run_with_timeout(client.connect, self.runtime.connect_timeout)
        if not ok:
            self.abandon(client)
            return self.failed_attempt(link, self.runtime.monotonic(), f"連線失敗：{error}")
        try:
            client.subscribe({"channel": BOOKS_CHANNEL, "symbols": stream.codes})
        except Exception as error:  # noqa: BLE001 - one failed attempt, retried with backoff
            self.abandon(client)
            return self.failed_attempt(link, self.runtime.monotonic(), f"訂閱失敗：{type(error).__name__}")
        stream.mark("connected", generation=generation, symbols=len(stream.codes), codes=stream.codes)
        link.state = "subscribing"
        link.subscribing_since = self.runtime.monotonic()

    def abandon(self, client) -> None:
        self.runtime.run_with_timeout(client.disconnect, DISCONNECT_TIMEOUT)

    def subscribed(self, link: Link, mono: float) -> None:
        stream = link.stream
        link.state = "up"
        link.ever_up = True
        link.backoff.connected(mono)
        stream.mark("subscribed", symbols=len(stream.acknowledged))
        missing = sorted(set(stream.codes) - stream.acknowledged)
        if missing:
            self.log(f"第 {stream.index} 條連線有 {len(missing)} 檔沒有確認訂閱：" + "、".join(missing[:10]))
        open_gaps = [gap for gap in stream.gaps if gap["to"] is None]
        if open_gaps:
            moment = self.iso(datetime.fromtimestamp(stream.acknowledged_at / 1000, TAIPEI))
            for gap in open_gaps:
                gap["to"] = moment
            link.refill_at = stream.acknowledged_at + REFILL_WAIT * 1000
            stream.reconnects += 1
            self.log(f"第 {stream.index} 條連線恢復，缺漏到 {moment}")
        link.down_since = None
        link.noticed = False

    def went_down(self, link: Link, mono: float, reason: str) -> None:
        stream = link.stream
        since = self.wall_at(stream.last_seen)
        stream.gaps.append({"from": self.iso(since), "to": None, "reason": reason})
        stream.mark("down", reason=reason, since=int(since.timestamp() * 1000))
        link.state = "down"
        link.down_since = mono
        link.noticed = False
        link.refill_at = None
        wait = link.backoff.failure(mono, full=stream.full)
        link.next_attempt = mono + wait
        self.log(f"第 {stream.index} 條連線：{reason}，{wait:.0f} 秒後重連")

    def failed_attempt(self, link: Link, mono: float, reason: str) -> None:
        link.state = "down" if link.ever_up else "pending"
        if link.down_since is None:
            link.down_since = mono
        wait = link.backoff.failure(mono, full=link.stream.full)
        link.next_attempt = mono + wait
        self.log(f"第 {link.stream.index} 條連線：{reason}，{wait:.0f} 秒後再試")

    def refill(self, now: datetime) -> None:
        wall = int(now.timestamp() * 1000)
        for link in self.links:
            if link.refill_at is not None and link.state == "up" and wall >= link.refill_at:
                stream = link.stream
                since = stream.acknowledged_at or 0
                self.refills.extend((link, code) for code in stream.codes if stream.last_books.get(code, 0) <= since)
                link.refill_at = None
        for done in range(int(1 / REFILL_SPACING)):
            if not self.refills:
                return
            if done:
                self.runtime.sleep(REFILL_SPACING)
            link, code = self.refills.pop(0)
            try:
                answer = self.client.quote(code)
            except Exception as error:  # noqa: BLE001 - counted, not retried
                link.stream.errors = (link.stream.errors + [f"補五檔 {code}：{type(error).__name__}"])[-20:]
                continue
            link.stream.write_rest(code, answer)
            link.stream.mark("refill", symbol=code)

    # ---- the end ------------------------------------------------------------------------------------------

    def close_all(self) -> None:
        for stream in self.streams:
            if stream.client is not None and not stream.writer.error:
                stream.mark("stop")
        for stream in self.streams:
            if stream.client is not None:
                self.abandon(stream.client)
        if self.client is not None:
            self.client.logout()
        for stream in self.streams:
            stream.close()

    def conclude(self) -> int:
        if self.closed:
            self.store.remove_books_staging(self.day)
            self.log("休市：開盤後都沒有任何五檔資料")
            self.write_status("closed", "休市", finished=True)
            return 0
        never_up = [str(link.stream.index) for link in self.links if not link.ever_up]
        gaps = any(gap for stream in self.streams for gap in stream.gaps)
        reason = (self.reason
                  or (f"第 {'、'.join(never_up)} 條連線一直沒連上" if never_up else None)
                  or (f"{len(self.dropped)} 檔超過連線容量沒有錄" if self.dropped else None)
                  or ("有斷線缺漏，見 connections 的 gaps" if gaps else None))
        outcome = "partial" if reason else "ok"
        self.write_status(outcome, reason, finished=True)
        self.log(f"結束：{outcome}" + (f"：{reason}" if reason else ""))
        if self.reason:
            self.notice(self.reason)
        return 0

    def late(self) -> int:
        self.log(f"已過 {self.stop_at:%H:%M}，今天不再錄")
        existing = self.store.read_books_status()
        if not (existing and existing.get("date") == self.day):
            self.write_status("late", f"已過 {self.stop_at:%H:%M}", finished=True)
        return 0

    def fail(self, reason: str, code: int) -> int:
        self.write_status("failed", reason, finished=True)
        self.log(f"失敗：{reason}")
        self.notice(reason)
        return code

    def write_status(self, outcome: str, reason: str | None = None, finished: bool = False) -> None:
        now = self.iso(self.runtime.now())
        connections = [{"index": link.stream.index, "symbols": len(link.stream.codes),
                        "messages": link.base_messages + link.stream.messages,
                        "reconnects": link.base_reconnects + link.stream.reconnects,
                        "up": link.state == "up", "gaps": link.stream.gaps,
                        "errors": link.stream.errors[-5:]} for link in self.links]
        carried = self.carried or {}
        entry = {"schema": 1, "date": self.day, "outcome": outcome,
                 "reason": reason[:MESSAGE_LIMIT] if reason else None,
                 "startedAt": carried.get("startedAt") or self.iso(self.started), "updatedAt": now,
                 "finishedAt": now if finished else None, "symbols": self.symbols, "dropped": self.dropped,
                 "messages": sum(item["messages"] for item in connections) or int(carried.get("messages") or 0),
                 "rawBytes": int(carried.get("rawBytes") or 0) + sum(stream.bytes for stream in self.streams),
                 "connections": connections, "version": self.runtime.version}
        self.store.write_books_status(entry)
