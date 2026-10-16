"""Small Fubon-shaped responses, modelled on the 2026-10-16 read-only probe."""
from __future__ import annotations

DATE = "2026-10-15"


def stamp(date: str, hour: int, minute: int) -> str:
    return f"{date}T{hour:02d}:{minute:02d}:00.000+08:00"


def row(date, hour, minute, price=100.0, volume=10, average=None):
    return {
        "date": stamp(date, hour, minute),
        "open": price,
        "high": price,
        "low": price,
        "close": price,
        "volume": volume,
        "average": price if average is None else average,
    }


def full_day(symbol="2330", date=DATE, price=100.0):
    """09:00–13:24 every minute plus the 13:30 closing auction: 266 bars."""
    rows = [row(date, 9 + minute // 60, minute % 60, price) for minute in range(0, 4 * 60 + 25)]
    rows.append(row(date, 13, 30, price, volume=50))
    return {"type": "EQUITY", "exchange": "TWSE", "market": "TSE", "symbol": symbol, "timeframe": "1", "data": rows}


def sparse_day(symbol="1413", date=DATE, minutes=((9, 11), (12, 35), (13, 12)), price=9.44):
    """A thin stock: no bar for minutes without trades and no 13:30 bar."""
    return {"type": "EQUITY", "symbol": symbol, "timeframe": "1",
            "data": [row(date, hour, minute, price, volume=2) for hour, minute in minutes]}


def quote(code, name, close, change, volume, value):
    return {"type": "EQUITY", "symbol": code, "name": name, "openPrice": close, "highPrice": close,
            "lowPrice": close, "closePrice": close, "change": change, "changePercent": 0,
            "tradeVolume": volume, "tradeValue": value, "lastPrice": close, "lastUpdated": 1}


def snapshot(date=DATE, items=None):
    if items is None:
        items = [
            quote("2330", "台積電", 2440, -50, 58487, 80_781_285_000),
            quote("1413", "宏洲", 9.44, 0, 26, 245_000),
            quote("9999", "無成交", None, 0, 0, 0),
        ]
    return {"date": date, "time": "140000", "market": "TSE", "data": items}


def daily(symbol, date=DATE, close=100.0, change=1.0, volume=1_234_000, turnover=123_400_000):
    return {"symbol": symbol, "type": "EQUITY", "timeframe": "D",
            "data": [{"date": date, "open": close, "high": close, "low": close, "close": close,
                      "volume": volume, "turnover": turnover, "change": change}]}


DISPOSITION = {"type": "EQUITY", "exchange": "TWSE", "data": [{"symbol": "2424", "name": "隴華"}]}
