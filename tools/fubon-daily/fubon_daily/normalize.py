"""Validates Fubon responses and converts them to the market-data formats. No network access."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
SESSION_OPEN_SECONDS = 9 * 3600
LAST_CONTINUOUS_T = 4 * 3600 + 24 * 60  # 13:24
CLOSING_AUCTION_T = 4 * 3600 + 30 * 60  # 13:30
# Trades are stamped in microseconds since the epoch. TWSE may postpone a closing match by about two minutes,
# and fixed-price trades run 14:00-14:30, so the day's trades may run until 14:30; later ones are noted.
TRADE_TIME_PER_SECOND = 1_000_000
TRADE_SESSION_END_T = 5 * 3600 + 31 * 60  # 14:31
# Trades from 13:35 on are outside the regular session: the 14:30 fixed-price match arrives without a running
# volume or quotes and with serial 99999999 (seen 2026-10-20), and the day's volume in the snapshot excludes it.
LATE_TRADE_MS = (4 * 3600 + 35 * 60) * 1000  # 13:35
FIXED_PRICE_FROM_MS = 5 * 3600 * 1000  # 14:00


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


def _quote_side(value: object, label: str) -> float | None:
    """A best bid or ask at the time of a trade; absent or 0 means that side was empty."""
    if value is None or value == 0:
        return None
    if not (_number(value) and value > 0):
        raise ValidationError("price", f"{label} 不是正數")
    return value


def trade_rows(pages: list, symbol: str, date: str) -> list[list]:
    """Trades [ms after 09:00, price, size, bid, ask] from intraday/trades pages fetched oldest first."""
    session_open = int(datetime.fromisoformat(f"{date}T09:00:00+08:00").timestamp()) * TRADE_TIME_PER_SECOND
    session_end = TRADE_SESSION_END_T * TRADE_TIME_PER_SECOND
    trades: list[list] = []
    previous_time = previous_serial = None
    running = 0
    late_from = LATE_TRADE_MS * (TRADE_TIME_PER_SECOND // 1000)
    for page in pages:
        rows = _rows(page, symbol)
        if page.get("date") != date:
            raise ValidationError("time", f"日期不是 {date}：{page.get('date')!r}")
        for item in rows:
            if not isinstance(item, dict):
                raise ValidationError("structure", "成交不是物件")
            moment, serial = item.get("time"), item.get("serial")
            if not isinstance(moment, int) or isinstance(moment, bool):
                raise ValidationError("time", f"成交時間不是整數：{moment!r}")
            offset = moment - session_open
            if not 0 <= offset < session_end:
                raise ValidationError("time", f"成交時間不在 {date} 交易時段：{moment}")
            if not isinstance(serial, int) or isinstance(serial, bool):
                raise ValidationError("structure", f"流水號不是整數：{serial!r}")
            late = offset >= late_from
            if previous_time is not None and moment < previous_time:
                raise ValidationError("order", f"成交時間倒序：流水號 {serial}")
            if not late:
                if previous_serial is not None and serial <= previous_serial:
                    raise ValidationError("order", f"成交重複或倒序：流水號 {serial}")
                previous_serial = serial
            previous_time = moment
            price, size = item.get("price"), item.get("size")
            if not (_number(price) and price > 0):
                raise ValidationError("price", f"流水號 {serial} 成交價不是正數")
            if not (isinstance(size, int) and not isinstance(size, bool) and size > 0):
                raise ValidationError("volume", f"流水號 {serial} 單量不是正整數")
            running += size
            volume = item.get("volume")
            if not late and volume is not None and volume != running:
                raise ValidationError("volume", f"流水號 {serial} 累計量 {volume} 與逐筆加總 {running} 不同")
            trades.append([offset // (TRADE_TIME_PER_SECOND // 1000), price, size,
                           _quote_side(item.get("bid"), "買價"), _quote_side(item.get("ask"), "賣價")])
    return trades


def split_session(trades: list[list]) -> tuple[list[list], list[list]]:
    """The regular session's trades (up to a delayed close) and those from 13:35 on (the fixed-price match)."""
    return ([trade for trade in trades if trade[0] < LATE_TRADE_MS],
            [trade for trade in trades if trade[0] >= LATE_TRADE_MS])


def tick_warnings(code: str, trades: list[list], trade_volume: int, close: float | None,
                  after_hours: list[list] = ()) -> list[dict]:
    """Checks the regular session's trades against the snapshot; notes trades between 13:35 and 14:00."""
    warnings = []
    total = sum(trade[2] for trade in trades)
    if total != trade_volume:
        warnings.append({"code": code, "kind": "volume", "detail": f"逐筆量 {total} 與當日量 {trade_volume} 不同"})
    if trades and close is not None and trades[-1][1] != close:
        warnings.append({"code": code, "kind": "close", "detail": f"最後成交 {trades[-1][1]} 與快照收盤 {close} 不同"})
    late = sum(1 for trade in after_hours if trade[0] < FIXED_PRICE_FROM_MS)
    if late:
        warnings.append({"code": code, "kind": "late", "detail": f"13:35–14:00 之間有 {late} 筆成交"})
    return warnings
