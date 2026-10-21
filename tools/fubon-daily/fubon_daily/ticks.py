"""Today's trade-by-trade data (intraday/trades) for every listed common stock that traded, most traded first.

Fubon serves trades for the current day only, so a day that is not kept is lost. Every answer is saved as
received before it is checked; a stock whose answer is missing, cut short or fails the checks waits for the
next trigger. Until a whole answer comes, the fullest one that fell short (short of the day's volume, or the
pages fetched before an answer broke off) is set aside as the stock's fallback, never thrown away. The last
attempt of the day publishes what it has: rejected answers with their reason, and for a stock it got no answer
for, the fallback (complete: false). A later run publishes anything an earlier day left in staging. Nothing
here may stop the day's candles.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from .client import ApiError
from .normalize import ValidationError, split_session, tick_warnings, trade_rows

if TYPE_CHECKING:
    from .pipeline import Run

TRADE_PAGE_SIZE = 500
MAX_TRADE_ROWS = 2_000_000
# The intraday limit is 300 calls a minute.
INTRADAY_SPACING = 0.25
# Earlier runs stop starting new stocks after this long, leaving time for the candles.
TICK_BUDGET_SECONDS = 45 * 60
# The last run has no later run to leave stocks to, but Windows stops the task after two hours, so it stops
# starting new stocks after this long and the candles, the publish and the notice still fit...
LAST_ATTEMPT_BUDGET_SECONDS = 70 * 60
# ...or after this long when the candles are already published and only today's trades are left.
LAST_ATTEMPT_TRADES_ONLY_BUDGET_SECONDS = 100 * 60
# Earlier runs take this many stocks in a row that Fubon fails to answer, even after retries, as Fubon being
# down and leave the rest to the next run. The last run keeps trying: its time cap is enough.
FAILURE_STREAK = 15
TICK_SOURCE = "fubon-neo intraday/trades"
MESSAGE_LIMIT = 300


def assess(pages: list, code: str, day: str, meta: dict) -> dict:
    """ok, incomplete (fewer lots than the day's volume, or cut short) or rejected (fails the checks), with the
    trades."""
    try:
        trades = trade_rows(pages, code, day)
    except ValidationError as error:
        return {"code": code, "name": meta["name"], "status": "rejected", "error": str(error)}
    trades, after_hours = split_session(trades)
    if not trades:
        return {"code": code, "name": meta["name"], "status": "rejected", "error": "一般交易時段沒有任何成交"}
    total = sum(trade[2] for trade in trades)
    status = "incomplete" if total < meta["tradeVolume"] else "ok"
    error = f"逐筆量 {total} 少於當日量 {meta['tradeVolume']}" if status == "incomplete" else None
    if meta.get("cut"):  # pages kept from an answer that broke off: whatever came after them is missing
        status, error = "incomplete", "；".join(filter(None, (error, meta["cut"])))
    return {"code": code, "name": meta["name"], "status": status, "error": error, "trades": trades,
            "afterHours": after_hours,
            "warnings": tick_warnings(code, trades, meta["tradeVolume"], meta["close"], after_hours)}


def covered_lots(pages: list, code: str, day: str, meta: dict) -> int:
    """How much of the day an answer covers: its regular-session lots, or -1 when it fails the checks."""
    result = assess(pages, code, day, meta)
    return sum(trade[2] for trade in result["trades"]) if "trades" in result else -1


class Ticks:
    def __init__(self, run: "Run"):
        self.run = run
        self.store = run.store
        self.runtime = run.runtime
        self.page_size_logged = False

    def pages(self, client, pacer, code: str, meta: dict) -> list:
        """Every page of today's trades, oldest first. A missing or empty answer for a traded stock is a failure;
        the pages fetched before a failure are set aside in case no whole answer comes."""
        from .pipeline import fetch

        pages: list = []
        offset = 0
        try:
            while True:
                page = fetch(pacer, self.runtime, lambda: client.trades(code, offset, TRADE_PAGE_SIZE))
                if page is None:
                    raise ValidationError("missing", f"富邦回覆查無成交（第 {offset} 筆起）")
                rows = page.get("data") if isinstance(page, dict) else None
                if not isinstance(rows, list):
                    raise ValidationError("structure", "data 不是陣列")
                if not rows:
                    if not pages:
                        raise ValidationError("missing", "富邦回覆沒有任何成交")
                    return pages
                if not self.page_size_logged:
                    self.page_size_logged = True
                    self.run.log(f"逐筆：第一頁回 {len(rows)} 筆（每頁要求 {TRADE_PAGE_SIZE} 筆）")
                pages.append(page)
                offset += len(rows)
                if offset > MAX_TRADE_ROWS:
                    raise ValidationError("structure", f"成交超過 {MAX_TRADE_ROWS} 筆")
        except Exception as error:
            if pages:
                self.set_aside(self.run.target, code, pages,
                               {**meta, "cut": self.store.redact(f"只抓到前 {offset} 筆（{error}）")})
            raise

    def stop_reason(self, started: float, streak: int) -> str | None:
        """Why no new stock is started: this run's time for trades is spent, or (earlier runs) Fubon keeps failing."""
        spent = self.runtime.monotonic() - started
        if self.run.last_attempt:
            budget = LAST_ATTEMPT_BUDGET_SECONDS if self.run.candles_due else LAST_ATTEMPT_TRADES_ONLY_BUDGET_SECONDS
            return "最後一次執行的時間用完" if spent > budget else None
        if streak >= FAILURE_STREAK:
            return f"富邦連續 {streak} 檔出錯，這次先停，下次再抓"
        return "時間不夠，下次再抓" if spent > TICK_BUDGET_SECONDS else None

    def collect(self, client, candidates: list[dict]) -> None:
        """Fetches, keeps and checks today's trades, then publishes them or leaves them for the next run.

        Candidates are the stocks that traded, most traded first, so a run cut short keeps the most traded ones.
        """
        from .pipeline import Pacer

        day = self.run.target
        started = self.runtime.monotonic()
        results: list[dict] = []
        record = {"date": day, "outcome": "failed", "reason": None,
                  "symbols": {"total": len(candidates), "fetched": 0, "failed": 0}, "trades": 0, "finishedAt": None}
        try:
            self.run.log(f"逐筆：{len(candidates)} 檔（當天有成交的上市普通股，成交值大的先抓）")
            pacer = Pacer(self.runtime, INTRADAY_SPACING)
            streak = 0  # stocks in a row that Fubon failed to answer
            stopped = None
            for entry in candidates:
                code = entry["code"]
                meta = {"name": entry["name"], "tradeVolume": entry["tradeVolume"], "close": entry["close"]}
                try:
                    cached = self.store.load_tick_raw(day, code)
                    if cached is None:
                        stop = self.stop_reason(started, streak)
                        if stop:
                            if not stopped:
                                stopped = stop
                                self.run.log(f"逐筆：{stop}，之後的股票這次不再開始抓")
                            results.append(self.fall_back(day, {"code": code, "name": entry["name"],
                                                                "status": "failed", "error": stop}))
                            continue
                        try:
                            pages = self.pages(client, pacer, code, meta)
                        except ApiError:
                            streak += 1
                            raise
                        except ValidationError:
                            streak = 0  # Fubon answered, just not with usable trades
                            raise
                        streak = 0
                        self.store.save_tick_raw(day, code, pages, meta)
                    else:
                        pages, meta = cached
                    result = assess(pages, code, day, meta)
                    if result["status"] == "incomplete" and not self.run.last_attempt:
                        # Short of the day's volume: fetched whole next time, this answer kept in case that fails.
                        self.set_aside(day, code, pages, meta)
                        self.store.drop_tick_raw(day, code)
                except Exception as error:  # noqa: BLE001 - one stock's failure never stops the others
                    expected = isinstance(error, (ApiError, ValidationError))
                    result = self.fall_back(day, {
                        "code": code, "name": entry["name"], "status": "failed",
                        "error": str(error) if expected else f"未預期的錯誤：{type(error).__name__}: {error}"})
                if result["status"] != "ok":
                    self.run.log(f"逐筆 {code}：{result['status']}，{result['error']}")
                results.append(result)
            problems = [result for result in results if result["status"] != "ok"]
            if problems:
                record["reason"] = (f"{stopped}；" if stopped else "") + f"{len(problems)} 檔沒抓齊：" + "、".join(
                    f"{result['code']}（{result['error']}）" for result in problems[:5])
            if problems and not self.run.last_attempt:
                self.run.log(f"逐筆：{len(problems)} 檔等下一次排程（{self.runtime.monotonic() - started:.0f} 秒）")
            else:
                self.publish(day, results, record)
        except Exception as error:  # noqa: BLE001 - trades must never stop the day's candles
            record["reason"] = f"未預期的錯誤：{type(error).__name__}: {error}"
            self.run.log(f"逐筆中斷：{record['reason']}")
        self.report(record)

    def set_aside(self, day: str, code: str, pages: list, meta: dict) -> None:
        """Keeps an answer that falls short as the stock's fallback, unless a fuller one is kept already."""
        kept = self.store.load_tick_raw(day, code, fallback=True)
        if kept is None or covered_lots(kept[0], code, day, kept[1]) <= covered_lots(pages, code, day, meta):
            self.store.save_tick_raw(day, code, pages, meta, fallback=True)

    def fall_back(self, day: str, failed: dict) -> dict:
        """On the last attempt, a stock it got no answer for gets the answer set aside earlier, if there is one."""
        if not self.run.last_attempt:
            return failed
        code = failed["code"]
        try:
            kept = self.store.restore_tick_fallback(day, code)
            if kept is None:
                return failed
            result = assess(kept[0], code, day, kept[1])
        except Exception as error:  # noqa: BLE001 - one stock's failure never stops the others
            self.run.log(f"逐筆 {code}：先前留下的回應讀不回來（{type(error).__name__}: {error}）")
            return failed
        self.run.log(f"逐筆 {code}：這次沒抓到（{failed['error']}），改用先前留下的回應")
        return {**result, "error": "；".join(filter(None, (result["error"], "用先前留下的回應")))}

    def publish(self, day: str, results: list[dict], record: dict) -> None:
        """Publishes kept trades; rejected answers go along with their reason. Fills in the record."""
        kept = [result for result in results if result["status"] in ("ok", "incomplete")]
        rejected = [{"code": result["code"], "error": result["error"]} for result in results
                    if result["status"] == "rejected"]
        record["symbols"].update(fetched=len(kept), failed=len(results) - len(kept))
        if not kept and not rejected:
            record["reason"] = record["reason"] or "沒有任何逐筆成交"
            return
        entries = [{"code": result["code"], "name": result["name"], "trades": len(result["trades"]),
                    "volume": sum(trade[2] for trade in result["trades"]), "close": result["trades"][-1][1],
                    "complete": result["status"] == "ok",
                    "afterHours": {"trades": len(result["afterHours"]),
                                   "volume": sum(trade[2] for trade in result["afterHours"])}} for result in kept]
        trades = {result["code"]: result["trades"] for result in kept}
        warnings = [warning for result in kept for warning in result["warnings"]]
        self.store.publish_ticks(day, entries, trades, rejected, warnings, self.runtime.now(), TICK_SOURCE,
                                 self.runtime.version,
                                 after_hours={result["code"]: result["afterHours"] for result in kept})
        record["trades"] = sum(len(rows) for rows in trades.values())
        record["outcome"] = "ok" if all(result["status"] == "ok" for result in results) else "partial"
        self.store.log(day, f"逐筆：上架 {day} {len(entries)} 檔、{record['trades']} 筆，"
                            f"未通過 {len(rejected)} 檔，警告 {len(warnings)} 筆", self.runtime.now())

    def publish_pending(self, today: str) -> None:
        """Publishes trades an earlier day left in staging (its evening runs never finished them)."""
        for day in self.store.pending_tick_days(before=today):
            record = {"date": day, "outcome": "failed", "reason": "前一天沒有上架，這次補上架",
                      "symbols": {"total": 0, "fetched": 0, "failed": 0}, "trades": 0, "finishedAt": None}
            try:
                results = []
                codes = set(self.store.tick_raw_codes(day)) | set(self.store.tick_raw_codes(day, fallback=True))
                for code in sorted(codes):
                    cached = self.store.load_tick_raw(day, code) or self.store.restore_tick_fallback(day, code)
                    if cached:
                        results.append(assess(cached[0], code, day, cached[1]))
                record["symbols"]["total"] = len(results)
                self.publish(day, results, record)
            except Exception as error:  # noqa: BLE001 - never stops today's run
                record["reason"] = f"補上架失敗：{type(error).__name__}: {error}"
                self.store.log(day, f"逐筆：{record['reason']}", self.runtime.now())
            self.report(record, notify=False)

    def failed(self, reason: str, urgent: bool) -> None:
        """A run only for trades stopped before reaching them (login, snapshot)."""
        self.report({"date": self.run.target, "outcome": "failed", "reason": reason,
                     "symbols": {"total": 0, "fetched": 0, "failed": 0}, "trades": 0, "finishedAt": None},
                    urgent=urgent)

    def report(self, record: dict, notify: bool = True, urgent: bool = False) -> None:
        try:
            # Secrets are masked before shortening, so a long message can never keep half a secret.
            record["reason"] = self.store.redact(record["reason"])[:MESSAGE_LIMIT] if record["reason"] else None
            record["finishedAt"] = self.runtime.now().isoformat(timespec="seconds")
            self.store.write_ticks_status(record)
            if notify and record["outcome"] != "ok" and (urgent or self.run.last_attempt):
                from .pipeline import NOTIFY_TITLE

                counts = record["symbols"]
                summary = (f"逐筆成交只收到 {counts['fetched']}／{counts['total']} 檔" if counts["total"]
                           else "逐筆成交抓取失敗")
                self.runtime.notify(NOTIFY_TITLE, self.store.redact(
                    f"{record['date']} {summary}：{record['reason']}")[:MESSAGE_LIMIT])
        except Exception as error:  # noqa: BLE001 - a status write must not stop the candles
            self.run.log(f"逐筆狀態寫入失敗：{type(error).__name__}")
