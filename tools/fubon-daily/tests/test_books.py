import gzip
import json
import tempfile
import unittest
import zlib
from datetime import datetime
from pathlib import Path
from unittest import mock

from fubon_daily.books import Backoff, RawWriter, Stream, split_symbols
from fubon_daily.normalize import TAIPEI
from tests.fixtures import BOOK, books_message


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


class FakeWs:
    """A WebSocket stock client as far as Stream needs it: callbacks registered with on()."""

    def __init__(self):
        self.handlers = {}

    def on(self, name, handler):
        self.handlers[name] = handler


class StreamTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.mono = 100.0
        self.wall = epoch_ms(9, 0, 1)
        self.writer = RawWriter(Path(self.temp.name) / "raw", "conn1")
        self.stream = Stream(1, ["2330", "2317"], self.writer, monotonic=lambda: self.mono,
                             wall_ms=lambda: self.wall)

    def tearDown(self):
        self.stream.close()
        self.temp.cleanup()

    def lines(self):
        self.stream.close()
        return [line for path in self.writer.paths for line in read_lines(path)]

    def test_books_data_is_written_as_received(self):
        ws = FakeWs()
        self.stream.attach(ws)
        ws.handlers["message"](books_message())
        self.assertEqual(self.lines(), [{"r": self.wall, "d": BOOK}])
        self.assertEqual(self.stream.messages, 1)
        self.assertEqual(self.stream.last_books, {"2330": self.wall})
        self.assertGreater(self.stream.bytes, 0)

    def test_login_and_heartbeat_messages_are_not_stored(self):
        ws = FakeWs()
        self.stream.attach(ws)
        self.mono = 130.0
        ws.handlers["message"]('{"event":"authenticated","data":{"message":"Authenticated successfully"}}')
        ws.handlers["message"]({"event": "heartbeat", "data": {"time": "1"}})
        self.assertEqual(self.lines(), [])
        self.assertEqual(self.stream.last_seen, 130.0)
        self.assertEqual(self.stream.messages, 0)

    def test_subscriptions_are_acknowledged(self):
        ws = FakeWs()
        self.stream.attach(ws)
        ws.handlers["message"](json.dumps({"event": "subscribed", "data": [
            {"id": "a", "channel": "books", "symbol": "2330"}, {"id": "b", "channel": "books", "symbol": "2317"}]}))
        self.assertEqual(self.stream.acknowledged, {"2330", "2317"})
        self.assertEqual(self.stream.acknowledged_at, self.wall)

    def test_messages_from_an_older_generation_are_ignored(self):
        old, new = FakeWs(), FakeWs()
        self.assertEqual(self.stream.attach(old), 1)
        self.assertEqual(self.stream.attach(new), 2)
        old.handlers["message"](books_message())
        old.handlers["disconnect"](1006, "gone")
        self.assertEqual(self.stream.messages, 0)
        self.assertFalse(self.stream.down)
        new.handlers["disconnect"](1006, "gone")
        self.assertTrue(self.stream.down)
        self.assertEqual(self.lines(), [])

    def test_error_1001_asks_for_the_long_wait(self):
        ws = FakeWs()
        self.stream.attach(ws)
        ws.handlers["message"]('{"event":"error","data":{"code":1001,"message":"Maximum number of connections reached"}}')
        self.assertTrue(self.stream.full)
        self.assertEqual(len(self.stream.errors), 1)

    def test_control_lines_mark_what_happened(self):
        self.stream.mark("connected", generation=1)
        self.wall += 5
        self.stream.mark("refill", symbol="2317")
        self.assertEqual(self.lines(), [{"r": epoch_ms(9, 0, 1), "ev": "connected", "generation": 1},
                                        {"r": epoch_ms(9, 0, 1) + 5, "ev": "refill", "symbol": "2317"}])

    def test_silence_counts_heartbeats_too(self):
        ws = FakeWs()
        self.stream.attach(ws)
        ws.handlers["message"]({"event": "heartbeat", "data": {}})  # at monotonic 100
        self.assertFalse(self.stream.silent(169.0))
        self.assertTrue(self.stream.silent(171.0))


class BackoffTest(unittest.TestCase):
    def test_backoff_waits_grow_then_slow_down(self):
        backoff = Backoff(random=lambda: 0.5)
        waits = [backoff.failure(float(attempt)) for attempt in range(9)]
        self.assertEqual(waits, [15, 25, 45, 65, 125, 125, 125, 125, 300])
        self.assertEqual(backoff.failure(10.0, full=True), 300)
        backoff.connected(1000.0)
        backoff.tick(1119.0)
        self.assertGreater(backoff.failures, 0)
        backoff.tick(1120.0)
        self.assertEqual(backoff.failures, 0)
        self.assertEqual(backoff.failure(1200.0), 15)


if __name__ == "__main__":
    unittest.main()
