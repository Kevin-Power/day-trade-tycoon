import gzip
import hashlib
import json
import os
import shutil
import tempfile
import time as clock
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock

from fubon_daily import books_compact
from fubon_daily.books import RawWriter
from fubon_daily.books_compact import decode
from fubon_daily.books_publish import BooksPublishError, publish_day
from fubon_daily.normalize import TAIPEI
from fubon_daily.store import MarketStore
from tests.test_books_compact import Raw, at, book, epoch_ms

DAY = "2026-10-28"
NOW = datetime(2026, 10, 28, 13, 40, tzinfo=TAIPEI)


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.store = MarketStore(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def record_day(self, day=DAY, crossed=False):
        raw = Raw(self.store.books_raw_folder(day))
        raw.control("connected", at(9, 0), generation=1, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(9, 0, 1), symbols=2)
        for second in range(10):
            raw.books(book("2330", at(9, 0, 2 + second), step=second))
            data = book("2317", at(9, 0, 2 + second), price=200.0, step=second)
            if crossed and second == 4:
                data["bids"][0]["price"] = data["asks"][0]["price"] + 0.5  # bid above ask while matching
            raw.books(data)
        raw.control("stop", at(13, 36))
        raw.close()

    def manifest(self, day=DAY):
        return json.loads((self.root / "books" / day / "manifest.json").read_text(encoding="utf-8"))

    def test_publish_is_atomic_and_lists_every_file_hash(self):
        self.record_day()
        summary = publish_day(self.store, DAY, version="test", now=NOW)
        manifest = self.manifest()
        self.assertEqual([entry["code"] for entry in manifest["symbols"]], ["2317", "2330"])
        for entry in manifest["symbols"]:
            blob = (self.root / "books" / DAY / entry["path"]).read_bytes()
            self.assertEqual(entry["sha256"], hashlib.sha256(blob).hexdigest())
            self.assertEqual(entry["bytes"], len(blob))
            self.assertEqual(entry["messages"], 10)
            self.assertEqual(len(decode(blob)), 10)
        self.assertEqual((manifest["sizeUnit"], manifest["source"]), ("unverified", "fubon-neo websocket books (Speed)"))
        self.assertEqual(manifest["counts"], {"symbols": 2, "messages": 20})
        self.assertEqual(summary["messages"], 20)
        self.assertFalse((self.root / "staging-books" / DAY).exists())
        self.assertTrue(any((self.root / "raw-books" / DAY).glob("conn1-*.jsonl.gz")))

    def test_a_failure_halfway_publishes_nothing_and_keeps_the_raw_files(self):
        self.record_day()
        with mock.patch("fubon_daily.store._replace", side_effect=PermissionError("held by a scanner")):
            with self.assertRaises(PermissionError):
                publish_day(self.store, DAY, version="test", now=NOW)
        self.assertFalse((self.root / "books" / DAY).exists())
        self.assertTrue(any(self.store.books_raw_folder(DAY).glob("conn1-*.jsonl.gz")))

    def test_a_crossed_book_is_a_warning_not_a_block(self):
        self.record_day(crossed=True)
        publish_day(self.store, DAY, version="test", now=NOW)
        warnings = self.manifest()["warnings"]
        self.assertIn({"code": "2317", "kind": "crossed", "count": 1}, warnings)
        self.assertEqual(self.manifest()["limitCheck"], "skipped")  # the day's 1-minute index is not out yet

    def test_prices_outside_the_days_limits_are_warned_when_the_index_is_there(self):
        self.record_day()
        listing = {"schema": 1, "date": DAY, "symbols": [
            {"code": "2330", "referencePrice": 50.0}, {"code": "2317", "referencePrice": 150.0}]}
        (self.root / "days" / DAY).mkdir(parents=True)
        (self.root / "days" / DAY / "index.json").write_text(json.dumps(listing), encoding="utf-8")
        publish_day(self.store, DAY, version="test", now=NOW)
        manifest = self.manifest()
        self.assertEqual(manifest["limitCheck"], "done")
        kinds = {(item["code"], item["kind"]) for item in manifest["warnings"]}
        self.assertIn(("2317", "limit"), kinds)  # 200 is far above 150 + 10%
        self.assertNotIn(("2330", "limit"), kinds)

    def test_a_round_trip_mismatch_blocks_the_day(self):
        self.record_day()
        real = books_compact._slots
        # An encoder that never sees the best bid change (its size changes in every message here).
        with mock.patch.object(books_compact, "_slots", lambda frame: [(None, None)] + real(frame)[1:]):
            with self.assertRaises(BooksPublishError) as caught:
                publish_day(self.store, DAY, version="test", now=NOW)
        self.assertIn("不一致", str(caught.exception))
        self.assertFalse((self.root / "books" / DAY).exists())
        self.assertTrue(any(self.store.books_raw_folder(DAY).glob("conn1-*.jsonl.gz")))

    def test_republish_from_raw_matches_the_first_publish(self):
        self.record_day()
        publish_day(self.store, DAY, version="test", now=NOW)
        first = {entry["code"]: entry["sha256"] for entry in self.manifest()["symbols"]}
        shutil.rmtree(self.root / "books" / DAY)
        publish_day(self.store, DAY, version="test", now=NOW + timedelta(days=1))  # from raw-books/<day>
        self.assertEqual({entry["code"]: entry["sha256"] for entry in self.manifest()["symbols"]}, first)

    def test_an_already_published_day_is_refused(self):
        self.record_day()
        publish_day(self.store, DAY, version="test", now=NOW)
        with self.assertRaises(BooksPublishError):
            publish_day(self.store, DAY, version="test", now=NOW)

    def test_raw_is_kept_until_published_then_pruned_after_14_days(self):
        old_published, old_unpublished, recent = "2026-10-01", "2026-10-02", "2026-10-20"
        for day in (old_published, recent):
            (self.root / "raw-books" / day).mkdir(parents=True)
            (self.root / "books" / day).mkdir(parents=True)
            (self.root / "books" / day / "manifest.json").write_text("{}", encoding="utf-8")
        (self.root / "raw-books" / old_unpublished).mkdir(parents=True)  # its books were removed to republish
        (self.store.books_raw_folder("2026-09-30")).mkdir(parents=True)  # recorded, never published
        (self.root / "logs" / "books").mkdir(parents=True)
        (self.root / "logs" / "books" / "2026-06-01.log").write_text("x", encoding="utf-8")
        self.store.prune_books(date(2026, 10, 28))
        self.assertFalse((self.root / "raw-books" / old_published).exists())
        self.assertTrue((self.root / "raw-books" / old_unpublished).exists())
        self.assertTrue((self.root / "raw-books" / recent).exists())
        self.assertTrue(self.store.books_raw_folder("2026-09-30").exists())
        self.assertTrue((self.root / "books" / old_published / "manifest.json").exists())  # books are kept forever
        self.assertFalse((self.root / "logs" / "books" / "2026-06-01.log").exists())


if __name__ == "__main__":
    unittest.main()
