import json
import re
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from fubon_daily import extras
from fubon_daily.extras import run_extras
from fubon_daily.normalize import TAIPEI
from fubon_daily.radar import HEADER, RadarError
from fubon_daily.store import MarketStore
from tests.fixtures import taiex_5s

NOW = datetime(2026, 10, 30, 17, 5, tzinfo=TAIPEI)
ENTRY = {"code": "2330", "name": "台積電", "referencePrice": 2490, "close": 2440, "change": -50,
         "tradeVolume": 58487, "tradeValue": 80781285000, "disposition": False, "bars": 2}
BARS = {"2330": [[0, 2420, 2435, 2420, 2435, 6446, 2420.92], [16200, 2440, 2440, 2440, 2440, 5833, 2437.47]]}
SECRET = "SECRET-xyz-123"
# Seven full-market trading days from the first lesson day on (10/23 was a typhoon closure).
DAYS = ["2026-10-21", "2026-10-22", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]


class FakeTwse:
    """TWSE's 5-second index for a chain of days: each day's 09:00:00 repeats the previous listed day's close."""

    def __init__(self, days=DAYS, answers=None):
        self.closes = {day: 33000.0 + 10 * index for index, day in enumerate(days)}
        self.opens = {day: (33000.0 + 10 * (index - 1) if index else 32990.0) for index, day in enumerate(days)}
        self.answers = answers or {}  # day -> bytes or an exception to raise
        self.requests = []

    def __call__(self, url):
        stamp = re.search(r"date=(\d{8})", url).group(1)
        day = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}"
        self.requests.append(day)
        answer = self.answers.get(day)
        if isinstance(answer, Exception):
            raise answer
        if answer is not None:
            return answer
        return json.dumps(taiex_5s(stamp, self.opens[day], self.closes[day]), ensure_ascii=False).encode("utf-8")


def values(*days, code="2330", name="台積電", kind="當沖"):
    """The sheet as the reader returns it: the header and one row per day."""
    return [list(HEADER)] + [[day, kind, code, name, "", "", "", "", "", "", ""] for day in days]


class ExtrasTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.store = MarketStore(self.root)
        self.sleeps = []

    def tearDown(self):
        self.temp.cleanup()

    def publish_days(self, *days, coverage="full-market"):
        for day in days:
            self.store.publish_day(day, coverage, [ENTRY], BARS, [], 0, NOW, "fubon-neo test", "abc123")

    def run_extras(self, **overrides):
        arguments = {"now": NOW, "taiex_get": None, "radar_read": None, "radar_config_present": False,
                     "version": "abc123", "sleep": self.sleeps.append}
        arguments.update(overrides)
        return run_extras(self.store, **arguments)

    def status(self):
        return json.loads((self.root / "status.json").read_text(encoding="utf-8"))

    def log_text(self):
        folder = self.root / "logs"
        return "".join(path.read_text(encoding="utf-8") for path in sorted(folder.glob("*.log"))) \
            if folder.is_dir() else ""

    def everything_on_disk(self):
        parts = []
        for path in sorted(self.root.rglob("*")):
            if path.is_file() and path.suffix in {".json", ".log"}:
                parts.append(path.read_text(encoding="utf-8"))
        return "\n".join(parts)

    # --- TAIEX ---

    def test_taiex_backfills_oldest_first_max_five(self):
        self.publish_days(*DAYS)
        twse = FakeTwse()
        self.run_extras(taiex_get=twse)
        self.assertEqual(twse.requests, DAYS[:5])
        self.assertEqual(self.store.taiex_days(), DAYS[:5])
        self.assertEqual(self.status()["taiex"], {"date": "2026-10-28", "outcome": "ok", "reason": None,
                                                  "points": 3241, "failed": [],
                                                  "finishedAt": "2026-10-30T17:05:00+08:00"})
        # TWSE is asked at a polite pace: a pause between requests, none before the first.
        self.assertEqual(self.sleeps, [extras.TAIEX_SPACING] * 4)
        # the next run takes the rest; a run with nothing left asks nobody and leaves the status as it was
        self.run_extras(taiex_get=twse)
        self.assertEqual(twse.requests, DAYS)
        self.assertEqual(self.store.taiex_days(), DAYS)
        self.assertEqual(self.status()["taiex"]["date"], "2026-10-30")
        before = self.status()["taiex"]
        self.run_extras(taiex_get=twse, now=datetime(2026, 10, 30, 18, 0, tzinfo=TAIPEI))
        self.assertEqual(twse.requests, DAYS)
        self.assertEqual(self.status()["taiex"], before)

    def test_taiex_asks_only_for_full_market_days_from_the_first_lesson_day(self):
        self.publish_days("2026-10-15", "2026-10-20", "2026-10-22")
        self.publish_days("2026-10-21", coverage="selected")
        twse = FakeTwse(["2026-10-22"])
        self.run_extras(taiex_get=twse)
        self.assertEqual(twse.requests, ["2026-10-22"])
        self.assertEqual(self.store.taiex_days(), ["2026-10-22"])

    def test_taiex_skips_days_that_are_already_stored(self):
        self.publish_days(*DAYS[:3])
        twse = FakeTwse()
        self.run_extras(taiex_get=twse)
        again = FakeTwse()
        self.run_extras(taiex_get=again)
        self.assertEqual(again.requests, [])

    def test_a_failed_day_is_kept_as_evidence_and_does_not_stop_the_others(self):
        self.publish_days(*DAYS[:3])
        blocked = "<html>您的連線太頻繁</html>".encode("utf-8")
        twse = FakeTwse(answers={"2026-10-22": blocked})
        self.run_extras(taiex_get=twse)
        self.assertEqual(twse.requests, DAYS[:3])
        self.assertEqual(self.store.taiex_days(), ["2026-10-21", "2026-10-26"])
        self.assertEqual(self.status()["taiex"], {
            "date": "2026-10-26", "outcome": "failed", "reason": "2026-10-22：證交所回覆不是 JSON", "points": 3241,
            "failed": ["2026-10-22"], "finishedAt": "2026-10-30T17:05:00+08:00"})
        staged = list((self.root / "staging-taiex" / "2026-10-22").iterdir())
        self.assertEqual([path.read_bytes() for path in staged], [blocked])
        self.assertIn("2026-10-22", self.log_text())
        # the next evening TWSE answers: the day is stored, the evidence goes with it
        again = FakeTwse()
        self.run_extras(taiex_get=again)
        self.assertEqual(again.requests, ["2026-10-22"])
        self.assertEqual(self.store.taiex_days(), ["2026-10-21", "2026-10-22", "2026-10-26"])
        self.assertFalse((self.root / "staging-taiex" / "2026-10-22").exists())
        self.assertEqual(self.status()["taiex"]["outcome"], "ok")
        self.assertEqual(self.status()["taiex"]["date"], "2026-10-22")

    def test_every_kind_of_rejected_answer_is_staged_before_it_is_checked(self):
        self.publish_days("2026-10-21")
        gap = taiex_5s("20261021", 32990.0, 33000.0)
        del gap["data"][100]
        answers = {"gap": json.dumps(gap).encode("utf-8"), "not ok": '{"stat":"很抱歉，沒有符合條件的資料!"}'.encode("utf-8"),
                   "empty": b" "}
        for name, answer in answers.items():
            with self.subTest(name):
                self.run_extras(taiex_get=FakeTwse(["2026-10-21"], answers={"2026-10-21": answer}))
                self.assertFalse(self.store.has_taiex("2026-10-21"))
                self.assertIn(answer, [path.read_bytes() for path in
                                       (self.root / "staging-taiex" / "2026-10-21").iterdir()])
        self.assertEqual(self.status()["taiex"]["outcome"], "failed")

    def test_a_download_error_is_a_fixed_reason(self):
        self.publish_days("2026-10-21")
        self.run_extras(taiex_get=FakeTwse(["2026-10-21"], answers={"2026-10-21": OSError(SECRET)}))
        self.assertEqual(self.status()["taiex"]["reason"], "2026-10-21：無法連上證交所")
        self.assertNotIn(SECRET, self.everything_on_disk())

    def test_taiex_is_left_alone_without_a_downloader(self):
        self.publish_days(*DAYS[:2])
        self.run_extras(taiex_get=None)
        self.assertEqual(self.store.taiex_days(), [])
        self.assertFalse((self.root / "staging-taiex").exists())
        self.assertNotIn("taiex", self.status())

    def test_an_error_inside_the_store_is_a_fixed_reason(self):
        self.publish_days("2026-10-21")
        with mock.patch.object(MarketStore, "publish_taiex", side_effect=OSError(SECRET)):
            self.run_extras(taiex_get=FakeTwse(["2026-10-21"]))
        self.assertEqual(self.status()["taiex"]["reason"], "2026-10-21：大盤處理時發生未預期的錯誤")
        self.assertNotIn(SECRET, self.everything_on_disk())

    # --- the list ---

    def test_radar_not_configured_status(self):
        reader = mock.Mock(return_value=values("2026-10-28"))
        self.run_extras(radar_read=reader, radar_config_present=False)
        reader.assert_not_called()
        self.assertEqual(self.status()["radar"], {"outcome": "not-configured", "reason": None, "latest": None,
                                                  "symbols": None, "stored": [],
                                                  "finishedAt": "2026-10-30T17:05:00+08:00"})
        self.assertEqual(self.store.radar_dates(), [])
        self.run_extras(radar_read=None, radar_config_present=True)  # a config nobody can read is no config either
        self.assertEqual(self.status()["radar"]["outcome"], "not-configured")

    def test_radar_stores_each_finished_day_once(self):
        rows = values("2026-10-27", "2026-10-28") + values("2026-10-28", code="2317", name="鴻海")[1:] \
            + values("2026-10-30")[1:]  # today's list is still being made
        reader = mock.Mock(return_value=rows)
        self.run_extras(radar_read=reader, radar_config_present=True)
        reader.assert_called_once_with()
        self.assertEqual(self.store.radar_dates(), ["2026-10-27", "2026-10-28"])
        self.assertEqual([entry["code"] for entry in self.store.read_radar("2026-10-28")["symbols"]],
                         ["2330", "2317"])
        self.assertEqual(self.status()["radar"], {
            "outcome": "ok", "reason": None, "latest": "2026-10-28", "symbols": 2,
            "stored": ["2026-10-27", "2026-10-28"], "finishedAt": "2026-10-30T17:05:00+08:00"})
        # the next evening: yesterday's list is final now; the days stored before stay exactly as they were
        before = (self.root / "radar" / "2026-10-27.json").read_bytes()
        later = datetime(2026, 10, 31, 17, 5, tzinfo=TAIPEI)
        self.run_extras(radar_read=reader, radar_config_present=True, now=later)
        self.assertEqual(self.store.radar_dates(), ["2026-10-27", "2026-10-28", "2026-10-30"])
        self.assertEqual((self.root / "radar" / "2026-10-27.json").read_bytes(), before)
        self.assertEqual(self.status()["radar"]["stored"], ["2026-10-30"])
        self.assertEqual((self.status()["radar"]["latest"], self.status()["radar"]["symbols"]), ("2026-10-30", 1))

    def test_radar_with_nothing_new_is_still_ok_and_names_the_latest_stored_day(self):
        reader = mock.Mock(return_value=values("2026-10-28"))
        self.run_extras(radar_read=reader, radar_config_present=True)
        self.run_extras(radar_read=reader, radar_config_present=True)
        self.assertEqual(self.status()["radar"], {
            "outcome": "ok", "reason": None, "latest": "2026-10-28", "symbols": 1, "stored": [],
            "finishedAt": "2026-10-30T17:05:00+08:00"})

    def test_radar_ignores_days_before_it_started_and_empty_lists(self):
        reader = mock.Mock(return_value=values("2026-10-19", "2026-10-20") + values("2026-10-22", kind="隔日衝")[1:])
        self.run_extras(radar_read=reader, radar_config_present=True)
        self.assertEqual(self.store.radar_dates(), ["2026-10-20"])

    def test_a_radar_failure_keeps_its_fixed_reason_and_the_days_already_stored(self):
        self.run_extras(radar_read=lambda: values("2026-10-27"), radar_config_present=True)
        for reason in ("試算表欄位改了", "Google 授權失敗", "連線逾時"):
            with self.subTest(reason):
                def fail():
                    raise RadarError(reason)
                self.run_extras(radar_read=fail, radar_config_present=True)
                self.assertEqual(self.status()["radar"], {
                    "outcome": "failed", "reason": reason, "latest": "2026-10-27", "symbols": 1, "stored": [],
                    "finishedAt": "2026-10-30T17:05:00+08:00"})
        self.assertEqual(self.store.radar_dates(), ["2026-10-27"])

    def test_a_sheet_with_other_columns_is_a_failure_not_a_crash(self):
        self.run_extras(radar_read=lambda: [["日期", "別的"]] + [["2026-10-27", "當沖"]], radar_config_present=True)
        self.assertEqual(self.status()["radar"]["outcome"], "failed")
        self.assertEqual(self.status()["radar"]["reason"], "試算表欄位改了")

    def test_a_day_that_cannot_be_written_does_not_stop_the_others(self):
        real = MarketStore.write_radar

        def write(store, day, symbols, fetched_at):
            if day == "2026-10-27":
                raise OSError(SECRET)
            return real(store, day, symbols, fetched_at)

        with mock.patch.object(MarketStore, "write_radar", write):
            self.run_extras(radar_read=lambda: values("2026-10-27", "2026-10-28"), radar_config_present=True)
        self.assertEqual(self.store.radar_dates(), ["2026-10-28"])
        self.assertEqual(self.status()["radar"]["outcome"], "failed")
        self.assertEqual(self.status()["radar"]["reason"], "名單存檔失敗")
        self.assertEqual(self.status()["radar"]["stored"], ["2026-10-28"])
        self.assertNotIn(SECRET, self.everything_on_disk())

    # --- together ---

    def test_taiex_failure_does_not_stop_radar(self):
        self.publish_days("2026-10-21", "2026-10-22")
        twse = FakeTwse(answers={"2026-10-21": b"<html></html>", "2026-10-22": OSError(SECRET)})
        self.run_extras(taiex_get=twse, radar_read=lambda: values("2026-10-27"), radar_config_present=True)
        self.assertEqual(self.status()["taiex"]["outcome"], "failed")
        self.assertEqual(self.status()["radar"]["outcome"], "ok")
        self.assertEqual(self.store.radar_dates(), ["2026-10-27"])

    def test_a_radar_failure_does_not_undo_the_taiex(self):
        self.publish_days("2026-10-21")

        def fail():
            raise RadarError("連線逾時")

        self.run_extras(taiex_get=FakeTwse(), radar_read=fail, radar_config_present=True)
        self.assertEqual(self.status()["taiex"]["outcome"], "ok")
        self.assertEqual(self.status()["radar"]["reason"], "連線逾時")

    def test_extras_never_raise(self):
        self.publish_days("2026-10-21", "2026-10-22")

        def broken(*_):
            raise RuntimeError(SECRET)

        self.run_extras(taiex_get=broken, radar_read=broken, radar_config_present=True)
        status = self.status()
        self.assertEqual(status["taiex"]["outcome"], "failed")
        self.assertEqual(status["radar"]["outcome"], "failed")
        self.assertEqual(status["radar"]["reason"], "名單處理時發生未預期的錯誤")
        on_disk = self.everything_on_disk()
        for marker in (SECRET, "RuntimeError"):
            self.assertNotIn(marker, on_disk)

    def test_extras_never_raise_even_when_the_store_does(self):
        self.publish_days("2026-10-21")
        with mock.patch.object(MarketStore, "write_status_key", side_effect=OSError(SECRET)), \
                mock.patch.object(MarketStore, "log", side_effect=OSError(SECRET)):
            self.run_extras(taiex_get=FakeTwse(), radar_read=lambda: values("2026-10-27"),
                            radar_config_present=True)
            self.run_extras(taiex_get=FakeTwse(), radar_read=None, radar_config_present=False)
        # the data itself was stored: only the report about it was lost
        self.assertEqual(self.store.taiex_days(), ["2026-10-21"])
        self.assertEqual(self.store.radar_dates(), ["2026-10-27"])

    def test_the_run_is_written_to_the_log(self):
        self.publish_days("2026-10-21")
        self.run_extras(taiex_get=FakeTwse(), radar_read=lambda: values("2026-10-27"), radar_config_present=True)
        log = (self.root / "logs" / "2026-10-30.log").read_text(encoding="utf-8")
        self.assertIn("大盤 2026-10-21", log)
        self.assertIn("名單", log)
        self.assertIn("2026-10-27", log)


if __name__ == "__main__":
    unittest.main()
