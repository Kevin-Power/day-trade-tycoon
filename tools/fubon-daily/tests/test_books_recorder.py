"""The books recorder's session loop, against a fake Fubon client and a fake clock (no login, no network)."""
import gzip
import heapq
import itertools
import json
import tempfile
import unittest
from datetime import datetime, time, timedelta
from pathlib import Path
from unittest import mock

from fubon_daily.books import BooksRuntime, Recorder
from fubon_daily.client import LoginError
from fubon_daily.credentials import MASK
from fubon_daily.normalize import TAIPEI
from fubon_daily.store import MarketStore
from tests.fixtures import BOOK, quote, snapshot
from tests.test_books import read_lines

DAY = "2026-10-28"
GB = 2**30


def at(hour, minute, second=0):
    return datetime(2026, 10, 28, hour, minute, second, tzinfo=TAIPEI)


def codes(count):
    return [str(1000 + rank) for rank in range(count)]


class Hang(Exception):
    """A connect() that never returns: the SDK can spin before on_open."""


class Clock:
    """Wall and monotonic time move together, only when the recorder sleeps; actions run at their time."""

    def __init__(self, start):
        self.current = start
        self.mono = 1000.0
        self.events = []
        self.order = itertools.count()

    def now(self):
        return self.current

    def monotonic(self):
        return self.mono

    def at(self, when, action):
        heapq.heappush(self.events, (when, next(self.order), action))

    def every(self, seconds, start, end, action):
        moment = start
        while moment <= end:
            self.at(moment, action)
            moment += timedelta(seconds=seconds)

    def _advance_to(self, when):
        if when > self.current:
            self.mono += (when - self.current).total_seconds()
            self.current = when

    def sleep(self, seconds):
        end = self.current + timedelta(seconds=seconds)
        while self.events and self.events[0][0] <= end:
            when, _, action = heapq.heappop(self.events)
            self._advance_to(when)
            action()
        self._advance_to(end)

    def run_with_timeout(self, call, seconds):
        try:
            return True, call()
        except Hang:
            self.sleep(seconds)
            return False, "逾時"
        except Exception as error:  # noqa: BLE001
            return False, error


class FakeStreamClient:
    def __init__(self, clock, behaviour="ok"):
        self.clock = clock
        # ok; fail; hang (connect never returns); full (answers error 1001); silent (never acknowledges);
        # mute (acknowledges, then never sends anything, not even a heartbeat)
        self.behaviour = behaviour
        self.handlers = {}
        self.subscribes = []
        self.disconnected = False
        self.dropped = False

    def on(self, name, handler):
        self.handlers[name] = handler

    def connect(self):
        if self.behaviour == "hang":
            raise Hang()
        if self.behaviour == "fail":
            raise ConnectionError("refused")
        self.emit({"event": "authenticated", "data": {"message": "Authenticated successfully"}})
        if self.behaviour != "mute":  # Fubon's server sends a heartbeat every 30 seconds
            start = self.clock.now() + timedelta(seconds=30)
            self.clock.every(30, start, start + timedelta(hours=5), self.heartbeat)

    def subscribe(self, params):
        self.subscribes.append(params)
        if self.behaviour == "full":
            self.emit({"event": "error", "data": {"code": 1001, "message": "Maximum number of connections reached"}})
            self.drop()
        elif self.behaviour != "silent":
            self.emit({"event": "subscribed", "data": [{"id": f"s{code}", "channel": "books", "symbol": code}
                                                       for code in params["symbols"]]})

    def emit(self, message):
        self.handlers["message"](json.dumps(message, ensure_ascii=False) if isinstance(message, dict) else message)

    def books(self, code):
        self.emit({"event": "data", "channel": "books", "id": "x", "data": {**BOOK, "symbol": code}})

    def heartbeat(self):
        if not (self.dropped or self.disconnected):
            self.emit({"event": "heartbeat", "data": {"time": "1"}})

    def drop(self):
        self.dropped = True
        self.handlers["disconnect"](1006, "dropped")

    def disconnect(self):
        self.disconnected = True


class FakeBooksClient:
    def __init__(self, clock, symbols, behaviours=(), default="ok", login_error=None):
        self.clock = clock
        self.symbols = symbols
        self.behaviours = list(behaviours)
        self.default = default
        self.login_error = login_error
        self.calls = []
        self.streams = []
        self.stream_times = []
        self.quotes = []

    def login(self):
        self.calls.append("login")
        if self.login_error:
            raise self.login_error
        return "富邦行情呼叫逾時：連線 10 秒、每次讀取 60 秒"

    def snapshot_quotes(self):
        self.calls.append("snapshot")
        items = [quote(code, f"股{code}", 50, 1, 1000, 10_000_000_000 - rank) for rank, code in enumerate(self.symbols)]
        return snapshot(date="2026-10-27", items=items)

    def stock_stream(self):
        stream = FakeStreamClient(self.clock, self.behaviours.pop(0) if self.behaviours else self.default)
        self.streams.append(stream)
        self.stream_times.append(self.clock.now())
        return stream

    def quote(self, code):
        self.quotes.append((self.clock.now(), code))
        return {"symbol": code, "bids": [{"price": 49.9, "size": 3}], "asks": [{"price": 50, "size": 4}]}

    def logout(self):
        self.calls.append("logout")


class RecorderTest(unittest.TestCase):
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
        self.free = 50 * GB

    def tearDown(self):
        self.temp.cleanup()

    def record(self, client, stop_at, test_mode=False):
        clock = client.clock
        runtime = BooksRuntime(make_client=lambda credentials: client, now=clock.now, monotonic=clock.monotonic,
                               sleep=clock.sleep, notify=lambda title, body: self.notices.append((title, body)) or True,
                               random=lambda: 0.0, version="test", run_with_timeout=clock.run_with_timeout)
        store = MarketStore(self.data)
        store.free_bytes = lambda: self.free() if callable(self.free) else self.free
        self.recorder = Recorder(self.data, self.credentials, runtime, store, stop_at=stop_at, test_mode=test_mode)
        return self.recorder.run()

    def status(self):
        return json.loads((self.data / "books-status.json").read_text(encoding="utf-8"))

    def raw_lines(self):
        folder = self.data / "staging-books" / DAY / "raw"
        return [line for path in sorted(folder.glob("*.jsonl.gz")) for line in read_lines(path)]

    # ---- before the session ------------------------------------------------------------------------------

    def test_a_start_after_the_stop_time_does_nothing(self):
        client = FakeBooksClient(Clock(at(15, 0)), codes(8))
        self.assertEqual(self.record(client, time(13, 36)), 0)
        self.assertEqual(self.status()["outcome"], "late")
        self.assertNotIn("login", client.calls)
        self.assertFalse((self.data / "staging-books").exists())

    def test_a_late_start_keeps_the_days_result(self):
        self.data.mkdir(parents=True)
        (self.data / "books-status.json").write_text(json.dumps({"schema": 1, "date": DAY, "outcome": "ok"}),
                                                     encoding="utf-8")
        client = FakeBooksClient(Clock(at(15, 0)), codes(8))
        self.assertEqual(self.record(client, time(13, 36)), 0)
        self.assertEqual(self.status()["outcome"], "ok")

    def test_a_restart_trigger_after_a_finished_day_does_nothing(self):
        # A holiday ends at 09:05 as closed; the 09:30 re-start trigger must not log in again.
        for outcome in ("closed", "ok"):
            with self.subTest(outcome=outcome):
                self.data.mkdir(parents=True, exist_ok=True)
                (self.data / "books-status.json").write_text(
                    json.dumps({"schema": 1, "date": DAY, "outcome": outcome}), encoding="utf-8")
                client = FakeBooksClient(Clock(at(9, 30)), codes(8))
                self.assertEqual(self.record(client, time(13, 36)), 0)
                self.assertNotIn("login", client.calls)
                self.assertEqual(self.status()["outcome"], outcome)

    def test_too_little_disk_space_does_not_start(self):
        self.free = 9 * GB
        client = FakeBooksClient(Clock(at(8, 40)), codes(8))
        self.assertEqual(self.record(client, time(13, 36)), 1)
        self.assertEqual(self.status()["outcome"], "failed")
        self.assertIn("磁碟", self.status()["reason"])
        self.assertEqual(len(self.notices), 1)
        self.assertNotIn("login", client.calls)

    def test_it_waits_for_the_opening_time(self):
        client = FakeBooksClient(Clock(at(8, 40)), codes(8))
        self.record(client, time(8, 46))
        self.assertGreaterEqual(client.stream_times[0], at(8, 44))

    # ---- connections ----------------------------------------------------------------------------------------

    def test_every_listed_stock_is_subscribed_on_four_connections(self):
        client = FakeBooksClient(Clock(at(8, 50)), codes(1057))
        self.assertEqual(self.record(client, time(8, 53)), 0)
        self.assertEqual([len(stream.subscribes[0]["symbols"]) for stream in client.streams], [265, 264, 264, 264])
        self.assertTrue(all(stream.subscribes[0]["channel"] == "books" for stream in client.streams))
        starts = client.stream_times
        self.assertTrue(all((later - earlier).total_seconds() >= 15 for earlier, later in zip(starts, starts[1:])))
        self.assertEqual(self.status()["symbols"], 1057)

    def test_fewer_stocks_than_connections_open_fewer_connections(self):
        client = FakeBooksClient(Clock(at(9, 0)), codes(2))
        self.record(client, time(9, 2))
        self.assertEqual(len(client.streams), 2)

    def test_books_are_recorded_until_the_stop_time(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8))
        for second in (1, 2, 3):
            clock.at(at(9, 1, second), lambda: client.streams[0].books("1000"))
        self.assertEqual(self.record(client, time(9, 2)), 0)
        lines = self.raw_lines()
        self.assertEqual([line["d"]["symbol"] for line in lines if "d" in line], ["1000", "1000", "1000"])
        events = [line["ev"] for line in lines if "ev" in line]
        self.assertEqual(events.count("connected"), 4)
        self.assertEqual(events.count("subscribed"), 4)
        self.assertEqual(events.count("stop"), 4)
        status = self.status()
        self.assertEqual((status["outcome"], status["messages"]), ("ok", 3))
        self.assertEqual([connection["gaps"] for connection in status["connections"]], [[], [], [], []])
        self.assertIn("logout", client.calls)
        self.assertTrue(all(stream.disconnected for stream in client.streams))

    def test_a_dropped_connection_comes_back_and_its_gap_is_recorded(self):
        clock = Clock(at(9, 58))
        client = FakeBooksClient(clock, codes(8))
        clock.at(at(9, 59, 50), lambda: client.streams[1].heartbeat())
        clock.at(at(10, 0), lambda: client.streams[1].drop())
        self.assertEqual(self.record(client, time(10, 3)), 0)
        self.assertEqual(len(client.streams), 5)
        self.assertEqual(client.streams[4].subscribes[0]["symbols"], client.streams[1].subscribes[0]["symbols"])
        delay = (client.stream_times[4] - at(10, 0)).total_seconds()
        self.assertTrue(10 <= delay <= 20, delay)
        gap = self.status()["connections"][1]["gaps"][0]
        self.assertEqual(gap["from"], at(9, 59, 50).isoformat(timespec="seconds"))
        self.assertIsNotNone(gap["to"])
        self.assertEqual(self.status()["outcome"], "partial")
        self.assertIn("down", [line.get("ev") for line in self.raw_lines()])

    def test_silence_is_a_drop(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8), behaviours=["ok", "ok", "mute", "ok"])
        self.record(client, time(9, 3))
        self.assertGreater(len(client.streams), 4)
        self.assertEqual(client.streams[4].subscribes[0]["symbols"], client.streams[2].subscribes[0]["symbols"])

    def test_a_connect_that_never_returns_is_abandoned(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8), behaviours=["ok"] * 4 + ["hang", "ok"])
        clock.at(at(9, 1), lambda: client.streams[0].drop())
        self.record(client, time(9, 3))
        hung, fresh = client.streams[4], client.streams[5]
        self.assertTrue(hung.disconnected)
        self.assertEqual(fresh.subscribes[0]["symbols"], client.streams[0].subscribes[0]["symbols"])
        self.assertGreaterEqual((client.stream_times[5] - client.stream_times[4]).total_seconds(), 15)

    def test_reconnects_are_staggered(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8))
        clock.at(at(9, 1), lambda: [stream.drop() for stream in client.streams[:4]])
        self.record(client, time(9, 4))
        again = client.stream_times[4:8]
        self.assertEqual(len(again), 4)
        self.assertTrue(all((later - earlier).total_seconds() >= 15 for earlier, later in zip(again, again[1:])))

    def test_after_eight_failures_retry_every_five_minutes_until_1330(self):
        client = FakeBooksClient(Clock(at(12, 40)), codes(1), default="fail")
        self.record(client, time(13, 36))
        attempts = client.stream_times
        waits = [(later - earlier).total_seconds() for earlier, later in zip(attempts, attempts[1:])]
        self.assertEqual(waits[:8], [10, 20, 40, 60, 120, 120, 120, 120])
        self.assertTrue(all(wait >= 300 for wait in waits[8:]))
        self.assertLessEqual(attempts[-1], at(13, 30))
        self.assertEqual(self.status()["outcome"], "partial")

    def test_error_1001_waits_five_minutes(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8), behaviours=["ok", "full", "ok", "ok"])
        clock.at(at(9, 1), lambda: client.streams[0].books("1000"))  # a trading day: not a holiday at 09:05
        self.record(client, time(9, 10))
        second = [time_ for time_, stream in zip(client.stream_times, client.streams)
                  if stream.subscribes and stream.subscribes[0]["symbols"] == client.streams[1].subscribes[0]["symbols"]]
        self.assertGreaterEqual((second[1] - second[0]).total_seconds(), 300)

    def test_an_unacknowledged_subscription_is_retried(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8), behaviours=["silent", "ok", "ok", "ok"])
        self.record(client, time(9, 2))
        self.assertGreater(len(client.streams), 4)

    # ---- refills ------------------------------------------------------------------------------------------

    def test_quiet_stocks_are_refilled_after_a_reconnect(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(12))  # stream 1 holds 1000, 1004, 1008
        clock.at(at(9, 1), lambda: client.streams[0].drop())
        clock.at(at(9, 1, 20), lambda: client.streams[4].books("1000"))
        self.record(client, time(9, 3))
        self.assertEqual(sorted(code for _, code in client.quotes), ["1004", "1008"])
        (first, _), (second, _) = client.quotes
        self.assertGreaterEqual((second - first).total_seconds(), 0.5)
        rest = [line for line in self.raw_lines() if line.get("src") == "rest"]
        self.assertEqual(sorted(line["d"]["symbol"] for line in rest), ["1004", "1008"])
        self.assertEqual(sorted(line["symbol"] for line in self.raw_lines() if line.get("ev") == "refill"),
                         ["1004", "1008"])

    def test_no_refill_after_the_first_connect_of_the_day(self):
        client = FakeBooksClient(Clock(at(9, 0)), codes(8))
        self.record(client, time(9, 3))
        self.assertEqual(client.quotes, [])

    # ---- how the day ends ----------------------------------------------------------------------------------

    def test_a_market_holiday_ends_as_closed(self):
        clock = Clock(at(8, 58))
        client = FakeBooksClient(clock, codes(8))
        self.assertEqual(self.record(client, time(13, 36)), 0)
        self.assertEqual(self.status()["outcome"], "closed")
        self.assertFalse((self.data / "staging-books" / DAY).exists())
        self.assertEqual(self.notices, [])
        self.assertLess(client.clock.now(), at(9, 7))
        self.assertIn("logout", client.calls)

    def test_test_mode_connects_after_1330(self):
        # An off-hours trial (2026-10-26 found it never connected): the 13:30 retry limit is for trading days.
        client = FakeBooksClient(Clock(at(14, 9)), codes(8))
        self.assertEqual(self.record(client, time(14, 11), test_mode=True), 0)
        self.assertEqual(len(client.streams), 4)
        self.assertEqual(self.status()["outcome"], "ok")

    def test_test_mode_never_calls_a_day_closed(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8))
        self.assertEqual(self.record(client, time(9, 7), test_mode=True), 0)
        self.assertEqual(self.status()["outcome"], "ok")

    def test_a_writer_failure_ends_the_day_as_partial(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8))
        failing = mock.patch.object(gzip.GzipFile, "write", side_effect=OSError(28, "No space left on device"))
        clock.at(at(9, 1), failing.start)
        clock.at(at(9, 1, 1), lambda: client.streams[0].books("1000"))
        try:
            self.assertEqual(self.record(client, time(9, 30)), 0)
        finally:
            mock.patch.stopall()
        self.assertEqual(self.status()["outcome"], "partial")
        self.assertIn("寫入", self.status()["reason"])
        self.assertLess(client.clock.now(), at(9, 2))
        self.assertEqual(len(self.notices), 1)

    def test_low_disk_during_the_day_stops_as_partial(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8))
        self.free = lambda: 50 * GB if clock.now() < at(9, 1) else 2 * GB
        self.assertEqual(self.record(client, time(9, 30)), 0)
        self.assertEqual(self.status()["outcome"], "partial")
        self.assertIn("磁碟", self.status()["reason"])
        self.assertLess(client.clock.now(), at(9, 3))

    def test_a_long_drop_sends_one_notice(self):
        clock = Clock(at(9, 0))
        client = FakeBooksClient(clock, codes(8), behaviours=["ok"] * 4, default="fail")
        clock.at(at(9, 0, 50), lambda: client.streams[0].books("1000"))  # a trading day: not a holiday at 09:05
        clock.at(at(9, 1), lambda: client.streams[1].drop())
        self.record(client, time(9, 20))
        downs = [body for _, body in self.notices if "斷線" in body]
        self.assertEqual(len(downs), 1)

    def test_secrets_never_reach_status_or_log(self):
        client = FakeBooksClient(Clock(at(9, 0)), codes(8), login_error=LoginError("登入失敗：A123456789 bad key"))
        self.assertEqual(self.record(client, time(13, 36)), 2)
        status_text = (self.data / "books-status.json").read_text(encoding="utf-8")
        log_text = (self.data / "logs" / "books" / f"{DAY}.log").read_text(encoding="utf-8")
        for text in (status_text, log_text, json.dumps(self.notices, ensure_ascii=False)):
            self.assertNotIn("A123456789", text)
            self.assertIn(MASK, text)

    def test_a_restart_the_same_day_keeps_the_earlier_counts_and_records_the_gap(self):
        self.data.mkdir(parents=True)
        earlier = {"schema": 1, "date": DAY, "outcome": "running", "reason": None,
                   "startedAt": "2026-10-28T08:40:00+08:00", "updatedAt": "2026-10-28T10:00:00+08:00",
                   "finishedAt": None, "symbols": 8, "dropped": [], "messages": 5000, "rawBytes": 123456,
                   "connections": [{"index": index, "symbols": 2, "messages": 1250, "reconnects": 0, "up": True,
                                    "gaps": []} for index in range(1, 5)], "version": "old"}
        (self.data / "books-status.json").write_text(json.dumps(earlier), encoding="utf-8")
        client = FakeBooksClient(Clock(at(10, 30)), codes(8))
        self.assertEqual(self.record(client, time(10, 32)), 0)
        status = self.status()
        self.assertGreaterEqual(status["messages"], 5000)
        for connection in status["connections"]:
            gap = connection["gaps"][0]
            self.assertEqual((gap["from"], gap["reason"]), ("2026-10-28T10:00:00+08:00", "程式重新啟動"))
            self.assertIsNotNone(gap["to"])
        self.assertEqual(status["outcome"], "partial")


if __name__ == "__main__":
    unittest.main()
