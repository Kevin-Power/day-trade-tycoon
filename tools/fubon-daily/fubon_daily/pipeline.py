"""One fetch run: lock, login, snapshot, today's trades, minute candles, validation, publishing and the status report."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from .client import ApiError, LoginError, NotFound, RateLimited, SdkUnavailable
from .credentials import CredentialsError, Redactor, load_credentials
from .normalize import (CLOSING_AUCTION_T, TAIPEI, ValidationError, daily_summary, disposition_codes,
                        minute_bars, reference_price, snapshot_listing, symbol_warnings, tick_warnings, trade_rows)
from .notify import notify as windows_notify
from .store import Locked, MarketStore

CALL_SPACING = 1.1
RATE_LIMIT_WAIT = 60
ERROR_WAIT = 2
ATTEMPTS = 3
LAST_ATTEMPT_AFTER = (18, 50)
# Fubon finishes updating the day's history by 16:30.
DAILY_EARLIEST = (16, 30)
MESSAGE_LIMIT = 300
NOTIFY_TITLE = "當沖大富翁每日行情"
# Today's trades: Fubon serves them for the current day only, so each daily run keeps them for the stocks
# lessons use and the day's most traded ones. The intraday limit is 300 calls a minute.
LESSON_SYMBOLS = ("2330", "2317", "2454", "2382", "2308")
TICK_TOP = 20
TRADE_PAGE_SIZE = 500
MAX_TRADE_PAGES = 1000
INTRADAY_SPACING = 0.25
TICK_SOURCE = "fubon-neo intraday/trades"


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
    """Keeps calls apart: CALL_SPACING seconds by default (historical limit: 60 per minute)."""

    def __init__(self, runtime: Runtime, spacing: float = CALL_SPACING):
        self.runtime = runtime
        self.spacing = spacing
        self.last: float | None = None

    def wait(self) -> None:
        if self.last is not None:
            remaining = self.spacing - (self.runtime.monotonic() - self.last)
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

    def elapsed(self) -> int:
        return round((self.runtime.now() - self.started).total_seconds())

    def finish(self, outcome: str, reason: str | None = None, code: int = 0, urgent: bool = False) -> int:
        # Secrets are masked before shortening, so a long message can never keep half a secret.
        reason = self.store.redact(reason)[:MESSAGE_LIMIT] if reason else None
        self.log(f"結果：{outcome}" + (f"：{reason}" if reason else "") + f"（{self.elapsed()} 秒）")
        if outcome == "already-done":
            return code  # keeps the last real run on the teacher card
        self.store.write_run(self.report.record(outcome, reason, self.runtime.now()))
        if outcome == "failed" and (urgent or self.last_attempt):
            self.runtime.notify(NOTIFY_TITLE, self.store.redact(f"{self.target} 每日行情抓取失敗：{reason}")[:MESSAGE_LIMIT])
        return code

    def execute(self) -> int:
        self.store.reconcile()
        self.candles_due = not self.store.has_day(self.target)
        self.ticks_due = self.mode == "daily" and not self.store.has_ticks(self.target)
        if not (self.candles_due or self.ticks_due):
            return self.finish("already-done")
        if self.mode == "daily" and (self.started.hour, self.started.minute) < DAILY_EARLIEST:
            self.log("每日抓取要 16:30 以後才執行（富邦歷史資料尚未更新），這次略過")
            return 0
        if self.candles_due:
            self.store.write_run(self.report.record("running", None, None))
        self.log(f"開始（{self.mode}）")
        try:
            credentials = load_credentials(self.options.credentials)
        except CredentialsError as error:
            return self.finish("failed", str(error), 2, urgent=True)
        self.store.set_redactor(Redactor(credentials.secrets()))
        try:
            client = self.runtime.make_client(credentials)
            try:
                try:
                    client.login()
                except (LoginError, SdkUnavailable) as error:
                    return self.finish("failed", str(error), 2, urgent=True)
                self.log("登入成功")
                return self.fetch_day(client, Pacer(self.runtime))
            finally:
                client.logout()
        except (ApiError, ValidationError) as error:
            return self.finish("failed", f"抓取中斷：{error}", 1)
        except Exception as error:  # noqa: BLE001 - pythonw has no console: record every failure
            return self.finish("failed", f"未預期的錯誤：{type(error).__name__}: {error}", 1)

    def candidates(self, client, pacer: Pacer) -> list[dict] | int:
        snapshot = fetch(pacer, self.runtime, client.snapshot_quotes)
        if self.candles_due:
            self.store.save_raw(self.target, "snapshot", None, snapshot)
        snapshot_date, listings = snapshot_listing(snapshot)
        if self.mode == "daily":
            if snapshot_date != self.target:
                self.store.discard_staging(self.target)
                return self.finish("closed", f"{self.target} 休市")
            disposition = fetch(pacer, self.runtime, client.disposition_list)
            if self.candles_due:
                self.store.save_raw(self.target, "disposition", None, disposition)
            flagged = disposition_codes(disposition)
            traded = [item for item in listings if item.trade_volume > 0]
            self.log(f"快照：{len(listings)} 檔上市普通股，{len(traded)} 檔有成交，處置股 {len(flagged)} 檔")
            return [{"code": item.code, "name": item.name, "referencePrice": reference_price(item.close, item.change),
                     "close": item.close, "change": item.change, "tradeVolume": item.trade_volume,
                     "tradeValue": item.trade_value, "disposition": item.code in flagged}
                    for item in traded]
        wanted = self.options.symbols
        names = {item.code: item.name for item in listings}
        unknown = [code for code in (wanted or []) if code not in names]
        if unknown:
            return self.finish("failed", "今日上市清單找不到：" + "、".join(unknown), 1)
        self.log(f"快照：補抓 {self.target}，{len(wanted or names)} 檔")
        result = []
        for code in wanted or list(names):
            payload = self.store.load_raw(self.target, "daily", code)
            fresh = payload is None
            if fresh:
                payload = fetch(pacer, self.runtime, lambda: client.daily_candle(code, self.target))
            # Validate before keeping evidence, so a bad answer is fetched again next time.
            day = daily_summary(payload, code, self.target) if payload is not None else None
            if fresh and payload is not None:
                self.store.save_raw(self.target, "daily", code, payload)
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
        if self.ticks_due:
            self.keep_ticks(client, candidates)
        if not self.candles_due:
            return self.finish("already-done")
        self.report.total = len(candidates)
        if not candidates:
            return self.finish("failed", "沒有任何有成交的股票", 1)
        # Fubon's history is complete once the most traded ordinary stock has its 13:30 auction bar;
        # disposition stocks match in batches and may not have one.
        ready_code = next((entry["code"] for entry in candidates if entry["disposition"] is not True), None)
        bars_by_code: dict[str, list] = {}
        warnings: list[dict] = []
        errors: list[str] = []
        for entry in candidates:
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
            if self.mode == "daily" and code == ready_code and (not bars or bars[-1][0] != CLOSING_AUCTION_T):
                self.store.drop_raw(self.target, "minute", code)
                return self.finish("failed", f"富邦歷史資料尚未更新（{code} 缺少 13:30 收盤 K 棒）", 1)
            if fresh and payload is not None:
                self.store.save_raw(self.target, "minute", code, payload)
            if not bars:
                warnings.append({"code": code, "kind": "empty", "detail": "有成交量，但沒有盤中 1 分 K"})
                self.report.excluded += 1
                continue
            bars_by_code[code] = bars
            self.report.fetched += 1
            warnings.extend(symbol_warnings(code, bars, entry["tradeVolume"], entry["close"]))
        self.log(f"1 分 K：{self.report.fetched}／{self.report.total} 檔通過，排除 {self.report.excluded} 檔，"
                 f"未通過 {self.report.failed} 檔，已耗時 {self.elapsed()} 秒")
        if errors:
            return self.finish("failed", f"{len(errors)} 檔資料未通過檢查：" + "、".join(errors[:5]), 1)
        entries = [{**entry, "bars": len(bars_by_code[entry["code"]])} for entry in candidates
                   if entry["code"] in bars_by_code]
        coverage = "selected" if self.options.symbols else "full-market"
        self.store.publish_day(self.target, coverage, entries, bars_by_code, warnings, self.report.excluded,
                               self.runtime.now(), self.runtime.source, self.runtime.version)
        self.log(f"上架 {self.target}：{len(entries)} 檔，警告 {len(warnings)} 筆")
        self.store.prune(self.started.date())
        return self.finish("ok")


    def trade_pages(self, client, pacer: Pacer, code: str) -> list:
        """Every page of the symbol's trades today, oldest first, until Fubon returns an empty page."""
        pages: list = []
        offset = 0
        for _ in range(MAX_TRADE_PAGES):
            page = fetch(pacer, self.runtime, lambda: client.trades(code, offset, TRADE_PAGE_SIZE))
            rows = page.get("data") if isinstance(page, dict) else None
            if page is None or rows == []:
                return pages
            if not isinstance(rows, list):
                raise ValidationError("structure", "data 不是陣列")
            pages.append(page)
            offset += len(rows)
        raise ValidationError("structure", f"成交超過 {MAX_TRADE_PAGES} 頁")

    def keep_ticks(self, client, candidates: list[dict]) -> None:
        """Today's trades for lesson stocks and the most traded ones. Failures stay here: candles go on."""
        started = self.elapsed()
        top = candidates[:TICK_TOP]
        chosen = top + [entry for entry in candidates if entry["code"] in LESSON_SYMBOLS and entry not in top]
        record = {"date": self.target, "outcome": "failed", "reason": None,
                  "symbols": {"total": len(chosen), "fetched": 0, "failed": 0}, "trades": 0, "finishedAt": None}
        try:
            self.log(f"逐筆：{len(chosen)} 檔（成交值前 {TICK_TOP} 名與教材股）")
            pacer = Pacer(self.runtime, INTRADAY_SPACING)
            trades_by_code: dict[str, list] = {}
            entries: list[dict] = []
            warnings: list[dict] = []
            failures: list[str] = []
            for entry in chosen:
                code = entry["code"]
                pages = self.store.load_tick_raw(self.target, code)
                fresh = pages is None
                try:
                    if fresh:
                        pages = self.trade_pages(client, pacer, code)
                    trades = trade_rows(pages, code, self.target)
                except (ApiError, ValidationError) as error:
                    failures.append(code)
                    self.log(f"逐筆 {code} 失敗：{error}")
                    continue
                if fresh:
                    self.store.save_tick_raw(self.target, code, pages)
                if not trades:
                    warnings.append({"code": code, "kind": "empty", "detail": "有成交量，但沒有逐筆成交"})
                    continue
                trades_by_code[code] = trades
                entries.append({"code": code, "name": entry["name"], "trades": len(trades),
                                "volume": sum(trade[2] for trade in trades), "close": trades[-1][1]})
                warnings.extend(tick_warnings(code, trades, entry["tradeVolume"], entry["close"]))
            record["symbols"].update(fetched=len(entries), failed=len(failures))
            record["trades"] = sum(len(rows) for rows in trades_by_code.values())
            if failures:
                record["reason"] = f"{len(failures)} 檔沒抓到：" + "、".join(failures[:10])
            if failures and not self.last_attempt:
                self.log(f"逐筆：{len(failures)} 檔失敗，等下一次排程再抓（{self.elapsed() - started} 秒）")
            elif not entries:
                record["reason"] = record["reason"] or "沒有任何逐筆成交"
            else:
                self.store.publish_ticks(self.target, entries, trades_by_code, warnings, self.runtime.now(),
                                         TICK_SOURCE, self.runtime.version)
                record["outcome"] = "partial" if failures else "ok"
                self.log(f"逐筆：上架 {len(entries)} 檔、{record['trades']} 筆，警告 {len(warnings)} 筆"
                         f"（{self.elapsed() - started} 秒）")
        except Exception as error:  # noqa: BLE001 - trades must never stop the day's candles
            record["reason"] = f"未預期的錯誤：{type(error).__name__}: {error}"
            self.log(f"逐筆中斷：{record['reason']}")
        record["reason"] = self.store.redact(record["reason"])[:MESSAGE_LIMIT] if record["reason"] else None
        record["finishedAt"] = self.runtime.now().isoformat(timespec="seconds")
        self.store.write_ticks_status(record)
        if record["outcome"] != "ok" and self.last_attempt:
            self.runtime.notify(NOTIFY_TITLE, self.store.redact(
                f"{self.target} 逐筆成交只收到 {record['symbols']['fetched']}／{record['symbols']['total']} 檔："
                f"{record['reason']}")[:MESSAGE_LIMIT])


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
