import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from fubon_daily.client import ApiError, LoginError, NotFound, RateLimited
from fubon_daily.normalize import TAIPEI
from fubon_daily.pipeline import Options, Runtime, run
from fubon_daily.store import MarketStore
from tests.fixtures import DATE, DISPOSITION, daily, full_day, quote, snapshot, sparse_day

SECRETS = ("A123456789", "SECRETKEY123", "CERTPASS999")
AFTERNOON = datetime(2026, 10, 15, 16, 45, tzinfo=TAIPEI)
EVENING = datetime(2026, 10, 15, 19, 0, tzinfo=TAIPEI)


class FakeClient:
    def __init__(self, snapshot_payload=None, minutes=None, dailies=None, login_error=None):
        self.snapshot_payload = snapshot() if snapshot_payload is None else snapshot_payload
        self.minutes = minutes or {}
        self.dailies = dailies or {}
        self.login_error = login_error
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
        return self.snapshot_payload

    def disposition_list(self):
        self.calls.append("disposition")
        return DISPOSITION

    def minute_candles(self, symbol, date):
        self.calls.append(("minute", symbol))
        return self.take(self.minutes, symbol)

    def daily_candle(self, symbol, date):
        self.calls.append(("daily", symbol))
        return self.take(self.dailies, symbol)

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


class PipelineTest(unittest.TestCase):
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
        self.assertEqual(self.clock.sleeps, [1.1, 1.1, 1.1])
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
        self.assertEqual(self.status()["lastRun"]["outcome"], "already-done")

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


if __name__ == "__main__":
    unittest.main()
