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


if __name__ == "__main__":
    unittest.main()
