"""Validates Fubon responses and converts them to the market-data formats. No network access."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
SESSION_OPEN_SECONDS = 9 * 3600
LAST_CONTINUOUS_T = 4 * 3600 + 24 * 60  # 13:24
CLOSING_AUCTION_T = 4 * 3600 + 30 * 60  # 13:30


class ValidationError(Exception):
    def __init__(self, kind: str, detail: str):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


@dataclass(frozen=True)
class Listing:
    code: str
    name: str
    close: float | None
    change: float | None
    trade_volume: int
    trade_value: float


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _rows(payload: object, symbol: str | None = None) -> list:
    if not isinstance(payload, dict):
        raise ValidationError("structure", "回應不是物件")
    if symbol is not None and payload.get("symbol") != symbol:
        raise ValidationError("structure", f"股票代號不符：{payload.get('symbol')!r}")
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise ValidationError("structure", "data 不是陣列")
    return rows


def minute_bars(payload: object, symbol: str, date: str) -> list[list[float]]:
    """Session bars [t, open, high, low, close, volume, average]; t is seconds after 09:00."""
    bars: list[list[float]] = []
    previous = -1
    for row in _rows(payload, symbol):
        if not isinstance(row, dict):
            raise ValidationError("structure", "K 棒不是物件")
        try:
            moment = datetime.fromisoformat(row.get("date"))
        except (TypeError, ValueError):
            raise ValidationError("time", f"時間無法解析：{row.get('date')!r}") from None
        if moment.utcoffset() != timedelta(hours=8):
            raise ValidationError("time", "時區不是 +08:00")
        if moment.date().isoformat() != date:
            raise ValidationError("time", f"日期不是 {date}")
        if moment.second or moment.microsecond:
            raise ValidationError("time", f"時間不是整分鐘：{moment:%H:%M:%S}")
        t = moment.hour * 3600 + moment.minute * 60 - SESSION_OPEN_SECONDS
        if not (0 <= t <= LAST_CONTINUOUS_T or t == CLOSING_AUCTION_T):
            raise ValidationError("time", f"不在交易時段：{moment:%H:%M}")
        if t <= previous:
            raise ValidationError("order", f"時間重複或倒序：{moment:%H:%M}")
        previous = t
        prices = [row.get(field) for field in ("open", "high", "low", "close")]
        if not all(_number(price) and price > 0 for price in prices):
            raise ValidationError("price", f"{moment:%H:%M} 價格不是正數")
        open_, high, low, close = prices
        if low > min(open_, close) or high < max(open_, close) or low > high:
            raise ValidationError("price", f"{moment:%H:%M} 開高低收不一致")
        volume = row.get("volume")
        if not (isinstance(volume, int) and not isinstance(volume, bool) and volume >= 0):
            raise ValidationError("volume", f"{moment:%H:%M} 量不是非負整數")
        average = row.get("average")
        if not (_number(average) and average > 0):
            raise ValidationError("average", f"{moment:%H:%M} 均價缺漏")
        bars.append([t, open_, high, low, close, volume, average])
    return bars


def snapshot_listing(payload: object) -> tuple[str, list[Listing]]:
    rows = _rows(payload)
    date = payload.get("date")
    if not isinstance(date, str):
        raise ValidationError("structure", "快照沒有日期")
    listings = []
    for item in rows:
        if not isinstance(item, dict) or not isinstance(item.get("symbol"), str) or not isinstance(item.get("name"), str):
            raise ValidationError("structure", "快照項目缺少代號或名稱")
        close = item.get("closePrice")
        change = item.get("change")
        volume = item.get("tradeVolume") or 0
        value = item.get("tradeValue") or 0
        if not isinstance(volume, int) or isinstance(volume, bool) or volume < 0 or not _number(value):
            raise ValidationError("structure", f"{item['symbol']} 成交量或成交值格式錯誤")
        listings.append(Listing(item["symbol"], item["name"], close if _number(close) else None,
                                change if _number(change) else None, volume, value))
    return date, listings


def disposition_codes(payload: object) -> set[str]:
    rows = _rows(payload)
    if not all(isinstance(item, dict) and isinstance(item.get("symbol"), str) for item in rows):
        raise ValidationError("structure", "處置股清單格式錯誤")
    return {item["symbol"] for item in rows}


def daily_summary(payload: object, symbol: str, date: str) -> dict | None:
    """Close, change, volume (lots) and turnover of one past day, or None when it did not trade."""
    for row in _rows(payload, symbol):
        if isinstance(row, dict) and row.get("date") == date:
            close, change, volume, turnover = (row.get(key) for key in ("close", "change", "volume", "turnover"))
            if not (_number(close) and _number(change) and _number(volume) and _number(turnover)):
                raise ValidationError("structure", f"{symbol} 日 K 欄位缺漏")
            return {"close": close, "change": change, "tradeVolume": round(volume / 1000), "tradeValue": turnover}
    return None


def reference_price(close: float | None, change: float | None) -> float | None:
    if close is None or change is None:
        return None
    return round(close - change, 2)


def symbol_warnings(code: str, bars: list[list[float]], trade_volume: int, close: float | None) -> list[dict]:
    warnings = []
    minute_volume = sum(bar[5] for bar in bars)
    if minute_volume > trade_volume:
        warnings.append({"code": code, "kind": "volume", "detail": f"分 K 量 {minute_volume} 張大於當日量 {trade_volume} 張"})
    if bars and close is not None and bars[-1][4] != close:
        warnings.append({"code": code, "kind": "close", "detail": f"最後收盤 {bars[-1][4]} 與快照收盤 {close} 不同"})
    return warnings
