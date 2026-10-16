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


def default_sdk():
    from fubon_neo.sdk import FubonSDK

    return FubonSDK()


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
        message = f"{type(error).__name__}: {error}"[:300]
        if status == 429:
            raise RateLimited(message, status) from None
        if status == 404:
            raise NotFound(message, status) from None
        raise ApiError(message, status) from None


class FubonClient:
    def __init__(self, credentials: Credentials, sdk_factory: Callable[[], object] = default_sdk):
        self._credentials = credentials
        self._factory = sdk_factory
        self._sdk = None
        self._rest = None

    def login(self) -> None:
        try:
            sdk = self._factory()
        except (ImportError, OSError) as error:
            raise SdkUnavailable(f"無法載入富邦 SDK：{type(error).__name__}") from None
        c = self._credentials
        try:
            result = sdk.apikey_login(c.person_id, c.api_key, c.cert_path, c.cert_password)
        except Exception as error:  # noqa: BLE001 - reported, then redacted by the caller
            raise LoginError(f"登入失敗：{type(error).__name__}: {error}"[:300]) from None
        if not getattr(result, "is_success", False):
            raise LoginError(f"登入失敗：{getattr(result, 'message', '')}"[:300])
        # The account list in result.data is never kept.
        self._sdk = sdk
        _call(sdk.init_realtime)
        self._rest = sdk.marketdata.rest_client.stock

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

    def logout(self) -> None:
        if self._sdk is None:
            return
        try:
            self._sdk.logout()
        except Exception:  # noqa: BLE001 - logout failures must not hide the run result
            pass
        self._sdk = None
        self._rest = None
