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


class LoginRefused(LoginError):
    """Fubon answered the login and said no (the key, the certificate or the account). Trying again and again could
    lock the account; any other LoginError (an exception on the way, a realtime setup failure) may pass."""


class SdkUnavailable(Exception):
    pass


# Seconds to connect, then to wait for each read of the answer. The SDK sends market data with requests and no
# timeout, so a server that stops answering would hold the run until Windows stops the task at two hours.
REST_TIMEOUT = (10, 60)
# The fugle_marketdata release whose REST code was read for this (fubon_neo 2.4.0 pins it). Another release may send
# another way (requests.request, a Session) that the stand-in below would not bound: read it, then change this.
CHECKED_FUGLE = "2.7.0rc1"
UNBOUNDED = "富邦行情呼叫沒有逾時"
UNAUTHENTICATED = 3  # fugle_marketdata 2.7.0rc1 websocket AuthenticationState.UNAUTHENTICATED


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
    """The SDK module that sends every market-data call (fugle_marketdata rest/base_rest.py), the requests package
    it is expected to send with, and the fugle_marketdata release."""
    import fugle_marketdata
    import requests
    from fugle_marketdata.rest import base_rest

    return base_rest, requests, fugle_marketdata.__version__


def bound_market_data_calls(rest_modules: Callable[[], tuple]) -> str:
    """Gives the SDK's market-data calls a timeout, if the SDK is the release this was checked against and still
    sends them the way it did then. Returns a line for the log saying whether they have one. Login, init_realtime
    and logout run inside the compiled SDK and keep having none."""
    try:
        base_rest, requests, release = rest_modules()
        if release != CHECKED_FUGLE:
            return f"{UNBOUNDED}：fugle_marketdata {release} 還沒檢查過（檢查過的是 {CHECKED_FUGLE}），這次不加"
        current = getattr(base_rest, "requests", None)
        if not isinstance(current, TimedRequests):  # else an earlier login in this run already put it there
            if current is not requests:
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
        self._streams = 0

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
            raise LoginRefused(f"登入失敗：{getattr(result, 'message', '')}")
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

    def stock_stream(self) -> object:
        """A WebSocket stock client on a connection of its own. The first is the one login set up; each later one
        runs init_realtime again for a new token, which the 2026-10-26 probe showed leaves the earlier connections
        working. REST then goes on with the newest token."""
        if self._streams:
            _call(self._sdk.init_realtime)
            self._rest = self._sdk.marketdata.rest_client.stock
        self._streams += 1
        return self._sdk.marketdata.websocket_client.stock

    def quote(self, symbol: str) -> dict:
        """The current 五檔 and last trade of one stock (intraday/quote): refills a book after a reconnect."""
        return _call(lambda: self._rest.intraday.quote(symbol=symbol))

    def release(self, stream: object) -> None:
        """Lets go of a WebSocket stock client for good, even one stuck in connect(). In fugle_marketdata 2.7.0rc1,
        connect() waits with no pause for AUTHENTICATED or UNAUTHENTICATED; a socket that fails before on_open
        (refused, timed out, a TLS or HTTP refusal) sets neither, and disconnect() puts PENDING back, so the wait
        would hold a core for good. UNAUTHENTICATED ends it. It is set on the client itself: fubon_neo's wrapper
        passes reads on, not writes. Before disconnect() too, in case that one never returns."""
        inner = getattr(stream, "_client", stream)
        checked = self._checked_fugle() and isinstance(getattr(inner, "auth_status", None), int)
        if checked:
            inner.auth_status = UNAUTHENTICATED
        try:
            stream.disconnect()
        except Exception:  # noqa: BLE001 - a client that cannot even disconnect is still let go
            pass
        if checked:
            inner.auth_status = UNAUTHENTICATED

    def _checked_fugle(self) -> bool:
        try:
            return self._rest_modules()[2] == CHECKED_FUGLE
        except Exception:  # noqa: BLE001 - without the release, leave the SDK's state alone
            return False

    def logout(self) -> None:
        if self._sdk is None:
            return
        try:
            self._sdk.logout()
        except Exception:  # noqa: BLE001 - logout failures must not hide the run result
            pass
        self._sdk = None
        self._rest = None
        self._streams = 0
