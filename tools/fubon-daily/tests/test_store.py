import gzip
import hashlib
import json
import os
import shutil
import time
import tempfile
import unittest
from unittest import mock
from datetime import date, datetime
from pathlib import Path

from fubon_daily.credentials import Redactor
from fubon_daily.normalize import TAIPEI
from fubon_daily.store import Locked, MarketStore
from tests.fixtures import DATE

NOW = datetime(2026, 10, 15, 17, 0, tzinfo=TAIPEI)
ENTRY = {"code": "2330", "name": "台積電", "referencePrice": 2490, "close": 2440, "change": -50,
         "tradeVolume": 58487, "tradeValue": 80781285000, "disposition": False, "bars": 2}
BARS = {"2330": [[0, 2420, 2435, 2420, 2435, 6446, 2420.92], [16200, 2440, 2440, 2440, 2440, 5833, 2437.47]]}


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.alive = {}
        self.store = MarketStore(self.root, pid_alive=lambda pid: self.alive.get(pid, False))

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, day=DATE, store=None):
        return (store or self.store).publish_day(day, "full-market", [ENTRY], BARS, [], 0, NOW,
                                                  "fubon-neo test", "abc123")

    def test_raw_payloads_round_trip_through_gzip(self):
        self.store.save_raw(DATE, "minute", "2330", {"symbol": "2330", "data": []})
        self.store.save_raw(DATE, "snapshot", None, {"date": DATE, "data": []})
        self.assertEqual(self.store.load_raw(DATE, "minute", "2330"), {"symbol": "2330", "data": []})
        self.assertIsNone(self.store.load_raw(DATE, "minute", "2317"))
        self.assertTrue((self.root / "staging" / DATE / "raw" / "minute" / "2330.json.gz").is_file())
        self.assertTrue((self.root / "staging" / DATE / "raw" / "snapshot.json.gz").is_file())

    def test_publish_moves_a_complete_day_and_its_raw_evidence(self):
        self.store.save_raw(DATE, "snapshot", None, {"date": DATE, "data": []})
        manifest = self.publish()
        day = self.root / "days" / DATE
        self.assertTrue(self.store.has_day(DATE))
        self.assertFalse((self.root / "staging" / DATE).exists())
        self.assertTrue((self.root / "raw" / DATE / "snapshot.json.gz").is_file())
        index = json.loads((day / "index.json").read_text(encoding="utf-8"))
        self.assertEqual((index["schema"], index["coverage"], index["volumeUnit"]), (1, "full-market", "lot"))
        self.assertEqual(index["symbols"], [ENTRY])
        symbol = json.loads(gzip.decompress((day / "symbols" / "2330.json.gz").read_bytes()))
        self.assertEqual(symbol, {"schema": 1, "code": "2330", "date": DATE, "volumeUnit": "lot", "bars": BARS["2330"]})
        for record in manifest["files"]:
            data = (day / record["path"]).read_bytes()
            self.assertEqual(record["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(record["bytes"], len(data))
        self.assertEqual(manifest["counts"], {"symbols": 1, "bars": 2, "excluded": 0})
        top = json.loads((self.root / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(top["days"], [{
            "date": DATE, "coverage": "full-market", "symbols": 1,
            "manifestSha256": hashlib.sha256((day / "manifest.json").read_bytes()).hexdigest(),
            "publishedAt": NOW.isoformat(timespec="seconds"),
        }])

    def test_publishing_the_same_day_twice_is_refused(self):
        self.publish()
        with self.assertRaises(FileExistsError):
            self.publish()

    def test_top_index_keeps_days_in_date_order(self):
        self.publish("2026-10-16")
        self.publish("2026-10-15")
        top = json.loads((self.root / "index.json").read_text(encoding="utf-8"))
        self.assertEqual([entry["date"] for entry in top["days"]], ["2026-10-15", "2026-10-16"])

    def test_prune_removes_old_raw_and_logs_but_keeps_lessons(self):
        for path in ("raw/2025-10-01", "raw/2026-10-01", "days/2025-10-01", "logs"):
            (self.root / path).mkdir(parents=True, exist_ok=True)
        (self.root / "logs" / "2026-06-01.log").write_text("old", encoding="utf-8")
        (self.root / "logs" / "2026-10-01.log").write_text("new", encoding="utf-8")
        self.store.prune(date(2026, 10, 16))
        self.assertFalse((self.root / "raw" / "2025-10-01").exists())
        self.assertTrue((self.root / "raw" / "2026-10-01").exists())
        self.assertTrue((self.root / "days" / "2025-10-01").exists())
        self.assertFalse((self.root / "logs" / "2026-06-01.log").exists())
        self.assertTrue((self.root / "logs" / "2026-10-01.log").exists())

    def test_lock_is_exclusive_while_its_owner_runs(self):
        self.alive[os.getpid()] = True
        with self.store.lock(NOW):
            with self.assertRaises(Locked):
                with MarketStore(self.root, pid_alive=lambda pid: True).lock(NOW):
                    pass
        self.assertFalse((self.root / ".lock").exists())

    def test_stale_lock_is_taken_over(self):
        self.root.mkdir(parents=True)
        (self.root / ".lock").write_text(json.dumps({"pid": 424242, "startedAt": "x"}), encoding="utf-8")
        with self.store.lock(NOW):
            self.assertEqual(json.loads((self.root / ".lock").read_text(encoding="utf-8"))["pid"], os.getpid())

    def run_record(self, day, outcome="ok", reason=None):
        return {"date": day, "mode": "daily", "startedAt": "s", "finishedAt": "f", "outcome": outcome,
                "reason": reason, "symbols": {"total": 1, "fetched": 1, "failed": 0, "excluded": 0}}

    def test_status_keeps_the_last_30_finished_runs_and_the_latest_day(self):
        self.publish()
        for day in range(1, 36):
            self.store.write_run(self.run_record(f"2026-09-{day:02d}" if day <= 30 else f"2026-10-{day - 30:02d}"))
        self.store.write_run(self.run_record("2026-10-06", outcome="running"))
        status = self.store.read_status()
        self.assertEqual(len(status["history"]), 30)
        self.assertEqual(status["history"][-1]["date"], "2026-10-05")
        self.assertEqual(status["lastRun"]["outcome"], "running")
        self.assertEqual(status["latestDay"], DATE)

    def test_status_and_logs_are_redacted(self):
        self.store.set_redactor(Redactor(["SECRET1"]))
        self.store.write_run(self.run_record(DATE, outcome="failed", reason="登入失敗 SECRET1"))
        self.store.log(DATE, "連線 SECRET1", NOW)
        for path in (self.root / "status.json", self.root / "logs" / f"{DATE}.log"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("SECRET1", text)
            self.assertIn("＊＊＊", text)

    def test_discard_staging_removes_a_closed_day(self):
        self.store.save_raw(DATE, "snapshot", None, {"date": "2026-10-14", "data": []})
        self.store.discard_staging(DATE)
        self.assertFalse((self.root / "staging" / DATE).exists())


    def test_corrupt_status_and_index_are_quarantined(self):
        self.root.mkdir(parents=True)
        (self.root / "status.json").write_text("{not json", encoding="utf-8")
        (self.root / "index.json").write_text("[]", encoding="utf-8")
        self.store.write_run(self.run_record(DATE))
        self.assertEqual(self.store.read_status()["lastRun"]["date"], DATE)
        names = sorted(path.name for path in self.root.iterdir())
        self.assertTrue(any(name.startswith("status.json.corrupt-") for name in names))
        self.assertTrue(any(name.startswith("index.json.corrupt-") for name in names))

    def test_reconcile_restores_index_entries_and_raw_evidence(self):
        self.store.save_raw(DATE, "snapshot", None, {"date": DATE, "data": []})
        self.publish()
        (self.root / "index.json").unlink()
        shutil.rmtree(self.root / "raw" / DATE)
        self.store.save_raw(DATE, "snapshot", None, {"date": DATE, "data": []})
        self.store.reconcile()
        top = json.loads((self.root / "index.json").read_text(encoding="utf-8"))
        self.assertEqual([(day["date"], day["coverage"], day["symbols"]) for day in top["days"]],
                         [(DATE, "full-market", 1)])
        self.assertTrue((self.root / "raw" / DATE / "snapshot.json.gz").is_file())
        self.assertFalse((self.root / "staging" / DATE).exists())

    def test_old_lock_is_taken_over_even_if_its_pid_is_alive(self):
        self.root.mkdir(parents=True)
        lock = self.root / ".lock"
        lock.write_text(json.dumps({"pid": 1234, "startedAt": "x"}), encoding="utf-8")
        old = time.time() - 3 * 3600
        os.utime(lock, (old, old))
        with MarketStore(self.root, pid_alive=lambda pid: True).lock(NOW):
            pass

    def test_unreadable_young_lock_counts_as_held(self):
        self.root.mkdir(parents=True)
        (self.root / ".lock").write_text("", encoding="utf-8")
        with self.assertRaises(Locked):
            with self.store.lock(NOW):
                pass

    def test_directory_moves_retry_while_windows_holds_a_file(self):
        real = os.replace
        calls = {"count": 0}

        def flaky(source, target):
            calls["count"] += 1
            if calls["count"] == 1:
                raise PermissionError("in use")
            return real(source, target)

        with mock.patch("fubon_daily.store.os.replace", side_effect=flaky), \
                mock.patch("fubon_daily.store.time.sleep"):
            self.publish()
        self.assertTrue(self.store.has_day(DATE))


TICK_ENTRY = {"code": "2330", "name": "台積電", "trades": 2, "volume": 6449, "close": 2425}
TRADES = {"2330": [[0, 2420, 6446, 2415, 2420], [1250, 2425, 3, 2420, 2425]]}
PAGES = [{"date": DATE, "symbol": "2330", "data": [{"price": 2420, "size": 6446, "time": 1, "serial": 11}]}]
META = {"name": "台積電", "tradeVolume": 6449, "close": 2425}
SHORT = [{**PAGES[0], "data": []}]


class TickStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.store = MarketStore(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, warnings=(), rejected=()):
        self.store.save_tick_raw(DATE, "2330", PAGES, META)
        return self.store.publish_ticks(DATE, [TICK_ENTRY], TRADES, list(rejected), list(warnings), NOW,
                                        "fubon-neo test", "abc123",
                                        after_hours={"2330": [[19_800_000, 2425, 34, None, None]]})

    def test_raw_pages_wait_in_staging_until_published(self):
        self.assertIsNone(self.store.load_tick_raw(DATE, "2330"))
        self.store.save_tick_raw(DATE, "2330", PAGES, META)
        self.assertEqual(self.store.load_tick_raw(DATE, "2330"), (PAGES, META))
        self.assertEqual(self.store.tick_raw_codes(DATE), ["2330"])
        self.assertFalse(self.store.has_ticks(DATE))
        self.assertFalse((self.root / "days").exists())

    def test_an_unreadable_cached_answer_is_fetched_again(self):
        self.store.save_tick_raw(DATE, "2330", PAGES, META)
        (self.root / "staging-ticks" / DATE / "raw" / "2330.json.gz").write_bytes(b"not gzip")
        self.assertIsNone(self.store.load_tick_raw(DATE, "2330"))
        self.assertEqual(self.store.tick_raw_codes(DATE), [])

    def fallbacks(self, code="2330"):
        return [(pages, meta) for _name, pages, meta in self.store.tick_fallbacks(DATE, code)]

    def test_answers_set_aside_are_only_ever_added(self):
        self.store.add_tick_fallback(DATE, "2330", PAGES, META)
        self.store.add_tick_fallback(DATE, "2330", SHORT, {**META, "cut": "x"})
        self.assertEqual(self.fallbacks(), [(PAGES, META), (SHORT, {**META, "cut": "x"})])  # oldest first
        self.assertEqual(self.store.tick_fallback_codes(DATE), ["2330"])
        self.assertIsNone(self.store.load_tick_raw(DATE, "2330"))
        self.assertEqual(self.store.tick_raw_codes(DATE), [])
        self.assertEqual(self.store.pending_tick_days(before="2026-10-16"), [DATE])

    def test_using_an_answer_set_aside_keeps_the_one_it_replaces(self):
        self.store.save_tick_raw(DATE, "2330", SHORT, META)
        self.store.add_tick_fallback(DATE, "2330", PAGES, META)
        (name, pages, meta), = self.store.tick_fallbacks(DATE, "2330")
        self.store.use_tick_fallback(DATE, "2330", name, pages, meta)
        self.assertEqual(self.store.load_tick_raw(DATE, "2330"), (PAGES, META))
        self.assertEqual(self.fallbacks(), [(SHORT, META)])

    def test_a_failure_while_using_an_answer_set_aside_loses_nothing(self):
        for step in ("add_tick_fallback", "save_tick_raw"):
            with self.subTest(step=step):
                self.tearDown()
                self.setUp()
                self.store.save_tick_raw(DATE, "2330", SHORT, META)
                self.store.add_tick_fallback(DATE, "2330", PAGES, META)
                (name, pages, meta), = self.store.tick_fallbacks(DATE, "2330")
                with mock.patch.object(MarketStore, step, side_effect=OSError("disk is busy")):
                    with self.assertRaises(OSError):
                        self.store.use_tick_fallback(DATE, "2330", name, pages, meta)
                kept = [answer for answer, _meta in self.fallbacks()] + [self.store.load_tick_raw(DATE, "2330")[0]]
                self.assertIn(SHORT, kept)
                self.assertIn(PAGES, kept)

    def test_an_answer_that_cannot_be_read_just_now_stays(self):
        self.store.save_tick_raw(DATE, "2330", PAGES, META)
        real = Path.read_bytes

        def busy(path):
            if path.name == "2330.json.gz":
                raise PermissionError("held by a scanner")
            return real(path)

        with mock.patch.object(Path, "read_bytes", busy):
            with self.assertRaises(PermissionError):
                self.store.load_tick_raw(DATE, "2330")
        self.assertEqual(self.store.load_tick_raw(DATE, "2330"), (PAGES, META))

    def test_an_answer_that_cannot_be_decoded_is_set_aside_and_fetched_again(self):
        for damage in ("truncated", "corrupt"):
            with self.subTest(damage=damage):
                self.tearDown()
                self.setUp()
                self.store.save_tick_raw(DATE, "2330", PAGES, META)
                path = self.root / "staging-ticks" / DATE / "raw" / "2330.json.gz"
                data = path.read_bytes()
                bad = data[:-8] if damage == "truncated" else data[:12] + bytes(b ^ 0xFF for b in data[12:20]) + data[20:]
                path.write_bytes(bad)
                self.assertIsNone(self.store.load_tick_raw(DATE, "2330"))
                self.assertEqual(self.store.tick_raw_codes(DATE), [])
                self.assertEqual(self.store.tick_fallbacks(DATE, "2330"), [])  # never offered again...
                manifest = self.store.publish_ticks(DATE, [], {}, [], [], NOW, "fubon-neo test", "abc123")
                evidence = [item["path"] for item in manifest["files"] if item["path"].endswith(".json.gz")]
                self.assertEqual([(self.root / "ticks" / DATE / item).read_bytes() for item in evidence], [bad])

    def test_answers_set_aside_go_along_as_evidence(self):
        self.store.add_tick_fallback(DATE, "2317", SHORT, {**META, "cut": "x"})
        manifest = self.publish()
        evidence = sorted(item["path"] for item in manifest["files"] if item["path"].startswith("fallback/"))
        self.assertEqual(len(evidence), 2)  # the answer and its facts
        folder = self.root / "ticks" / DATE
        answer = next(path for path in evidence if path.endswith(".json.gz"))
        self.assertEqual(json.loads(gzip.decompress((folder / answer).read_bytes())), SHORT)
        self.assertFalse((self.root / "staging-ticks" / DATE).exists())

    def test_days_left_in_staging_are_listed_until_published(self):
        self.store.save_tick_raw("2026-10-14", "2330", PAGES, META)
        self.store.save_tick_raw(DATE, "2330", PAGES, META)
        self.assertEqual(self.store.pending_tick_days(before=DATE), ["2026-10-14"])
        self.assertEqual(self.store.pending_tick_days(before="2026-10-16"), ["2026-10-14", DATE])

    def test_rejected_answers_are_published_with_the_reason(self):
        self.store.save_tick_raw(DATE, "2317", PAGES, {**META, "name": "鴻海"})
        manifest = self.publish(rejected=[{"code": "2317", "error": "time: 不在交易時段"}])
        self.assertEqual(manifest["rejected"], [{"code": "2317", "error": "time: 不在交易時段"}])
        self.assertEqual(sorted(item["path"] for item in manifest["files"]),
                         ["raw/2317.json.gz", "raw/2330.json.gz", "symbols/2330.json.gz"])

    def test_publish_moves_trades_and_raw_pages_together(self):
        manifest = self.publish(warnings=[{"code": "2330", "kind": "close", "detail": "x"}])
        folder = self.root / "ticks" / DATE
        self.assertTrue(self.store.has_ticks(DATE))
        self.assertFalse((self.root / "staging-ticks" / DATE).exists())
        self.assertEqual(manifest["counts"], {"symbols": 1, "trades": 2})
        self.assertEqual(manifest["symbols"], [TICK_ENTRY])
        self.assertEqual(manifest["sizeUnit"], "lot")
        self.assertEqual(manifest["warnings"][0]["kind"], "close")
        self.assertEqual(json.loads((folder / "manifest.json").read_text(encoding="utf-8")), manifest)
        payload = json.loads(gzip.decompress((folder / "symbols" / "2330.json.gz").read_bytes()))
        self.assertEqual(payload["trades"], TRADES["2330"])
        self.assertEqual(payload["afterHours"], [[19_800_000, 2425, 34, None, None]])
        self.assertEqual(payload["fields"], ["msAfter0900", "price", "size", "bid", "ask"])
        self.assertEqual(json.loads(gzip.decompress((folder / "raw" / "2330.json.gz").read_bytes())), PAGES)
        for item in manifest["files"]:
            data = (folder / item["path"]).read_bytes()
            self.assertEqual((item["bytes"], item["sha256"]), (len(data), hashlib.sha256(data).hexdigest()))
        self.assertEqual(sorted(item["path"] for item in manifest["files"]), ["raw/2330.json.gz", "symbols/2330.json.gz"])

    def test_publishing_the_same_day_twice_is_refused(self):
        self.publish()
        with self.assertRaises(FileExistsError):
            self.publish()

    def test_tick_status_survives_later_runs(self):
        self.store.write_ticks_status({"date": DATE, "outcome": "ok"})
        self.store.write_run({"date": DATE, "mode": "daily", "startedAt": "s", "finishedAt": "f", "outcome": "ok",
                              "reason": None, "symbols": {"total": 1, "fetched": 1, "failed": 0, "excluded": 0}})
        status = self.store.read_status()
        self.assertEqual(status["ticks"], {"date": DATE, "outcome": "ok"})
        self.assertEqual(status["lastRun"]["outcome"], "ok")

    def test_reconcile_clears_staging_of_published_ticks(self):
        self.publish()
        self.store.save_tick_raw(DATE, "2317", PAGES, META)
        self.store.reconcile()
        self.assertFalse((self.root / "staging-ticks" / DATE).exists())
        self.assertTrue(self.store.has_ticks(DATE))

    def test_prune_keeps_ticks(self):
        self.publish()
        self.store.prune(date(2028, 1, 1))
        self.assertTrue(self.store.has_ticks(DATE))


if __name__ == "__main__":
    unittest.main()
