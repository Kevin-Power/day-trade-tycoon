import gzip
import json
import tempfile
import unittest
from unittest import mock
from datetime import datetime
from pathlib import Path

from fubon_daily.client import ApiError, LoginError, NotFound, RateLimited
from fubon_daily.normalize import TAIPEI
from fubon_daily.pipeline import Options, Runtime, run
from fubon_daily.store import MarketStore
from tests.fixtures import (DATE, DISPOSITION, daily, full_day, quote, snapshot, sparse_day, trade,
                            trades_page)

SECRETS = ("A123456789", "SECRETKEY123", "CERTPASS999")
AFTERNOON = datetime(2026, 10, 15, 16, 45, tzinfo=TAIPEI)
EVENING = datetime(2026, 10, 15, 19, 0, tzinfo=TAIPEI)


class FakeClient:
    def __init__(self, snapshot_payload=None, minutes=None, dailies=None, login_error=None, trades=None,
                 trade_errors=None, snapshot_error=None, disposition_error=None):
        self.snapshot_payload = snapshot() if snapshot_payload is None else snapshot_payload
        self.snapshot_error = snapshot_error
        self.disposition_error = disposition_error
        self.minutes = minutes or {}
        self.dailies = dailies or {}
        self.login_error = login_error
        # Today's trades per symbol (rows); by default one 13:30 trade carrying the snapshot's whole volume.
        day = self.snapshot_payload["date"]
        self.trade_table = {item["symbol"]: [trade(day, 13, 30, 0, item["closePrice"], item["tradeVolume"], 1,
                                                   volume=item["tradeVolume"])]
                            for item in self.snapshot_payload["data"] if item["tradeVolume"]}
        self.trade_table.update(trades or {})
        self.trade_errors = trade_errors or {}
        self.calls = []

    @staticmethod
    def take(table, symbol):
        value = table[symbol]
        if isinstance(value, list):
            value = value.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    def login(self):
        self.calls.append("login")
        if self.login_error:
            raise self.login_error

    def snapshot_quotes(self):
        self.calls.append("snapshot")
        if self.snapshot_error:
            raise self.snapshot_error
        return self.snapshot_payload

    def disposition_list(self):
        self.calls.append("disposition")
        if self.disposition_error:
            raise self.disposition_error
        return DISPOSITION

    def minute_candles(self, symbol, date):
        self.calls.append(("minute", symbol))
        return self.take(self.minutes, symbol)

    def daily_candle(self, symbol, date):
        self.calls.append(("daily", symbol))
        return self.take(self.dailies, symbol)

    def trades(self, symbol, offset, limit):
        self.calls.append(("trades", symbol, offset))
        errors = self.trade_errors.get((symbol, offset)) or self.trade_errors.get(symbol)
        if errors:
            raise errors.pop(0) if isinstance(errors, list) else errors
        if symbol not in self.trade_table:
            raise NotFound("404", 404)
        return trades_page(symbol, self.snapshot_payload["date"], self.trade_table[symbol][offset:offset + limit])

    def logout(self):
        self.calls.append("logout")


class Clock:
    def __init__(self, now):
        self.current = now
        self.mono = 0.0
        self.sleeps = []

    def now(self):
        return self.current

    def monotonic(self):
        return self.mono

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.mono += seconds


def good_minutes():
    return {"2330": full_day("2330", price=2440), "1413": sparse_day()}


class PipelineHarness:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.data = base / "market-data"
        cert = base / "A123456789.pfx"
        cert.write_bytes(b"cert")
        self.credentials = base / "credentials.local.py"
        self.credentials.write_text(
            f"PERSON_ID = 'A123456789'\nSECRET_KEY = 'SECRETKEY123'\nCERT_PATH = {str(cert)!r}\nCERT_PASSWORD = 'CERTPASS999'\n",
            encoding="utf-8")
        self.notices = []

    def tearDown(self):
        self.temp.cleanup()

    def run_once(self, client, at=AFTERNOON, alive=False, **options):
        self.clock = Clock(at)
        runtime = Runtime(make_client=lambda credentials: client, now=self.clock.now,
                          monotonic=self.clock.monotonic, sleep=self.clock.sleep,
                          notify=lambda title, body: self.notices.append((title, body)) or True)
        store = MarketStore(self.data, pid_alive=lambda pid: alive)
        return run(Options(data=self.data, credentials=self.credentials, **options), runtime, store)

    def status(self):
        return json.loads((self.data / "status.json").read_text(encoding="utf-8"))

    def day_index(self, day=DATE):
        return json.loads((self.data / "days" / day / "index.json").read_text(encoding="utf-8"))

    def assertNoSecretsOnDisk(self):
        for path in self.data.rglob("*"):
            if path.is_file() and path.suffix != ".gz":
                text = path.read_text(encoding="utf-8")
                for secret in SECRETS:
                    self.assertNotIn(secret, text, str(path))


class PipelineTest(PipelineHarness, unittest.TestCase):
    def test_publishes_a_complete_day(self):
        client = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(client), 0)
        last = self.status()["lastRun"]
        self.assertEqual(last["outcome"], "ok")
        self.assertEqual(last["symbols"], {"total": 2, "fetched": 2, "failed": 0, "excluded": 0})
        index = self.day_index()
        self.assertEqual([entry["code"] for entry in index["symbols"]], ["2330", "1413"])
        self.assertEqual(index["symbols"][0], {"code": "2330", "name": "台積電", "referencePrice": 2490, "close": 2440,
                                               "change": -50, "tradeVolume": 58487, "tradeValue": 80781285000,
                                               "disposition": False, "bars": 266})
        self.assertNotIn(("minute", "9999"), client.calls)
        self.assertEqual(client.calls[-1], "logout")
        self.assertEqual(self.notices, [])
        # Historical calls keep 1.1 s apart; today's trades (intraday limit 300 a minute) 0.25 s.
        self.assertEqual([round(seconds, 2) for seconds in self.clock.sleeps], [0.25, 0.25, 0.25, 0.35, 1.1, 1.1])
        self.assertNoSecretsOnDisk()

    def test_holiday_is_recorded_as_closed(self):
        client = FakeClient(snapshot_payload=snapshot(date="2026-10-14"), minutes=good_minutes())
        self.assertEqual(self.run_once(client), 0)
        status = self.status()
        self.assertEqual(status["lastRun"]["outcome"], "closed")
        self.assertEqual(status["history"][-1], {"date": DATE, "outcome": "closed",
                                                 "finishedAt": status["lastRun"]["finishedAt"]})
        self.assertFalse((self.data / "days").exists())
        self.assertFalse((self.data / "staging" / DATE).exists())
        self.assertFalse(any(call[0] == "trades" for call in client.calls if isinstance(call, tuple)))
        self.assertFalse((self.data / "ticks").exists())

    def test_waits_when_fubon_history_is_not_updated_yet(self):
        client = FakeClient(minutes={"2330": sparse_day("2330"), "1413": sparse_day()})
        self.assertEqual(self.run_once(client), 1)
        self.assertIn("尚未更新", self.status()["lastRun"]["reason"])
        self.assertFalse((self.data / "days").exists())
        self.assertEqual(self.notices, [])

    def test_the_last_attempt_of_the_day_notifies_on_failure(self):
        client = FakeClient(minutes={"2330": sparse_day("2330"), "1413": sparse_day()})
        self.assertEqual(self.run_once(client, at=EVENING), 1)
        self.assertEqual(len(self.notices), 1)
        self.assertEqual(self.notices[0][0], "當沖大富翁每日行情")

    def test_rate_limit_waits_a_minute_then_retries(self):
        minutes = good_minutes()
        minutes["2330"] = [RateLimited("429", 429), full_day("2330", price=2440)]
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 0)
        self.assertIn(60, self.clock.sleeps)

    def test_api_failure_after_retries_fails_the_run(self):
        minutes = good_minutes()
        minutes["1413"] = [ApiError("500", 500), ApiError("500", 500), ApiError("500", 500)]
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 1)
        self.assertIn("抓取中斷", self.status()["lastRun"]["reason"])
        self.assertEqual(self.clock.sleeps.count(2), 2)

    def test_invalid_symbol_blocks_the_day_and_resume_refetches_only_missing(self):
        bad = sparse_day()
        bad["data"].append(dict(bad["data"][-1]))
        minutes = good_minutes()
        minutes["1413"] = bad
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 1)
        self.assertIn("1413", self.status()["lastRun"]["reason"])
        self.assertFalse((self.data / "days").exists())
        second = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(second), 0)
        self.assertIn(("minute", "1413"), second.calls)
        self.assertNotIn(("minute", "2330"), second.calls)

    def test_symbol_without_minutes_is_excluded_with_a_warning(self):
        minutes = good_minutes()
        minutes["1413"] = NotFound("404", 404)
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 0)
        self.assertEqual([entry["code"] for entry in self.day_index()["symbols"]], ["2330"])
        manifest = json.loads((self.data / "days" / DATE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([warning["kind"] for warning in manifest["warnings"]], ["empty"])
        self.assertEqual(self.status()["lastRun"]["symbols"]["excluded"], 1)

    def test_already_done_skips_login(self):
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes())), 0)
        again = FakeClient(login_error=LoginError("should not log in"))
        self.assertEqual(self.run_once(again), 0)
        self.assertEqual(again.calls, [])
        self.assertEqual(self.status()["lastRun"]["outcome"], "ok")

    def test_login_failure_is_fatal_notified_and_redacted(self):
        client = FakeClient(login_error=LoginError("登入失敗：A123456789 SECRETKEY123 CERTPASS999 無效"))
        self.assertEqual(self.run_once(client), 2)
        self.assertEqual(len(self.notices), 1)
        for secret in SECRETS:
            self.assertNotIn(secret, self.notices[0][1])
        self.assertEqual(self.status()["lastRun"]["outcome"], "failed")
        self.assertNoSecretsOnDisk()

    def test_bad_settings_file_is_fatal_and_notified(self):
        self.credentials.write_text("PERSON_ID = 'A123456789'\n", encoding="utf-8")
        self.assertEqual(self.run_once(FakeClient()), 2)
        self.assertIn("CERT_PASSWORD", self.status()["lastRun"]["reason"])
        self.assertEqual(len(self.notices), 1)

    def test_backfill_selected_symbols_uses_daily_candles(self):
        past = "2026-10-05"
        client = FakeClient(
            snapshot_payload=snapshot(date="2026-10-16"),
            minutes={"2330": full_day("2330", date=past, price=2440)},
            dailies={"2330": daily("2330", date=past, close=2440, change=-50, volume=58_487_000,
                                   turnover=80_781_285_000)})
        at = datetime(2026, 10, 16, 20, 0, tzinfo=TAIPEI)
        self.assertEqual(self.run_once(client, at=at, date=past, symbols=["2330"]), 0)
        index = self.day_index(past)
        self.assertEqual(index["coverage"], "selected")
        self.assertEqual(index["symbols"][0]["referencePrice"], 2490)
        self.assertEqual(index["symbols"][0]["tradeVolume"], 58487)
        self.assertIsNone(index["symbols"][0]["disposition"])
        self.assertNotIn("disposition", client.calls)
        # Fubon has trades for today only: a past day never asks for them.
        self.assertFalse(any(call[0] == "trades" for call in client.calls if isinstance(call, tuple)))
        self.assertFalse((self.data / "ticks").exists())

    def test_backfill_unknown_symbol_fails_clearly(self):
        client = FakeClient(snapshot_payload=snapshot(date="2026-10-16"))
        at = datetime(2026, 10, 16, 20, 0, tzinfo=TAIPEI)
        self.assertEqual(self.run_once(client, at=at, date="2026-10-05", symbols=["0000"]), 1)
        self.assertIn("0000", self.status()["lastRun"]["reason"])

    def test_a_running_fetch_is_left_alone(self):
        self.data.mkdir(parents=True)
        (self.data / ".lock").write_text(json.dumps({"pid": 1234, "startedAt": "x"}), encoding="utf-8")
        client = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(client, alive=True), 0)
        self.assertEqual(client.calls, [])
        self.assertFalse((self.data / "status.json").exists())


    def test_not_updated_response_is_refetched_on_the_next_run(self):
        first = FakeClient(minutes={"2330": sparse_day("2330"), "1413": sparse_day()})
        self.assertEqual(self.run_once(first), 1)
        second = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(second, at=datetime(2026, 10, 15, 17, 30, tzinfo=TAIPEI)), 0)
        self.assertIn(("minute", "2330"), second.calls)

    def test_daily_run_before_1630_leaves_everything_alone(self):
        client = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(client, at=datetime(2026, 10, 15, 10, 1, tzinfo=TAIPEI)), 0)
        self.assertEqual(client.calls, [])
        self.assertFalse((self.data / "status.json").exists())
        self.assertFalse((self.data / "staging").exists())
        self.assertIn("16:30", (self.data / "logs" / f"{DATE}.log").read_text(encoding="utf-8"))

    def test_invalid_daily_candle_in_backfill_is_refetched(self):
        past = "2026-10-05"
        at = datetime(2026, 10, 16, 20, 0, tzinfo=TAIPEI)
        broken = daily("2330", date=past)
        broken["data"][0]["change"] = None
        first = FakeClient(snapshot_payload=snapshot(date="2026-10-16"),
                           minutes={"2330": full_day("2330", date=past, price=2440)}, dailies={"2330": broken})
        self.assertEqual(self.run_once(first, at=at, date=past, symbols=["2330"]), 1)
        second = FakeClient(snapshot_payload=snapshot(date="2026-10-16"),
                            minutes={"2330": full_day("2330", date=past, price=2440)},
                            dailies={"2330": daily("2330", date=past, close=2440, change=-50)})
        self.assertEqual(self.run_once(second, at=at, date=past, symbols=["2330"]), 0)
        self.assertIn(("daily", "2330"), second.calls)

    def test_readiness_skips_a_disposition_top_stock(self):
        items = [quote("2424", "隴華", 14.2, 1.25, 835, 99_000_000_000),
                 quote("2330", "台積電", 2440, -50, 58487, 80_781_285_000)]
        client = FakeClient(snapshot_payload=snapshot(items=items),
                            minutes={"2424": sparse_day("2424", price=14.2), "2330": full_day("2330", price=2440)})
        self.assertEqual(self.run_once(client), 0)
        self.assertEqual([entry["code"] for entry in self.day_index()["symbols"]], ["2424", "2330"])

    def test_unexpected_error_is_recorded_and_notified_on_the_last_attempt(self):
        minutes = good_minutes()
        minutes["1413"] = RuntimeError("disk is busy")
        self.assertEqual(self.run_once(FakeClient(minutes=minutes), at=EVENING), 1)
        last = self.status()["lastRun"]
        self.assertEqual(last["outcome"], "failed")
        self.assertIn("未預期", last["reason"])
        self.assertEqual(len(self.notices), 1)

    def test_published_day_missing_from_the_index_is_restored(self):
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes())), 0)
        (self.data / "index.json").unlink()
        self.assertEqual(self.run_once(FakeClient()), 0)
        days = json.loads((self.data / "index.json").read_text(encoding="utf-8"))["days"]
        self.assertEqual([day["date"] for day in days], [DATE])

    def test_already_done_keeps_the_last_real_run(self):
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes())), 0)
        before = self.status()
        self.assertEqual(self.run_once(FakeClient()), 0)
        after = self.status()
        self.assertEqual(after["lastRun"], before["lastRun"])
        self.assertEqual(after["history"], before["history"])

    def test_long_error_messages_are_redacted_then_truncated(self):
        client = FakeClient(login_error=LoginError("x" * 290 + " A123456789 SECRETKEY123 CERTPASS999"))
        self.assertEqual(self.run_once(client), 2)
        reason = self.status()["lastRun"]["reason"]
        self.assertLessEqual(len(reason), 300)
        for secret in SECRETS:
            self.assertNotIn(secret[:4], reason + self.notices[0][1])

    def test_log_records_steps_and_timings(self):
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes())), 0)
        log = (self.data / "logs" / f"{DATE}.log").read_text(encoding="utf-8")
        for step in ("登入成功", "快照", "1 分 K", "上架"):
            self.assertIn(step, log)
        self.assertIn("秒", log)


class TicksTest(PipelineHarness, unittest.TestCase):
    """Today's trade-by-trade data: fetched in daily runs, before the minute candles, never blocking them."""

    def tick_manifest(self, day=DATE):
        return json.loads((self.data / "ticks" / day / "manifest.json").read_text(encoding="utf-8"))

    @staticmethod
    def trade_calls(client):
        return [call for call in client.calls if isinstance(call, tuple) and call[0] == "trades"]

    def test_daily_run_keeps_todays_trades_before_the_candles(self):
        client = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(client), 0)
        manifest = self.tick_manifest()
        self.assertEqual([entry["code"] for entry in manifest["symbols"]], ["2330", "1413"])
        self.assertEqual(manifest["symbols"][0], {"code": "2330", "name": "台積電", "trades": 1, "volume": 58487,
                                                  "close": 2440, "complete": True,
                                                  "afterHours": {"trades": 0, "volume": 0}})
        self.assertEqual((manifest["warnings"], manifest["rejected"]), ([], []))
        ticks = self.status()["ticks"]
        self.assertEqual((ticks["date"], ticks["outcome"], ticks["trades"]), (DATE, "ok", 2))
        self.assertEqual(ticks["symbols"], {"total": 2, "fetched": 2, "failed": 0})
        # Before the candle-only disposition list, so nothing the candles need can stop the trades.
        disposition = client.calls.index("disposition")
        self.assertTrue(all(client.calls.index(call) < disposition for call in self.trade_calls(client)))
        self.assertEqual(self.status()["lastRun"]["outcome"], "ok")
        self.assertIn("逐筆", (self.data / "logs" / f"{DATE}.log").read_text(encoding="utf-8"))

    def test_pages_are_read_until_an_empty_one(self):
        rows = [trade(DATE, 9, 0, second, 2440, 1, second + 1, volume=second + 1) for second in range(5)]
        rows[-1]["size"] = 58483
        rows[-1]["volume"] = 58487
        client = FakeClient(minutes=good_minutes(), trades={"2330": rows})
        with mock.patch("fubon_daily.ticks.TRADE_PAGE_SIZE", 2):
            self.assertEqual(self.run_once(client), 0)
        self.assertEqual([call[2] for call in self.trade_calls(client) if call[1] == "2330"], [0, 2, 4, 5])
        self.assertEqual(self.tick_manifest()["symbols"][0]["trades"], 5)

    def test_every_traded_stock_is_kept_most_traded_first(self):
        items = [quote(str(1100 + rank), f"股{rank}", 50, 1, 1000, 10_000_000_000 - rank) for rank in range(25)]
        items += [quote("2317", "鴻海", 200, 1, 5, 1_000_000), quote("2454", "聯發科", 1000, 0, 0, 0)]
        client = FakeClient(snapshot_payload=snapshot(items=items),
                            minutes={item["symbol"]: full_day(item["symbol"], price=item["closePrice"])
                                     for item in items})
        self.assertEqual(self.run_once(client), 0)
        # Every stock that traded, fetched in order of value so a cut-short run keeps the most traded ones.
        expected = [str(1100 + rank) for rank in range(25)] + ["2317"]
        self.assertEqual([call[1] for call in self.trade_calls(client) if call[2] == 0], expected)
        self.assertEqual([entry["code"] for entry in self.tick_manifest()["symbols"]], expected)
        self.assertEqual(self.status()["ticks"]["symbols"], {"total": 26, "fetched": 26, "failed": 0})

    def test_a_failed_symbol_waits_for_the_next_run_without_blocking_candles(self):
        client = FakeClient(minutes=good_minutes(), trade_errors={"1413": [ApiError("500", 500)] * 3})
        self.assertEqual(self.run_once(client), 0)
        self.assertEqual(self.status()["lastRun"]["outcome"], "ok")
        self.assertFalse((self.data / "ticks").exists())
        ticks = self.status()["ticks"]
        self.assertEqual(ticks["outcome"], "failed")
        self.assertIn("1413", ticks["reason"])
        self.assertEqual(self.notices, [])
        before = self.status()["lastRun"]
        second = FakeClient()
        self.assertEqual(self.run_once(second, at=datetime(2026, 10, 15, 17, 30, tzinfo=TAIPEI)), 0)
        self.assertEqual({call[1] for call in self.trade_calls(second)}, {"1413"})
        self.assertFalse(any(call[0] == "minute" for call in second.calls if isinstance(call, tuple)))
        self.assertEqual([entry["code"] for entry in self.tick_manifest()["symbols"]], ["2330", "1413"])
        self.assertEqual(self.status()["ticks"]["outcome"], "ok")
        self.assertEqual(self.status()["lastRun"], before)

    def test_the_last_attempt_keeps_what_it_has_and_notifies(self):
        client = FakeClient(minutes=good_minutes(), trade_errors={"1413": [ApiError("500", 500)] * 3})
        self.assertEqual(self.run_once(client, at=EVENING), 0)
        self.assertEqual([entry["code"] for entry in self.tick_manifest()["symbols"]], ["2330"])
        ticks = self.status()["ticks"]
        self.assertEqual((ticks["outcome"], ticks["symbols"]["failed"]), ("partial", 1))
        self.assertEqual(len(self.notices), 1)
        self.assertIn("逐筆", self.notices[0][1])

    def test_answers_that_fail_the_checks_are_kept_and_published_last(self):
        broken = [trade(DATE, 13, 30, 0, 9.44, 26, 1, volume=27)]
        client = FakeClient(minutes=good_minutes(), trades={"1413": broken})
        self.assertEqual(self.run_once(client), 0)
        self.assertIn("1413", self.status()["ticks"]["reason"])
        self.assertFalse((self.data / "ticks").exists())
        self.assertIsNotNone(MarketStore(self.data).load_tick_raw(DATE, "1413"))
        last = FakeClient()
        self.assertEqual(self.run_once(last, at=EVENING), 0)
        self.assertEqual(self.trade_calls(last), [])  # the kept answer is checked again, not fetched again
        manifest = self.tick_manifest()
        self.assertEqual([entry["code"] for entry in manifest["symbols"]], ["2330"])
        self.assertEqual([item["code"] for item in manifest["rejected"]], ["1413"])
        self.assertIn("volume", manifest["rejected"][0]["error"])
        self.assertTrue((self.data / "ticks" / DATE / "raw" / "1413.json.gz").is_file())
        self.assertEqual(self.status()["ticks"]["outcome"], "partial")

    def test_a_traded_stock_without_trades_is_fetched_again(self):
        for missing in (NotFound("404", 404), None):
            with self.subTest(missing=missing):
                self.tearDown()
                self.setUp()
                options = {"trade_errors": {"1413": missing}} if missing else {"trades": {"1413": []}}
                self.assertEqual(self.run_once(FakeClient(minutes=good_minutes(), **options)), 0)
                self.assertFalse((self.data / "ticks").exists())
                self.assertIn("1413", self.status()["ticks"]["reason"])
                self.assertIsNone(MarketStore(self.data).load_tick_raw(DATE, "1413"))
                second = FakeClient()
                self.assertEqual(self.run_once(second, at=datetime(2026, 10, 15, 17, 30, tzinfo=TAIPEI)), 0)
                self.assertEqual({call[1] for call in self.trade_calls(second)}, {"1413"})
                self.assertEqual(self.status()["ticks"]["outcome"], "ok")

    def test_a_404_partway_through_the_pages_is_a_failure(self):
        rows = [trade(DATE, 9, 0, second, 2440, 1, second + 1, volume=second + 1) for second in range(5)]
        client = FakeClient(minutes=good_minutes(), trades={"2330": rows},
                            trade_errors={("2330", 2): NotFound("404", 404)})
        with mock.patch("fubon_daily.ticks.TRADE_PAGE_SIZE", 2):
            self.assertEqual(self.run_once(client), 0)
        self.assertIn("2330", self.status()["ticks"]["reason"])
        self.assertIsNone(MarketStore(self.data).load_tick_raw(DATE, "2330"))

    def test_trades_short_of_the_days_volume_are_fetched_again_then_kept_as_incomplete(self):
        short = {"2330": [trade(DATE, 9, 0, 0, 2440, 5, 1, volume=5)]}
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes(), trades=short)), 0)
        self.assertFalse((self.data / "ticks").exists())
        self.assertIn("2330", self.status()["ticks"]["reason"])
        self.assertIsNone(MarketStore(self.data).load_tick_raw(DATE, "2330"))
        last = FakeClient(trades=short)
        self.assertEqual(self.run_once(last, at=EVENING), 0)
        self.assertIn(("trades", "2330", 0), last.calls)
        manifest = self.tick_manifest()
        self.assertEqual([(entry["code"], entry["complete"]) for entry in manifest["symbols"]],
                         [("2330", False), ("1413", True)])
        self.assertEqual(self.status()["ticks"]["outcome"], "partial")

    def test_a_trades_only_retry_that_fails_keeps_the_candle_run(self):
        client = FakeClient(minutes=good_minutes(), trade_errors={"1413": [ApiError("500", 500)] * 3})
        self.assertEqual(self.run_once(client), 0)
        before = self.status()
        broken = FakeClient(snapshot_error=ApiError("503", 503))
        self.assertEqual(self.run_once(broken, at=EVENING), 1)
        after = self.status()
        self.assertEqual((after["lastRun"], after["history"]), (before["lastRun"], before["history"]))
        self.assertEqual(after["ticks"]["outcome"], "failed")
        self.assertIn("503", after["ticks"]["reason"])
        self.assertEqual(len(self.notices), 1)
        self.assertIn("逐筆", self.notices[0][1])
        self.assertNotIn("每日行情抓取失敗", self.notices[0][1])

    def test_trades_left_in_staging_are_published_by_a_later_run(self):
        client = FakeClient(minutes=good_minutes(), trade_errors={"1413": [ApiError("500", 500)] * 3})
        self.assertEqual(self.run_once(client), 0)
        self.assertFalse((self.data / "ticks").exists())
        # The evening runs never happened; the next day's first run cannot even log in.
        next_day = FakeClient(login_error=LoginError("down"))
        self.assertEqual(self.run_once(next_day, at=datetime(2026, 10, 16, 16, 45, tzinfo=TAIPEI)), 2)
        manifest = self.tick_manifest()
        self.assertEqual([entry["code"] for entry in manifest["symbols"]], ["2330"])
        self.assertFalse((self.data / "staging-ticks" / DATE).exists())
        self.assertIn(DATE, (self.data / "logs" / f"{DATE}.log").read_text(encoding="utf-8"))

    def test_a_disposition_failure_does_not_stop_the_trades(self):
        client = FakeClient(minutes=good_minutes(), disposition_error=NotFound("404", 404))
        self.assertEqual(self.run_once(client), 1)
        self.assertEqual(self.status()["lastRun"]["outcome"], "failed")
        self.assertEqual(self.status()["ticks"]["outcome"], "ok")
        self.assertTrue((self.data / "ticks" / DATE / "manifest.json").is_file())

    def test_a_budget_cut_keeps_the_most_traded_and_the_next_run_fetches_the_rest_in_order(self):
        items = [quote(str(1100 + rank), f"股{rank}", 50, 1, 1000, 10_000_000_000 - rank) for rank in range(6)]
        minutes = {item["symbol"]: full_day(item["symbol"], price=item["closePrice"]) for item in items}
        first = FakeClient(snapshot_payload=snapshot(items=items), minutes=minutes)
        with mock.patch("fubon_daily.ticks.TICK_BUDGET_SECONDS", 0.6):
            self.assertEqual(self.run_once(first), 0)
        self.assertEqual([call[1] for call in self.trade_calls(first) if call[2] == 0], ["1100", "1101"])
        second = FakeClient(snapshot_payload=snapshot(items=items))
        self.assertEqual(self.run_once(second, at=datetime(2026, 10, 15, 17, 30, tzinfo=TAIPEI)), 0)
        self.assertEqual([call[1] for call in self.trade_calls(second) if call[2] == 0],
                         ["1102", "1103", "1104", "1105"])
        self.assertEqual([entry["code"] for entry in self.tick_manifest()["symbols"]],
                         [str(1100 + rank) for rank in range(6)])

    def test_the_last_attempt_has_its_own_time_budget(self):
        # The task is stopped after two hours: the last attempt must still publish, notify and fetch the candles.
        client = FakeClient(minutes=good_minutes())
        with mock.patch("fubon_daily.ticks.LAST_ATTEMPT_BUDGET_SECONDS", 0.1):
            self.assertEqual(self.run_once(client, at=EVENING), 0)
        self.assertEqual({call[1] for call in self.trade_calls(client)}, {"2330"})
        self.assertEqual([entry["code"] for entry in self.tick_manifest()["symbols"]], ["2330"])
        ticks = self.status()["ticks"]
        self.assertEqual(ticks["outcome"], "partial")
        self.assertIn("1413", ticks["reason"])
        self.assertEqual(len(self.notices), 1)
        self.assertTrue((self.data / "days" / DATE / "manifest.json").is_file())

    def test_a_run_of_fubon_failures_stops_starting_new_stocks(self):
        items = [quote(str(1100 + rank), f"股{rank}", 50, 1, 1000, 10_000_000_000 - rank) for rank in range(8)]
        failing = {code: ApiError("500", 500) for code in ("1100", "1102", "1103", "1104")}
        client = FakeClient(snapshot_payload=snapshot(items=items), trade_errors=failing,
                            minutes={item["symbol"]: full_day(item["symbol"], price=item["closePrice"])
                                     for item in items})
        with mock.patch("fubon_daily.ticks.FAILURE_STREAK", 3):
            self.assertEqual(self.run_once(client), 0)
        # 1101 answered between the failures, so the streak is 1102-1104; nothing after it is tried.
        self.assertEqual(sorted({call[1] for call in self.trade_calls(client)}),
                         ["1100", "1101", "1102", "1103", "1104"])
        self.assertIn("連續", self.status()["ticks"]["reason"])
        self.assertTrue((self.data / "days" / DATE / "manifest.json").is_file())

    def test_the_time_budget_leaves_the_rest_for_the_next_run(self):
        client = FakeClient(minutes=good_minutes())
        with mock.patch("fubon_daily.ticks.TICK_BUDGET_SECONDS", 0.1):
            self.assertEqual(self.run_once(client), 0)
        self.assertEqual({call[1] for call in self.trade_calls(client)}, {"2330"})
        self.assertIn("1413", self.status()["ticks"]["reason"])
        self.assertTrue((self.data / "days" / DATE / "manifest.json").is_file())
        second = FakeClient()
        self.assertEqual(self.run_once(second, at=datetime(2026, 10, 15, 17, 30, tzinfo=TAIPEI)), 0)
        self.assertEqual({call[1] for call in self.trade_calls(second)}, {"1413"})
        self.assertEqual(self.status()["ticks"]["outcome"], "ok")

    def test_one_broken_symbol_does_not_stop_the_others(self):
        client = FakeClient(minutes=good_minutes(), trade_errors={"2330": TypeError("odd answer")})
        self.assertEqual(self.run_once(client, at=EVENING), 0)
        self.assertEqual([entry["code"] for entry in self.tick_manifest()["symbols"]], ["1413"])
        self.assertIn("2330", self.status()["ticks"]["reason"])

    def test_an_unexpected_tick_error_still_publishes_the_candles(self):
        client = FakeClient(minutes=good_minutes(), trade_errors={"2330": RuntimeError("disk is busy")})
        self.assertEqual(self.run_once(client), 0)
        self.assertTrue((self.data / "days" / DATE / "manifest.json").is_file())
        self.assertEqual(self.status()["ticks"]["outcome"], "failed")
        self.assertIn("未預期", self.status()["ticks"]["reason"])

    def test_candles_waiting_for_fubon_do_not_lose_the_trades(self):
        client = FakeClient(minutes={"2330": sparse_day("2330"), "1413": sparse_day()})
        self.assertEqual(self.run_once(client), 1)
        self.assertEqual(self.status()["ticks"]["outcome"], "ok")
        self.assertTrue((self.data / "ticks" / DATE / "manifest.json").is_file())
        second = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(second, at=datetime(2026, 10, 15, 17, 30, tzinfo=TAIPEI)), 0)
        self.assertEqual(self.trade_calls(second), [])

    def test_the_fixed_price_trade_is_kept_apart(self):
        fixed = {"price": 2440, "size": 34, "time": trade(DATE, 14, 30, 0, 1, 1, 1)["time"], "serial": 99999999}
        rows = [trade(DATE, 13, 30, 0, 2440, 58487, 1, volume=58487), fixed]
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes(), trades={"2330": rows})), 0)
        manifest = self.tick_manifest()
        entry = manifest["symbols"][0]
        self.assertEqual((entry["trades"], entry["volume"], entry["complete"], entry["afterHours"]),
                         (1, 58487, True, {"trades": 1, "volume": 34}))
        self.assertEqual(manifest["warnings"], [])
        payload = json.loads(gzip.decompress((self.data / "ticks" / DATE / "symbols" / "2330.json.gz").read_bytes()))
        self.assertEqual(payload["afterHours"], [[19_800_000, 2440, 34, None, None]])
        self.assertEqual(len(payload["trades"]), 1)

    def test_trade_warnings_are_recorded(self):
        client = FakeClient(minutes=good_minutes(),
                            trades={"2330": [trade(DATE, 13, 30, 0, 2435, 58490, 1, volume=58490)]})
        self.assertEqual(self.run_once(client), 0)
        kinds = [warning["kind"] for warning in self.tick_manifest()["warnings"]]
        self.assertEqual(kinds, ["volume", "close"])


if __name__ == "__main__":
    unittest.main()
