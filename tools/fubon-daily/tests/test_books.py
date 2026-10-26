import gzip
import json
import tempfile
import unittest
import zlib
from datetime import datetime
from pathlib import Path
from unittest import mock

from fubon_daily.books import RawWriter, split_symbols
from fubon_daily.normalize import TAIPEI


def epoch_ms(hour, minute, second, ms=0, day=(2026, 10, 28)):
    return int(datetime(*day, hour, minute, second, ms * 1000, tzinfo=TAIPEI).timestamp() * 1000)


def read_lines(path: Path) -> list[dict]:
    """Every whole line in a gzip file, even one a crash left without its end: decompress what is there."""
    data = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(path.read_bytes())
    lines = data.decode("utf-8").split("\n")
    return [json.loads(line) for line in lines[:-1]]  # the last piece is empty or cut short


class SplitSymbolsTest(unittest.TestCase):
    def test_symbols_are_dealt_round_robin_most_traded_first(self):
        codes = [f"{1000 + rank}" for rank in range(1057)]
        groups, dropped = split_symbols(codes)
        self.assertEqual([len(group) for group in groups], [265, 264, 264, 264])
        self.assertEqual(dropped, [])
        self.assertEqual(groups[0][:2], [codes[0], codes[4]])
        self.assertEqual(sorted(code for group in groups for code in group), sorted(codes))

    def test_codes_beyond_four_times_280_are_reported(self):
        codes = [f"{1000 + rank}" for rank in range(1130)]
        groups, dropped = split_symbols(codes)
        self.assertEqual([len(group) for group in groups], [280, 280, 280, 280])
        self.assertEqual(dropped, codes[-10:])


class RawWriterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name) / "raw"

    def tearDown(self):
        self.temp.cleanup()

    def test_records_go_to_hourly_files_and_read_back(self):
        writer = RawWriter(self.folder, "conn1")
        first = {"r": epoch_ms(8, 59, 59, 900), "d": {"symbol": "2330", "bids": [], "asks": []}}
        second = {"r": epoch_ms(9, 0, 0, 100), "d": {"symbol": "2317", "名稱": "鴻海"}}
        self.assertGreater(writer.write(first), 0)
        self.assertGreater(writer.write(second), 0)
        writer.close()
        self.assertEqual(sorted(path.name for path in self.folder.iterdir()),
                         ["conn1-08-1.jsonl.gz", "conn1-09-1.jsonl.gz"])
        with gzip.open(self.folder / "conn1-08-1.jsonl.gz", "rt", encoding="utf-8") as handle:
            self.assertEqual([json.loads(line) for line in handle], [first])
        raw_text = gzip.decompress((self.folder / "conn1-09-1.jsonl.gz").read_bytes()).decode("utf-8")
        self.assertIn("鴻海", raw_text)  # ensure_ascii=False
        self.assertNotIn(", ", raw_text)  # compact separators

    def test_a_restart_never_appends_to_an_earlier_file(self):
        first = RawWriter(self.folder, "conn1")
        first.write({"r": epoch_ms(10, 0, 0), "d": {"symbol": "2330"}})
        first.close()
        before = (self.folder / "conn1-10-1.jsonl.gz").read_bytes()
        again = RawWriter(self.folder, "conn1")
        again.write({"r": epoch_ms(10, 5, 0), "d": {"symbol": "2317"}})
        again.close()
        self.assertEqual((self.folder / "conn1-10-1.jsonl.gz").read_bytes(), before)
        self.assertEqual(read_lines(self.folder / "conn1-10-2.jsonl.gz"), [{"r": epoch_ms(10, 5, 0), "d": {"symbol": "2317"}}])

    def test_flushed_lines_survive_a_crash(self):
        writer = RawWriter(self.folder, "conn2")
        records = [{"r": epoch_ms(9, 0, second), "d": {"symbol": "2330", "n": second}} for second in range(4)]
        for record in records[:3]:
            writer.write(record)
        writer.flush()
        writer.write(records[3])  # never flushed: a crash now loses only this one
        crashed = Path(self.temp.name) / "copy.gz"
        crashed.write_bytes((self.folder / "conn2-09-1.jsonl.gz").read_bytes())
        self.assertEqual(read_lines(crashed), records[:3])
        writer.close()

    def test_a_write_error_stops_the_writer_and_keeps_what_was_flushed(self):
        writer = RawWriter(self.folder, "conn3")
        kept = [{"r": epoch_ms(11, 0, second), "d": {"symbol": "2454"}} for second in range(2)]
        for record in kept:
            writer.write(record)
        writer.flush()
        with mock.patch.object(gzip.GzipFile, "write", side_effect=OSError(28, "No space left on device")):
            self.assertEqual(writer.write({"r": epoch_ms(11, 0, 5), "d": {"symbol": "2454"}}), 0)
        self.assertIsNotNone(writer.error)
        self.assertIn("No space", writer.error)
        self.assertEqual(writer.write({"r": epoch_ms(11, 0, 6), "d": {"symbol": "2454"}}), 0)  # stays stopped
        writer.close()
        self.assertEqual(read_lines(self.folder / "conn3-11-1.jsonl.gz"), kept)


if __name__ == "__main__":
    unittest.main()
