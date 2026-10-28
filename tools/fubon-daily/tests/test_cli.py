import http.server
import json
import socket
import tempfile
import threading
import time
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock

from fubon_daily import cli, taiex
from fubon_daily.cli import parse_args
from fubon_daily.normalize import TAIPEI
from fubon_daily.store import MarketStore
from tests.test_extras import BARS, ENTRY, FakeTwse, values

NOW = datetime(2026, 10, 30, 17, 5, tzinfo=TAIPEI)


class CliTest(unittest.TestCase):
    def test_required_paths_and_defaults(self):
        args = parse_args(["--data", "md", "--credentials", "c.py"])
        self.assertEqual((args.data.name, args.date, args.symbols, args.last_attempt), ("md", None, None, False))

    def test_symbols_need_a_date(self):
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--symbols", "2330"])

    def test_dates_must_be_valid_and_not_in_the_future(self):
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--date", "2026-13-01"])
        future = (date.today() + timedelta(days=2)).isoformat()
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--date", future])

    def test_symbols_are_split_and_trimmed(self):
        args = parse_args(["--data", "d", "--credentials", "c", "--date", "2026-10-05", "--symbols", "2330, 2317"])
        self.assertEqual(args.symbols, ["2330", "2317"])

    def test_the_radar_config_defaults_to_the_users_folder(self):
        args = parse_args(["--data", "d", "--credentials", "c"])
        self.assertEqual(args.radar_config, Path.home() / ".daytrade-tycoon" / "radar.local.json")

    def test_the_radar_config_can_be_chosen(self):
        args = parse_args(["--data", "d", "--credentials", "c", "--radar-config", "x/radar.json"])
        self.assertEqual(args.radar_config, Path("x/radar.json"))


    def test_main_hands_the_extras_to_the_run(self):
        with mock.patch.object(cli, "run", return_value=0) as run:
            self.assertEqual(cli.main(["--data", "d", "--credentials", "c", "--radar-config", "r.json"]), 0)
        runtime = run.call_args.args[1]
        self.assertTrue(callable(runtime.extras))


class TwseServer:
    """A local stand-in for TWSE: records each request's headers and answers as told."""

    def __init__(self, body=b"{}", status=200, delay=0.0):
        outer = self
        self.headers = []
        self.body, self.status, self.delay = body, status, delay

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                outer.headers.append(dict(self.headers))
                time.sleep(outer.delay)
                try:
                    self.send_response(outer.status)
                    self.send_header("Content-Length", str(len(outer.body)))
                    self.end_headers()
                    self.wfile.write(outer.body)
                except OSError:
                    pass  # the client gave up

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{port}/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=20261027"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class TwseGetTest(unittest.TestCase):
    def serve(self, **arguments):
        server = TwseServer(**arguments)
        self.addCleanup(server.close)
        return server

    def test_it_sends_the_fetchers_user_agent_and_returns_the_body_as_received(self):
        body = '{"stat":"OK","note":"大盤"}'.encode("utf-8")
        server = self.serve(body=body)
        self.assertEqual(cli.twse_get(server.url), body)
        self.assertEqual(server.headers[0]["User-Agent"], taiex.USER_AGENT)

    def test_the_connection_waits_ten_seconds_and_each_read_sixty(self):
        self.assertEqual((cli.CONNECT_TIMEOUT, cli.READ_TIMEOUT), (10, 60))
        server = self.serve()
        real = socket.create_connection
        connects = []
        reads = []

        def create(address, timeout=None, *rest, **keywords):
            connects.append(timeout)
            return real(address, timeout, *rest, **keywords)

        original = cli.ReadTimeout.connect

        def connect(connection):
            original(connection)
            reads.append(connection.sock.gettimeout())

        with mock.patch("socket.create_connection", create), mock.patch.object(cli.ReadTimeout, "connect", connect):
            cli.twse_get(server.url)
        self.assertEqual(connects, [10])
        self.assertEqual(reads, [60])

    def test_a_server_that_stops_answering_is_given_up_after_the_read_timeout(self):
        server = self.serve(delay=3)
        started = time.monotonic()
        with mock.patch.object(cli, "READ_TIMEOUT", 0.3):
            with self.assertRaises(OSError):
                cli.twse_get(server.url)
        self.assertLess(time.monotonic() - started, 2.5)

    def test_an_https_address_goes_through_the_same_connection_class(self):
        # A local port that accepts and hangs up: the TLS handshake fails, which is an OSError (the real address is
        # never reached from a test). A wrong signature in the https handler would show up here as a TypeError.
        listener = socket.socket()
        self.addCleanup(listener.close)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)

        def hang_up():
            connection, _ = listener.accept()
            connection.close()

        thread = threading.Thread(target=hang_up, daemon=True)
        thread.start()
        with self.assertRaises(OSError):
            cli.twse_get(f"https://127.0.0.1:{listener.getsockname()[1]}/")
        thread.join(5)

    def test_an_error_status_is_an_error(self):
        server = self.serve(status=503, body=b"busy")
        with self.assertRaises(OSError):
            cli.twse_get(server.url)

    def test_an_answer_far_bigger_than_the_real_one_is_refused(self):
        server = self.serve(body=b"x" * 1000)
        with mock.patch.object(cli, "MAX_DOWNLOAD_BYTES", 100):
            with self.assertRaises(OSError):
                cli.twse_get(server.url)

    def test_a_real_answer_fits_well_inside_the_limit(self):
        answer = FakeTwse(["2026-10-27"])("date=20261027")
        self.assertGreater(cli.MAX_DOWNLOAD_BYTES, 10 * len(answer))


class MakeExtrasTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.store = MarketStore(self.base / "market-data")
        self.store.publish_day("2026-10-21", "full-market", [ENTRY], BARS, [], 0, NOW, "fubon-neo test", "abc123")
        self.sleeps = []

    def tearDown(self):
        self.temp.cleanup()

    def status(self):
        return json.loads((self.base / "market-data" / "status.json").read_text(encoding="utf-8"))

    def make(self, config, **fakes):
        return cli.make_extras(config, "abc123", sleep=self.sleeps.append, **fakes)

    def test_without_a_config_file_the_list_is_not_configured_and_the_index_is_fetched(self):
        twse = FakeTwse(["2026-10-21"])
        self.make(self.base / "radar.local.json", taiex_get=twse)(self.store, NOW)
        self.assertEqual(twse.requests, ["2026-10-21"])
        self.assertEqual(self.store.taiex_days(), ["2026-10-21"])
        self.assertEqual(self.status()["radar"]["outcome"], "not-configured")
        self.assertEqual(self.status()["taiex"]["outcome"], "ok")

    def test_with_a_config_file_the_list_is_read_with_its_settings(self):
        config = self.base / "radar.local.json"
        config.write_text(json.dumps({"sheetId": "SHEET-1_a", "tab": "定格名單", "keyFile": "reader.json"}),
                          encoding="utf-8")
        seen = []

        def read_values(settings):
            seen.append(settings)
            return values("2026-10-28")

        self.make(config, taiex_get=FakeTwse(["2026-10-21"]), read_values=read_values)(self.store, NOW)
        self.assertEqual([(item.sheet_id, item.tab, item.key_path) for item in seen],
                         [("SHEET-1_a", "定格名單", self.base / "reader.json")])
        self.assertEqual(self.store.radar_dates(), ["2026-10-28"])
        self.assertEqual(self.status()["radar"]["outcome"], "ok")

    def test_a_damaged_config_file_is_a_failure_with_a_fixed_reason(self):
        config = self.base / "radar.local.json"
        config.write_text("{not json LEAK-MARKER", encoding="utf-8")
        read_values = mock.Mock()
        self.make(config, taiex_get=FakeTwse(["2026-10-21"]), read_values=read_values)(self.store, NOW)
        read_values.assert_not_called()
        self.assertEqual((self.status()["radar"]["outcome"], self.status()["radar"]["reason"]),
                         ("failed", "設定檔格式不正確"))
        self.assertNotIn("LEAK-MARKER", (self.base / "market-data" / "status.json").read_text(encoding="utf-8"))

    def test_a_config_file_that_cannot_be_examined_counts_as_present(self):
        config = self.base / "radar.local.json"
        self.assertFalse(cli.config_present(config))
        config.write_text("{}", encoding="utf-8")
        self.assertTrue(cli.config_present(config))
        with mock.patch.object(Path, "is_file", side_effect=PermissionError()):
            self.assertTrue(cli.config_present(config))

    def test_the_config_file_is_looked_for_when_the_extras_run_not_when_they_are_made(self):
        config = self.base / "radar.local.json"
        extras = self.make(config, taiex_get=FakeTwse(["2026-10-21"]),
                           read_values=lambda settings: values("2026-10-28"))
        config.write_text(json.dumps({"sheetId": "S", "tab": "t", "keyFile": "k.json"}), encoding="utf-8")
        extras(self.store, NOW)
        self.assertEqual(self.status()["radar"]["outcome"], "ok")


if __name__ == "__main__":
    unittest.main()
