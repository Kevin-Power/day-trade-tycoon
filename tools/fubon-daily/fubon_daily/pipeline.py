"""One fetch run: lock, login, snapshot, minute candles, validation, publishing and the status report."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from .client import ApiError, LoginError, NotFound, RateLimited, SdkUnavailable
from .credentials import CredentialsError, Redactor, load_credentials
from .normalize import (CLOSING_AUCTION_T, TAIPEI, ValidationError, daily_summary, disposition_codes,
                        minute_bars, reference_price, snapshot_listing, symbol_warnings)
from .notify import notify as windows_notify
from .store import Locked, MarketStore

CALL_SPACING = 1.1
RATE_LIMIT_WAIT = 60
ERROR_WAIT = 2
ATTEMPTS = 3
LAST_ATTEMPT_AFTER = (18, 50)
NOTIFY_TITLE = "當沖大富翁每日行情"


@dataclass
class Options:
    data: Path
    credentials: Path
    date: str | None = None
    symbols: list[str] | None = None
    last_attempt: bool = False


@dataclass
class Runtime:
    make_client: Callable
    now: Callable[[], datetime] = field(default=lambda: datetime.now(TAIPEI))
    monotonic: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    notify: Callable[[str, str], bool] = windows_notify
    version: str = "dev"
    source: str = "fubon-neo historical/candles timeframe=1"


@dataclass
class Report:
    date: str
    mode: str
    started: datetime
    total: int = 0
    fetched: int = 0
    failed: int = 0
    excluded: int = 0

    def record(self, outcome: str, reason: str | None, finished: datetime | None) -> dict:
        return {"date": self.date, "mode": self.mode, "startedAt": self.started.isoformat(timespec="seconds"),
                "finishedAt": finished.isoformat(timespec="seconds") if finished else None,
                "outcome": outcome, "reason": reason,
                "symbols": {"total": self.total, "fetched": self.fetched, "failed": self.failed,
                            "excluded": self.excluded}}


class Pacer:
    """Keeps at least CALL_SPACING seconds between Fubon calls (historical limit: 60 per minute)."""

    def __init__(self, runtime: Runtime):
        self.runtime = runtime
        self.last: float | None = None

    def wait(self) -> None:
        if self.last is not None:
            remaining = CALL_SPACING - (self.runtime.monotonic() - self.last)
            if remaining > 0:
                self.runtime.sleep(remaining)
        self.last = self.runtime.monotonic()


def fetch(pacer: Pacer, runtime: Runtime, request: Callable[[], object]) -> object | None:
    """Up to three attempts; HTTP 429 waits a minute; 404 means no regular-session data (None)."""
    for attempt in range(ATTEMPTS):
        pacer.wait()
        try:
            return request()
        except NotFound:
            return None
        except RateLimited:
            if attempt == ATTEMPTS - 1:
                raise
            runtime.sleep(RATE_LIMIT_WAIT)
        except ApiError:
            if attempt == ATTEMPTS - 1:
                raise
            runtime.sleep(ERROR_WAIT)
    return None


class Run:
    def __init__(self, options: Options, runtime: Runtime, store: MarketStore):
        self.options = options
        self.runtime = runtime
        self.store = store
        self.started = runtime.now()
        self.target = options.date or self.started.date().isoformat()
        self.mode = "backfill" if options.date else "daily"
        self.last_attempt = options.last_attempt or (self.started.hour, self.started.minute) >= LAST_ATTEMPT_AFTER
        self.report = Report(self.target, self.mode, self.started)

    def log(self, message: str) -> None:
        self.store.log(self.target, message, self.runtime.now())

    def finish(self, outcome: str, reason: str | None = None, code: int = 0, urgent: bool = False) -> int:
        self.store.write_run(self.report.record(outcome, reason, self.runtime.now()))
        self.log(f"結果：{outcome}" + (f"：{reason}" if reason else ""))
        if outcome == "failed" and (urgent or self.last_attempt):
            self.runtime.notify(NOTIFY_TITLE, self.store.redact(f"{self.target} 每日行情抓取失敗：{reason}"))
        return code

    def execute(self) -> int:
        if self.store.has_day(self.target):
            return self.finish("already-done")
        self.store.write_run(self.report.record("running", None, None))
        self.log(f"開始（{self.mode}）")
        try:
            credentials = load_credentials(self.options.credentials)
        except CredentialsError as error:
            return self.finish("failed", str(error), 2, urgent=True)
        self.store.set_redactor(Redactor(credentials.secrets()))
        client = self.runtime.make_client(credentials)
        try:
            try:
                client.login()
            except (LoginError, SdkUnavailable) as error:
                return self.finish("failed", str(error), 2, urgent=True)
            try:
                return self.fetch_day(client, Pacer(self.runtime))
            except (ApiError, ValidationError) as error:
                return self.finish("failed", f"抓取中斷：{error}", 1)
        finally:
            client.logout()

    def candidates(self, client, pacer: Pacer) -> list[dict] | int:
        snapshot = fetch(pacer, self.runtime, client.snapshot_quotes)
        self.store.save_raw(self.target, "snapshot", None, snapshot)
        snapshot_date, listings = snapshot_listing(snapshot)
        if self.mode == "daily":
            if snapshot_date != self.target:
                self.store.discard_staging(self.target)
                return self.finish("closed", f"{self.target} 休市")
            disposition = fetch(pacer, self.runtime, client.disposition_list)
            self.store.save_raw(self.target, "disposition", None, disposition)
            flagged = disposition_codes(disposition)
            return [{"code": item.code, "name": item.name, "referencePrice": reference_price(item.close, item.change),
                     "close": item.close, "change": item.change, "tradeVolume": item.trade_volume,
                     "tradeValue": item.trade_value, "disposition": item.code in flagged}
                    for item in listings if item.trade_volume > 0]
        wanted = self.options.symbols
        names = {item.code: item.name for item in listings}
        unknown = [code for code in (wanted or []) if code not in names]
        if unknown:
            return self.finish("failed", "今日上市清單找不到：" + "、".join(unknown), 1)
        result = []
        for code in wanted or list(names):
            summary = self.store.load_raw(self.target, "daily", code)
            if summary is None:
                summary = fetch(pacer, self.runtime, lambda: client.daily_candle(code, self.target))
                if summary is not None:
                    self.store.save_raw(self.target, "daily", code, summary)
            day = daily_summary(summary, code, self.target) if summary is not None else None
            if day is None:
                self.report.excluded += 1
                continue
            result.append({"code": code, "name": names[code],
                           "referencePrice": reference_price(day["close"], day["change"]), "close": day["close"],
                           "change": day["change"], "tradeVolume": day["tradeVolume"],
                           "tradeValue": day["tradeValue"], "disposition": None})
        return result

    def fetch_day(self, client, pacer: Pacer) -> int:
        candidates = self.candidates(client, pacer)
        if isinstance(candidates, int):
            return candidates
        candidates.sort(key=lambda entry: entry["tradeValue"] or 0, reverse=True)
        self.report.total = len(candidates)
        if not candidates:
            return self.finish("failed", "沒有任何有成交的股票", 1)
        bars_by_code: dict[str, list] = {}
        warnings: list[dict] = []
        errors: list[str] = []
        for position, entry in enumerate(candidates):
            code = entry["code"]
            payload = self.store.load_raw(self.target, "minute", code)
            fresh = payload is None
            if fresh:
                payload = fetch(pacer, self.runtime, lambda: client.minute_candles(code, self.target))
            bars: list = []
            if payload is not None:
                try:
                    bars = minute_bars(payload, code, self.target)
                except ValidationError as error:
                    errors.append(f"{code}（{error.kind}）")
                    self.report.failed += 1
                    self.log(f"{code} 未通過檢查：{error}")
                    continue
                if fresh:
                    self.store.save_raw(self.target, "minute", code, payload)
            if self.mode == "daily" and position == 0 and (not bars or bars[-1][0] != CLOSING_AUCTION_T):
                return self.finish("failed", "富邦歷史資料尚未更新（成交值第一名缺少 13:30 收盤 K 棒）", 1)
            if not bars:
                warnings.append({"code": code, "kind": "empty", "detail": "有成交量，但沒有盤中 1 分 K"})
                self.report.excluded += 1
                continue
            bars_by_code[code] = bars
            self.report.fetched += 1
            warnings.extend(symbol_warnings(code, bars, entry["tradeVolume"], entry["close"]))
        if errors:
            return self.finish("failed", f"{len(errors)} 檔資料未通過檢查：" + "、".join(errors[:5]), 1)
        entries = [{**entry, "bars": len(bars_by_code[entry["code"]])} for entry in candidates
                   if entry["code"] in bars_by_code]
        coverage = "selected" if self.options.symbols else "full-market"
        self.store.publish_day(self.target, coverage, entries, bars_by_code, warnings, self.report.excluded,
                               self.runtime.now(), self.runtime.source, self.runtime.version)
        self.store.prune(self.started.date())
        return self.finish("ok")


def run(options: Options, runtime: Runtime, store: MarketStore | None = None) -> int:
    store = store or MarketStore(options.data)
    started = runtime.now()
    target = options.date or started.date().isoformat()
    try:
        with store.lock(started):
            return Run(options, runtime, store).execute()
    except Locked:
        store.log(target, "上一個工作仍在執行，這次略過", started)
        return 0
