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


def frame(data, src="ws", received=None):
    """A REST refill's row is placed when it arrived (`received`): that is when its book became known."""
    t = epoch_ms(received) - epoch_ms(OPEN) if src == "rest" else data["time"] // 1000 - epoch_ms(OPEN)
    return {"t": t, "trial": bool(data.get("isTrial")),
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
        self.addCleanup(self.temp.cleanup)  # last: after any writer a test leaves open, as a crash does
        self.raw = Path(self.temp.name) / "raw"

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
                         (1, "2330", DAY, "lot", 60000))
        self.assertEqual(encoded.unparsable, [])
        self.assertEqual(encoded.mismatched, [])
        self.assertEqual(encoded.gaps, {})  # connected before 09:00 and stopped after the close: nothing missing

    def test_a_stock_that_moves_to_another_connection_keeps_its_order(self):
        # A same-day restart splits the stocks by a fresh snapshot order, so 2330 can change connection.
        morning1, morning2 = Raw(self.raw, "conn1"), Raw(self.raw, "conn2")
        morning1.control("connected", at(8, 44), generation=1, symbols=1, codes=["2317"])
        morning1.control("subscribed", at(8, 44, 1), symbols=1)
        morning2.control("connected", at(8, 44, 15), generation=1, symbols=1, codes=["2330"])
        morning2.control("subscribed", at(8, 44, 16), symbols=1)
        early = [book("2330", at(9, 0, 10), step=0), book("2330", at(9, 0, 20), step=1)]
        for data in early:
            morning2.books(data)
        morning1.books(book("2317", at(9, 0, 30)))
        morning1.writer.flush()
        morning2.writer.flush()  # then the process dies
        again1, again2 = Raw(self.raw, "conn1"), Raw(self.raw, "conn2")
        again1.control("connected", at(10, 10), generation=1, symbols=1, codes=["2330"])
        again1.control("subscribed", at(10, 10, 1), symbols=1)
        again2.control("connected", at(10, 10, 15), generation=1, symbols=1, codes=["2317"])
        again2.control("subscribed", at(10, 10, 16), symbols=1)
        late = [book("2330", at(10, 10, 30), step=2), book("2330", at(10, 10, 40), step=3)]
        for data in late:
            again1.books(data)
        again1.control("stop", at(13, 36))
        again2.control("stop", at(13, 36))
        for raw in (again1, again2, morning1, morning2):
            raw.close()
        encoded = encode_day(self.raw, DAY)
        self.assertEqual(decode(encoded.files["2330"]), [frame(data) for data in early + late])
        self.assertEqual(encoded.mismatched, [])
        self.assertEqual(len(encoded.gaps["2330"]), 1)  # the restart

    def test_an_early_stop_or_a_crash_is_a_gap_to_the_close(self):
        stopped, died = Raw(self.raw, "conn1"), Raw(self.raw, "conn2")
        self.addCleanup(died.close)
        stopped.control("connected", at(8, 44), generation=1, symbols=1, codes=["2330"])
        stopped.control("subscribed", at(8, 44, 1), symbols=1)
        died.control("connected", at(8, 44, 15), generation=1, symbols=1, codes=["2317"])
        died.control("subscribed", at(8, 44, 16), symbols=1)
        stopped.books(book("2330", at(10, 59, 50)))
        died.books(book("2317", at(11, 0, 5)))
        stopped.control("stop", at(11, 0))  # low disk ended the session early
        stopped.close()
        died.writer.flush()  # a crash: no stop line, no re-start
        gaps = gaps_by_symbol(self.raw, DAY)
        close = after_open(at(13, 31))
        self.assertEqual(gaps["2330"], [[after_open(at(11, 0)), close]])
        self.assertEqual(gaps["2317"], [[after_open(at(11, 0, 5, 5)), close]])

    def test_touching_gaps_become_one(self):
        raw = Raw(self.raw)
        raw.control("connected", at(8, 44), generation=1, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(8, 44, 1), symbols=2)
        raw.books(book("2330", at(9, 59, 40)))
        raw.books(book("2317", at(9, 59, 45)))
        raw.control("down", at(10, 0, 30), reason="斷線", since=epoch_ms(at(9, 59, 50)))
        raw.control("connected", at(10, 1), generation=2, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(10, 1, 1), symbols=2)
        raw.books(book("2330", at(10, 1, 5)))
        raw.control("stop", at(11, 0))
        raw.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        close = after_open(at(13, 31))
        self.assertEqual(gaps["2317"], [[after_open(at(9, 59, 50)), close]])  # one gap, not two
        self.assertEqual(gaps["2330"], [[after_open(at(9, 59, 50)), after_open(at(10, 1, 5, 5))],
                                        [after_open(at(11, 0)), close]])

    def test_a_book_before_the_subscribed_line_ends_its_gap(self):
        # The subscribed line is written up to a second after Fubon acknowledges; books can come before it.
        raw = Raw(self.raw)
        raw.control("connected", at(8, 44), generation=1, symbols=1, codes=["2330"])
        raw.control("subscribed", at(8, 44, 1), symbols=1)
        raw.books(book("2330", at(9, 0, 10)))
        raw.control("down", at(9, 1, 30), reason="斷線", since=epoch_ms(at(9, 0, 20)))
        raw.control("connected", at(9, 1, 40), generation=2, symbols=1, codes=["2330"])
        raw.books(book("2330", at(9, 1, 40, 500), step=1))
        raw.control("subscribed", at(9, 1, 41), symbols=1)
        raw.control("stop", at(13, 36))
        raw.close()
        self.assertEqual(gaps_by_symbol(self.raw, DAY)["2330"],
                         [[after_open(at(9, 0, 20)), after_open(at(9, 1, 40, 505))]])

    def test_a_late_start_is_a_gap_from_the_opening_time(self):
        # The recorder writes a down line from 08:44 when it starts late (or its first connect fails).
        raw = Raw(self.raw)
        raw.control("start", at(10, 0), codes=["2330", "2317"])
        raw.control("down", at(10, 0), reason="程式晚啟動", since=epoch_ms(at(8, 44)), codes=["2330", "2317"])
        raw.control("connected", at(10, 0, 1), generation=1, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(10, 0, 2), symbols=2)
        raw.books(book("2330", at(10, 0, 5)))
        raw.control("stop", at(13, 36))
        raw.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        self.assertEqual(gaps["2330"], [[after_open(at(8, 44)), after_open(at(10, 0, 5, 5))]])
        self.assertEqual(gaps["2317"], [[after_open(at(8, 44)), after_open(at(13, 36))]])

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
        raw.control("stop", at(13, 36))
        raw.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        self.assertEqual(gaps["2330"], [[after_open(at(9, 0, 20)), after_open(at(9, 1, 45, 5))]])
        self.assertEqual(gaps["2317"], [[after_open(at(9, 0, 20)), after_open(at(13, 36))]])  # never heard again
        encoded = encode_day(self.raw, DAY)
        header = json.loads(gzip.decompress(encoded.files["2330"]))
        self.assertEqual(header["gaps"], gaps["2330"])
        rows = header["rows"]
        self.assertTrue(rows[1][1] & FLAG_FULL)  # same minute as the row before, but after the gap

    def test_a_crash_and_restart_is_a_gap(self):
        first = Raw(self.raw)
        first.control("connected", at(8, 44), generation=1, symbols=1, codes=["2330"])
        first.control("subscribed", at(8, 44, 1), symbols=1)
        first.books(book("2330", at(10, 0, 5)))
        first.writer.flush()  # then the process dies: no stop line
        again = Raw(self.raw)  # the re-start trigger: a new part file for the same hour
        again.control("connected", at(10, 10), generation=1, symbols=1, codes=["2330"])
        again.control("subscribed", at(10, 10, 1), symbols=1)
        again.books(book("2330", at(10, 10, 30), step=2))
        again.control("stop", at(13, 36))
        again.close()
        self.assertEqual(sorted(path.name for path in self.raw.iterdir()),
                         ["conn1-08-1.jsonl.gz", "conn1-10-1.jsonl.gz", "conn1-10-2.jsonl.gz", "conn1-13-1.jsonl.gz"])
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
        raw.control("stop", at(13, 36))
        raw.close()
        encoded = encode_day(self.raw, DAY)
        frames = decode(encoded.files["2317"])
        self.assertEqual(frames[-1], frame(quote, src="rest", received=at(9, 2, 41)))
        rows = rows_of(encoded.files["2317"])
        self.assertTrue(rows[-1][1] & FLAG_REST and rows[-1][1] & FLAG_FULL)
        self.assertEqual(gaps_by_symbol(self.raw, DAY)["2317"], [[after_open(at(9, 1)), after_open(at(9, 2, 41))]])

    # ---- gaps per stock (the recorder writes a start line per connection, and codes on down lines) ----------

    def two_connections(self, start, first, second):
        one, two = Raw(self.raw, "conn1"), Raw(self.raw, "conn2")
        one.control("start", start, codes=first)
        two.control("start", start, codes=second)
        return one, two

    def test_a_restart_that_moves_stocks_keeps_each_stocks_gap(self):
        # The restart splits the stocks by a fresh snapshot order, and connection 2 never connects again.
        p1c1, p1c2 = self.two_connections(at(8, 40), ["A", "B"], ["C", "D"])
        p1c1.control("connected", at(8, 44), generation=1, symbols=2, codes=["A", "B"])
        p1c1.control("subscribed", at(8, 44, 1), symbols=2)
        p1c2.control("connected", at(8, 44, 15), generation=1, symbols=2, codes=["C", "D"])
        p1c2.control("subscribed", at(8, 44, 16), symbols=2)
        for code, raw in (("A", p1c1), ("B", p1c1), ("C", p1c2), ("D", p1c2)):
            raw.books(book(code, at(9, 59, 58)))
        p1c1.writer.flush()
        p1c2.writer.flush()  # then the process dies
        p2c1, p2c2 = self.two_connections(at(10, 10), ["C", "B"], ["A", "D"])
        p2c1.control("connected", at(10, 10, 1), generation=1, symbols=2, codes=["C", "B"])
        p2c1.control("subscribed", at(10, 10, 2), symbols=2)
        p2c2.control("down", at(10, 10, 20), reason="連線失敗", since=epoch_ms(at(10, 10)), codes=["A", "D"])
        p2c1.books(book("C", at(10, 10, 30)))
        p2c1.books(book("B", at(10, 10, 40)))
        p2c1.control("stop", at(13, 36))
        for raw in (p2c1, p2c2, p1c1, p1c2):
            raw.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        crash, end = after_open(at(9, 59, 58, 5)), after_open(at(13, 36))
        self.assertEqual(gaps["A"], [[crash, end]])  # moved onto the connection that never came back
        self.assertEqual(gaps["D"], [[crash, end]])
        self.assertEqual(gaps["C"], [[crash, after_open(at(10, 10, 30, 5))]])  # moved off it, heard elsewhere
        self.assertEqual(gaps["B"], [[crash, after_open(at(10, 10, 40, 5))]])

    def test_a_drop_before_a_restart_stays_with_the_stocks_that_had_it(self):
        p1c1, p1c2 = self.two_connections(at(8, 40), ["A", "B"], ["C", "D"])
        p1c1.control("connected", at(8, 44), generation=1, symbols=2, codes=["A", "B"])
        p1c1.control("subscribed", at(8, 44, 1), symbols=2)
        p1c2.control("connected", at(8, 44, 15), generation=1, symbols=2, codes=["C", "D"])
        p1c2.control("subscribed", at(8, 44, 16), symbols=2)
        for code, raw in (("A", p1c1), ("B", p1c1), ("C", p1c2), ("D", p1c2)):
            raw.books(book(code, at(9, 20)))
        p1c2.control("down", at(9, 31), reason="斷線", since=epoch_ms(at(9, 30)), codes=["C", "D"])
        p1c1.books(book("A", at(9, 59, 58)))
        p1c1.writer.flush()
        p1c2.writer.flush()  # the process dies while connection 2 is still down
        p2c1, p2c2 = self.two_connections(at(10, 10), ["C", "B"], ["A", "D"])
        for raw, codes in ((p2c1, ["C", "B"]), (p2c2, ["A", "D"])):
            raw.control("connected", at(10, 10, 1), generation=1, symbols=2, codes=codes)
            raw.control("subscribed", at(10, 10, 2), symbols=2)
        for code, raw in (("C", p2c1), ("B", p2c1), ("A", p2c2), ("D", p2c2)):
            raw.books(book(code, at(10, 10, 30)))
        p2c1.control("stop", at(13, 36))
        p2c2.control("stop", at(13, 36))
        for raw in (p2c1, p2c2, p1c1, p1c2):
            raw.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        back = after_open(at(10, 10, 30, 5))
        for code in ("C", "D"):
            self.assertEqual(gaps[code], [[after_open(at(9, 30)), back]], code)
        for code in ("A", "B"):
            self.assertEqual(gaps[code], [[after_open(at(9, 59, 58, 5)), back]], code)

    def test_a_process_that_dies_before_its_subscription_is_confirmed_leaves_a_gap(self):
        first = Raw(self.raw)
        first.control("start", at(8, 59, 59), codes=["A", "B"])
        first.control("connected", at(9, 0), generation=1, symbols=2, codes=["A", "B"])
        first.books(book("A", at(9, 0)))  # books come with the subscription, before the subscribed line
        first.writer.flush()  # the process dies right here
        again = Raw(self.raw)
        again.control("start", at(9, 30), codes=["A", "B"])
        again.control("connected", at(9, 30, 1), generation=1, symbols=2, codes=["A", "B"])
        again.control("subscribed", at(9, 30, 2), symbols=2)
        again.books(book("A", at(9, 30, 5)))
        again.books(book("B", at(9, 30, 6)))
        again.control("stop", at(13, 36))
        again.close()
        first.close()
        gaps = gaps_by_symbol(self.raw, DAY)
        crash = after_open(at(9, 0, 0, 5))
        self.assertEqual(gaps["A"], [[crash, after_open(at(9, 30, 5, 5))]])
        self.assertEqual(gaps["B"], [[crash, after_open(at(9, 30, 6, 5))]])

    def test_a_down_line_names_the_stocks_it_loses(self):
        # The stocks come with the down line, so it holds even before any other line has named them.
        raw = Raw(self.raw)
        raw.control("down", at(10, 0), reason="程式晚啟動", since=epoch_ms(at(8, 44)), codes=["2330"])
        raw.control("connected", at(10, 0, 1), generation=1, symbols=1, codes=["2330"])
        raw.control("subscribed", at(10, 0, 2), symbols=1)
        raw.books(book("2330", at(10, 0, 5)))
        raw.control("stop", at(13, 36))
        raw.close()
        self.assertEqual(gaps_by_symbol(self.raw, DAY)["2330"], [[after_open(at(8, 44)), after_open(at(10, 0, 5, 5))]])

    def test_what_an_unconfirmed_attempt_heard_is_unknown_again_after_it(self):
        # Raw written without a down line for the failed attempt: the next connected line says it failed.
        raw = Raw(self.raw)
        raw.control("start", at(8, 40), codes=["2330"])
        raw.control("connected", at(8, 44), generation=1, symbols=1, codes=["2330"])
        raw.control("subscribed", at(8, 44, 1), symbols=1)
        raw.control("down", at(10, 0), reason="斷線", since=epoch_ms(at(9, 59, 30)), codes=["2330"])
        raw.control("connected", at(10, 0, 10), generation=2, symbols=1, codes=["2330"])
        raw.books(book("2330", at(10, 0, 10)))  # heard on an attempt that drops before it is confirmed
        raw.control("connected", at(10, 0, 30), generation=3, symbols=1, codes=["2330"])
        raw.control("subscribed", at(10, 0, 31), symbols=1)
        quote = {"symbol": "2330", "bids": [{"price": 49.9, "size": 3}], "asks": [{"price": 50, "size": 4}]}
        raw.rest(quote, at(10, 1, 1))
        raw.control("refill", at(10, 1, 1), symbol="2330")
        raw.control("stop", at(13, 36))
        raw.close()
        self.assertEqual(gaps_by_symbol(self.raw, DAY)["2330"], [[after_open(at(9, 59, 30)), after_open(at(10, 1, 1))]])

    def test_a_zeroed_tail_loses_only_the_damaged_part(self):
        # A power cut can leave zeros after the last write; every line flushed before them must still be read.
        raw = Raw(self.raw)
        raw.control("start", at(9, 0), codes=["2330", "2317"])
        raw.control("connected", at(9, 0), generation=1, symbols=2, codes=["2330", "2317"])
        raw.control("subscribed", at(9, 0, 1), symbols=2)
        moment = at(9, 0, 2)
        for index in range(40_000):
            moment += timedelta(milliseconds=50)
            raw.books(book("2330" if index % 2 else "2317", moment, step=index % 7, price=50 + (index % 13) * 0.05))
            if index % 2000 == 0:
                raw.writer.flush()
        raw.writer.flush()
        crashed = Path(self.temp.name) / "crashed"
        crashed.mkdir()
        damaged = crashed / raw.writer.paths[-1].name
        damaged.write_bytes(raw.writer.paths[-1].read_bytes() + b"\x00" * 4096)
        raw.close()
        encoded = encode_day(crashed, DAY)
        self.assertEqual(sum(encoded.messages.values()), 40_000)
        self.assertEqual(encoded.truncated, [damaged.name])
        self.assertEqual(encoded.mismatched, [])

    def test_an_unreadable_hour_is_a_gap(self):
        raw = Raw(self.raw)
        raw.control("start", at(8, 40), codes=["2330"])
        raw.control("connected", at(8, 44), generation=1, symbols=1, codes=["2330"])
        raw.control("subscribed", at(8, 44, 1), symbols=1)
        raw.books(book("2330", at(9, 50), step=0))
        raw.books(book("2330", at(10, 10), step=1))  # this hour's file is damaged below
        raw.books(book("2330", at(11, 5), step=2))
        raw.control("stop", at(13, 36))
        raw.close()
        hour = self.raw / "conn1-10-1.jsonl.gz"
        hour.write_bytes(hour.read_bytes()[:10] + b"\x00" * 64)  # the gzip header, then nothing readable
        gaps = gaps_by_symbol(self.raw, DAY)
        self.assertEqual(gaps["2330"], [[after_open(at(9, 50, 0, 5)), after_open(at(11, 5, 0, 5))]])

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
