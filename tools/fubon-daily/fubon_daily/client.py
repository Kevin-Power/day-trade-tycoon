"""The only module that talks to the Fubon SDK. Market data only: no account or order calls."""
from __future__ import annotations

from typing import Callable

from .credentials import Credentials


class ApiError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class RateLimited(ApiError):
    pass


class NotFound(ApiError):
    pass


class LoginError(Exception):
    pass


class SdkUnavailable(Exception):
    pass


# Seconds to connect, then to wait for each read of the answer. The SDK sends market data with requests and no
# timeout, so a server that stops answering would hold the run until Windows stops the task at two hours.
REST_TIMEOUT = (10, 60)
UNBOUNDED = "富邦行情呼叫沒有逾時"


class TimedRequests:
    """Stands in for `requests` in the SDK module that sends every market-data call: a GET always gets
    REST_TIMEOUT. Everything else is the real package, `exceptions` above all: the SDK's own error handling
    names it on the way out of every failed call."""

    def __init__(self, requests):
        self._requests = requests

    def get(self, url, *args, **kwargs):
        return self._requests.get(url, *args, **{**kwargs, "timeout": REST_TIMEOUT})

    def __getattr__(self, name):
        return getattr(self._requests, name)


def default_sdk():
    from fubon_neo.sdk import FubonSDK

    return FubonSDK()


def sdk_rest_modules():
    """The SDK module that sends every market-data call (fugle_marketdata rest/base_rest.py), and the requests
    package it is expected to send with."""
    import requests
    from fugle_marketdata.rest import base_rest

    return base_rest, requests


def bound_market_data_calls(rest_modules: Callable[[], tuple]) -> str:
    """Gives the SDK's market-data calls a timeout, if the SDK still sends them the way it did when this was
    written (fugle_marketdata 2.7.0rc1, which fubon_neo 2.4.0 pins). Returns a line for the log saying whether
    they have one. Login, init_realtime and logout run inside the compiled SDK and keep having none."""
    try:
        base_rest, requests = rest_modules()
        if getattr(base_rest, "requests", None) is not requests:
            return f"{UNBOUNDED}：SDK（fugle_marketdata）送出行情的方式和預期不同，這次不加"
        base_rest.requests = TimedRequests(requests)
    except Exception as error:  # noqa: BLE001 - without a timeout the run goes on as before; it never stops it
        return f"{UNBOUNDED}：{type(error).__name__}: {error}"
    return f"富邦行情呼叫逾時：連線 {REST_TIMEOUT[0]} 秒、每次讀取 {REST_TIMEOUT[1]} 秒"


def sdk_version() -> str:
    try:
        from importlib.metadata import version

        return version("fubon_neo")
    except Exception:  # noqa: BLE001 - only used for the provenance label
        return "unknown"


def _call(request: Callable[[], object]) -> object:
    try:
        return request()
    except Exception as error:  # noqa: BLE001 - every SDK failure is mapped to ApiError
        status = getattr(error, "status_code", None)
        try:
            status = int(status) if status is not None else None
        except (TypeError, ValueError):
            status = None
        message = f"{type(error).__name__}: {error}"
        if status == 429:
            raise RateLimited(message, status) from None
        if status == 404:
            raise NotFound(message, status) from None
        raise ApiError(message, status) from None


class FubonClient:
    def __init__(self, credentials: Credentials, sdk_factory: Callable[[], object] = default_sdk,
                 rest_modules: Callable[[], tuple] = sdk_rest_modules):
        self._credentials = credentials
        self._factory = sdk_factory
        self._rest_modules = rest_modules
        self._sdk = None
        self._rest = None

    def login(self) -> str:
        """Logs in and sets up market data. Returns a line for the log: whether market-data calls have a timeout."""
        try:
            sdk = self._factory()
        except (ImportError, OSError) as error:
            raise SdkUnavailable(f"無法載入富邦 SDK：{type(error).__name__}") from None
        c = self._credentials
        try:
            result = sdk.apikey_login(c.person_id, c.api_key, c.cert_path, c.cert_password)
        except Exception as error:  # noqa: BLE001 - reported, then redacted by the caller
            raise LoginError(f"登入失敗：{type(error).__name__}: {error}") from None
        if not getattr(result, "is_success", False):
            raise LoginError(f"登入失敗：{getattr(result, 'message', '')}")
        # The account list in result.data is never kept.
        self._sdk = sdk
        try:
            _call(sdk.init_realtime)
        except ApiError as error:
            raise LoginError(f"行情連線初始化失敗：{error}") from None
        self._rest = sdk.marketdata.rest_client.stock
        return bound_market_data_calls(self._rest_modules)

    def snapshot_quotes(self) -> dict:
        return _call(lambda: self._rest.snapshot.quotes(market="TSE", type="COMMONSTOCK"))

    def disposition_list(self) -> dict:
        return _call(lambda: self._rest.intraday.tickers(type="EQUITY", exchange="TWSE", isDisposition=True))

    def minute_candles(self, symbol: str, date: str) -> dict:
        return _call(lambda: self._rest.historical.candles(**{
            "symbol": symbol, "from": date, "to": date, "timeframe": "1",
            "fields": "open,high,low,close,volume,average", "sort": "asc"}))

    def daily_candle(self, symbol: str, date: str) -> dict:
        return _call(lambda: self._rest.historical.candles(**{
            "symbol": symbol, "from": date, "to": date, "fields": "open,high,low,close,volume,turnover,change"}))

    def trades(self, symbol: str, offset: int, limit: int) -> dict:
        """One page of today's trades, oldest first. Fubon keeps only the current day: there is no date."""
        return _call(lambda: self._rest.intraday.trades(symbol=symbol, offset=offset, limit=limit, sort="asc"))

    def logout(self) -> None:
        if self._sdk is None:
            return
        try:
            self._sdk.logout()
        except Exception:  # noqa: BLE001 - logout failures must not hide the run result
            pass
        self._sdk = None
        self._rest = None
