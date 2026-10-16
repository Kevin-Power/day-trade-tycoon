# 富邦每日資料管線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每個交易日收盤後，自動抓取全部上市普通股的富邦 1 分 K，驗證、存證後放進正式站的 `market-data` 資料夾，並在講師頁顯示狀態。

**Architecture:** 本機獨立的 Python 套件 `tools/fubon-daily/fubon_daily/`，由 Windows 工作排程器執行安裝到 `DayTradeTycoon\fetcher\` 的複本。只有 `client.py` 會碰富邦 SDK；驗證、儲存與流程都可以用假 client 測試。網站只透過 `MARKET_DATA_DIR` 讀狀態檔，碰不到券商與金鑰。

**Tech Stack:** Python 3.12、`unittest`、富邦 SDK `fubon_neo` 2.4.0、PowerShell（安裝與排程）、TanStack Start 伺服器函式、zod、React 19、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-10-16-fubon-daily-pipeline-design.md`

## Global Constraints

- **範圍**：只做上市普通股（`market="TSE"`、`type="COMMONSTOCK"`）的 1 分 K。只用歷史 K 線 `historical/candles`（`timeframe="1"`），不呼叫任何帳務或下單 API。
- **登入設定**：預設是 `C:\Users\kevin\.fubon\credentials.local.py`，只用 `ast` 讀字串、絕不執行。設定檔位在 Git 工作目錄內就拒絕執行。
- **秘密保護**：`PERSON_ID`、API／SECRET 金鑰與憑證密碼，絕不可出現在 `market-data` 內任何檔案、日誌、通知或結束訊息中，一律換成 `＊＊＊`。
- **資料位置**：`%USERPROFILE%\YilutekServices\DayTradeTycoon\market-data\`，結構依規格第 4 節。
- **時間單位**：`t` 是距 09:00 的秒數，13:30 是 16200。量的單位是張（`volumeUnit: "lot"`）。
- **呼叫節奏**：每次呼叫間隔至少 1.1 秒。HTTP 429 等 60 秒；其他錯誤等 2 秒，每次呼叫最多 3 次。404 視為沒有盤中資料。
- **保存期限**：`raw\<日期>\` 保留 365 天，`logs\` 保留 90 天，`days\` 永久保留。
- **結束碼**：`ok`、`closed`、`already-done` 為 0；`failed` 為 1；設定檔、登入、憑證或 SDK 錯誤為 2。
- **不新增 npm 依賴**。Python 端只依賴標準函式庫與富邦 SDK；測試只用標準函式庫，所以系統的 `py -3.12` 就能跑。
- **工作區與提交**：工作區與其他工作階段共用。`git add` 只列明確路徑，絕不提交 `Fubon_Codex_Handoff/`、`當沖大富翁-地端/` 或任何設定檔、憑證。提交指令：`git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`。
- **需要使用者明確同意的步驟**：下載 SDK、從 PyPI 安裝相依套件、建立排程、部署正式站。這些只在 Task 8 做，做之前先問。
- **介面文字**一律繁體中文。

**計畫層級的決定（相對於規格的細節調整）**：
1. 規格寫「19:00 那次加 `--last-attempt`」。因為一個排程工作的三個觸發只能共用同一組參數，改成：台北時間 18:50 以後開始的執行自動視為最後一次；`--last-attempt` 保留給手動執行。
2. 模組放在套件 `tools/fubon-daily/fubon_daily/`（含 `__init__.py`），入口是 `tools/fubon-daily/fetch_daily.py`。規格列的模組名稱不變；只是 `fubon_client.py` 改名為 `client.py`，新增流程模組 `pipeline.py` 與命令列模組 `cli.py`。
3. 補抓模式的股票名稱，直接用「今日快照」的上市普通股清單，不另外呼叫 `intraday/tickers`，避免把 ETF 混進來。
4. 1 分 K 通過驗證後才寫入原始存證，這樣下一次執行會重新抓之前不合格的股票；快照則一律存證。

## Review Focus

1. **登入失敗的錯誤訊息可能帶出身分證字號或金鑰**：狀態檔、日誌與通知都必須遮蔽。→ Task 5 `test_login_failure_is_fatal_notified_and_redacted` 掃描整個資料夾。
2. **程式中途當掉，留下 `.lock` 和 `running` 狀態**：下一次排程必須能接手。講師頁對超過 2 小時的 `running` 要顯示「可能中斷」。→ Task 3 `test_stale_lock_is_taken_over`、Task 7 的 `stalled` 測試。
3. **補抓時指定了今天清單沒有的股票（例如已下市）**：要明確失敗並說明原因，不可默默略過。→ Task 5 `test_backfill_unknown_symbol_fails_clearly`。
4. **不合格的 1 分 K 不能卡住之後的補抓**：下一次執行必須重新抓那一檔。→ Task 5 `test_invalid_symbol_blocks_the_day_and_resume_refetches_only_missing`。
5. **狀態檔是壞的或來自未來版本**：講師頁顯示「狀態檔格式錯誤」，不能讓整頁出錯。→ Task 7 的 `malformed files are invalid, not thrown`。

## 共用指令

- **Python 測試**（在 repo 根目錄執行）：`py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
- **網站檢查**：`npm test`、`npm run typecheck`、`npx eslint src --quiet`

---

### Task 1: 套件骨架、登入設定讀取與遮蔽

**Files:**
- Create: `tools/fubon-daily/fubon_daily/__init__.py`
- Create: `tools/fubon-daily/fubon_daily/credentials.py`
- Create: `tools/fubon-daily/tests/__init__.py`
- Test: `tools/fubon-daily/tests/test_credentials.py`
- Modify: `.gitignore`（加入 `__pycache__/`）

**Interfaces:**
- Produces:
  - `class CredentialsError(Exception)`
  - `@dataclass(frozen=True) class Credentials: person_id: str; api_key: str; cert_path: str; cert_password: str`，方法 `secrets() -> list[str]`
  - `inside_git_worktree(path: Path) -> bool`
  - `load_credentials(path: Path) -> Credentials`
  - `class Redactor`：`Redactor(secrets: Iterable[str])`，呼叫 `redactor(text: object) -> str`

- [ ] **Step 1: 寫失敗的測試**

`tools/fubon-daily/fubon_daily/__init__.py` 與 `tools/fubon-daily/tests/__init__.py` 先建立為空檔案，然後建立 `tools/fubon-daily/tests/test_credentials.py`：

```python
import tempfile
import unittest
from pathlib import Path

from fubon_daily.credentials import CredentialsError, Redactor, load_credentials


class CredentialsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.cert = self.dir / "A123456789.pfx"
        self.cert.write_bytes(b"cert")

    def tearDown(self):
        self.temp.cleanup()

    def settings(self, **values):
        base = {
            "PERSON_ID": "A123456789",
            "API_KEY": "",
            "SECRET_KEY": "SECRETKEY123",
            "CERT_PATH": str(self.cert),
            "CERT_PASSWORD": "CERTPASS999",
        }
        base.update(values)
        path = self.dir / "credentials.local.py"
        path.write_text("".join(f"{key} = {value!r}\n" for key, value in base.items()), encoding="utf-8")
        return path

    def test_reads_strings_without_running_the_file(self):
        path = self.settings()
        path.write_text(path.read_text(encoding="utf-8") + "raise SystemExit('executed')\n", encoding="utf-8")
        credentials = load_credentials(path)
        self.assertEqual(
            (credentials.person_id, credentials.api_key, credentials.cert_password),
            ("A123456789", "SECRETKEY123", "CERTPASS999"),
        )

    def test_api_key_is_preferred_over_secret_key(self):
        self.assertEqual(load_credentials(self.settings(API_KEY="APIKEY1")).api_key, "APIKEY1")

    def test_missing_fields_are_named(self):
        with self.assertRaises(CredentialsError) as caught:
            load_credentials(self.settings(SECRET_KEY="", CERT_PASSWORD=""))
        self.assertIn("CERT_PASSWORD", str(caught.exception))
        self.assertIn("API_KEY", str(caught.exception))

    def test_missing_certificate_file_is_refused(self):
        with self.assertRaises(CredentialsError):
            load_credentials(self.settings(CERT_PATH=str(self.dir / "missing.pfx")))

    def test_settings_inside_a_git_worktree_are_refused(self):
        path = self.settings()
        (self.dir / ".git").mkdir()
        with self.assertRaises(CredentialsError) as caught:
            load_credentials(path)
        self.assertIn("Git", str(caught.exception))

    def test_unreadable_or_missing_files_are_credentials_errors(self):
        broken = self.dir / "credentials.local.py"
        broken.write_text("PERSON_ID = (\n", encoding="utf-8")
        with self.assertRaises(CredentialsError):
            load_credentials(broken)
        with self.assertRaises(CredentialsError):
            load_credentials(self.dir / "none.py")

    def test_redactor_hides_every_secret_even_inside_paths(self):
        credentials = load_credentials(self.settings())
        redact = Redactor(credentials.secrets())
        text = redact("login A123456789 key SECRETKEY123 cert CERTPASS999 path C:/x/A123456789.pfx")
        for secret in ("A123456789", "SECRETKEY123", "CERTPASS999"):
            self.assertNotIn(secret, text)
        self.assertIn("＊＊＊", text)
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'fubon_daily.credentials'`）

- [ ] **Step 3: 實作**

`tools/fubon-daily/fubon_daily/credentials.py`：

```python
"""Reads the Fubon login settings with ast; the settings file is never executed."""
from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MASK = "＊＊＊"


class CredentialsError(Exception):
    """The settings file is missing, unreadable, incomplete or kept in a disallowed place."""


@dataclass(frozen=True)
class Credentials:
    person_id: str
    api_key: str
    cert_path: str
    cert_password: str

    def secrets(self) -> list[str]:
        return [value for value in (self.person_id, self.api_key, self.cert_password) if value]


def inside_git_worktree(path: Path) -> bool:
    resolved = Path(path).resolve()
    return any((parent / ".git").exists() for parent in [resolved.parent, *resolved.parents])


def load_credentials(path: Path) -> Credentials:
    path = Path(path)
    if inside_git_worktree(path):
        raise CredentialsError("登入設定檔不可放在 Git 專案資料夾內")
    try:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise CredentialsError("找不到登入設定檔") from None
    except (OSError, SyntaxError, UnicodeDecodeError, ValueError):
        raise CredentialsError("無法讀取登入設定檔") from None
    values: dict[str, str] = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            values[node.targets[0].id] = node.value.value.strip()
    key = values.get("API_KEY") or values.get("SECRET_KEY") or ""
    missing = [name for name in ("PERSON_ID", "CERT_PATH", "CERT_PASSWORD") if not values.get(name)]
    if not key:
        missing.append("API_KEY 或 SECRET_KEY")
    if missing:
        raise CredentialsError("登入設定檔缺少：" + "、".join(missing))
    if not Path(values["CERT_PATH"]).is_file():
        raise CredentialsError("找不到憑證檔，請確認 CERT_PATH")
    return Credentials(values["PERSON_ID"], key, values["CERT_PATH"], values["CERT_PASSWORD"])


class Redactor:
    """Replaces every secret (longest first) with a mask before anything is written or shown."""

    def __init__(self, secrets: Iterable[str]):
        self._secrets = sorted({secret for secret in secrets if secret}, key=len, reverse=True)

    def __call__(self, text: object) -> str:
        result = str(text)
        for secret in self._secrets:
            result = result.replace(secret, MASK)
        return result
```

`.gitignore` 檔尾加入：

```
# Python bytecode from tools/fubon-daily.
__pycache__/
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: 7 tests OK

- [ ] **Step 5: 提交**

```bash
git add .gitignore tools/fubon-daily/fubon_daily/__init__.py tools/fubon-daily/fubon_daily/credentials.py tools/fubon-daily/tests/__init__.py tools/fubon-daily/tests/test_credentials.py
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: read Fubon login settings without executing them, with redaction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 驗證與格式轉換

**Files:**
- Create: `tools/fubon-daily/fubon_daily/normalize.py`
- Create: `tools/fubon-daily/tests/fixtures.py`
- Test: `tools/fubon-daily/tests/test_normalize.py`

**Interfaces:**
- Consumes: 無。
- Produces:
  - 常數 `TAIPEI`（`timezone(timedelta(hours=8))`）、`SESSION_OPEN_SECONDS = 32400`、`LAST_CONTINUOUS_T = 15840`、`CLOSING_AUCTION_T = 16200`
  - `class ValidationError(Exception)`，屬性 `kind: str`、`detail: str`
  - `@dataclass(frozen=True) class Listing: code: str; name: str; close: float | None; change: float | None; trade_volume: int; trade_value: float`
  - `minute_bars(payload: object, symbol: str, date: str) -> list[list[float]]`：每根是 `[t, open, high, low, close, volume, average]`
  - `snapshot_listing(payload: object) -> tuple[str, list[Listing]]`
  - `disposition_codes(payload: object) -> set[str]`
  - `daily_summary(payload: object, symbol: str, date: str) -> dict | None`：鍵為 `close`、`change`、`tradeVolume`（張）、`tradeValue`
  - `reference_price(close: float | None, change: float | None) -> float | None`
  - `symbol_warnings(code: str, bars: list[list[float]], trade_volume: int, close: float | None) -> list[dict]`
  - 測試資料 `tests/fixtures.py`：`DATE`、`stamp()`、`row()`、`full_day()`、`sparse_day()`、`quote()`、`snapshot()`、`daily()`、`DISPOSITION`

- [ ] **Step 1: 寫測試資料與失敗的測試**

`tools/fubon-daily/tests/fixtures.py`：

```python
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
```

`tools/fubon-daily/tests/test_normalize.py`：

```python
import copy
import unittest

from fubon_daily.normalize import (
    CLOSING_AUCTION_T,
    ValidationError,
    daily_summary,
    disposition_codes,
    minute_bars,
    reference_price,
    snapshot_listing,
    symbol_warnings,
)
from tests.fixtures import DATE, DISPOSITION, daily, full_day, quote, row, snapshot, sparse_day


class MinuteBarsTest(unittest.TestCase):
    def assertKind(self, payload, kind, symbol="2330"):
        with self.assertRaises(ValidationError) as caught:
            minute_bars(payload, symbol, DATE)
        self.assertEqual(caught.exception.kind, kind)

    def test_full_day_has_266_bars_ending_with_the_closing_auction(self):
        bars = minute_bars(full_day(), "2330", DATE)
        self.assertEqual(len(bars), 266)
        self.assertEqual(bars[0], [0, 100.0, 100.0, 100.0, 100.0, 10, 100.0])
        self.assertEqual(bars[-1][0], CLOSING_AUCTION_T)

    def test_sparse_day_without_a_closing_bar_is_valid(self):
        bars = minute_bars(sparse_day(), "1413", DATE)
        self.assertEqual([bar[0] for bar in bars], [660, 12900, 15120])

    def test_empty_data_is_valid_and_empty(self):
        self.assertEqual(minute_bars({"symbol": "2330", "data": []}, "2330", DATE), [])

    def test_structure_errors(self):
        self.assertKind([], "structure")
        self.assertKind({**full_day(), "symbol": "2317"}, "structure")
        self.assertKind({"symbol": "2330", "data": {}}, "structure")
        self.assertKind({"symbol": "2330", "data": ["x"]}, "structure")

    def test_time_errors(self):
        for bad in ("not a time", "2026-10-15T09:00:00.000+00:00", "2026-10-14T09:00:00.000+08:00",
                    "2026-10-15T13:27:00.000+08:00", "2026-10-15T08:59:00.000+08:00",
                    "2026-10-15T09:00:30.000+08:00"):
            payload = full_day()
            payload["data"][0]["date"] = bad
            self.assertKind(payload, "time")

    def test_order_errors(self):
        duplicate = full_day()
        duplicate["data"].insert(1, copy.deepcopy(duplicate["data"][0]))
        self.assertKind(duplicate, "order")
        backwards = full_day()
        backwards["data"].reverse()
        self.assertKind(backwards, "order")

    def test_price_errors(self):
        low_above_close = full_day()
        low_above_close["data"][0]["low"] = 101.0
        self.assertKind(low_above_close, "price")
        zero = full_day()
        zero["data"][0]["open"] = 0
        self.assertKind(zero, "price")

    def test_volume_and_average_errors(self):
        for field, value, kind in (("volume", 1.5, "volume"), ("volume", -1, "volume"), ("volume", True, "volume"),
                                   ("average", None, "average"), ("average", 0, "average")):
            payload = full_day()
            payload["data"][0][field] = value
            self.assertKind(payload, kind)


class SnapshotAndDailyTest(unittest.TestCase):
    def test_snapshot_listing_keeps_untraded_stocks_with_zero_volume(self):
        date, listings = snapshot_listing(snapshot())
        self.assertEqual(date, DATE)
        self.assertEqual([item.code for item in listings], ["2330", "1413", "9999"])
        self.assertEqual(listings[0].name, "台積電")
        self.assertIsNone(listings[2].close)
        self.assertEqual(listings[2].trade_volume, 0)

    def test_snapshot_volume_none_counts_as_zero(self):
        _, listings = snapshot_listing(snapshot(items=[quote("1101", "台泥", None, 0, None, None)]))
        self.assertEqual((listings[0].trade_volume, listings[0].trade_value), (0, 0))

    def test_bad_snapshot_is_a_structure_error(self):
        for bad in (None, {"date": DATE}, {"date": 1, "data": []}, {"date": DATE, "data": [{"symbol": 1}]}):
            with self.assertRaises(ValidationError):
                snapshot_listing(bad)

    def test_reference_price_is_close_minus_change(self):
        self.assertEqual(reference_price(27.3, 0.5), 26.8)
        self.assertEqual(reference_price(2440, -50), 2490)
        self.assertIsNone(reference_price(None, 1))

    def test_disposition_codes(self):
        self.assertEqual(disposition_codes(DISPOSITION), {"2424"})
        with self.assertRaises(ValidationError):
            disposition_codes({"data": "x"})

    def test_daily_summary_converts_shares_to_lots(self):
        self.assertEqual(daily_summary(daily("2330"), "2330", DATE),
                         {"close": 100.0, "change": 1.0, "tradeVolume": 1234, "tradeValue": 123_400_000})
        self.assertIsNone(daily_summary({"symbol": "2330", "data": []}, "2330", DATE))
        self.assertIsNone(daily_summary(daily("2330", date="2026-10-14"), "2330", DATE))


class WarningsTest(unittest.TestCase):
    def test_consistent_symbol_has_no_warnings(self):
        bars = minute_bars(full_day(price=2440), "2330", DATE)
        self.assertEqual(symbol_warnings("2330", bars, 58487, 2440), [])

    def test_volume_above_snapshot_and_close_mismatch_are_warnings(self):
        bars = minute_bars(full_day(price=2440), "2330", DATE)
        kinds = [warning["kind"] for warning in symbol_warnings("2330", bars, 10, 2435)]
        self.assertEqual(kinds, ["volume", "close"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: FAIL（`No module named 'fubon_daily.normalize'`）

- [ ] **Step 3: 實作**

`tools/fubon-daily/fubon_daily/normalize.py`：

```python
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
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: 全部 OK（Task 1 的 7 項加上本任務 16 項）

- [ ] **Step 5: 提交**

```bash
git add tools/fubon-daily/fubon_daily/normalize.py tools/fubon-daily/tests/fixtures.py tools/fubon-daily/tests/test_normalize.py
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: validate Fubon minute candles and snapshots into market-data formats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 存證、上架、狀態與執行鎖

**Files:**
- Create: `tools/fubon-daily/fubon_daily/store.py`
- Test: `tools/fubon-daily/tests/test_store.py`

**Interfaces:**
- Consumes: `Redactor`（Task 1）。
- Produces:
  - `class Locked(Exception)`
  - `process_alive(pid: int) -> bool`
  - `class MarketStore(root: Path, pid_alive: Callable[[int], bool] = process_alive)`，方法：
    - `set_redactor(redact: Callable[[object], str]) -> None`、`redact(text: object) -> str`
    - `has_day(date: str) -> bool`
    - `save_raw(date: str, kind: str, name: str | None, payload: object) -> None`、`load_raw(date: str, kind: str, name: str | None = None) -> object | None`
    - `discard_staging(date: str) -> None`
    - `publish_day(date: str, coverage: str, entries: list[dict], bars: dict[str, list], warnings: list[dict], excluded: int, published_at: datetime, source: str, version: str) -> dict`（回傳 manifest）
    - `write_run(run: dict) -> None`、`read_status() -> dict`
    - `log(date: str, message: str, at: datetime) -> None`
    - `prune(today: date, raw_days: int = 365, log_days: int = 90) -> None`
    - `lock(now: datetime)`（context manager；取不到時拋出 `Locked`）

- [ ] **Step 1: 寫失敗的測試**

`tools/fubon-daily/tests/test_store.py`：

```python
import gzip
import hashlib
import json
import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from fubon_daily.credentials import Redactor
from fubon_daily.normalize import TAIPEI
from fubon_daily.store import Locked, MarketStore
from tests.fixtures import DATE

NOW = datetime(2026, 10, 15, 17, 0, tzinfo=TAIPEI)
ENTRY = {"code": "2330", "name": "台積電", "referencePrice": 2490, "close": 2440, "change": -50,
         "tradeVolume": 58487, "tradeValue": 80781285000, "disposition": False, "bars": 2}
BARS = {"2330": [[0, 2420, 2435, 2420, 2435, 6446, 2420.92], [16200, 2440, 2440, 2440, 2440, 5833, 2437.47]]}


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.alive = {}
        self.store = MarketStore(self.root, pid_alive=lambda pid: self.alive.get(pid, False))

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, day=DATE, store=None):
        return (store or self.store).publish_day(day, "full-market", [ENTRY], BARS, [], 0, NOW,
                                                  "fubon-neo test", "abc123")

    def test_raw_payloads_round_trip_through_gzip(self):
        self.store.save_raw(DATE, "minute", "2330", {"symbol": "2330", "data": []})
        self.store.save_raw(DATE, "snapshot", None, {"date": DATE, "data": []})
        self.assertEqual(self.store.load_raw(DATE, "minute", "2330"), {"symbol": "2330", "data": []})
        self.assertIsNone(self.store.load_raw(DATE, "minute", "2317"))
        self.assertTrue((self.root / "staging" / DATE / "raw" / "minute" / "2330.json.gz").is_file())
        self.assertTrue((self.root / "staging" / DATE / "raw" / "snapshot.json.gz").is_file())

    def test_publish_moves_a_complete_day_and_its_raw_evidence(self):
        self.store.save_raw(DATE, "snapshot", None, {"date": DATE, "data": []})
        manifest = self.publish()
        day = self.root / "days" / DATE
        self.assertTrue(self.store.has_day(DATE))
        self.assertFalse((self.root / "staging" / DATE).exists())
        self.assertTrue((self.root / "raw" / DATE / "snapshot.json.gz").is_file())
        index = json.loads((day / "index.json").read_text(encoding="utf-8"))
        self.assertEqual((index["schema"], index["coverage"], index["volumeUnit"]), (1, "full-market", "lot"))
        self.assertEqual(index["symbols"], [ENTRY])
        symbol = json.loads(gzip.decompress((day / "symbols" / "2330.json.gz").read_bytes()))
        self.assertEqual(symbol, {"schema": 1, "code": "2330", "date": DATE, "volumeUnit": "lot", "bars": BARS["2330"]})
        for record in manifest["files"]:
            data = (day / record["path"]).read_bytes()
            self.assertEqual(record["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(record["bytes"], len(data))
        self.assertEqual(manifest["counts"], {"symbols": 1, "bars": 2, "excluded": 0})
        top = json.loads((self.root / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(top["days"], [{
            "date": DATE, "coverage": "full-market", "symbols": 1,
            "manifestSha256": hashlib.sha256((day / "manifest.json").read_bytes()).hexdigest(),
            "publishedAt": NOW.isoformat(timespec="seconds"),
        }])

    def test_publishing_the_same_day_twice_is_refused(self):
        self.publish()
        with self.assertRaises(FileExistsError):
            self.publish()

    def test_top_index_keeps_days_in_date_order(self):
        self.publish("2026-10-16")
        self.publish("2026-10-15")
        top = json.loads((self.root / "index.json").read_text(encoding="utf-8"))
        self.assertEqual([entry["date"] for entry in top["days"]], ["2026-10-15", "2026-10-16"])

    def test_prune_removes_old_raw_and_logs_but_keeps_lessons(self):
        for path in ("raw/2025-10-01", "raw/2026-10-01", "days/2025-10-01", "logs"):
            (self.root / path).mkdir(parents=True, exist_ok=True)
        (self.root / "logs" / "2026-06-01.log").write_text("old", encoding="utf-8")
        (self.root / "logs" / "2026-10-01.log").write_text("new", encoding="utf-8")
        self.store.prune(date(2026, 10, 16))
        self.assertFalse((self.root / "raw" / "2025-10-01").exists())
        self.assertTrue((self.root / "raw" / "2026-10-01").exists())
        self.assertTrue((self.root / "days" / "2025-10-01").exists())
        self.assertFalse((self.root / "logs" / "2026-06-01.log").exists())
        self.assertTrue((self.root / "logs" / "2026-10-01.log").exists())

    def test_lock_is_exclusive_while_its_owner_runs(self):
        self.alive[os.getpid()] = True
        with self.store.lock(NOW):
            with self.assertRaises(Locked):
                with MarketStore(self.root, pid_alive=lambda pid: True).lock(NOW):
                    pass
        self.assertFalse((self.root / ".lock").exists())

    def test_stale_lock_is_taken_over(self):
        self.root.mkdir(parents=True)
        (self.root / ".lock").write_text(json.dumps({"pid": 424242, "startedAt": "x"}), encoding="utf-8")
        with self.store.lock(NOW):
            self.assertEqual(json.loads((self.root / ".lock").read_text(encoding="utf-8"))["pid"], os.getpid())

    def run_record(self, day, outcome="ok", reason=None):
        return {"date": day, "mode": "daily", "startedAt": "s", "finishedAt": "f", "outcome": outcome,
                "reason": reason, "symbols": {"total": 1, "fetched": 1, "failed": 0, "excluded": 0}}

    def test_status_keeps_the_last_30_finished_runs_and_the_latest_day(self):
        self.publish()
        for day in range(1, 36):
            self.store.write_run(self.run_record(f"2026-09-{day:02d}" if day <= 30 else f"2026-10-{day - 30:02d}"))
        self.store.write_run(self.run_record("2026-10-06", outcome="running"))
        status = self.store.read_status()
        self.assertEqual(len(status["history"]), 30)
        self.assertEqual(status["history"][-1]["date"], "2026-10-05")
        self.assertEqual(status["lastRun"]["outcome"], "running")
        self.assertEqual(status["latestDay"], DATE)

    def test_status_and_logs_are_redacted(self):
        self.store.set_redactor(Redactor(["SECRET1"]))
        self.store.write_run(self.run_record(DATE, outcome="failed", reason="登入失敗 SECRET1"))
        self.store.log(DATE, "連線 SECRET1", NOW)
        for path in (self.root / "status.json", self.root / "logs" / f"{DATE}.log"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("SECRET1", text)
            self.assertIn("＊＊＊", text)

    def test_discard_staging_removes_a_closed_day(self):
        self.store.save_raw(DATE, "snapshot", None, {"date": "2026-10-14", "data": []})
        self.store.discard_staging(DATE)
        self.assertFalse((self.root / "staging" / DATE).exists())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: FAIL（`No module named 'fubon_daily.store'`）

- [ ] **Step 3: 實作**

`tools/fubon-daily/fubon_daily/store.py`：

```python
"""market-data on disk: raw evidence, atomic day publishing, status, logs, retention and the run lock."""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Callable

DAY_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HISTORY_LIMIT = 30


class Locked(Exception):
    """Another fetch still holds the run lock."""


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _json_bytes(value: object, indent: int | None = None) -> bytes:
    separators = None if indent else (",", ":")
    return json.dumps(value, ensure_ascii=False, sort_keys=indent is None, indent=indent,
                      separators=separators).encode("utf-8")


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


class MarketStore:
    def __init__(self, root: Path, pid_alive: Callable[[int], bool] = process_alive):
        self.root = Path(root)
        self._pid_alive = pid_alive
        self._redact: Callable[[object], str] = str

    # Secrets never reach the disk: status and logs pass through the redactor.
    def set_redactor(self, redact: Callable[[object], str]) -> None:
        self._redact = redact

    def redact(self, text: object) -> str:
        return self._redact(text)

    def has_day(self, day: str) -> bool:
        return (self.root / "days" / day / "manifest.json").is_file()

    def _raw_path(self, day: str, kind: str, name: str | None) -> Path:
        base = self.root / "staging" / day / "raw"
        return base / f"{kind}.json.gz" if name is None else base / kind / f"{name}.json.gz"

    def save_raw(self, day: str, kind: str, name: str | None, payload: object) -> None:
        _write_atomic(self._raw_path(day, kind, name), gzip.compress(_json_bytes(payload), mtime=0))

    def load_raw(self, day: str, kind: str, name: str | None = None) -> object | None:
        path = self._raw_path(day, kind, name)
        if not path.is_file():
            return None
        return json.loads(gzip.decompress(path.read_bytes()))

    def discard_staging(self, day: str) -> None:
        shutil.rmtree(self.root / "staging" / day, ignore_errors=True)

    def publish_day(self, day: str, coverage: str, entries: list[dict], bars: dict[str, list],
                    warnings: list[dict], excluded: int, published_at: datetime, source: str,
                    version: str) -> dict:
        target = self.root / "days" / day
        if target.exists():
            raise FileExistsError(day)
        staging = self.root / "staging" / day / "day"
        shutil.rmtree(staging, ignore_errors=True)
        (staging / "symbols").mkdir(parents=True)
        files = []

        def put(relative: str, data: bytes) -> None:
            (staging / relative).write_bytes(data)
            files.append({"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

        stamp = published_at.isoformat(timespec="seconds")
        put("index.json", _json_bytes({"schema": 1, "date": day, "coverage": coverage, "volumeUnit": "lot",
                                       "source": source, "fetchedAt": stamp, "symbols": entries}, indent=1))
        for code in sorted(bars):
            payload = {"schema": 1, "code": code, "date": day, "volumeUnit": "lot", "bars": bars[code]}
            put(f"symbols/{code}.json.gz", gzip.compress(_json_bytes(payload), mtime=0))
        manifest = {"schema": 1, "date": day, "coverage": coverage, "createdAt": stamp, "version": version,
                    "counts": {"symbols": len(entries), "bars": sum(len(rows) for rows in bars.values()),
                               "excluded": excluded},
                    "warnings": warnings, "files": files}
        manifest_bytes = _json_bytes(manifest, indent=1)
        (staging / "manifest.json").write_bytes(manifest_bytes)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staging, target)
        raw = self.root / "staging" / day / "raw"
        if raw.exists():
            (self.root / "raw").mkdir(parents=True, exist_ok=True)
            os.replace(raw, self.root / "raw" / day)
        self.discard_staging(day)
        self._update_index({"date": day, "coverage": coverage, "symbols": len(entries),
                            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "publishedAt": stamp})
        return manifest

    def _read_json(self, name: str, default: dict) -> dict:
        path = self.root / name
        if not path.is_file():
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))

    def _update_index(self, entry: dict) -> None:
        index = self._read_json("index.json", {"schema": 1, "days": []})
        days = [day for day in index["days"] if day["date"] != entry["date"]] + [entry]
        index["days"] = sorted(days, key=lambda day: day["date"])
        _write_atomic(self.root / "index.json", _json_bytes(index, indent=1))

    def read_status(self) -> dict:
        return self._read_json("status.json", {"schema": 1, "latestDay": None, "lastRun": None, "history": []})

    def write_run(self, run: dict) -> None:
        status = self.read_status()
        status["lastRun"] = run
        if run["outcome"] != "running":
            status["history"] = (status["history"] + [{"date": run["date"], "outcome": run["outcome"],
                                                       "finishedAt": run["finishedAt"]}])[-HISTORY_LIMIT:]
        days = self._read_json("index.json", {"schema": 1, "days": []})["days"]
        status["latestDay"] = days[-1]["date"] if days else None
        text = self.redact(json.dumps(status, ensure_ascii=False, indent=1))
        _write_atomic(self.root / "status.json", text.encode("utf-8"))

    def log(self, day: str, message: str, at: datetime) -> None:
        path = self.root / "logs" / f"{day}.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"{at:%Y-%m-%d %H:%M:%S} {self.redact(message)}\n")

    def prune(self, today: date, raw_days: int = 365, log_days: int = 90) -> None:
        def age(name: str) -> int | None:
            return (today - date.fromisoformat(name)).days if DAY_NAME.match(name) else None

        raw = self.root / "raw"
        if raw.is_dir():
            for entry in raw.iterdir():
                days_old = age(entry.name)
                if entry.is_dir() and days_old is not None and days_old > raw_days:
                    shutil.rmtree(entry)
        logs = self.root / "logs"
        if logs.is_dir():
            for entry in logs.glob("*.log"):
                days_old = age(entry.stem)
                if days_old is not None and days_old > log_days:
                    entry.unlink()

    @contextlib.contextmanager
    def lock(self, now: datetime):
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / ".lock"
        for attempt in range(2):
            try:
                handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                break
            except FileExistsError:
                try:
                    pid = int(json.loads(path.read_text(encoding="utf-8")).get("pid", 0))
                except (OSError, ValueError, AttributeError):
                    pid = 0
                if attempt == 1 or self._pid_alive(pid):
                    raise Locked() from None
                path.unlink(missing_ok=True)
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump({"pid": os.getpid(), "startedAt": now.isoformat(timespec="seconds")}, stream)
        try:
            yield
        finally:
            path.unlink(missing_ok=True)
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: 全部 OK

- [ ] **Step 5: 提交**

```bash
git add tools/fubon-daily/fubon_daily/store.py tools/fubon-daily/tests/test_store.py
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: market-data store with atomic publishing, status, retention and run lock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 富邦連線轉接層與 Windows 通知

**Files:**
- Create: `tools/fubon-daily/fubon_daily/client.py`
- Create: `tools/fubon-daily/fubon_daily/notify.py`
- Test: `tools/fubon-daily/tests/test_client.py`
- Test: `tools/fubon-daily/tests/test_notify.py`

**Interfaces:**
- Consumes: `Credentials`（Task 1）。
- Produces:
  - 例外 `ApiError(message: str, status: int | None)`，以及它的子類 `RateLimited`、`NotFound`；另有 `LoginError`、`SdkUnavailable`。
  - `class FubonClient(credentials: Credentials, sdk_factory: Callable[[], object] = default_sdk)`，方法 `login()`、`snapshot_quotes() -> dict`、`disposition_list() -> dict`、`minute_candles(symbol: str, date: str) -> dict`、`daily_candle(symbol: str, date: str) -> dict`、`logout()`。
  - `sdk_version() -> str`
  - `notify(title: str, body: str, runner=subprocess.run) -> bool`

- [ ] **Step 1: 寫失敗的測試**

`tools/fubon-daily/tests/test_client.py`：

```python
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
    def __init__(self, ok=True, failure=None):
        self.ok = ok
        self.failure = failure
        self.login_args = None
        self.realtime = False
        self.requests = []
        rest = SimpleNamespace(
            snapshot=SimpleNamespace(quotes=lambda **kw: self.answer("quotes", kw)),
            intraday=SimpleNamespace(tickers=lambda **kw: self.answer("tickers", kw)),
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
        return SimpleNamespace(is_success=self.ok, message="bad key", data=["ACCOUNT-OBJECT"])

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
        self.assertEqual(sdk.requests, [
            ("quotes", {"market": "TSE", "type": "COMMONSTOCK"}),
            ("tickers", {"type": "EQUITY", "exchange": "TWSE", "isDisposition": True}),
            ("candles", {"symbol": "2330", "from": "2026-10-15", "to": "2026-10-15", "timeframe": "1",
                         "fields": "open,high,low,close,volume,average", "sort": "asc"}),
            ("candles", {"symbol": "2330", "from": "2026-10-05", "to": "2026-10-05",
                         "fields": "open,high,low,close,volume,turnover,change"}),
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


if __name__ == "__main__":
    unittest.main()
```

`tools/fubon-daily/tests/test_notify.py`：

```python
import unittest

from fubon_daily.notify import notify


class NotifyTest(unittest.TestCase):
    def test_text_travels_in_the_environment_not_the_command_line(self):
        calls = []
        self.assertTrue(notify("標題", "內容 <b>&", runner=lambda args, **kw: calls.append((args, kw))))
        args, kwargs = calls[0]
        self.assertEqual(args[0], "powershell.exe")
        self.assertNotIn("內容", " ".join(args))
        self.assertEqual(kwargs["env"]["DTT_TOAST_TITLE"], "標題")
        self.assertEqual(kwargs["env"]["DTT_TOAST_BODY"], "內容 <b>&")

    def test_failures_return_false(self):
        def broken(args, **kwargs):
            raise OSError("no powershell")

        self.assertFalse(notify("t", "b", runner=broken))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: FAIL（`No module named 'fubon_daily.client'`）

- [ ] **Step 3: 實作**

`tools/fubon-daily/fubon_daily/client.py`：

```python
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
```

`tools/fubon-daily/fubon_daily/notify.py`：

```python
"""Windows toast through PowerShell's built-in WinRT API; text travels in environment variables."""
from __future__ import annotations

import os
import subprocess

TOAST = r"""
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName('text')
[void]$texts.Item(0).AppendChild($template.CreateTextNode($env:DTT_TOAST_TITLE))
[void]$texts.Item(1).AppendChild($template.CreateTextNode($env:DTT_TOAST_BODY))
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($template))
"""


def notify(title: str, body: str, runner=subprocess.run) -> bool:
    env = {**os.environ, "DTT_TOAST_TITLE": title, "DTT_TOAST_BODY": body}
    try:
        runner(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", TOAST], env=env, check=True,
               timeout=30, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return True
    except Exception:  # noqa: BLE001 - a missing toast must never fail the fetch
        return False
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: 全部 OK

- [ ] **Step 5: 提交**

```bash
git add tools/fubon-daily/fubon_daily/client.py tools/fubon-daily/fubon_daily/notify.py tools/fubon-daily/tests/test_client.py tools/fubon-daily/tests/test_notify.py
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: Fubon market-data client adapter and Windows failure toast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 每日流程與命令列

**Files:**
- Create: `tools/fubon-daily/fubon_daily/pipeline.py`
- Create: `tools/fubon-daily/fubon_daily/cli.py`
- Create: `tools/fubon-daily/fetch_daily.py`
- Test: `tools/fubon-daily/tests/test_pipeline.py`
- Test: `tools/fubon-daily/tests/test_cli.py`

**Interfaces:**
- Consumes: Task 1–4 的全部公開名稱。
- Produces:
  - `@dataclass class Options: data: Path; credentials: Path; date: str | None = None; symbols: list[str] | None = None; last_attempt: bool = False`
  - `@dataclass class Runtime: make_client; now; monotonic; sleep; notify; version: str = "dev"; source: str = "fubon-neo historical/candles timeframe=1"`
  - `run(options: Options, runtime: Runtime, store: MarketStore | None = None) -> int`
  - `cli.parse_args(argv: list[str] | None) -> argparse.Namespace`、`cli.main(argv: list[str] | None = None) -> int`

- [ ] **Step 1: 寫失敗的測試**

`tools/fubon-daily/tests/test_pipeline.py`：

```python
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from fubon_daily.client import ApiError, LoginError, NotFound, RateLimited
from fubon_daily.normalize import TAIPEI
from fubon_daily.pipeline import Options, Runtime, run
from fubon_daily.store import MarketStore
from tests.fixtures import DATE, DISPOSITION, daily, full_day, quote, snapshot, sparse_day

SECRETS = ("A123456789", "SECRETKEY123", "CERTPASS999")
AFTERNOON = datetime(2026, 10, 15, 16, 45, tzinfo=TAIPEI)
EVENING = datetime(2026, 10, 15, 19, 0, tzinfo=TAIPEI)


class FakeClient:
    def __init__(self, snapshot_payload=None, minutes=None, dailies=None, login_error=None):
        self.snapshot_payload = snapshot() if snapshot_payload is None else snapshot_payload
        self.minutes = minutes or {}
        self.dailies = dailies or {}
        self.login_error = login_error
        self.calls = []

    @staticmethod
    def take(table, symbol):
        value = table[symbol]
        if isinstance(value, list):
            value = value.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    def login(self):
        self.calls.append("login")
        if self.login_error:
            raise self.login_error

    def snapshot_quotes(self):
        self.calls.append("snapshot")
        return self.snapshot_payload

    def disposition_list(self):
        self.calls.append("disposition")
        return DISPOSITION

    def minute_candles(self, symbol, date):
        self.calls.append(("minute", symbol))
        return self.take(self.minutes, symbol)

    def daily_candle(self, symbol, date):
        self.calls.append(("daily", symbol))
        return self.take(self.dailies, symbol)

    def logout(self):
        self.calls.append("logout")


class Clock:
    def __init__(self, now):
        self.current = now
        self.mono = 0.0
        self.sleeps = []

    def now(self):
        return self.current

    def monotonic(self):
        return self.mono

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.mono += seconds


def good_minutes():
    return {"2330": full_day("2330", price=2440), "1413": sparse_day()}


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.data = base / "market-data"
        cert = base / "A123456789.pfx"
        cert.write_bytes(b"cert")
        self.credentials = base / "credentials.local.py"
        self.credentials.write_text(
            f"PERSON_ID = 'A123456789'\nSECRET_KEY = 'SECRETKEY123'\nCERT_PATH = {str(cert)!r}\nCERT_PASSWORD = 'CERTPASS999'\n",
            encoding="utf-8")
        self.notices = []

    def tearDown(self):
        self.temp.cleanup()

    def run_once(self, client, at=AFTERNOON, alive=False, **options):
        self.clock = Clock(at)
        runtime = Runtime(make_client=lambda credentials: client, now=self.clock.now,
                          monotonic=self.clock.monotonic, sleep=self.clock.sleep,
                          notify=lambda title, body: self.notices.append((title, body)) or True)
        store = MarketStore(self.data, pid_alive=lambda pid: alive)
        return run(Options(data=self.data, credentials=self.credentials, **options), runtime, store)

    def status(self):
        return json.loads((self.data / "status.json").read_text(encoding="utf-8"))

    def day_index(self, day=DATE):
        return json.loads((self.data / "days" / day / "index.json").read_text(encoding="utf-8"))

    def assertNoSecretsOnDisk(self):
        for path in self.data.rglob("*"):
            if path.is_file() and path.suffix != ".gz":
                text = path.read_text(encoding="utf-8")
                for secret in SECRETS:
                    self.assertNotIn(secret, text, str(path))

    def test_publishes_a_complete_day(self):
        client = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(client), 0)
        last = self.status()["lastRun"]
        self.assertEqual(last["outcome"], "ok")
        self.assertEqual(last["symbols"], {"total": 2, "fetched": 2, "failed": 0, "excluded": 0})
        index = self.day_index()
        self.assertEqual([entry["code"] for entry in index["symbols"]], ["2330", "1413"])
        self.assertEqual(index["symbols"][0], {"code": "2330", "name": "台積電", "referencePrice": 2490, "close": 2440,
                                               "change": -50, "tradeVolume": 58487, "tradeValue": 80781285000,
                                               "disposition": False, "bars": 266})
        self.assertNotIn(("minute", "9999"), client.calls)
        self.assertEqual(client.calls[-1], "logout")
        self.assertEqual(self.notices, [])
        self.assertEqual(self.clock.sleeps, [1.1, 1.1, 1.1])
        self.assertNoSecretsOnDisk()

    def test_holiday_is_recorded_as_closed(self):
        client = FakeClient(snapshot_payload=snapshot(date="2026-10-14"), minutes=good_minutes())
        self.assertEqual(self.run_once(client), 0)
        status = self.status()
        self.assertEqual(status["lastRun"]["outcome"], "closed")
        self.assertEqual(status["history"][-1], {"date": DATE, "outcome": "closed",
                                                 "finishedAt": status["lastRun"]["finishedAt"]})
        self.assertFalse((self.data / "days").exists())
        self.assertFalse((self.data / "staging" / DATE).exists())

    def test_waits_when_fubon_history_is_not_updated_yet(self):
        client = FakeClient(minutes={"2330": sparse_day("2330"), "1413": sparse_day()})
        self.assertEqual(self.run_once(client), 1)
        self.assertIn("尚未更新", self.status()["lastRun"]["reason"])
        self.assertFalse((self.data / "days").exists())
        self.assertEqual(self.notices, [])

    def test_the_last_attempt_of_the_day_notifies_on_failure(self):
        client = FakeClient(minutes={"2330": sparse_day("2330"), "1413": sparse_day()})
        self.assertEqual(self.run_once(client, at=EVENING), 1)
        self.assertEqual(len(self.notices), 1)
        self.assertEqual(self.notices[0][0], "當沖大富翁每日行情")

    def test_rate_limit_waits_a_minute_then_retries(self):
        minutes = good_minutes()
        minutes["2330"] = [RateLimited("429", 429), full_day("2330", price=2440)]
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 0)
        self.assertIn(60, self.clock.sleeps)

    def test_api_failure_after_retries_fails_the_run(self):
        minutes = good_minutes()
        minutes["1413"] = [ApiError("500", 500), ApiError("500", 500), ApiError("500", 500)]
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 1)
        self.assertIn("抓取中斷", self.status()["lastRun"]["reason"])
        self.assertEqual(self.clock.sleeps.count(2), 2)

    def test_invalid_symbol_blocks_the_day_and_resume_refetches_only_missing(self):
        bad = sparse_day()
        bad["data"].append(dict(bad["data"][-1]))
        minutes = good_minutes()
        minutes["1413"] = bad
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 1)
        self.assertIn("1413", self.status()["lastRun"]["reason"])
        self.assertFalse((self.data / "days").exists())
        second = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(second), 0)
        self.assertIn(("minute", "1413"), second.calls)
        self.assertNotIn(("minute", "2330"), second.calls)

    def test_symbol_without_minutes_is_excluded_with_a_warning(self):
        minutes = good_minutes()
        minutes["1413"] = NotFound("404", 404)
        self.assertEqual(self.run_once(FakeClient(minutes=minutes)), 0)
        self.assertEqual([entry["code"] for entry in self.day_index()["symbols"]], ["2330"])
        manifest = json.loads((self.data / "days" / DATE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([warning["kind"] for warning in manifest["warnings"]], ["empty"])
        self.assertEqual(self.status()["lastRun"]["symbols"]["excluded"], 1)

    def test_already_done_skips_login(self):
        self.assertEqual(self.run_once(FakeClient(minutes=good_minutes())), 0)
        again = FakeClient(login_error=LoginError("should not log in"))
        self.assertEqual(self.run_once(again), 0)
        self.assertEqual(again.calls, [])
        self.assertEqual(self.status()["lastRun"]["outcome"], "already-done")

    def test_login_failure_is_fatal_notified_and_redacted(self):
        client = FakeClient(login_error=LoginError("登入失敗：A123456789 SECRETKEY123 CERTPASS999 無效"))
        self.assertEqual(self.run_once(client), 2)
        self.assertEqual(len(self.notices), 1)
        for secret in SECRETS:
            self.assertNotIn(secret, self.notices[0][1])
        self.assertEqual(self.status()["lastRun"]["outcome"], "failed")
        self.assertNoSecretsOnDisk()

    def test_bad_settings_file_is_fatal_and_notified(self):
        self.credentials.write_text("PERSON_ID = 'A123456789'\n", encoding="utf-8")
        self.assertEqual(self.run_once(FakeClient()), 2)
        self.assertIn("CERT_PASSWORD", self.status()["lastRun"]["reason"])
        self.assertEqual(len(self.notices), 1)

    def test_backfill_selected_symbols_uses_daily_candles(self):
        past = "2026-10-05"
        client = FakeClient(
            snapshot_payload=snapshot(date="2026-10-16"),
            minutes={"2330": full_day("2330", date=past, price=2440)},
            dailies={"2330": daily("2330", date=past, close=2440, change=-50, volume=58_487_000,
                                   turnover=80_781_285_000)})
        at = datetime(2026, 10, 16, 20, 0, tzinfo=TAIPEI)
        self.assertEqual(self.run_once(client, at=at, date=past, symbols=["2330"]), 0)
        index = self.day_index(past)
        self.assertEqual(index["coverage"], "selected")
        self.assertEqual(index["symbols"][0]["referencePrice"], 2490)
        self.assertEqual(index["symbols"][0]["tradeVolume"], 58487)
        self.assertIsNone(index["symbols"][0]["disposition"])
        self.assertNotIn("disposition", client.calls)

    def test_backfill_unknown_symbol_fails_clearly(self):
        client = FakeClient(snapshot_payload=snapshot(date="2026-10-16"))
        at = datetime(2026, 10, 16, 20, 0, tzinfo=TAIPEI)
        self.assertEqual(self.run_once(client, at=at, date="2026-10-05", symbols=["0000"]), 1)
        self.assertIn("0000", self.status()["lastRun"]["reason"])

    def test_a_running_fetch_is_left_alone(self):
        self.data.mkdir(parents=True)
        (self.data / ".lock").write_text(json.dumps({"pid": 1234, "startedAt": "x"}), encoding="utf-8")
        client = FakeClient(minutes=good_minutes())
        self.assertEqual(self.run_once(client, alive=True), 0)
        self.assertEqual(client.calls, [])
        self.assertFalse((self.data / "status.json").exists())


if __name__ == "__main__":
    unittest.main()
```

`tools/fubon-daily/tests/test_cli.py`：

```python
import unittest
from datetime import date, timedelta

from fubon_daily.cli import parse_args


class CliTest(unittest.TestCase):
    def test_required_paths_and_defaults(self):
        args = parse_args(["--data", "md", "--credentials", "c.py"])
        self.assertEqual((args.data.name, args.date, args.symbols, args.last_attempt), ("md", None, None, False))

    def test_symbols_need_a_date(self):
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--symbols", "2330"])

    def test_dates_must_be_valid_and_not_in_the_future(self):
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--date", "2026-13-01"])
        future = (date.today() + timedelta(days=2)).isoformat()
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--date", future])

    def test_symbols_are_split_and_trimmed(self):
        args = parse_args(["--data", "d", "--credentials", "c", "--date", "2026-10-05", "--symbols", "2330, 2317"])
        self.assertEqual(args.symbols, ["2330", "2317"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: FAIL（`No module named 'fubon_daily.pipeline'`）

- [ ] **Step 3: 實作流程**

`tools/fubon-daily/fubon_daily/pipeline.py`：

```python
"""One fetch run: lock, login, snapshot, minute candles, validation, publishing and the status report."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from .client import ApiError, LoginError, NotFound, RateLimited, SdkUnavailable
from .credentials import CredentialsError, Redactor, load_credentials
from .normalize import (CLOSING_AUCTION_T, TAIPEI, ValidationError, daily_summary, disposition_codes,
                        minute_bars, reference_price, snapshot_listing, symbol_warnings)
from .notify import notify as windows_notify
from .store import Locked, MarketStore

CALL_SPACING = 1.1
RATE_LIMIT_WAIT = 60
ERROR_WAIT = 2
ATTEMPTS = 3
LAST_ATTEMPT_AFTER = (18, 50)
NOTIFY_TITLE = "當沖大富翁每日行情"


@dataclass
class Options:
    data: Path
    credentials: Path
    date: str | None = None
    symbols: list[str] | None = None
    last_attempt: bool = False


@dataclass
class Runtime:
    make_client: Callable
    now: Callable[[], datetime] = field(default=lambda: datetime.now(TAIPEI))
    monotonic: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    notify: Callable[[str, str], bool] = windows_notify
    version: str = "dev"
    source: str = "fubon-neo historical/candles timeframe=1"


@dataclass
class Report:
    date: str
    mode: str
    started: datetime
    total: int = 0
    fetched: int = 0
    failed: int = 0
    excluded: int = 0

    def record(self, outcome: str, reason: str | None, finished: datetime | None) -> dict:
        return {"date": self.date, "mode": self.mode, "startedAt": self.started.isoformat(timespec="seconds"),
                "finishedAt": finished.isoformat(timespec="seconds") if finished else None,
                "outcome": outcome, "reason": reason,
                "symbols": {"total": self.total, "fetched": self.fetched, "failed": self.failed,
                            "excluded": self.excluded}}


class Pacer:
    """Keeps at least CALL_SPACING seconds between Fubon calls (historical limit: 60 per minute)."""

    def __init__(self, runtime: Runtime):
        self.runtime = runtime
        self.last: float | None = None

    def wait(self) -> None:
        if self.last is not None:
            remaining = CALL_SPACING - (self.runtime.monotonic() - self.last)
            if remaining > 0:
                self.runtime.sleep(remaining)
        self.last = self.runtime.monotonic()


def fetch(pacer: Pacer, runtime: Runtime, request: Callable[[], object]) -> object | None:
    """Up to three attempts; HTTP 429 waits a minute; 404 means no regular-session data (None)."""
    for attempt in range(ATTEMPTS):
        pacer.wait()
        try:
            return request()
        except NotFound:
            return None
        except RateLimited:
            if attempt == ATTEMPTS - 1:
                raise
            runtime.sleep(RATE_LIMIT_WAIT)
        except ApiError:
            if attempt == ATTEMPTS - 1:
                raise
            runtime.sleep(ERROR_WAIT)
    return None


class Run:
    def __init__(self, options: Options, runtime: Runtime, store: MarketStore):
        self.options = options
        self.runtime = runtime
        self.store = store
        self.started = runtime.now()
        self.target = options.date or self.started.date().isoformat()
        self.mode = "backfill" if options.date else "daily"
        self.last_attempt = options.last_attempt or (self.started.hour, self.started.minute) >= LAST_ATTEMPT_AFTER
        self.report = Report(self.target, self.mode, self.started)

    def log(self, message: str) -> None:
        self.store.log(self.target, message, self.runtime.now())

    def finish(self, outcome: str, reason: str | None = None, code: int = 0, urgent: bool = False) -> int:
        self.store.write_run(self.report.record(outcome, reason, self.runtime.now()))
        self.log(f"結果：{outcome}" + (f"：{reason}" if reason else ""))
        if outcome == "failed" and (urgent or self.last_attempt):
            self.runtime.notify(NOTIFY_TITLE, self.store.redact(f"{self.target} 每日行情抓取失敗：{reason}"))
        return code

    def execute(self) -> int:
        if self.store.has_day(self.target):
            return self.finish("already-done")
        self.store.write_run(self.report.record("running", None, None))
        self.log(f"開始（{self.mode}）")
        try:
            credentials = load_credentials(self.options.credentials)
        except CredentialsError as error:
            return self.finish("failed", str(error), 2, urgent=True)
        self.store.set_redactor(Redactor(credentials.secrets()))
        client = self.runtime.make_client(credentials)
        try:
            try:
                client.login()
            except (LoginError, SdkUnavailable) as error:
                return self.finish("failed", str(error), 2, urgent=True)
            try:
                return self.fetch_day(client, Pacer(self.runtime))
            except (ApiError, ValidationError) as error:
                return self.finish("failed", f"抓取中斷：{error}", 1)
        finally:
            client.logout()

    def candidates(self, client, pacer: Pacer) -> list[dict] | int:
        snapshot = fetch(pacer, self.runtime, client.snapshot_quotes)
        self.store.save_raw(self.target, "snapshot", None, snapshot)
        snapshot_date, listings = snapshot_listing(snapshot)
        if self.mode == "daily":
            if snapshot_date != self.target:
                self.store.discard_staging(self.target)
                return self.finish("closed", f"{self.target} 休市")
            disposition = fetch(pacer, self.runtime, client.disposition_list)
            self.store.save_raw(self.target, "disposition", None, disposition)
            flagged = disposition_codes(disposition)
            return [{"code": item.code, "name": item.name, "referencePrice": reference_price(item.close, item.change),
                     "close": item.close, "change": item.change, "tradeVolume": item.trade_volume,
                     "tradeValue": item.trade_value, "disposition": item.code in flagged}
                    for item in listings if item.trade_volume > 0]
        wanted = self.options.symbols
        names = {item.code: item.name for item in listings}
        unknown = [code for code in (wanted or []) if code not in names]
        if unknown:
            return self.finish("failed", "今日上市清單找不到：" + "、".join(unknown), 1)
        result = []
        for code in wanted or list(names):
            summary = self.store.load_raw(self.target, "daily", code)
            if summary is None:
                summary = fetch(pacer, self.runtime, lambda: client.daily_candle(code, self.target))
                if summary is not None:
                    self.store.save_raw(self.target, "daily", code, summary)
            day = daily_summary(summary, code, self.target) if summary is not None else None
            if day is None:
                self.report.excluded += 1
                continue
            result.append({"code": code, "name": names[code],
                           "referencePrice": reference_price(day["close"], day["change"]), "close": day["close"],
                           "change": day["change"], "tradeVolume": day["tradeVolume"],
                           "tradeValue": day["tradeValue"], "disposition": None})
        return result

    def fetch_day(self, client, pacer: Pacer) -> int:
        candidates = self.candidates(client, pacer)
        if isinstance(candidates, int):
            return candidates
        candidates.sort(key=lambda entry: entry["tradeValue"] or 0, reverse=True)
        self.report.total = len(candidates)
        if not candidates:
            return self.finish("failed", "沒有任何有成交的股票", 1)
        bars_by_code: dict[str, list] = {}
        warnings: list[dict] = []
        errors: list[str] = []
        for position, entry in enumerate(candidates):
            code = entry["code"]
            payload = self.store.load_raw(self.target, "minute", code)
            fresh = payload is None
            if fresh:
                payload = fetch(pacer, self.runtime, lambda: client.minute_candles(code, self.target))
            bars: list = []
            if payload is not None:
                try:
                    bars = minute_bars(payload, code, self.target)
                except ValidationError as error:
                    errors.append(f"{code}（{error.kind}）")
                    self.report.failed += 1
                    self.log(f"{code} 未通過檢查：{error}")
                    continue
                if fresh:
                    self.store.save_raw(self.target, "minute", code, payload)
            if self.mode == "daily" and position == 0 and (not bars or bars[-1][0] != CLOSING_AUCTION_T):
                return self.finish("failed", "富邦歷史資料尚未更新（成交值第一名缺少 13:30 收盤 K 棒）", 1)
            if not bars:
                warnings.append({"code": code, "kind": "empty", "detail": "有成交量，但沒有盤中 1 分 K"})
                self.report.excluded += 1
                continue
            bars_by_code[code] = bars
            self.report.fetched += 1
            warnings.extend(symbol_warnings(code, bars, entry["tradeVolume"], entry["close"]))
        if errors:
            return self.finish("failed", f"{len(errors)} 檔資料未通過檢查：" + "、".join(errors[:5]), 1)
        entries = [{**entry, "bars": len(bars_by_code[entry["code"]])} for entry in candidates
                   if entry["code"] in bars_by_code]
        coverage = "selected" if self.options.symbols else "full-market"
        self.store.publish_day(self.target, coverage, entries, bars_by_code, warnings, self.report.excluded,
                               self.runtime.now(), self.runtime.source, self.runtime.version)
        self.store.prune(self.started.date())
        return self.finish("ok")


def run(options: Options, runtime: Runtime, store: MarketStore | None = None) -> int:
    store = store or MarketStore(options.data)
    started = runtime.now()
    target = options.date or started.date().isoformat()
    try:
        with store.lock(started):
            return Run(options, runtime, store).execute()
    except Locked:
        store.log(target, "上一個工作仍在執行，這次略過", started)
        return 0
```

- [ ] **Step 4: 實作命令列與入口**

`tools/fubon-daily/fubon_daily/cli.py`：

```python
"""Command line: python fetch_daily.py --data <market-data> --credentials <file> [--date D [--symbols a,b]]."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from .client import FubonClient, sdk_version
from .pipeline import Options, Runtime, run


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="抓取富邦上市普通股 1 分 K（只讀行情）")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--date")
    parser.add_argument("--symbols")
    parser.add_argument("--last-attempt", action="store_true")
    args = parser.parse_args(argv)
    if args.date is not None:
        try:
            day = date.fromisoformat(args.date)
        except ValueError:
            parser.error("--date 必須是 YYYY-MM-DD")
        if day > date.today():
            parser.error("--date 不可是未來的日期")
    if args.symbols is not None:
        if args.date is None:
            parser.error("--symbols 必須搭配 --date")
        args.symbols = [code.strip() for code in args.symbols.split(",") if code.strip()]
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    version_file = Path(__file__).resolve().parent.parent / "VERSION.txt"
    version = version_file.read_text(encoding="ascii").strip() if version_file.is_file() else "dev"
    runtime = Runtime(make_client=lambda credentials: FubonClient(credentials), version=version,
                      source=f"fubon-neo {sdk_version()} historical/candles timeframe=1")
    return run(Options(data=args.data, credentials=args.credentials, date=args.date, symbols=args.symbols,
                       last_attempt=args.last_attempt), runtime)
```

`tools/fubon-daily/fetch_daily.py`：

```python
"""Entry point for the scheduled task; see tools/fubon-daily/README.md."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fubon_daily.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: 跑測試，確認通過**

Run: `py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
Expected: 全部 OK

另外確認入口可以載入（不登入）：

Run: `py -3.12 tools/fubon-daily/fetch_daily.py --help`
Expected: 印出用法，結束碼 0

- [ ] **Step 6: 提交**

```bash
git add tools/fubon-daily/fubon_daily/pipeline.py tools/fubon-daily/fubon_daily/cli.py tools/fubon-daily/fetch_daily.py tools/fubon-daily/tests/test_pipeline.py tools/fubon-daily/tests/test_cli.py
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: daily Fubon fetch pipeline with resume, retries, closed days and backfill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 安裝腳本與說明

**Files:**
- Create: `tools/fubon-daily/install.ps1`
- Create: `tools/fubon-daily/README.md`

**Interfaces:**
- Consumes: `fetch_daily.py`（Task 5）。
- Produces:
  - `install.ps1 [-Sdk] [-App] [-Task] [-Runtime <path>] [-Credentials <path>]`
  - 安裝後的產物：`DayTradeTycoon\fetcher\.venv\`、`fetcher\sdk-lock.json`、`fetcher\requirements.lock.txt`、`fetcher\app\`（含 `VERSION.txt`）、`fetcher\work\`，以及排程工作 `DayTradeTycoonMarketData`。

- [ ] **Step 1: 寫語法檢查（先讓它失敗）**

Run: `powershell -NoProfile -Command "$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/fubon-daily/install.ps1'), [ref]$null, [ref]$errors); if ($errors) { $errors; exit 1 } else { 'parse ok' }"`
Expected: FAIL（找不到檔案）

- [ ] **Step 2: 寫安裝腳本**

`tools/fubon-daily/install.ps1`：

```powershell
<#
  Installs or updates the Fubon daily market-data fetcher outside the repository.
  Run from the repository root:
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -Sdk     # venv + official SDK 2.4.0 (download)
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -App     # copy the committed fetcher
    powershell -NoProfile -File tools\fubon-daily\install.ps1 -Task    # weekday 16:45 / 17:30 / 19:00
#>
param(
  [switch]$Sdk,
  [switch]$App,
  [switch]$Task,
  [string]$Runtime = (Join-Path $env:USERPROFILE 'YilutekServices\DayTradeTycoon'),
  [string]$Credentials = (Join-Path $env:USERPROFILE '.fubon\credentials.local.py')
)
$ErrorActionPreference = 'Stop'
$fetcher = Join-Path $Runtime 'fetcher'
$venv = Join-Path $fetcher '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$sdkName = 'fubon_neo-2.4.0-cp37-abi3-win_amd64.zip'
$sdkUrl = "https://www.fbs.com.tw/TradeAPI_SDK/fubon_binary/$sdkName"
$lockPath = Join-Path $fetcher 'sdk-lock.json'
foreach ($directory in @($fetcher, (Join-Path $fetcher 'downloads'), (Join-Path $fetcher 'work'), (Join-Path $Runtime 'market-data'))) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

if ($Sdk) {
  if (-not (Test-Path $venvPython)) {
    & py -3.12 -m venv $venv
    if ($LASTEXITCODE) { throw 'Python 3.12 virtual environment could not be created.' }
  }
  $zip = Join-Path $fetcher "downloads\$sdkName"
  if (-not (Test-Path $zip)) { Invoke-WebRequest -Uri $sdkUrl -OutFile $zip -UseBasicParsing }
  $zipHash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
  $extract = Join-Path $fetcher 'downloads\fubon_neo-2.4.0'
  if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
  Expand-Archive -Path $zip -DestinationPath $extract
  $wheel = Get-ChildItem -Path $extract -Recurse -Filter '*.whl' | Select-Object -First 1
  if (-not $wheel) { throw 'The SDK archive contains no wheel.' }
  $wheelHash = (Get-FileHash -Algorithm SHA256 $wheel.FullName).Hash.ToLowerInvariant()
  if (Test-Path $lockPath) {
    $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
    if ($lock.zipSha256 -ne $zipHash -or $lock.wheelSha256 -ne $wheelHash) {
      throw 'SDK archive hash differs from sdk-lock.json; refusing to install.'
    }
  } else {
    [ordered]@{ url = $sdkUrl; zipSha256 = $zipHash; wheel = $wheel.Name; wheelSha256 = $wheelHash; recordedAt = (Get-Date).ToString('o') } |
      ConvertTo-Json | Set-Content -Encoding UTF8 $lockPath
  }
  & $venvPython -m pip install --disable-pip-version-check $wheel.FullName
  if ($LASTEXITCODE) { throw 'pip install failed.' }
  & $venvPython -m pip freeze --disable-pip-version-check | Set-Content -Encoding UTF8 (Join-Path $fetcher 'requirements.lock.txt')
  & $venvPython -c "from importlib.metadata import version; print('fubon_neo', version('fubon_neo'))"
}

if ($App) {
  $dirty = git -C $PSScriptRoot status --porcelain -- .
  if ($dirty) { throw 'tools/fubon-daily has uncommitted changes; commit them before installing.' }
  $commit = (git -C $PSScriptRoot rev-parse HEAD).Trim()
  $target = Join-Path $fetcher 'app'
  $staging = Join-Path $fetcher ('app.staging-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $staging | Out-Null
  Copy-Item -Path (Join-Path $PSScriptRoot 'fubon_daily') -Destination (Join-Path $staging 'fubon_daily') -Recurse
  Copy-Item -Path (Join-Path $PSScriptRoot 'fetch_daily.py') -Destination $staging
  Get-ChildItem -Path $staging -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
  Set-Content -Encoding ASCII -Path (Join-Path $staging 'VERSION.txt') -Value $commit
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item -Path $staging -Destination $target
  Write-Output "fetcher installed from $commit"
}

if ($Task) {
  $pythonw = Join-Path $venv 'Scripts\pythonw.exe'
  if (-not (Test-Path $pythonw)) { throw 'Run -Sdk first.' }
  $entry = Join-Path $fetcher 'app\fetch_daily.py'
  if (-not (Test-Path $entry)) { throw 'Run -App first.' }
  $arguments = '-X utf8 "{0}" --data "{1}" --credentials "{2}"' -f $entry, (Join-Path $Runtime 'market-data'), $Credentials
  $action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory (Join-Path $fetcher 'work')
  $days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
  $triggers = @('16:45', '17:30', '19:00') | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $_ }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'DayTradeTycoonMarketData' -Action $action -Trigger $triggers -Settings $settings `
    -Principal $principal -Description 'DayTradeTycoon: weekday Fubon 1-minute candles for TWSE common stocks (read-only market data)' -Force | Out-Null
  Get-ScheduledTask -TaskName 'DayTradeTycoonMarketData' | Select-Object TaskName, State
}

if (-not ($Sdk -or $App -or $Task)) { Write-Output 'Choose -Sdk, -App and/or -Task.' }
```

- [ ] **Step 3: 寫說明文件**

`tools/fubon-daily/README.md`：

````markdown
# 富邦每日行情抓取程式

每個平日 16:45、17:30、19:00 由 Windows 排程 `DayTradeTycoonMarketData` 執行，抓取上市普通股的富邦 1 分 K，寫入 `%USERPROFILE%\YilutekServices\DayTradeTycoon\market-data\`。設計見 `docs/superpowers/specs/2026-10-16-fubon-daily-pipeline-design.md`。

- **只讀行情**：不呼叫帳務或下單 API。
- **登入設定**：`C:\Users\kevin\.fubon\credentials.local.py`，由使用者自己填寫。程式只用 `ast` 讀字串、不執行；設定檔放在 Git 專案裡會被拒絕。
- **排程執行的複本**：排程跑的是 `DayTradeTycoon\fetcher\app\` 裡的複本，不是 repo 的工作目錄。改了程式要先提交，再執行 `install.ps1 -App`。
- **最後一次執行**：18:50 以後開始的執行，視為當天最後一次，失敗時跳出 Windows 通知。

## 測試（不需要登入，也不需要 SDK）

```powershell
py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v
```

## 安裝與更新

```powershell
powershell -NoProfile -File tools\fubon-daily\install.ps1 -Sdk    # 建立 Python 3.12 環境並安裝官方 SDK 2.4.0（雜湊記錄在 fetcher\sdk-lock.json）
powershell -NoProfile -File tools\fubon-daily\install.ps1 -App    # 複製已提交的程式
powershell -NoProfile -File tools\fubon-daily\install.ps1 -Task   # 建立／更新排程
```

## 手動執行

```powershell
$fetcher = "$env:USERPROFILE\YilutekServices\DayTradeTycoon\fetcher"
& "$fetcher\.venv\Scripts\python.exe" -X utf8 "$fetcher\app\fetch_daily.py" --data "$env:USERPROFILE\YilutekServices\DayTradeTycoon\market-data" --credentials "$env:USERPROFILE\.fubon\credentials.local.py"
# 補抓過去的日子（可只抓部分股票）：
#   ... --date 2026-10-05 --symbols 2330,2317,2454,2382,2308
```

結束碼：0 表示成功、休市或已完成；1 表示失敗，等下一次排程；2 表示設定、登入、憑證或 SDK 錯誤，需要人處理。狀態在 `market-data\status.json`，每日日誌在 `market-data\logs\`。
````

- [ ] **Step 4: 語法檢查通過**

Run: `powershell -NoProfile -Command "$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/fubon-daily/install.ps1'), [ref]$null, [ref]$errors); if ($errors) { $errors; exit 1 } else { 'parse ok' }"`
Expected: `parse ok`

Run: `powershell -NoProfile -File tools/fubon-daily/install.ps1 -Runtime "$env:TEMP\dtt-install-check"`
Expected: 印出 `Choose -Sdk, -App and/or -Task.`；只在暫存資料夾建立空目錄，不下載也不建立排程。之後刪除 `$env:TEMP\dtt-install-check`。

- [ ] **Step 5: 提交**

```bash
git add tools/fubon-daily/install.ps1 tools/fubon-daily/README.md
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: installer and guide for the Fubon daily fetcher" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 正式站環境變數與講師頁狀態卡

**Files:**
- Create: `scripts/hosting/app-paths.mjs`
- Test: `scripts/hosting/app-paths.test.mjs`
- Modify: `scripts/hosting/supervisor.mjs:77-91`（`appEnvironment`）
- Create: `src/lib/market-data-status.ts`
- Test: `src/lib/market-data-status.test.ts`
- Create: `src/lib/market-data.ts`
- Create: `src/components/market-data-card.tsx`
- Modify: `src/components/teacher-workspace.tsx`（在班級概況前插入卡片）

**Interfaces:**
- Consumes: 規格第 4 節的 `status.json` 與 `index.json` 格式（Task 3 實際寫出的格式）。
- Produces:
  - `hostedAppPaths(runtime: string, entry: string): { PGLITE_DATA_DIR: string; CLASSROOM_DOWNLOADS_DIR: string; MARKET_DATA_DIR: string }`
  - `type MarketDataState = "unconfigured" | "never" | "ok" | "closed" | "failed" | "running" | "stalled" | "invalid"`
  - `type MarketDataSummary`（欄位見下方程式碼）
  - `expectedTradingDay(now: Date): string`
  - `marketDataSummary(input: { configured: boolean; status: unknown; index: unknown }, now: Date): MarketDataSummary`
  - `loadMarketDataStatus`（伺服器函式，回傳 `{ ok: true; summary } | { ok: false; reason }`）
  - `<MarketDataCard />`

- [ ] **Step 1: 寫失敗的測試**

`scripts/hosting/app-paths.test.mjs`：

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { hostedAppPaths } from './app-paths.mjs';

test('hosted app paths put market data next to, not inside, the backed-up data folder', () => {
  const runtime = resolve('C:/runtime');
  const entry = join(runtime, 'releases', 'r1', 'server', 'index.mjs');
  assert.deepEqual(hostedAppPaths(runtime, entry), {
    PGLITE_DATA_DIR: join(runtime, 'data', 'pglite'),
    CLASSROOM_DOWNLOADS_DIR: join(runtime, 'releases', 'r1', 'downloads'),
    MARKET_DATA_DIR: join(runtime, 'market-data'),
  });
});
```

`src/lib/market-data-status.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedTradingDay, marketDataSummary } from "./market-data-status.ts";

const at = (iso: string) => new Date(iso);
const run = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-10-16",
  mode: "daily",
  startedAt: "2026-10-16T16:45:00+08:00",
  finishedAt: "2026-10-16T17:05:00+08:00",
  outcome: "ok",
  reason: null,
  symbols: { total: 1049, fetched: 1049, failed: 0, excluded: 0 },
  ...overrides,
});
const status = (lastRun: unknown, history: unknown[] = [], latestDay: string | null = "2026-10-16") => ({
  schema: 1,
  latestDay,
  lastRun,
  history,
});
const day = (date: string, coverage = "full-market", symbols = 1049) => ({
  date,
  coverage,
  symbols,
  manifestSha256: "a".repeat(64),
  publishedAt: `${date}T17:05:00+08:00`,
});
const index = (...days: unknown[]) => ({ schema: 1, days });
const EVENING = at("2026-10-16T20:00:00+08:00");

test("expectedTradingDay is the latest weekday whose 19:30 has passed in Taipei", () => {
  assert.equal(expectedTradingDay(at("2026-10-16T20:00:00+08:00")), "2026-10-16");
  assert.equal(expectedTradingDay(at("2026-10-16T18:00:00+08:00")), "2026-10-15");
  assert.equal(expectedTradingDay(at("2026-10-17T12:00:00+08:00")), "2026-10-16");
  assert.equal(expectedTradingDay(at("2026-10-19T10:00:00+08:00")), "2026-10-16");
  assert.equal(expectedTradingDay(at("2026-10-19T19:31:00+08:00")), "2026-10-19");
});

test("an unconfigured or never-run fetcher says so", () => {
  assert.equal(marketDataSummary({ configured: false, status: null, index: null }, EVENING).state, "unconfigured");
  const never = marketDataSummary({ configured: true, status: null, index: null }, EVENING);
  assert.equal(never.state, "never");
  assert.equal(never.missingExpectedDay, null);
});

test("a successful run reports the latest day, counts and duration", () => {
  const summary = marketDataSummary(
    { configured: true, status: status(run()), index: index(day("2026-10-05", "selected", 5), day("2026-10-16")) },
    EVENING,
  );
  assert.equal(summary.state, "ok");
  assert.equal(summary.latestDay, "2026-10-16");
  assert.equal(summary.latestSymbols, 1049);
  assert.equal(summary.fullMarketDays, 1);
  assert.equal(summary.lastRun?.durationMinutes, 20);
  assert.equal(summary.missingExpectedDay, null);
});

test("already-done shows as ok and a failure keeps its reason", () => {
  const done = marketDataSummary(
    { configured: true, status: status(run({ outcome: "already-done" })), index: index(day("2026-10-16")) },
    EVENING,
  );
  assert.equal(done.state, "ok");
  const failed = marketDataSummary(
    {
      configured: true,
      status: status(run({ outcome: "failed", reason: "登入失敗：＊＊＊" })),
      index: index(day("2026-10-15")),
    },
    EVENING,
  );
  assert.equal(failed.state, "failed");
  assert.equal(failed.reason, "登入失敗：＊＊＊");
  assert.equal(failed.missingExpectedDay, "2026-10-16");
});

test("a recorded holiday covers the expected day", () => {
  const closed = marketDataSummary(
    {
      configured: true,
      status: status(run({ outcome: "closed" }), [
        { date: "2026-10-16", outcome: "closed", finishedAt: "2026-10-16T16:46:00+08:00" },
      ]),
      index: index(day("2026-10-15")),
    },
    EVENING,
  );
  assert.equal(closed.state, "closed");
  assert.equal(closed.missingExpectedDay, null);
});

test("a run still marked running after two hours is stalled", () => {
  const stalled = marketDataSummary(
    {
      configured: true,
      status: status(run({ outcome: "running", finishedAt: null, startedAt: "2026-10-16T16:45:00+08:00" })),
      index: index(day("2026-10-15")),
    },
    EVENING,
  );
  assert.equal(stalled.state, "stalled");
  assert.match(stalled.reason ?? "", /中斷/);
});

test("malformed files are invalid, not thrown", () => {
  for (const bad of [{ schema: 2 }, { invalid: true }, "text", 42]) {
    assert.equal(marketDataSummary({ configured: true, status: bad, index: null }, EVENING).state, "invalid");
    assert.equal(marketDataSummary({ configured: true, status: null, index: bad }, EVENING).state, "invalid");
  }
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/market-data-status.test.ts scripts/hosting/app-paths.test.mjs`
Expected: FAIL（`Cannot find module`）

- [ ] **Step 3: 實作路徑與狀態摘要**

`scripts/hosting/app-paths.mjs`：

```js
import { dirname, join, resolve } from 'node:path';

/** Paths the hosted app reads. Market data lives beside data/, so service backups never copy it. */
export function hostedAppPaths(runtime, entry) {
  return {
    PGLITE_DATA_DIR: join(runtime, 'data', 'pglite'),
    CLASSROOM_DOWNLOADS_DIR: resolve(dirname(entry), '../downloads'),
    MARKET_DATA_DIR: join(runtime, 'market-data'),
  };
}
```

`scripts/hosting/supervisor.mjs`：

- import 區加入 `import { hostedAppPaths } from './app-paths.mjs';`
- `appEnvironment` 的 return 結尾，把 `PGLITE_DATA_DIR: join(runtime, 'data', 'pglite'), CLASSROOM_DOWNLOADS_DIR: resolve(dirname(config.entry), '../downloads') };` 換成 `...hostedAppPaths(runtime, config.entry) };`

`src/lib/market-data-status.ts`：

```ts
import { z } from "zod";

const outcome = z.enum(["running", "ok", "closed", "failed", "already-done"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const run = z.object({
  date: isoDate,
  mode: z.enum(["daily", "backfill"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcome,
  reason: z.string().nullable(),
  symbols: z.object({ total: count, fetched: count, failed: count, excluded: count }),
});
const statusSchema = z.object({
  schema: z.literal(1),
  latestDay: isoDate.nullable(),
  lastRun: run.nullable(),
  history: z.array(z.object({ date: isoDate, outcome, finishedAt: z.string().nullable() })),
});
const indexSchema = z.object({
  schema: z.literal(1),
  days: z.array(
    z.object({
      date: isoDate,
      coverage: z.enum(["full-market", "selected"]),
      symbols: count,
      manifestSha256: z.string(),
      publishedAt: z.string(),
    }),
  ),
});

export type MarketDataState =
  | "unconfigured"
  | "never"
  | "ok"
  | "closed"
  | "failed"
  | "running"
  | "stalled"
  | "invalid";

export type MarketDataSummary = {
  state: MarketDataState;
  latestDay: string | null;
  latestSymbols: number | null;
  fullMarketDays: number;
  lastRun: {
    date: string;
    mode: "daily" | "backfill";
    startedAt: string;
    finishedAt: string | null;
    durationMinutes: number | null;
    symbols: { total: number; fetched: number; failed: number; excluded: number };
  } | null;
  reason: string | null;
  missingExpectedDay: string | null;
};

const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const STALLED_AFTER_MS = 2 * 3_600_000;

/** The most recent weekday (Taipei) whose 19:30 has passed: by then its lesson should exist. */
export function expectedTradingDay(now: Date): string {
  const local = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (local.getUTCHours() * 60 + local.getUTCMinutes() < 19 * 60 + 30) day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

export function marketDataSummary(
  input: { configured: boolean; status: unknown; index: unknown },
  now: Date,
): MarketDataSummary {
  const empty = {
    latestDay: null,
    latestSymbols: null,
    fullMarketDays: 0,
    lastRun: null,
    reason: null,
    missingExpectedDay: null,
  };
  if (!input.configured) return { state: "unconfigured", ...empty };
  if (input.status === null && input.index === null) return { state: "never", ...empty };
  const parsedStatus = input.status === null ? null : statusSchema.safeParse(input.status);
  const parsedIndex = input.index === null ? null : indexSchema.safeParse(input.index);
  if ((parsedStatus && !parsedStatus.success) || (parsedIndex && !parsedIndex.success))
    return { state: "invalid", ...empty, reason: "狀態檔格式錯誤，請確認抓取程式版本" };
  const status = parsedStatus?.success ? parsedStatus.data : null;
  const index = parsedIndex?.success ? parsedIndex.data : null;
  const days = [...(index?.days ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = days.at(-1) ?? null;
  const last = status?.lastRun ?? null;
  const history = status?.history ?? [];
  let state: MarketDataState = !last ? "never" : last.outcome === "already-done" ? "ok" : last.outcome;
  let reason = last?.reason ?? null;
  if (last?.outcome === "running" && now.getTime() - Date.parse(last.startedAt) > STALLED_AFTER_MS) {
    state = "stalled";
    reason = "上一次執行超過 2 小時仍未結束，可能已中斷";
  }
  const expected = expectedTradingDay(now);
  const covered =
    days.some((entry) => entry.date === expected) ||
    history.some((entry) => entry.date === expected && entry.outcome === "closed");
  return {
    state,
    latestDay: latest?.date ?? null,
    latestSymbols: latest?.symbols ?? null,
    fullMarketDays: days.filter((entry) => entry.coverage === "full-market").length,
    lastRun: last
      ? {
          date: last.date,
          mode: last.mode,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          durationMinutes: last.finishedAt
            ? Math.round((Date.parse(last.finishedAt) - Date.parse(last.startedAt)) / 60_000)
            : null,
          symbols: last.symbols,
        }
      : null,
    reason,
    missingExpectedDay: last && !covered ? expected : null,
  };
}
```

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/market-data-status.test.ts scripts/hosting/app-paths.test.mjs`
Expected: PASS（8 項）

- [ ] **Step 5: 伺服器函式與講師卡片**

`src/lib/market-data.ts`：

```ts
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { MarketDataSummary } from "@/lib/market-data-status";

type Result = { ok: true; summary: MarketDataSummary } | { ok: false; reason: string };

/** Teacher-only: the fetcher's status files under MARKET_DATA_DIR; never any broker data. */
export const loadMarketDataStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<Result> => {
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const user = await requireAuthenticatedUser();
    if (
      classroomRole(user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }) !== "teacher"
    )
      return { ok: false, reason: "此帳號尚未由管理員授予講師權限" };
    const { marketDataSummary } = await import("@/lib/market-data-status");
    const directory = process.env.MARKET_DATA_DIR?.trim();
    if (!directory)
      return { ok: true, summary: marketDataSummary({ configured: false, status: null, index: null }, new Date()) };
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const read = async (name: string): Promise<unknown> => {
      try {
        return JSON.parse((await readFile(join(directory, name), "utf8")).replace(/^\uFEFF/, ""));
      } catch (error) {
        return (error as { code?: string }).code === "ENOENT" ? null : { invalid: true };
      }
    };
    const [status, index] = await Promise.all([read("status.json"), read("index.json")]);
    return { ok: true, summary: marketDataSummary({ configured: true, status, index }, new Date()) };
  });
```

`src/components/market-data-card.tsx`：

```tsx
import { useEffect, useState } from "react";
import { CalendarClock, RefreshCw } from "lucide-react";
import { loadMarketDataStatus } from "@/lib/market-data";
import type { MarketDataState, MarketDataSummary } from "@/lib/market-data-status";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<MarketDataState, string> = {
  unconfigured: "未設定",
  never: "尚未執行",
  ok: "成功",
  closed: "休市",
  failed: "失敗",
  running: "執行中",
  stalled: "可能中斷",
  invalid: "狀態異常",
};
const ALERT: MarketDataState[] = ["failed", "stalled", "invalid"];
const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";

/** Teacher workspace card: the daily Fubon market-data fetch, read from its status files. */
export function MarketDataCard() {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; summary?: MarketDataSummary; error?: string } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void loadMarketDataStatus()
      .then((result) => {
        if (!cancelled)
          setLoaded(result.ok ? { key: revision, summary: result.summary } : { key: revision, error: result.reason });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: revision, error: "每日行情狀態暫時無法讀取" });
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const summary = loaded?.key === revision ? loaded.summary : undefined;
  const error = loaded?.key === revision ? loaded.error : undefined;
  return (
    <section className="academy-card mt-7 p-5 sm:p-6" aria-labelledby="market-data-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="market-data-title" className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock aria-hidden="true" className="size-5 text-brand" />
          富邦每日行情
        </h2>
        <button
          type="button"
          className="academy-button-secondary min-h-12"
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          重新讀取
        </button>
      </div>
      {!summary && !error && (
        <p role="status" className="mt-3 text-base text-muted">
          正在讀取每日行情狀態…
        </p>
      )}
      {error && <p className="mt-3 text-base text-warn">{error}</p>}
      {summary && (
        <div className="mt-3 space-y-2 text-base">
          <p>
            狀態：
            <strong className={cn("ml-1", ALERT.includes(summary.state) ? "text-warn" : "text-brand")}>
              {STATE_TEXT[summary.state]}
            </strong>
          </p>
          {summary.state === "unconfigured" ? (
            <p className="text-muted">此教室未設定富邦每日資料。</p>
          ) : (
            <>
              <p className="text-muted">
                最新教材日：
                <span className="font-mono text-fg">{summary.latestDay ?? "—"}</span>
                {summary.latestSymbols !== null && `・${summary.latestSymbols.toLocaleString("zh-TW")} 檔`}
                ・已累積 {summary.fullMarketDays} 個全市場交易日
              </p>
              {summary.lastRun && (
                <p className="text-muted">
                  最近一次：{summary.lastRun.date}（{summary.lastRun.mode === "daily" ? "每日" : "補抓"}），
                  {time(summary.lastRun.startedAt)} 開始
                  {summary.lastRun.durationMinutes !== null && `，耗時 ${summary.lastRun.durationMinutes} 分鐘`}
                  ，抓到 {summary.lastRun.symbols.fetched}／{summary.lastRun.symbols.total} 檔
                </p>
              )}
              {summary.reason && <p className="text-warn">原因：{summary.reason}</p>}
              {summary.missingExpectedDay && (
                <p className="text-warn">
                  預期應有 {summary.missingExpectedDay} 的教材，請檢查排程與這台電腦是否開機。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
```

`src/components/teacher-workspace.tsx`：
- import 區加入 `import { MarketDataCard } from "@/components/market-data-card";`
- 在 `<section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="班級學習概況">` 之前插入 `<MarketDataCard />`，並把那個班級概況 section 的 `mt-7` 保持不變。

- [ ] **Step 6: 全套檢查與建置**

Run: `npm test` 、 `npm run typecheck` 、 `npx eslint src --quiet` 、 `npm run build`
Expected: 全部通過；`npm test` 的結果包含新的 `app-paths` 與 `market-data-status` 測試。

確認 hosting 既有測試沒有退步：

Run: `node --experimental-strip-types --test scripts/hosting/hosting.test.mjs scripts/hosting/app-paths.test.mjs`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add scripts/hosting/app-paths.mjs scripts/hosting/app-paths.test.mjs scripts/hosting/supervisor.mjs src/lib/market-data-status.ts src/lib/market-data-status.test.ts src/lib/market-data.ts src/components/market-data-card.tsx src/components/teacher-workspace.tsx
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: market-data directory for the hosted app and a teacher status card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 實機安裝、首次抓取、部署與排程

**這個任務的步驟會下載檔案、建立排程並部署正式站，開始前必須取得使用者明確同意。**

**Files:**
- Create: `docs/fubon-daily-2026-10-16.md`

**Interfaces:**
- Consumes: Task 1–7 全部。
- Produces: 已安裝的抓取程式、`market-data\days\<今天>\`、補抓的 10/05 與 10/06、正式站新 release、排程 `DayTradeTycoonMarketData`、上線紀錄。

- [ ] **Step 1: 取得同意**

先用 `Invoke-WebRequest -Method Head` 取得 SDK 壓縮檔大小，然後一次問使用者，可以分別勾選：
  1. 從 `https://www.fbs.com.tw/TradeAPI_SDK/fubon_binary/fubon_neo-2.4.0-cp37-abi3-win_amd64.zip` 下載 SDK，告知大小。
  2. 用 pip 從 PyPI 安裝 SDK 的相依套件（套件名稱以 wheel 的 `Requires-Dist` 為準）。
  3. 建立 Windows 排程 `DayTradeTycoonMarketData`：週一到週五 16:45、17:30、19:00，只在登入時執行。
  4. 部署到正式站（加入 `MARKET_DATA_DIR` 與講師卡片），流程依 `docs/deployment-2026-10-12.md`。

  沒有取得同意的項目就跳過，記錄在上線紀錄裡。

- [ ] **Step 2: 安裝 SDK 與程式**

Run: `powershell -NoProfile -File tools\fubon-daily\install.ps1 -Sdk`
Expected: 最後印出 `fubon_neo 2.4.0`；`fetcher\sdk-lock.json` 記錄了兩組 SHA-256。

Run: `powershell -NoProfile -File tools\fubon-daily\install.ps1 -App`
Expected: `fetcher installed from <HEAD>`

- [ ] **Step 3: 手動抓取今天（16:30 以後）**

Run:
```powershell
$fetcher = "$env:USERPROFILE\YilutekServices\DayTradeTycoon\fetcher"
Push-Location "$fetcher\work"; & "$fetcher\.venv\Scripts\python.exe" -X utf8 "$fetcher\app\fetch_daily.py" --data "$env:USERPROFILE\YilutekServices\DayTradeTycoon\market-data" --credentials "$env:USERPROFILE\.fubon\credentials.local.py"; $code = $LASTEXITCODE; Pop-Location; $code
```
Expected: 結束碼 0，約 20 分鐘。`status.json` 的 `lastRun.outcome` 是 `ok`，`symbols.total` 等於快照中有成交的檔數。記錄耗時、`days\<今天>` 與 `raw\<今天>` 的大小，以及 manifest 的警告數。

再用一段 Python 核對 manifest 的每個 SHA-256：
```powershell
& "$fetcher\.venv\Scripts\python.exe" -I -c "import hashlib,json,sys,pathlib; d=pathlib.Path(sys.argv[1]); m=json.loads((d/'manifest.json').read_text(encoding='utf-8')); bad=[f['path'] for f in m['files'] if hashlib.sha256((d/f['path']).read_bytes()).hexdigest()!=f['sha256']]; print(len(m['files']),'files; mismatches:',bad)" "$env:USERPROFILE\YilutekServices\DayTradeTycoon\market-data\days\<今天>"
```
Expected: `mismatches: []`

秘密掃描：程式從設定檔讀出秘密字串後逐檔比對，`.gz` 檔解壓後也比對，只印出命中檔數，不印出內容：
```powershell
& "$fetcher\.venv\Scripts\python.exe" -X utf8 -c "import gzip,sys,pathlib; sys.path.insert(0, sys.argv[1]); from fubon_daily.credentials import load_credentials; s=load_credentials(pathlib.Path(sys.argv[2])).secrets(); read=lambda p: (gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes()).decode('utf-8','ignore'); print('secret hits:', sum(1 for p in pathlib.Path(sys.argv[3]).rglob('*') if p.is_file() and any(x in read(p) for x in s)))" "$fetcher\app" "$env:USERPROFILE\.fubon\credentials.local.py" "$env:USERPROFILE\YilutekServices\DayTradeTycoon\market-data"
```
Expected: `secret hits: 0`

- [ ] **Step 4: 補抓 10/05、10/06 的 5 檔**

Run（把上一步指令的參數換成）：`--date 2026-10-05 --symbols 2330,2317,2454,2382,2308`，以及 `--date 2026-10-06 --symbols 2330,2317,2454,2382,2308`
Expected: 兩次結束碼都是 0；兩天的 `index.json` 都是 `coverage: "selected"`，各 5 檔。

- [ ] **Step 5: 部署正式站（取得同意後）**

依 `docs/deployment-2026-10-12.md` 與上一版紀錄 `docs/jiangbo-chart-2026-10-16.md` 的步驟：
1. `npm run build`，執行 `stage-release`，跑隔離整合測試。
2. 用 `desk-layout --strict` 與 `desk-orders` 驗收 release。
3. 記錄 preflight，`host.ps1 stop`，`host.ps1 backup`，`activate.mjs`，`host.ps1 start`，`verify-release.mjs`。
4. 稽核資料夾用新的 `artifacts/deploy-<日期>-market-data/`。

網站程序有沒有帶到 `MARKET_DATA_DIR`，由兩件事確認：
- `app-paths.test.mjs` 驗證 supervisor 產生的路徑。
- 請使用者用講師帳號打開正式站講師頁，卡片顯示「成功」與今天的日期。如果顯示「未設定」，就代表環境變數沒有生效。

supervisor 不記錄環境變數；我不能代為登入。

- [ ] **Step 6: 建立排程（取得同意後）**

Run: `powershell -NoProfile -File tools\fubon-daily\install.ps1 -Task`
Expected: 印出 `DayTradeTycoonMarketData Ready`

Run: `powershell -NoProfile -Command "(Get-ScheduledTask -TaskName DayTradeTycoonMarketData).Triggers | Select-Object StartBoundary, DaysOfWeek"`
Expected: 三個觸發，時間是 16:45、17:30、19:00，週一到週五。

立即手動觸發一次，確認排程能跑起來（今天已完成，應該記為 `already-done`）：

Run: `powershell -NoProfile -Command "Start-ScheduledTask -TaskName DayTradeTycoonMarketData"`，等 10 秒後讀 `status.json`
Expected: `lastRun.outcome` 是 `already-done`

- [ ] **Step 7: 寫上線紀錄並提交**

建立 `docs/fubon-daily-2026-10-16.md`，記錄：
- 安裝的 SDK 版本與 `sdk-lock.json` 的兩組雜湊。
- 首次抓取的日期、檔數、耗時、資料大小與警告數。
- 補抓結果。
- 部署的 release 名稱與停機時間。
- 排程的觸發時間。
- 秘密掃描結果。
- 尚未驗證的項目：下一個平日排程自動執行的結果，請使用者隔天看講師卡片確認。

```bash
git add docs/fubon-daily-2026-10-16.md
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "docs: record the Fubon daily fetcher installation and first run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
