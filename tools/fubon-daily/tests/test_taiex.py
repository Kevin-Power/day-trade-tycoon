import copy
import hashlib
import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from fubon_daily import taiex
from fubon_daily.normalize import TAIPEI
from fubon_daily.store import MarketStore
from fubon_daily.taiex import TaiexError
from tests.fixtures import taiex_5s

DAY = date(2026, 10, 27)
NOW = datetime(2026, 10, 27, 17, 0, tzinfo=TAIPEI)


class ParsePointsTest(unittest.TestCase):
    def reason(self, raw, day=DAY):
        with self.assertRaises(TaiexError) as caught:
            taiex.parse_points(raw, day)
        return caught.exception.reason

    def test_parse_points_accepts_full_day(self):
        points = taiex.parse_points(taiex_5s(), DAY)
        self.assertEqual(len(points), 3241)
        self.assertEqual(points[0], [0, 33000.0])
        self.assertEqual(points[1], [5, 33000.03])
        self.assertEqual(points[-1], [16200, 33100.0])  # 13:30:00, "33,100.00" read without its comma
        self.assertEqual([second for second, _ in points], list(range(0, 16201, 5)))

    def test_columns_are_found_by_name(self):
        raw = taiex_5s()
        raw["fields"] = ["未含金融保險股指數", "發行量加權股價指數", "時間"]
        raw["data"] = [[row[2], row[1], row[0]] for row in raw["data"]]
        self.assertEqual(taiex.parse_points(raw, DAY), taiex.parse_points(taiex_5s(), DAY))

    def test_rejects_stat_not_ok(self):
        raw = taiex_5s()
        raw["stat"] = "很抱歉，沒有符合條件的資料!"
        self.assertEqual(self.reason(raw), "證交所回覆不是 OK")
        self.assertEqual(self.reason({"data": []}), "證交所回覆不是 OK")

    def test_rejects_wrong_date(self):
        self.assertEqual(self.reason(taiex_5s(date="20261026")), "日期不符")
        self.assertEqual(self.reason(taiex_5s(), date(2026, 10, 28)), "日期不符")

    def test_rejects_gap(self):
        raw = taiex_5s()
        raw["data"] = [row for row in raw["data"] if row[0] != "10:00:05"]
        self.assertEqual(self.reason(raw), "大盤資料不連續")

    def test_rejects_a_day_that_stops_early(self):
        raw = taiex_5s()
        raw["data"] = raw["data"][:2000]
        self.assertEqual(self.reason(raw), "大盤資料不連續")

    def test_rejects_rows_out_of_order(self):
        raw = taiex_5s()
        raw["data"][10], raw["data"][11] = raw["data"][11], raw["data"][10]
        self.assertEqual(self.reason(raw), "大盤資料不連續")

    def test_rejects_duplicate(self):
        raw = taiex_5s()
        raw["data"].insert(100, copy.deepcopy(raw["data"][100]))
        self.assertEqual(self.reason(raw), "大盤資料重複")
        # a row stamped like its neighbour, the count unchanged, is a duplicate too
        raw = taiex_5s()
        raw["data"][101][0] = raw["data"][100][0]
        self.assertEqual(self.reason(raw), "大盤資料重複")

    def test_rejects_non_positive(self):
        for bad in ("0.00", "-33,000.00", "--", "", "nan", "inf", None, True):
            with self.subTest(bad=bad):
                raw = taiex_5s()
                raw["data"][500][1] = bad
                self.assertEqual(self.reason(raw), "大盤數值不正確")

    def test_numbers_in_the_file_are_accepted_as_they_are(self):
        raw = taiex_5s()
        raw["data"][500][1] = 33050.5
        self.assertEqual(taiex.parse_points(raw, DAY)[500], [2500, 33050.5])

    def test_rejects_a_file_of_the_wrong_shape(self):
        shape = "大盤檔案格式不正確"
        for name, change in (
            ("no value column", lambda raw: raw.update(fields=["時間", "未含金融保險股指數"])),
            ("no time column", lambda raw: raw.update(fields=["發行量加權股價指數", "未含金融保險股指數"])),
            ("fields missing", lambda raw: raw.pop("fields")),
            ("data missing", lambda raw: raw.pop("data")),
            ("row too short", lambda raw: raw["data"].__setitem__(7, ["09:00:35"])),
            ("row not a list", lambda raw: raw["data"].__setitem__(7, "09:00:35")),
            ("time not a time", lambda raw: raw["data"][7].__setitem__(0, "9:00:35")),
            ("time not text", lambda raw: raw["data"][7].__setitem__(0, 32435)),
        ):
            with self.subTest(name):
                raw = taiex_5s()
                change(raw)
                self.assertEqual(self.reason(raw), shape)
        self.assertEqual(self.reason([]), "證交所回覆不是 OK")


class FetchTest(unittest.TestCase):
    def test_fetch_asks_for_the_day_and_returns_the_bytes_as_received(self):
        asked = []
        answer = b'{"stat":"OK"}  '

        def http_get(url):
            asked.append(url)
            return answer

        self.assertEqual(taiex.fetch(DAY, http_get), answer)
        self.assertEqual(asked, ["https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=20261027"])
        self.assertEqual(taiex.USER_AGENT, "Mozilla/5.0 (DayTradeTycoon fetcher)")

    def test_fetch_failure_gives_a_fixed_reason_and_no_exception_text(self):
        def http_get(url):
            raise RuntimeError("secret-host.example refused")

        with self.assertRaises(TaiexError) as caught:
            taiex.fetch(DAY, http_get)
        self.assertEqual(caught.exception.reason, "無法連上證交所")
        self.assertNotIn("secret", str(caught.exception))
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)

    def test_fetch_rejects_an_empty_or_odd_answer(self):
        for answer in (b"", None, "text"):
            with self.subTest(answer=answer):
                with self.assertRaises(TaiexError) as caught:
                    taiex.fetch(DAY, lambda url: answer)
                self.assertEqual(caught.exception.reason, "證交所回覆是空的")

    def test_decode_reads_json_and_names_a_page_that_is_not(self):
        self.assertEqual(taiex.decode('{"stat":"OK","note":"大盤"}'.encode("utf-8")), {"stat": "OK", "note": "大盤"})
        for answer in (b"<html>blocked</html>", b"[1, 2]", b"\xff\xfe", b"null"):
            with self.subTest(answer=answer):
                with self.assertRaises(TaiexError) as caught:
                    taiex.decode(answer)
                self.assertEqual(caught.exception.reason, "證交所回覆不是 JSON")


class StoreTaiexTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.store = MarketStore(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, day=DAY, previous_close=33000.0, close=33100.0, version="abc123", store=None):
        payload = taiex_5s(day.strftime("%Y%m%d"), previous_close, close)
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        (store or self.store).publish_taiex(day.isoformat(), raw, taiex.parse_points(payload, day), version, NOW)
        return raw

    def test_publish_writes_raw_points_and_manifest(self):
        raw = self.publish()
        folder = self.root / "taiex" / "2026-10-27"
        self.assertEqual(sorted(path.name for path in folder.iterdir()), ["manifest.json", "points.json", "raw.json"])
        self.assertEqual((folder / "raw.json").read_bytes(), raw)
        points = json.loads((folder / "points.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(points), ["date", "points", "previousClose", "schema", "source"])
        self.assertEqual((points["schema"], points["date"], points["source"], points["previousClose"]),
                         (1, "2026-10-27", "twse MI_5MINS_INDEX", 33000.0))
        self.assertEqual(len(points["points"]), 3241)
        self.assertEqual((points["points"][0], points["points"][-1]), ([0, 33000.0], [16200, 33100.0]))
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual((manifest["schema"], manifest["date"], manifest["version"], manifest["createdAt"]),
                         (1, "2026-10-27", "abc123", "2026-10-27T17:00:00+08:00"))
        self.assertEqual(sorted(item["path"] for item in manifest["files"]), ["points.json", "raw.json"])
        for item in manifest["files"]:
            data = (folder / item["path"]).read_bytes()
            self.assertEqual((item["bytes"], item["sha256"]), (len(data), hashlib.sha256(data).hexdigest()))
        self.assertFalse((self.root / "staging-taiex" / "2026-10-27").exists())

    def test_publish_is_write_once(self):
        self.publish()
        folder = self.root / "taiex" / "2026-10-27"
        before = {path.name: path.read_bytes() for path in folder.iterdir()}
        with self.assertRaises(FileExistsError):
            self.publish(close=33200.0, version="other")
        self.assertEqual({path.name: path.read_bytes() for path in folder.iterdir()}, before)
        self.assertFalse((self.root / "staging-taiex" / "2026-10-27").exists())

    def test_lookups(self):
        self.assertFalse(self.store.has_taiex("2026-10-26"))
        self.assertEqual(self.store.taiex_days(), [])
        self.assertIsNone(self.store.taiex_close("2026-10-26"))
        self.publish(date(2026, 10, 26), previous_close=32900.0, close=33000.0)
        self.publish(DAY)
        (self.root / "taiex" / "notes").mkdir()
        (self.root / "taiex" / "2026-10-28").mkdir()  # no manifest: not published
        self.assertTrue(self.store.has_taiex("2026-10-26"))
        self.assertFalse(self.store.has_taiex("2026-10-28"))
        self.assertEqual(self.store.taiex_days(), ["2026-10-26", "2026-10-27"])
        self.assertEqual(self.store.taiex_close("2026-10-26"), 33000.0)
        self.assertEqual(self.store.taiex_close("2026-10-27"), 33100.0)
        self.assertIsNone(self.store.taiex_close("2026-10-28"))
        self.assertTrue(self.store.has_taiex(date(2026, 10, 26)))  # a date works as well as its name

    def test_taiex_close_is_none_when_the_points_cannot_be_read(self):
        self.publish()
        (self.root / "taiex" / "2026-10-27" / "points.json").write_bytes(b"{broken")
        self.assertIsNone(self.store.taiex_close("2026-10-27"))
        (self.root / "taiex" / "2026-10-27" / "points.json").write_bytes(b'{"points":[[0,1.5]]}')
        self.assertIsNone(self.store.taiex_close("2026-10-27"))

    def test_a_day_name_that_is_no_day_is_refused(self):
        with self.assertRaises(ValueError):
            self.store.has_taiex("../days")

    def test_previous_close_must_match(self):
        self.publish(date(2026, 10, 26), previous_close=32900.0, close=33000.0)
        payload = taiex_5s("20261027", previous_close=33001.0)
        raw = json.dumps(payload).encode("utf-8")
        with self.assertRaises(TaiexError) as caught:
            self.store.publish_taiex("2026-10-27", raw, taiex.parse_points(payload, DAY), "abc123", NOW)
        self.assertEqual(caught.exception.reason, "前一交易日收盤與今天 09:00:00 不同")
        self.assertFalse(self.store.has_taiex("2026-10-27"))
        # the answer was written to staging before it was checked, and stays there as evidence
        self.assertEqual((self.root / "staging-taiex" / "2026-10-27" / "raw.json").read_bytes(), raw)

    def test_a_matching_previous_close_publishes(self):
        self.publish(date(2026, 10, 26), previous_close=32900.0, close=33000.0)
        self.publish(DAY, previous_close=33000.0)
        self.assertTrue(self.store.has_taiex("2026-10-27"))

    def test_the_first_day_has_nothing_to_be_compared_with(self):
        self.publish(DAY, previous_close=12345.67)
        self.assertEqual(self.store.taiex_days(), ["2026-10-27"])

    def test_a_retry_after_a_failed_check_publishes_and_clears_staging(self):
        self.publish(date(2026, 10, 26), previous_close=32900.0, close=33000.0)
        with self.assertRaises(TaiexError):
            self.publish(DAY, previous_close=33001.0)
        self.publish(DAY, previous_close=33000.0)
        self.assertFalse((self.root / "staging-taiex" / "2026-10-27").exists())
        self.assertEqual(self.store.taiex_close("2026-10-27"), 33100.0)

    def test_a_trading_day_without_its_file_in_between_is_not_compared(self):
        # 10/26 is published (1-minute candles) but its TAIEX fetch failed: 10/21's close is not "the previous
        # trading day's", so 10/27 is neither held back by it nor compared with it.
        self.publish(date(2026, 10, 21), previous_close=32000.0, close=32500.0)
        (self.root / "index.json").write_text(json.dumps({"schema": 1, "days": [
            {"date": "2026-10-21"}, {"date": "2026-10-26"}, {"date": "2026-10-27"}]}), encoding="utf-8")
        self.publish(DAY, previous_close=33000.0)
        self.assertEqual(self.store.taiex_days(), ["2026-10-21", "2026-10-27"])

    def test_an_adjacent_published_day_still_has_its_close_compared(self):
        self.publish(date(2026, 10, 26), previous_close=32900.0, close=33000.0)
        (self.root / "index.json").write_text(json.dumps({"schema": 1, "days": [
            {"date": "2026-10-26"}, {"date": "2026-10-27"}]}), encoding="utf-8")
        with self.assertRaises(TaiexError):
            self.publish(DAY, previous_close=33001.0)

    def test_status_key_survives_write_run(self):
        self.store.write_status_key("taiex", {"date": "2026-10-27", "outcome": "ok", "points": 3241})
        self.store.write_run({"date": "2026-10-27", "mode": "daily", "startedAt": "s", "finishedAt": "f",
                              "outcome": "ok", "reason": None,
                              "symbols": {"total": 1, "fetched": 1, "failed": 0, "excluded": 0}})
        status = self.store.read_status()
        self.assertEqual(status["taiex"], {"date": "2026-10-27", "outcome": "ok", "points": 3241})
        self.assertEqual(status["lastRun"]["outcome"], "ok")

    def test_status_keys_do_not_overwrite_each_other(self):
        self.store.write_ticks_status({"date": "2026-10-27", "outcome": "ok"})
        self.store.write_status_key("taiex", {"outcome": "failed", "reason": "日期不符"})
        self.store.write_status_key("taiex", {"outcome": "ok"})
        status = self.store.read_status()
        self.assertEqual((status["ticks"], status["taiex"]), ({"date": "2026-10-27", "outcome": "ok"}, {"outcome": "ok"}))


if __name__ == "__main__":
    unittest.main()
