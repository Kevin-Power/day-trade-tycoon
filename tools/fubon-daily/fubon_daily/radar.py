"""The 當沖 list the user keeps in a Google Sheet (tab 「定格名單」): read with a read-only service account, checked
row by row, and reduced to code and name. Everything else in the sheet (score, grade, prices) is dropped here.

Nothing from the key file or from Google's answers goes into an error: every failure becomes one fixed reason."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import quote

from .credentials import inside_git_worktree

HEADER = ["日期", "類型", "代號", "名稱", "族群", "分數", "等級", "收盤", "漲跌幅%", "連板", "備註"]
KIND = "當沖"
RADAR_FIRST_DAY = date(2026, 10, 20)
SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
# (connect, read) seconds, for the token request and for the values request alike.
TIMEOUT = (10, 60)
CODE = re.compile(r"[0-9A-Z]{4,6}")
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
SHEET_ID = re.compile(r"[A-Za-z0-9_-]+")


class RadarError(Exception):
    """The list could not be read. `reason` is a fixed sentence, safe to show and to store."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class RadarConfig:
    sheet_id: str
    tab: str
    key_path: Path


def load_config(path: Path) -> RadarConfig | None:
    """radar.local.json: {"sheetId", "tab", "keyFile"}; keyFile is relative to the folder of this file. None when
    the file does not exist (the list is then simply not used). The key must not sit inside a git project."""
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        raise RadarError("設定檔格式不正確") from None
    fields = [data.get(name) for name in ("sheetId", "tab", "keyFile")] if isinstance(data, dict) else []
    if len(fields) != 3 or not all(isinstance(field, str) and field.strip() for field in fields):
        raise RadarError("設定檔格式不正確")
    sheet_id, tab, key_file = (field.strip() for field in fields)
    if not SHEET_ID.fullmatch(sheet_id):
        raise RadarError("設定檔格式不正確")
    key_path = path.parent / key_file
    if inside_git_worktree(key_path):
        raise RadarError("金鑰檔不能放在 git 專案裡")
    return RadarConfig(sheet_id, tab, key_path)


def _text(cell: object) -> str:
    return cell.strip() if isinstance(cell, str) else ""


def _real_day(text: str) -> bool:
    if not DAY.fullmatch(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def parse_values(values: list[list[str]]) -> tuple[dict[str, list[tuple[str, str]]], int]:
    """The 當沖 rows of every day as (code, name), each code once per day in the sheet's order, and how many rows
    were skipped as unusable. The first row must be exactly HEADER (anything else: RadarError, the whole read
    fails). A blank line is no row; a row of another kind (隔日衝 …) is not ours to judge, so neither is counted."""
    if not values or not isinstance(values[0], (list, tuple)) or list(values[0]) != HEADER:
        raise RadarError("試算表欄位改了")
    lists: dict[str, list[tuple[str, str]]] = {}
    skipped = 0
    for raw in values[1:]:
        if not isinstance(raw, (list, tuple)):
            skipped += 1
            continue
        if not any(_text(cell) for cell in raw):
            continue
        cells = [_text(cell) for cell in raw[:4]]
        day, kind, code, name = cells + [""] * (4 - len(cells))
        if kind != KIND:
            if not kind:
                skipped += 1
            continue
        if not (_real_day(day) and CODE.fullmatch(code) and name):
            skipped += 1
            continue
        entries = lists.setdefault(day, [])
        if all(known != code for known, _ in entries):
            entries.append((code, name))
    return lists, skipped


def read_values(config: RadarConfig, *, base_url: str = "https://sheets.googleapis.com") -> list[list[str]]:
    """The sheet's columns A to K as rows of text. Signs in with the service account in the key file for the
    read-only scope. google-auth is imported here, so a computer without it can still run everything else."""
    try:
        import requests
        from google.auth import exceptions as auth_exceptions
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
    except ImportError:
        raise RadarError("沒有安裝 google-auth") from None
    try:
        info = json.loads(config.key_path.read_text(encoding="utf-8-sig"))
    except OSError:
        raise RadarError("找不到 Google 金鑰檔") from None
    except ValueError:
        raise RadarError("Google 授權失敗") from None
    url = (f"{base_url.rstrip('/')}/v4/spreadsheets/{quote(config.sheet_id, safe='')}"
           f"/values/{quote(config.tab + '!A:K', safe='')}")
    try:
        credentials = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
        with AuthorizedSession(credentials) as session:
            response = session.get(url, timeout=TIMEOUT)
    except Exception as error:
        # No connection, no answer in time, a refused token, a damaged key ...: none of their text is kept.
        no_answer = isinstance(error, (requests.exceptions.RequestException, auth_exceptions.TransportError))
        raise RadarError("連線逾時" if no_answer else "Google 授權失敗") from None
    reason = f"讀不到試算表（HTTP {response.status_code}）"
    if response.status_code != 200:
        raise RadarError(reason) from None
    try:
        rows = response.json().get("values", [])
    except (ValueError, AttributeError):
        rows = None
    if not (isinstance(rows, list) and all(isinstance(row, list) for row in rows)):
        raise RadarError(reason) from None
    return rows


def dates_to_store(lists: dict, stored: set[str], today: date) -> list[str]:
    """The days to freeze now, oldest first: from RADAR_FIRST_DAY up to the day before `today` (today's list is
    still being made), not stored yet, and with at least one stock."""
    wanted = []
    for name, symbols in lists.items():
        try:
            day = date.fromisoformat(name)
        except (TypeError, ValueError):
            continue
        if symbols and day.isoformat() == name and RADAR_FIRST_DAY <= day < today and name not in stored:
            wanted.append(name)
    return sorted(wanted)
