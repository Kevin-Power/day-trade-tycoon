import http.server
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fubon_daily import client as client_module
from fubon_daily.client import ApiError, FubonClient, LoginError, NotFound, RateLimited, SdkUnavailable
from fubon_daily.credentials import Credentials

try:  # the SDK's own modules: there in the task's Python (fetcher\.venv), not in a bare Python
    import requests
    from fugle_marketdata import RestClient
    from fugle_marketdata.rest import base_rest
except ImportError:
    requests = None

CREDENTIALS = Credentials("A123456789", "SECRETKEY123", "C:/cert/A123456789.pfx", "CERTPASS999")
SDK_RELEASE = "2.7.0rc1"  # fugle_marketdata as fubon_neo 2.4.0 installs it


class SdkError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


class RequestException(OSError):
    """Stands in for requests.exceptions.RequestException."""


class FakeRequests:
    """The requests package as the SDK's REST module uses it: get() and exceptions. Answers with `status`."""

    exceptions = SimpleNamespace(RequestException=RequestException)

    def __init__(self, status=200):
        self.status = status
        self.gets = []

    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        return SimpleNamespace(status_code=self.status, json=lambda: {"url": url})


class FakeRestModule:
    """fugle_marketdata rest/base_rest.py in miniature. Every GET goes through the module's `requests`. An HTTP
    error becomes the SDK's own error inside the `try`, so on its way out it passes the `except` that names
    `requests.exceptions`."""

    def __init__(self, requests):
        self.requests = requests

    def request(self, path):
        url = "https://fubon.example/" + path
        try:
            response = self.requests.get(url, headers={"X-SDK-TOKEN": "token"})
            if response.status_code >= 400:
                raise SdkError(f"HTTP {response.status_code}", response.status_code)
            return response.json()
        except self.requests.exceptions.RequestException as error:
            raise SdkError(f"{type(error).__name__}: {error}") from None


def fake_modules():
    """Fakes for the SDK's REST module and the requests package, so that a test never changes an installed SDK."""
    fake = FakeRequests()
    return FakeRestModule(fake), fake, SDK_RELEASE


class FakeSdk:
    def __init__(self, ok=True, failure=None, message="bad key", rest_module=None):
        self.ok = ok
        self.message = message
        self.failure = failure
        self.rest_module = rest_module  # when given, requests are sent through it as the SDK does
        self.login_args = None
        self.realtime = False
        self.requests = []
        rest = SimpleNamespace(
            snapshot=SimpleNamespace(quotes=lambda **kw: self.answer("quotes", kw)),
            intraday=SimpleNamespace(tickers=lambda **kw: self.answer("tickers", kw),
                                     trades=lambda **kw: self.answer("trades", kw)),
            historical=SimpleNamespace(candles=lambda **kw: self.answer("candles", kw)),
        )
        self.marketdata = SimpleNamespace(rest_client=SimpleNamespace(stock=rest))

    def answer(self, name, kwargs):
        self.requests.append((name, kwargs))
        if self.failure:
            raise self.failure
        if self.rest_module:
            return self.rest_module.request(name)
        return {"name": name}

    def apikey_login(self, *args):
        self.login_args = args
        return SimpleNamespace(is_success=self.ok, message=self.message, data=["ACCOUNT-OBJECT"])

    def init_realtime(self):
        self.realtime = True

    def logout(self):
        raise RuntimeError("already logged out")


class ClientTest(unittest.TestCase):
    def test_login_passes_credentials_in_order_and_keeps_no_account_data(self):
        sdk = FakeSdk()
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk, rest_modules=fake_modules)
        client.login()
        self.assertEqual(sdk.login_args, ("A123456789", "SECRETKEY123", "C:/cert/A123456789.pfx", "CERTPASS999"))
        self.assertTrue(sdk.realtime)
        self.assertNotIn("ACCOUNT-OBJECT", repr(vars(client)))

    def test_failed_login_raises_login_error(self):
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(ok=False))
        with self.assertRaises(LoginError) as caught:
            client.login()
        self.assertIn("bad key", str(caught.exception))

    def test_missing_sdk_is_reported(self):
        def broken():
            raise ImportError("no fubon_neo")

        with self.assertRaises(SdkUnavailable):
            FubonClient(CREDENTIALS, sdk_factory=broken).login()

    def test_requests_use_the_documented_parameters(self):
        sdk = FakeSdk()
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk, rest_modules=fake_modules)
        client.login()
        client.snapshot_quotes()
        client.disposition_list()
        client.minute_candles("2330", "2026-10-15")
        client.daily_candle("2330", "2026-10-05")
        client.trades("2330", 500, 500)
        self.assertEqual(sdk.requests, [
            ("quotes", {"market": "TSE", "type": "COMMONSTOCK"}),
            ("tickers", {"type": "EQUITY", "exchange": "TWSE", "isDisposition": True}),
            ("candles", {"symbol": "2330", "from": "2026-10-15", "to": "2026-10-15", "timeframe": "1",
                         "fields": "open,high,low,close,volume,average", "sort": "asc"}),
            ("candles", {"symbol": "2330", "from": "2026-10-05", "to": "2026-10-05",
                         "fields": "open,high,low,close,volume,turnover,change"}),
            ("trades", {"symbol": "2330", "offset": 500, "limit": 500, "sort": "asc"}),
        ])

    def test_errors_are_mapped_by_status(self):
        for status, expected in ((429, RateLimited), (404, NotFound), (500, ApiError), (None, ApiError)):
            sdk = FakeSdk(failure=SdkError("boom", status))
            client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk, rest_modules=fake_modules)
            client.login()
            with self.assertRaises(expected) as caught:
                client.minute_candles("2330", "2026-10-15")
            self.assertEqual(type(caught.exception), expected)
            self.assertEqual(caught.exception.status, status)

    def test_logout_swallows_sdk_errors_and_is_idempotent(self):
        client = FubonClient(CREDENTIALS, sdk_factory=FakeSdk, rest_modules=fake_modules)
        client.login()
        client.logout()
        client.logout()


    def test_long_login_messages_are_kept_whole_for_redaction(self):
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(ok=False, message="x" * 295 + "SECRETKEY123"))
        with self.assertRaises(LoginError) as caught:
            client.login()
        self.assertIn("SECRETKEY123", str(caught.exception))

    def test_realtime_setup_failure_is_a_login_error(self):
        sdk = FakeSdk()

        def broken():
            raise SdkError("realtime down", 503)

        sdk.init_realtime = broken
        with self.assertRaises(LoginError):
            FubonClient(CREDENTIALS, sdk_factory=lambda: sdk).login()

    def test_market_data_calls_get_a_timeout(self):
        # Without one, a server that stops answering holds the run until Windows stops the task at two hours.
        fake = FakeRequests()
        module = FakeRestModule(fake)
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(rest_module=module),
                             rest_modules=lambda: (module, fake, SDK_RELEASE))
        note = client.login()
        self.assertEqual(client.trades("2330", 0, 500), {"url": "https://fubon.example/trades"})
        self.assertEqual(fake.gets, [("https://fubon.example/trades",
                                      {"headers": {"X-SDK-TOKEN": "token"}, "timeout": (10, 60)})])
        self.assertNotIn("沒有逾時", note)

    def test_a_second_login_keeps_the_timeout_and_says_so(self):
        fake = FakeRequests()
        module = FakeRestModule(fake)
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(rest_module=module),
                             rest_modules=lambda: (module, fake, SDK_RELEASE))
        client.login()
        note = client.login()
        client.trades("2330", 0, 500)
        self.assertEqual(fake.gets, [("https://fubon.example/trades",
                                      {"headers": {"X-SDK-TOKEN": "token"}, "timeout": (10, 60)})])
        self.assertNotIn("沒有逾時", note)

    def test_fubon_errors_keep_their_status_once_calls_have_a_timeout(self):
        # The SDK's `except requests.exceptions...` must still work, or a 404 would lose its status on the way out.
        fake = FakeRequests(status=404)
        module = FakeRestModule(fake)
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(rest_module=module),
                             rest_modules=lambda: (module, fake, SDK_RELEASE))
        client.login()
        with self.assertRaises(NotFound) as caught:
            client.trades("2330", 0, 500)
        self.assertEqual(caught.exception.status, 404)

    def test_an_sdk_that_sends_another_way_is_left_alone_and_the_log_says_so(self):
        session = FakeRequests()  # say, a requests.Session: not the requests package the timeout is made for
        module = FakeRestModule(session)
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(rest_module=module),
                             rest_modules=lambda: (module, FakeRequests(), SDK_RELEASE))
        note = client.login()
        self.assertEqual(client.trades("2330", 0, 500), {"url": "https://fubon.example/trades"})
        self.assertIs(module.requests, session)
        self.assertIn("沒有逾時", note)

    def test_an_sdk_release_not_checked_is_left_alone_and_the_log_says_so(self):
        # Another release may send another way (requests.request, a Session), which the stand-in would not bound.
        fake = FakeRequests()
        module = FakeRestModule(fake)
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: FakeSdk(rest_module=module),
                             rest_modules=lambda: (module, fake, "2.8.0"))
        note = client.login()
        self.assertEqual(client.trades("2330", 0, 500), {"url": "https://fubon.example/trades"})
        self.assertIs(module.requests, fake)
        self.assertIn("沒有逾時", note)
        self.assertIn("2.8.0", note)

    def test_login_still_works_when_the_sdk_module_is_missing_and_the_log_says_so(self):
        def missing():
            raise ImportError("No module named 'fugle_marketdata'")

        client = FubonClient(CREDENTIALS, sdk_factory=FakeSdk, rest_modules=missing)
        note = client.login()
        self.assertEqual(client.trades("2330", 0, 500), {"name": "trades"})
        self.assertIn("沒有逾時", note)
        self.assertIn("fugle_marketdata", note)


class FubonServer(http.server.BaseHTTPRequestHandler):
    """Stands in for Fubon's market-data server: answers every GET with the server's `status`, echoing the path
    and the SDK token it was sent."""

    def do_GET(self):
        body = json.dumps({"path": self.path, "token": self.headers.get("X-SDK-TOKEN")}).encode()
        self.send_response(self.server.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # keeps the test output clean


class HalfAnswer(FubonServer):
    """Sends the headers and the start of an answer, then holds the rest back until the test ends."""

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", "1000")
        self.end_headers()
        self.wfile.write(b'{"data": [')
        self.server.release.wait(30)


@unittest.skipUnless(requests, "needs the installed SDK: run with fetcher\\.venv\\Scripts\\python.exe")
class InstalledSdkTest(unittest.TestCase):
    """The SDK's real REST code and requests, against servers on this computer. Fubon is never called."""

    def setUp(self):
        self.assertIs(base_rest.requests, requests, "an earlier test left the SDK module changed")
        self.addCleanup(setattr, base_rest, "requests", requests)

    def serve(self, status=200, handler=FubonServer):
        server = http.server.HTTPServer(("127.0.0.1", 0), handler)
        server.status = status
        server.release = threading.Event()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.release.set)  # first: lets an answer held back finish, so that shutdown can
        return f"http://127.0.0.1:{server.server_port}/marketdata"

    @staticmethod
    def client_for(base_url):
        sdk = FakeSdk()
        sdk.marketdata = SimpleNamespace(rest_client=RestClient(sdk_token="token", base_url=base_url))
        return FubonClient(CREDENTIALS, sdk_factory=lambda: sdk)

    def test_every_market_data_call_goes_out_with_a_timeout(self):
        client = self.client_for(self.serve())
        client.login()
        with mock.patch.object(requests, "get", wraps=requests.get) as get:
            answers = [client.snapshot_quotes(), client.disposition_list(), client.trades("2330", 500, 500),
                       client.minute_candles("2330", "2026-10-15")]
        self.assertEqual([(answer["path"].split("?")[0], answer["token"]) for answer in answers], [
            ("/marketdata/v1.0/stock/snapshot/quotes/TSE", "token"),
            ("/marketdata/v1.0/stock/intraday/tickers", "token"),
            ("/marketdata/v1.0/stock/intraday/trades/2330", "token"),
            ("/marketdata/v1.0/stock/historical/candles/2330", "token")])
        self.assertEqual([call.kwargs.get("timeout") for call in get.call_args_list], [(10, 60)] * 4)

    def trades_error(self, base_url):
        """Asks `base_url` for a page of trades with reads cut at half a second; returns the error, once sure that
        the call ended well within five seconds. A call sent without a timeout fails at once instead of waiting
        forever, so a missing timeout fails the test rather than hanging it."""
        client = self.client_for(base_url)
        real_get = requests.get

        def get(url, *args, **kwargs):
            if kwargs.get("timeout") is None:
                raise requests.exceptions.ConnectionError("sent without a timeout")
            return real_get(url, *args, **kwargs)

        with mock.patch.object(client_module, "REST_TIMEOUT", (5, 0.5)):
            client.login()
            started = time.monotonic()
            with mock.patch.object(requests, "get", get), self.assertRaises(ApiError) as caught:
                client.trades("2330", 0, 500)
        self.assertLess(time.monotonic() - started, 5)
        return caught.exception

    def test_a_server_that_stops_answering_ends_the_call(self):
        listener = socket.create_server(("127.0.0.1", 0))  # the connection is taken, then nothing is ever sent
        self.addCleanup(listener.close)
        error = self.trades_error(f"http://127.0.0.1:{listener.getsockname()[1]}/marketdata")
        self.assertIn("ReadTimeout", str(error))
        self.assertIsNone(error.status)

    def test_an_answer_that_stops_halfway_ends_the_call(self):
        # The body is read inside requests.get as well, and a stall there comes out as another error type.
        error = self.trades_error(self.serve(handler=HalfAnswer))
        self.assertIn("Read timed out", str(error))
        self.assertNotIn("ReadTimeout", str(error))  # that would be the wait for the headers, not for the body
        self.assertIsNone(error.status)

    def test_a_missing_answer_is_still_told_apart_once_calls_have_a_timeout(self):
        client = self.client_for(self.serve(404))
        client.login()
        with self.assertRaises(NotFound) as caught:
            client.trades("2330", 0, 500)
        self.assertEqual(caught.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
