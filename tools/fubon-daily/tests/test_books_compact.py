import gzip
import unittest.mock
import json
import tempfile
import unittest
import zlib
from datetime import datetime, timedelta
from pathlib import Path

from fubon_daily.books import RawWriter
from fubon_daily.books_compact import (FLAG_FULL, FLAG_REST, decode, encode_day, gaps_by_symbol)
from fubon_daily.normalize import TAIPEI

DAY = "2026-10-28"
OPEN = datetime(2026, 10, 28, 9, 0, tzinfo=TAIPEI)


def at(hour, minute, second=0, ms=0):
    return datetime(2026, 10, 28, hour, minute, second, ms * 1000, tzinfo=TAIPEI)


def epoch_ms(moment):
    return int(moment.timestamp() * 1000)


def after_open(moment):
    return epoch_ms(moment) - epoch_ms(OPEN)


def book(code, moment, levels=(5, 5), price=50.0, step=0, trial=False, continuous=True):
    bids = [{"price": round(price - 0.05 * (level + 1), 2), "size": 10 + level + step} for level in range(levels[0])]
    asks = [{"price": round(price + 0.05 * level, 2), "size": 20 + level} for level in range(levels[1])]
    data = {"symbol": code, "type": "EQUITY", "exchange": "TWSE", "market": "TSE", "bids": bids, "asks": asks,
            "time": int(moment.timestamp() * 1_000_000)}
    if trial:
        data["isTrial"] = True
    elif continuous:
        data["isContinuous"] = True
    return data


def frame(data, src="ws"):
    stamp = data.get("lastUpdated") if src == "rest" else data["time"]
    return {"t": stamp // 1000 - epoch_ms(OPEN), "trial": bool(data.get("isTrial")),
            "continuous": bool(data.get("isContinuous")), "src": src,
            "bids": [[level["price"], level["size"]] for level in data["bids"]],
            "asks": [[level["price"], level["size"]] for level in data["asks"]]}


def rows_of(blob):
    return json.loads(gzip.decompress(blob))["rows"]


class Raw:
    """Writes raw files the way the recorder does (RawWriter): data, control and REST lines."""

    def __init__(self, folder, name="conn1"):
        self.writer = RawWriter(folder, name)

    def books(self, data, received=None):
        moment = received or datetime.fromtimestamp(data["time"] / 1_000_000, TAIPEI) + timedelta(milliseconds=5)
        self.writer.write({"r": epoch_ms(moment), "d": data})

    def rest(self, data, moment):
        self.writer.write({"r": epoch_ms(moment), "src": "rest", "d": data})

    def control(self, event, moment, **values):
        self.writer.write({"r": epoch_ms(moment), "ev": event, **values})

    def close(self):
        self.writer.close()


class CompactTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.raw = Path(self.temp.name) / "raw"

    def tearDown(self):
        self.temp.cleanup()

    def test_round_trip_equals_the_raw_messages(self):
        raw = Raw(self.raw)
        raw.control("connected", at(8, 44), generation=1, symbols=3, codes=["1101", "2330", "6957"])
        raw.control("subscribed", at(8, 44, 1), symbols=3)
        expected = {"1101": [], "2330": [], "6957": []}
        moment = at(8, 59, 50)
        for index in range(300):
            code = ("1101", "2330", "6957")[index % 3]
            moment += timedelta(milliseconds=731)
            data = book(code, moment, levels=(4, 5) if code == "6957" else (5, 5), price=50 + index % 7 * 0.05,
                        step=index % 4, trial=moment < at(9, 0), continuous=index % 50 != 7)
            raw.books(data)
            expected[code].append(frame(data))
        raw.control("stop", at(13, 36))
        raw.close()
        encoded = encode_day(self.raw, DAY)
        self.assertEqual(sorted(encoded.files), ["1101", "2330", "6957"])
        for code, frames in expected.items():
            self.assertEqual(decode(encoded.files[code]), frames, code)
            self.assertEqual(encoded.messages[code], 100)
        header = json.loads(gzip.decompress(encoded.files["2330"]))
        self.assertEqual((header["schema"], header["code"], header["date"], header["sizeUnit"], header["keyEvery"]),
                         (1, "2330", DAY, "unverified", 60000))
        self.assertEqual(encoded.unparsable, [])
        self.assertEqual(encoded.mismatched, [])

    def test_arrival_order_is_kept_even_when_time_goes_back(self):
        # Fubon's time very rarely goes back (22 of 914,635 on 2026-10-22): keep the order it sent them in.
        raw = Raw(self.raw)
        raw.control("connected", at(9, 0), generation=1, symbols=1, codes=["1303"])
        raw.control("subscribed", at(9, 0, 1), symbols=1)
        sent = [book("1303", at(9, 0, 5), step=0), book("1303", at(9, 0, 7), step=1),
                book("1303", at(9, 0, 6), step=2), book("1303", at(9, 0, 8), step=3)]
        for index, data in enumerate(sent):
            raw.books(data, received=at(9, 0, 10, index))
        raw.close()
        encoded = encode_day(self.raw, DAY)
        self.assertEqual(decode(encoded.files["1303"]), [frame(data) for data in sent])
        self.assertEqual(encoded.mismatched, [])

    def test_a_round_trip_mismatch_is_reported(self):
        raw = Raw(self.raw)
        raw.control("connected", at(9, 0), generation=1, symbols=1, codes=["2330"])
        raw.control("subscribed", at(9, 0, 1), symbols=1)
        for second in range(5):
            data = book("2330", at(9, 0, 2 + second))
            data["asks"][4]["size"] = 100 + second  # only the fifth ask changes
            raw.books(data)
        raw.close()
        from fubon_daily import books_compact

        real = books_compact._slots
        with unittest.mock.patch.object(books_compact, "_slots", lambda frame: real(frame)[:9] + [(None, None)]):
            encoded = encode_day(self.raw, DAY)  # an encoder that loses the fifth ask
        self.assertEqual(encoded.mismatched, ["2330"])

    def test_every_minute_starts_with_a_full_frame(self):
        raw = Raw(self.raw)
        raw.control("connected", at(9, 0), generation=1, symbols=1, codes=["2330"])
        raw.control("subscribed", at(9, 0), symbols=1)
        for second in range(0, 180, 7):
            raw.books(book("2330", at(9, 0) + timedelta(seconds=second), step=second % 3))
        raw.close()
        rows = rows_of(encode_day(self.raw, DAY).files["2330"])
        t = 0
        minutes = []
        for dt, flags, _ in rows:
            t += dt
            minutes.append((t // 60000, bool(flags & FLAG_FULL)))
        self.assertTrue(minutes[0][1])
        for (previous, _), (minute, full) in zip(minutes, minutes[1:]):
            if minute != previous:
                self.assertTrue(full, minute)
        self.assertFalse(all(full for _, full in minutes))  # the rest are deltas

    def test_a_gap_is_kept_and_the_next_row_is_full(self):
        raw = Raw(self.raw)
        raw.control("connected", at(9, 0), generation=1, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(9, 0, 1), symbols=2)
        raw.books(book("2330", at(9, 0, 10)))
        raw.control("down", at(9, 1, 30), reason="斷線", since=epoch_ms(at(9, 0, 20)))
        raw.control("connected", at(9, 1, 40), generation=2, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(9, 1, 41), symbols=2)
        raw.books(book("2330", at(9, 1, 45), step=1))
        raw.control("stop", at(9, 3))
        raw.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        self.assertEqual(gaps["2330"], [[after_open(at(9, 0, 20)), after_open(at(9, 1, 45, 5))]])
        self.assertEqual(gaps["2317"], [[after_open(at(9, 0, 20)), after_open(at(9, 3))]])  # never heard again
        encoded = encode_day(self.raw, DAY)
        header = json.loads(gzip.decompress(encoded.files["2330"]))
        self.assertEqual(header["gaps"], gaps["2330"])
        rows = header["rows"]
        self.assertTrue(rows[1][1] & FLAG_FULL)  # same minute as the row before, but after the gap

    def test_a_crash_and_restart_is_a_gap(self):
        first = Raw(self.raw)
        first.control("connected", at(10, 0), generation=1, symbols=1, codes=["2330"])
        first.control("subscribed", at(10, 0, 1), symbols=1)
        first.books(book("2330", at(10, 0, 5)))
        first.writer.flush()  # then the process dies: no stop line
        again = Raw(self.raw)  # the re-start trigger: a new part file for the same hour
        again.control("connected", at(10, 10), generation=1, symbols=1, codes=["2330"])
        again.control("subscribed", at(10, 10, 1), symbols=1)
        again.books(book("2330", at(10, 10, 30), step=2))
        again.control("stop", at(10, 20))
        again.close()
        self.assertEqual(sorted(path.name for path in self.raw.iterdir()),
                         ["conn1-10-1.jsonl.gz", "conn1-10-2.jsonl.gz"])
        gaps = gaps_by_symbol(self.raw, DAY)
        self.assertEqual(gaps["2330"], [[after_open(at(10, 0, 5, 5)), after_open(at(10, 10, 30, 5))]])
        frames = decode(encode_day(self.raw, DAY).files["2330"])
        self.assertEqual(len(frames), 2)
        first.close()  # only now, so the earlier part stayed as a crash leaves it

    def test_rest_refills_are_flagged(self):
        raw = Raw(self.raw)
        raw.control("connected", at(9, 0), generation=1, symbols=1, codes=["2317"])
        raw.control("subscribed", at(9, 0, 1), symbols=1)
        raw.books(book("2317", at(9, 0, 3)))
        raw.control("down", at(9, 2), reason="斷線", since=epoch_ms(at(9, 1)))
        raw.control("connected", at(9, 2, 10), generation=2, symbols=1, codes=["2317"])
        raw.control("subscribed", at(9, 2, 11), symbols=1)
        quote = {"symbol": "2317", "bids": [{"price": 200.5, "size": 3}], "asks": [{"price": 201, "size": 4}],
                 "lastUpdated": int(at(9, 2, 40).timestamp() * 1_000_000)}
        raw.rest(quote, at(9, 2, 41))
        raw.control("refill", at(9, 2, 41), symbol="2317")
        raw.close()
        encoded = encode_day(self.raw, DAY)
        frames = decode(encoded.files["2317"])
        self.assertEqual(frames[-1], frame(quote, src="rest"))
        rows = rows_of(encoded.files["2317"])
        self.assertTrue(rows[-1][1] & FLAG_REST and rows[-1][1] & FLAG_FULL)
        self.assertEqual(gaps_by_symbol(self.raw, DAY)["2317"], [[after_open(at(9, 1)), after_open(at(9, 2, 41))]])

    def test_unparsable_lines_are_reported_not_dropped_silently(self):
        self.raw.mkdir(parents=True)
        good = [json.dumps({"r": epoch_ms(at(9, 0, second)), "d": book("2330", at(9, 0, second))}) for second in (1, 2)]
        text = "\n".join([good[0], "not json", good[1]]) + "\n"
        (self.raw / "conn1-09-1.jsonl.gz").write_bytes(gzip.compress(text.encode("utf-8")))
        cut = zlib.compressobj(9, zlib.DEFLATED, 16 + zlib.MAX_WBITS)
        partial = cut.compress((good[0] + "\n" + good[1][:40]).encode("utf-8")) + cut.flush(zlib.Z_SYNC_FLUSH)
        (self.raw / "conn2-09-1.jsonl.gz").write_bytes(partial)  # a crash cut this one short
        encoded = encode_day(self.raw, DAY)
        self.assertEqual(len(encoded.unparsable), 1)
        self.assertIn("conn1-09-1.jsonl.gz", encoded.unparsable[0])
        self.assertEqual(encoded.truncated, ["conn2-09-1.jsonl.gz"])
        self.assertEqual(len(decode(encoded.files["2330"])), 3)  # two from conn1, one whole line from conn2


if __name__ == "__main__":
    unittest.main()
