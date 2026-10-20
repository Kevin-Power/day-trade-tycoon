import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fubon_daily.client import ApiError, FubonClient, LoginError, NotFound, RateLimited, SdkUnavailable
from fubon_daily.credentials import Credentials

CREDENTIALS = Credentials("A123456789", "SECRETKEY123", "C:/cert/A123456789.pfx", "CERTPASS999")


class SdkError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


class FakeSdk:
    def __init__(self, ok=True, failure=None, message="bad key"):
        self.ok = ok
        self.message = message
        self.failure = failure
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
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk)
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
        client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk)
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
            client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk)
            client.login()
            with self.assertRaises(expected) as caught:
                client.minute_candles("2330", "2026-10-15")
            self.assertEqual(type(caught.exception), expected)
            self.assertEqual(caught.exception.status, status)

    def test_logout_swallows_sdk_errors_and_is_idempotent(self):
        client = FubonClient(CREDENTIALS, sdk_factory=FakeSdk)
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


if __name__ == "__main__":
    unittest.main()
