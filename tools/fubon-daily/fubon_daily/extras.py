"""What runs after the evening fetch, inside the run lock: TWSE's 5-second index for the published days that miss it, and
the 當沖 list from the user's sheet. Neither is allowed to block, fail or change the fetch itself: run_extras never
raises, and what went wrong is only ever recorded as fixed text (an error's own text can echo addresses or key data),
in status.json ("taiex", "radar") and in the day's log.

The radar list is stored with MarketStore.write_radar, which is check-then-replace and only safe under the run lock;
this module is only called from run(), after the lock was taken.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from typing import Callable

from . import radar, taiex
from .store import MarketStore

# The first day of the daily lessons: earlier days have no lesson, so no index is fetched for them.
FIRST_LESSON_DAY = "2026-10-21"
# A run fetches at most this many days (the oldest missing ones first), so a long gap is closed over a few runs.
MAX_TAIEX_DAYS = 5
# Seconds between two requests to TWSE, which blocks clients that ask too often.
TAIEX_SPACING = 2.0

TAIEX_UNEXPECTED = "大盤處理時發生未預期的錯誤"
RADAR_UNEXPECTED = "名單處理時發生未預期的錯誤"
RADAR_WRITE_FAILED = "名單存檔失敗"
# Rows were skipped and not one 當沖 row was usable: the sheet changed in a way the header check cannot see.
RADAR_NO_ROWS = "試算表沒有可用的當沖列"
STATUS_LOST = "狀態檔寫入失敗"


class _Log:
    """Log lines of the day of `now`; a failing log never stops anything."""

    def __init__(self, store: MarketStore, now: datetime):
        self.store = store
        self.now = now

    def __call__(self, message: str) -> None:
        try:
            self.store.log(self.now.date().isoformat(), message, self.now)
        except Exception:  # noqa: BLE001 - the report about the work must not undo the work
            pass


def _report(store: MarketStore, log: _Log, key: str, entry: dict) -> None:
    try:
        store.write_status_key(key, entry)
    except Exception:  # noqa: BLE001
        log(STATUS_LOST)


def _fetch_taiex_day(store: MarketStore, day: str, taiex_get: Callable[[str], bytes], version: str,
                     now: datetime) -> int:
    """Downloads, keeps the answer as received, checks it and stores the day; the number of points stored."""
    day_date = date.fromisoformat(day)
    raw = taiex.fetch(day_date, taiex_get)
    store.stage_taiex_raw(day, raw)
    points = taiex.parse_points(taiex.decode(raw), day_date)
    store.publish_taiex(day, raw, points, version, now)
    return len(points)


def _taiex(store: MarketStore, log: _Log, now: datetime, taiex_get: Callable[[str], bytes], version: str,
           sleep: Callable[[float], None]) -> None:
    pending = [day for day in store.full_market_days() if day >= FIRST_LESSON_DAY and not store.has_taiex(day)]
    pending = pending[:MAX_TAIEX_DAYS]
    if not pending:
        return
    failures: list[tuple[str, str]] = []
    points = None
    for position, day in enumerate(pending):
        if position:
            sleep(TAIEX_SPACING)
        points, reason = None, None
        try:
            points = _fetch_taiex_day(store, day, taiex_get, version, now)
        except taiex.TaiexError as error:
            reason = error.reason
        except Exception:  # noqa: BLE001 - one day's trouble must not stop the next day
            reason = TAIEX_UNEXPECTED
        if reason is None:
            log(f"大盤 {day}：已存（{points} 點）")
        else:
            failures.append((day, reason))
            log(f"大盤 {day}：失敗：{reason}")
    _report(store, log, "taiex", {
        "date": pending[-1], "outcome": "failed" if failures else "ok",
        "reason": f"{failures[-1][0]}：{failures[-1][1]}" if failures else None,
        "points": points, "failed": [day for day, _ in failures], "finishedAt": now.isoformat(timespec="seconds")})


def _latest_radar(store: MarketStore) -> tuple[str | None, int | None]:
    """The newest stored day that reads back whole, and how many stocks it has."""
    try:
        for day in reversed(store.radar_dates()):
            stored = store.read_radar(day)
            if stored is not None:
                return day, len(stored["symbols"])
    except Exception:  # noqa: BLE001
        pass
    return None, None


def _radar(store: MarketStore, log: _Log, now: datetime, radar_read: Callable[[], list[list[str]]] | None,
           configured: bool) -> None:
    finished = now.isoformat(timespec="seconds")
    if radar_read is None or not configured:
        latest, count = _latest_radar(store)
        log("名單：沒有設定檔，略過")
        _report(store, log, "radar", {"outcome": "not-configured", "reason": None, "latest": latest,
                                      "symbols": count, "stored": [], "finishedAt": finished})
        return
    stored: list[str] = []
    reason = None
    try:
        lists, skipped = radar.parse_values(radar_read())
        if skipped:
            log(f"名單：試算表有 {skipped} 列不能用，已略過")
            if not lists:
                raise radar.RadarError(RADAR_NO_ROWS)
        for day in radar.dates_to_store(lists, set(store.radar_dates()), now.date()):
            try:
                if store.write_radar(day, lists[day], now):
                    stored.append(day)
            except Exception:  # noqa: BLE001 - one day that cannot be written does not hold back the others
                reason = RADAR_WRITE_FAILED
                log(f"名單 {day}：存檔失敗")
    except radar.RadarError as error:
        reason = error.reason
    except Exception:  # noqa: BLE001
        reason = RADAR_UNEXPECTED
    if reason is not None:
        log(f"名單：失敗：{reason}")
    elif stored:
        log(f"名單：存了 {len(stored)} 天（{'、'.join(stored)}）")
    else:
        log("名單：沒有新的日子要存")
    latest, count = _latest_radar(store)
    _report(store, log, "radar", {"outcome": "failed" if reason else "ok", "reason": reason, "latest": latest,
                                  "symbols": count, "stored": stored, "finishedAt": finished})


def run_extras(store: MarketStore, *, now: datetime, taiex_get: Callable[[str], bytes] | None,
               radar_read: Callable[[], list[list[str]]] | None, radar_config_present: bool, version: str,
               sleep: Callable[[float], None] = time.sleep) -> None:
    """TAIEX first, then the list; each is independent of the other and of the fetch. Never raises.

    taiex_get(url) -> bytes downloads (None: no index is fetched); radar_read() -> rows of the sheet raises
    RadarError(reason) when it cannot (None or radar_config_present False: the list is not configured, which is not
    a failure)."""
    log = _Log(store, now)
    finished = now.isoformat(timespec="seconds")
    if taiex_get is not None:
        try:
            _taiex(store, log, now, taiex_get, version, sleep)
        except Exception:  # noqa: BLE001 - never raise: whatever is not handled day by day ends up here
            log(f"大盤：失敗：{TAIEX_UNEXPECTED}")
            _report(store, log, "taiex", {"date": None, "outcome": "failed", "reason": TAIEX_UNEXPECTED,
                                          "points": None, "failed": [], "finishedAt": finished})
    try:
        _radar(store, log, now, radar_read, radar_config_present)
    except Exception:  # noqa: BLE001
        log(f"名單：失敗：{RADAR_UNEXPECTED}")
        _report(store, log, "radar", {"outcome": "failed", "reason": RADAR_UNEXPECTED, "latest": None,
                                      "symbols": None, "stored": [], "finishedAt": finished})
