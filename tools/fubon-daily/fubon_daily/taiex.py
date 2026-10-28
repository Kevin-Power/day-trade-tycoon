"""TWSE's 5-second weighted index (MI_5MINS_INDEX): download and check, for the lessons' market cell.

Public data, no login. The file for a day is stored write-once by MarketStore.publish_taiex after the checks here
and the comparison with the previous day's close. Every reason is fixed text (never an exception's own text).
"""
from __future__ import annotations

import json
import math
import re
from datetime import date
from typing import Callable

URL = "https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date={day}"
# The real downloader (urllib, in cli.py) sends this; fetch() only hands it the address.
USER_AGENT = "Mozilla/5.0 (DayTradeTycoon fetcher)"
SOURCE = "twse MI_5MINS_INDEX"
TIME_COLUMN = "時間"
VALUE_COLUMN = "發行量加權股價指數"
STEP = 5
LAST_SECOND = 16200  # 13:30:00, seconds after 09:00:00
POINT_COUNT = LAST_SECOND // STEP + 1  # 3,241

NOT_OK = "證交所回覆不是 OK"
NOT_JSON = "證交所回覆不是 JSON"
EMPTY = "證交所回覆是空的"
UNREACHABLE = "無法連上證交所"
WRONG_DATE = "日期不符"
BAD_SHAPE = "大盤檔案格式不正確"
GAP = "大盤資料不連續"
DUPLICATE = "大盤資料重複"
BAD_VALUE = "大盤數值不正確"
PREVIOUS_CLOSE = "前一交易日收盤與今天 09:00:00 不同"

_TIME = re.compile(r"^(\d{2}):(\d{2}):(\d{2})$")


class TaiexError(Exception):
    """A download or check that failed; `reason` is fixed Chinese text safe to log and show."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def fetch(day: date, http_get: Callable[[str], bytes]) -> bytes:
    """The day's file exactly as TWSE sent it. `http_get(url)` is injected (tests never reach the network)."""
    try:
        data = http_get(URL.format(day=day.strftime("%Y%m%d")))
    except Exception:  # noqa: BLE001 - a network error's text can echo addresses; only the fixed reason goes on
        raise TaiexError(UNREACHABLE) from None
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise TaiexError(EMPTY)
    return bytes(data)


def decode(raw: bytes) -> dict:
    """The JSON object in a downloaded file; a page TWSE sends instead (a block notice, say) is named as such."""
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError, AttributeError):
        raise TaiexError(NOT_JSON) from None
    if not isinstance(value, dict):
        raise TaiexError(NOT_JSON)
    return value


def _seconds(cell: object) -> int:
    match = _TIME.match(cell) if isinstance(cell, str) else None
    if not match:
        raise TaiexError(BAD_SHAPE)
    hours, minutes, seconds = (int(part) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds - 9 * 3600


def _value(cell: object) -> float:
    if isinstance(cell, str):
        try:
            number = float(cell.replace(",", ""))
        except ValueError:
            raise TaiexError(BAD_VALUE) from None
    elif isinstance(cell, (int, float)) and not isinstance(cell, bool):
        number = float(cell)
    else:
        raise TaiexError(BAD_VALUE)
    if not math.isfinite(number) or number <= 0:
        raise TaiexError(BAD_VALUE)
    return number


def parse_points(raw: dict, day: date) -> list[list]:
    """`[[seconds after 09:00:00, index], ...]`: all 3,241 five-second points from 09:00:00 to 13:30:00, in order,
    none missing or repeated. The 09:00:00 point holds the previous session's close, not an opening value."""
    if not isinstance(raw, dict) or raw.get("stat") != "OK":
        raise TaiexError(NOT_OK)
    if raw.get("date") != day.strftime("%Y%m%d"):
        raise TaiexError(WRONG_DATE)
    fields, rows = raw.get("fields"), raw.get("data")
    if not isinstance(fields, list) or not isinstance(rows, list) or TIME_COLUMN not in fields \
            or VALUE_COLUMN not in fields:
        raise TaiexError(BAD_SHAPE)
    time_column, value_column = fields.index(TIME_COLUMN), fields.index(VALUE_COLUMN)
    points = []
    for row in rows:
        if not isinstance(row, list) or len(row) <= max(time_column, value_column):
            raise TaiexError(BAD_SHAPE)
        points.append([_seconds(row[time_column]), _value(row[value_column])])
    seconds = [point[0] for point in points]
    if len(set(seconds)) != len(seconds):
        raise TaiexError(DUPLICATE)
    if seconds != list(range(0, LAST_SECOND + 1, STEP)):
        raise TaiexError(GAP)
    return points


def check_previous_close(points: list[list], previous_close: float | None) -> None:
    """The 09:00:00 point repeats the previous trading day's close: when that day's file is stored (`previous_close`
    is its 13:30:00 value, None when it is not), the two must be the same number."""
    if previous_close is not None and points[0][1] != previous_close:
        raise TaiexError(PREVIOUS_CLOSE)
