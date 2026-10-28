# 每日富邦真實教材＋熱門當沖自選 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每個交易日收盤後自動多一堂 09:00–10:30 的真實行情課。逐筆、五檔、大盤都是真的，自選預設是前一交易日的熱門當沖名單，兩堂舊的 Yahoo 課停用。

**Architecture:**
- **抓取程式**（`tools/fubon-daily`，Python）多做兩件事，寫進 `market-data/`：
  - 證交所 5 秒大盤，存 `taiex/<d>/`；
  - Google 試算表的當沖名單，存 `radar/<D>.json`。
- **網站伺服器**在執行時讀 `days/`、`ticks/`、`taiex/`、`radar/`、`books/`：
  - 每局只揭露到游標為止；
  - 照真實成交撮合；
  - 每次前進只回這一格的增量。
- **瀏覽器**把每格的真實逐筆照秒數重播，自選表可以放到 80 列。

**Tech Stack:** TypeScript、React 19、TanStack Start/Router、Nitro、PGlite/Postgres、node:test（`--experimental-strip-types`）、Playwright；Python 3.12 unittest、google-auth。

**Spec:** 兩份一起讀，第二份優先：
- `docs/superpowers/specs/2026-10-22-fubon-daily-lessons-design.md`，以下稱「③」；
- `docs/superpowers/specs/2026-10-28-radar-watchlist-design.md`，以下稱「名單設計」。

## Global Constraints

- 工作目錄：`C:\Users\kevin\Documents\ChatGPT\當沖大富翁\.worktrees\radar-watchlist`，分支 `claude/radar-watchlist`。`node_modules` 是指向主目錄的 junction，不要刪。
- 提交一律用 `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`，訊息最後一行是 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不要 `git add -A`，只加這個任務的檔案。
- **不准做的事**：
  - 不推送、不部署、不安裝抓取程式、不改排程，也不連富邦。
  - 不讀 `C:\Users\kevin\.fubon\`、任何 `.pfx`、`secrets/`，或 Google 金鑰檔的內容。
  - 測試不連真的 Google 或證交所，一律用本機假伺服器。
- 時段只有早盤：`MORNING_CELLS = 90`，游標 0–89 代表 09:00–10:29。逐筆時間單位是「09:00 後的毫秒」，早盤是 `0 ≤ ms < 5_400_000`。1 分 K 的 `t` 是「09:00 後的秒」。
- `FIRST_LESSON_DAY = "2026-10-21"`；名單從 `RADAR_FIRST_DAY = "2026-10-20"` 起收。
- 課程 id：`fubon-YYYYMMDD-am`。舊課 id 只用來看舊紀錄：`morning-20261005-v1-bd566804b809`、`morning-20261006-v1-ce4a95ce69f1`。
- 一局 1 到 80 檔：`MAX_RUN_CODES = 80`。代號只收 4 碼數字，也就是上市普通股。
- **畫面上的字**照名單設計決定 B、D、L，一字不改：
  - 「預設：前一交易日熱門當沖股（MM/DD 盤後）」
  - 「名單 N 檔：上櫃 k 檔不在教材範圍，另 j 檔這天沒有可練習的資料」。k 或 j 是 0 的那半句不寫。
  - 「前一交易日沒有熱門當沖名單，改用成交值前 5 名」
  - 訪客：「預設：成交值前 5 名」
- 不顯示名單的分數和等級，也不出現「推薦」「勝率」「漲停雷達」。
- 體驗訪客（`PracticeAccess.kind === "guest"`）的任何回應都不含名單、名單日期或名單檔數。
- 開局前和選股清單裡，不送當天的收盤、漲跌、成交值或名次（③ 決定 P）。任何回應都不含游標之後的成交、K 棒或五檔。
- 紙上練習的標示保留；行情的「模擬」標示拿掉（③ §6 清單）。
- 測試指令：
  - TypeScript 單檔：`node --experimental-strip-types --test <檔案>`
  - 全部：`npm test`、`npm run typecheck`、`npx eslint src --quiet`
  - Python：`py -3.12 -m unittest discover -s tools/fubon-daily/tests -t tools/fubon-daily -v`
  - Google 測試要用 Task 2 建立的 `tools/fubon-daily/.venv-test`。
- 抓取程式的 HTTP 一律帶逾時 `(10, 60)` 秒，錯誤訊息只用固定的中文原因，不放例外內容。

## Review Focus

1. **洩漏未來**：任何回應不可含游標之後的成交、K 棒或五檔，包括 GET、POST、增量、五檔區段和選股清單。開局前也不可含當天收盤、漲跌或成交值。測試在 Task 6、7、8。
2. **訪客拿到名單**：訪客的 GET 選課、開局和前進回應裡，不能有 `radar` 字樣、名單日期或檔數。測試在 Task 8。
3. **早盤很晚才有第一筆、或整段沒成交的股票**：
   - K 棒從第一筆所在的格開始，之前不畫；
   - 市價單一直掛到第一筆成交；
   - 10:30 還沒成交就取消，原因「之後沒有成交」。
   測試在 Task 6、7。
4. **舊課沒做完的局**：停用後打開不會壞，可以「完成並復盤」或「放棄這局」，不能前進或下單。測試在 Task 9。
5. **名單裡的怪資料**：
   - 重複代號、上櫃股、目錄查不到的代號、名單日期晚於課程日；
   - 名單和課程日之間夾著另一個交易日（名單過期）；
   - 試算表的當天名單還沒定格。
   測試在 Task 2、5。

---

## 檔案地圖

**抓取程式**（`tools/fubon-daily/`）
- 新增 `fubon_daily/taiex.py`：證交所 5 秒大盤的下載與檢查。
- 新增 `fubon_daily/radar.py`：讀試算表和名單規則。
- 新增 `fubon_daily/extras.py`：每次排程結束時跑大盤與名單，一定不拋例外。
- 修改：
  - `fubon_daily/store.py`：`taiex/`、`radar/` 的存放和 status 欄位。
  - `fubon_daily/pipeline.py`：`Runtime.extras`。
  - `fubon_daily/cli.py`：`--radar-config`。
  - `install.ps1`：google-auth 和 `-RadarSheet`。
  - `README.md`。
- 測試：`tests/test_taiex.py`、`tests/test_radar.py`、`tests/test_extras.py`、`tests/test_pipeline.py`、`tests/test_install_script.py`。

**網站伺服器**（`src/lib/lessons/` 是新資料夾）
- 純函式：
  - `trades.ts`：逐筆列、格、早盤 K 棒與比對。
  - `taiex.ts`：5 秒點轉每格 12 點。
  - `books.ts`：五檔壓縮檔解碼、某格的五檔。
  - `default-codes.ts`：預設股票與文字。
  - `matching.ts`：照真實成交撮合。
- `market-files.server.ts`：讀 `ticks/`、`taiex/`、`radar/`、`books/` 的檔案。
- `daily-lessons.server.ts`：課程目錄、選股清單、每局資料、快取。
- 修改：
  - `src/lib/morning.ts`：型別。
  - `src/lib/morning-engine.ts`。
  - `src/lib/morning-session.server.ts`。
  - `src/lib/morning-data.server.ts`：改成執行時讀資料，舊課停用。
  - `src/routes/api/morning.ts`、`src/routes/morning.tsx`。
  - `src/lib/discipline/records.server.ts`。
  - `src/lib/market-data-status.ts`、`src/components/market-data-card.tsx`。

**瀏覽器**
- 新增：
  - `src/lib/market/real-replay.ts`：照秒數重播真實逐筆。
  - `src/components/lesson-picker.tsx`：選課。
  - `src/components/run-records.tsx`：練習紀錄與舊課紀錄。
- 修改：
  - 狀態與重播：`morning-live.ts`、`use-tick-replay.ts`、`morning-book.ts`、`morning-quote.ts`。
  - 自選與報價：`watch-table.tsx`、`trade-tape.tsx`、`quote-hero.tsx`、`stock-detail.tsx`。
  - 下單與五檔：`morning-trading.tsx`、`morning-order-book.tsx`。
  - 版面與選課：`morning-practice.tsx`、`morning-desk-bar.tsx`、`morning-plan-form.tsx`、`replay-notice.tsx`。
  - 樣式：`trading-desk.css`。
- 刪除 `src/lib/market/tick-replay.ts` 和它的測試，那是模擬逐筆。

**腳本、文件**
- 建置：`package.json`、`scripts/verify-morning-build.mjs`、`scripts/check-symbols.mjs`。
- QA：`scripts/qa/make-market-fixture.mjs`、`scripts/qa/desk-*.mjs`。
- 整合測試：`scripts/hosting/*-integration.test.mjs`、`scripts/onprem/integration.test.mjs`、`scripts/hosting/verify-public.mjs`。
- 說明書與授權：`docs/pdf-source.json`、`public/daytrade-tycoon-manual.pdf`、`src/components/manual-page.tsx`、`src/lib/license.ts`、`src/components/license-page.tsx`。
- 其他：`README.md`、`docs/broker-integration.md`、上線紀錄。

---

### Task 1: 抓取程式：證交所 5 秒大盤

**Files:**
- Create: `tools/fubon-daily/fubon_daily/taiex.py`
- Create: `tools/fubon-daily/tests/test_taiex.py`
- Modify: `tools/fubon-daily/fubon_daily/store.py`，在 `write_ticks_status` 旁邊加。

**Interfaces:**
- Produces:
  - `taiex.TaiexError(reason: str)`：reason 是固定的中文原因。
  - `taiex.parse_points(raw: dict, day: date) -> list[list]`，回傳 `[[秒, 值], …]`，共 3,241 點。
  - `taiex.fetch(day: date, http_get: Callable[[str], bytes]) -> bytes`。
  - `Store.has_taiex(day) -> bool`
  - `Store.taiex_days() -> list[str]`
  - `Store.taiex_close(day) -> float | None`：13:30:00 的值。
  - `Store.publish_taiex(day, raw: bytes, points, version, now) -> None`
  - `Store.write_status_key(key: str, entry: dict) -> None`
- 檔案格式：
  - `market-data/taiex/<d>/raw.json`：收到的原始位元組。
  - `market-data/taiex/<d>/points.json`：`{schema:1, date, source:"twse MI_5MINS_INDEX", previousClose, points}`。`previousClose` 是 09:00:00 那一點的值。
  - `market-data/taiex/<d>/manifest.json`：`{schema:1, date, createdAt, version, files:[{path,bytes,sha256}]}`。
  - 資料夾叫 `taiex/` 而不是 ③ 寫的 `index/`，因為根目錄已經有 `index.json`，避免混淆。這是 Ruling，要記進帳本。

- [ ] **Step 1：寫失敗的測試** `tests/test_taiex.py`。用 `fixtures` 產生一份合格的 MI_5MINS_INDEX JSON：`stat:"OK"`、`date:"20261027"`、`fields` 含「時間」「發行量加權股價指數」，3,241 列，數值帶千分位逗號。
  - `test_parse_points_accepts_full_day`：3,241 點，第一點 `[0, 前收]`，最後一點 `[16200, …]`。
  - `test_rejects_stat_not_ok`、`test_rejects_wrong_date`、`test_rejects_gap`（刪掉 10:00:05）、`test_rejects_duplicate`、`test_rejects_non_positive`：都拋 `TaiexError`。reason 依序是「證交所回覆不是 OK」「日期不符」「大盤資料不連續」「大盤資料重複」「大盤數值不正確」。
  - `test_previous_close_must_match`：store 裡前一日 13:30:00 是 33000、今天 09:00:00 是 33001，`publish` 前的檢查拋「前一交易日收盤與今天 09:00:00 不同」。
  - `test_publish_is_write_once`：發布兩次，第二次拋 `FileExistsError`，內容不變；manifest 的 sha256 和檔案相符。
  - `test_status_key_survives_write_run`：先 `write_status_key("taiex", {...})` 再 `write_run(...)`，`taiex` 還在。
- [ ] **Step 2：執行，確認失敗。** 指令：`py -3.12 -m unittest tests.test_taiex -v`（工作目錄 `tools/fubon-daily`）。Expected：ImportError 或多個 FAIL。
- [ ] **Step 3：實作。**
  - 網址：`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=YYYYMMDD`。
  - `fetch` 帶 `User-Agent: Mozilla/5.0 (DayTradeTycoon fetcher)`；真正的 `http_get` 在 Task 3 用 `urllib.request` 實作。
  - 發布照 store 既有的「staging 再整個資料夾替換」：`staging-taiex/<d>/`，再搬到 `taiex/<d>/`。原始回應先寫進 staging 才檢查。
- [ ] **Step 4：執行，確認通過。** 用同一個指令，Expected：全部 OK。另外跑一次全部 Python 測試，Expected：既有測試也都通過。
- [ ] **Step 5：提交。** `git add tools/fubon-daily/fubon_daily/taiex.py tools/fubon-daily/fubon_daily/store.py tools/fubon-daily/tests/test_taiex.py`。訊息：`feat(fetcher): TWSE 5-second TAIEX, checked and stored write-once under taiex/<day>`

### Task 2: 抓取程式：試算表當沖名單

**Files:**
- Create: `tools/fubon-daily/fubon_daily/radar.py`
- Create: `tools/fubon-daily/tests/test_radar.py`
- Modify: `tools/fubon-daily/fubon_daily/store.py`

**Interfaces:**
- Produces:
  - `radar.HEADER = ["日期","類型","代號","名稱","族群","分數","等級","收盤","漲跌幅%","連板","備註"]`
  - `radar.RADAR_FIRST_DAY = date(2026, 10, 20)`
  - `radar.RadarError(reason: str)`
  - `@dataclass(frozen=True) radar.RadarConfig(sheet_id: str, tab: str, key_path: Path)`
  - `radar.load_config(path: Path) -> RadarConfig | None`：檔案不存在回 `None`。
    - 設定檔 `radar.local.json`：`{"sheetId": str, "tab": "定格名單", "keyFile": "google-radar-reader.json"}`。`keyFile` 相對於設定檔所在資料夾。
    - 金鑰在 git 工作目錄裡就拋 `RadarError("金鑰檔不能放在 git 專案裡")`，沿用 `credentials.inside_git_worktree`。
  - `radar.parse_values(values: list[list[str]]) -> tuple[dict[str, list[tuple[str, str]]], int]`：回傳「每個日期的當沖 (代號, 名稱)」和「跳過的列數」。
  - `radar.read_values(config, *, base_url="https://sheets.googleapis.com") -> list[list[str]]`：
    - google-auth 在函式裡才 import，範圍 `https://www.googleapis.com/auth/spreadsheets.readonly`。
    - 用 `AuthorizedSession`，GET `{base_url}/v4/spreadsheets/{id}/values/{quote(tab + "!A:K")}`，逾時 `(10, 60)`。
  - `radar.dates_to_store(lists: dict, stored: set[str], today: date) -> list[str]`：只要 `RADAR_FIRST_DAY ≤ D < today`、而且還沒存的日期。
  - `Store.radar_dates() -> list[str]`
  - `Store.read_radar(day) -> dict | None`
  - `Store.write_radar(day, symbols, fetched_at) -> bool`：寫入回 True；已存在回 False，且不覆蓋。
- 檔案：`market-data/radar/<D>.json` = `{schema:1, date, kind:"當沖", fetchedAt, sha256, symbols:[{code,name}]}`。`sha256` 是 `symbols` 正規 JSON 的雜湊。不存分數、等級，也不存原始回應。

- [ ] **Step 1：寫失敗的測試** `tests/test_radar.py`。
  - `test_header_must_match`：欄名少一欄或順序不同，拋「試算表欄位改了」。
  - `test_only_daytrade_rows_deduped`：
    - 輸入同日的「當沖 2330」兩次、「隔日衝 2317」、「當沖 6488」；
    - 回傳只有 `[("2330","台積電"), ("6488","環球晶")]`。
    - 上櫃股在這一層不過濾，交給網站。
  - `test_bad_rows_skipped_and_counted`：日期 `2026/10/27`、代號空白、名稱空白，各算一列跳過。代號規則 `^[0-9A-Z]{4,6}$`。
  - `test_dates_to_store`：
    - `RADAR_FIRST_DAY` 之前的不收；
    - `today` 當天不收，因為還沒定格；
    - 已存的不收。
  - `test_write_radar_is_write_once`：第二次寫不同內容回 False，檔案不變，而且 log 有一行「試算表的 2026-10-27 名單和已存的不同」。log 用 `Store` 既有的 log 函式。
  - `test_missing_config_is_none`、`test_key_inside_git_refused`
  - `GoogleFakeTest`：`@unittest.skipUnless(importlib.util.find_spec("google.auth"), …)`。
    - 用 `http.server` 在 127.0.0.1 起兩個假服務：一個發 token，一個回 values。
    - 測試用的假金鑰：
      - `cryptography` 產生 RSA；
      - `token_uri` 指向假 token 服務；
      - `private_key_id` 和 `client_email` 都含標記字串 `LEAK-MARKER-7f3a`。
    - `test_reads_values_with_service_account`：回傳的列等於假服務送出的列，而且假服務收到 `Authorization: Bearer`。
    - `test_http_error_reason_is_fixed`：values 回 403，`RadarError.reason == "讀不到試算表（HTTP 403）"`，而且 `str(error)` 不含標記。
    - `test_token_failure_reason_is_fixed`：token 回 400，reason 是「Google 授權失敗」，不含標記。
- [ ] **Step 2：建測試用 venv，再執行確認失敗。**
  - `py -3.12 -m venv tools/fubon-daily/.venv-test`
  - `tools/fubon-daily/.venv-test/Scripts/pip install google-auth==<版本> requests cryptography`：版本挑 PyPI 上至少兩週前發布的最新 2.x，Task 3 要用同一個版本。
  - 把 `.venv-test/` 加進 `.git/info/exclude`。
  - 執行：`tools/fubon-daily/.venv-test/Scripts/python -m unittest tests.test_radar -v`（工作目錄 `tools/fubon-daily`）。Expected：FAIL 或 ImportError。
- [ ] **Step 3：實作。**
  - 例外一律換成固定原因：「找不到 Google 金鑰檔」「Google 授權失敗」「讀不到試算表（HTTP n）」「連線逾時」「試算表欄位改了」「設定檔格式不正確」「沒有安裝 google-auth」。
  - 原例外不串接（`raise … from None`），確保例外訊息不含金鑰。
- [ ] **Step 4：執行，確認通過。**
  - 用 `.venv-test` 跑全部；
  - 再用 `py -3.12` 跑全部，Google 測試應該是 skipped，其他 OK。
- [ ] **Step 5：提交。** 訊息：`feat(fetcher): read the 當沖 list from the user's sheet with a read-only service account; store code+name per day, write-once`

### Task 3: 抓取程式：接進每日流程與安裝

**Files:**
- Create: `tools/fubon-daily/fubon_daily/extras.py`
- Create: `tools/fubon-daily/tests/test_extras.py`
- Modify:
  - `fubon_daily/pipeline.py`：`Runtime` 和 `run()`。
  - `fubon_daily/cli.py`。
  - `install.ps1`：`-Sdk` 區塊，並新增 `-RadarSheet`。
  - `tests/test_pipeline.py`、`tests/test_install_script.py`、`README.md`。

**Interfaces:**
- Consumes: Task 1、2 的所有函式。
- Produces:
  - `extras.run_extras(store, *, now: datetime, taiex_get: Callable[[str], bytes] | None, radar_read: Callable[[], list[list[str]]] | None, radar_config_present: bool, version: str) -> None`：一定不拋例外。
  - `Runtime.extras: Callable[[Store, datetime], None] | None = None`
- 規則：
  - `run()` 拿到鎖，`execute()` 結束後（不論結果）呼叫 `runtime.extras(store, now)`，但只在每日模式而且 `now ≥ 16:30` 時呼叫。拿不到鎖或在 16:30 前都不呼叫。
  - **大盤**：
    - 對每個「已發布全市場日 ≥ 2026-10-21 但還沒有 `taiex/`」的日子補抓，每次最多 5 天，由舊到新。
    - 抓到就發布；失敗記原因，不擋別的日子。
    - `status["taiex"] = {date, outcome:"ok"|"failed", reason, points, finishedAt}`，`date` 是這次處理的最新一天。
  - **名單**：
    - 沒有設定檔：`status["radar"] = {outcome:"not-configured", …}`，不算失敗。
    - 有設定檔：讀一次，存所有該存的日期。`status["radar"] = {outcome, reason, latest, symbols, stored:[…], finishedAt}`，`latest` 是已存的最新 D，`symbols` 是它的檔數。
  - `cli.py`：
    - 加 `--radar-config`，預設 `%USERPROFILE%\.daytrade-tycoon\radar.local.json`；
    - 組出真正的 `extras`：`urllib.request` 下載大盤，`radar.read_values` 讀名單。
  - `install.ps1`：
    - `-Sdk` 在 freeze 之前 `pip install google-auth==<Task 2 的版本>`。
    - 新參數 `-RadarSheet <id>`：把 `{"sheetId":…, "tab":"定格名單", "keyFile":"google-radar-reader.json"}` 寫到 `%USERPROFILE%\.daytrade-tycoon\radar.local.json`。
    - 用 UTF-8 無 BOM 寫入，`[IO.File]::WriteAllText` 搭配 `UTF8Encoding($false)`。
    - 資料夾不存在就建立。不碰金鑰檔。

- [ ] **Step 1：寫失敗的測試。**
  - `test_extras.py`：
    - `test_taiex_backfills_oldest_first_max_five`：有 7 個全市場日都缺大盤，只處理最舊的 5 天。
    - `test_taiex_failure_does_not_stop_radar`
    - `test_radar_not_configured_status`
    - `test_extras_never_raise`：`taiex_get` 和 `radar_read` 都拋 `RuntimeError`，函式正常返回，status 記 `failed`，而且不含例外內容。
  - `test_pipeline.py`：
    - `test_extras_run_after_already_done`：已完成的那一次執行仍會呼叫 extras，而且沒有登入（`calls == []`）。
    - `test_extras_not_before_1630`
    - `test_extras_not_when_locked`
    - 既有的 `PipelineHarness` 不傳 extras，預設 `None`，不碰網路。
  - `test_install_script.py`：
    - `-Sdk` 區塊含 `google-auth==` 加上確切版本；
    - 有 `-RadarSheet` 參數；
    - 寫入時用 `UTF8Encoding($false)`。
- [ ] **Step 2：執行，確認失敗。** 指令是 Global Constraints 的 Python 指令。Expected：新測試 FAIL。
- [ ] **Step 3：實作上面的規則。**
- [ ] **Step 4：執行全部 Python 測試。** `py -3.12` 和 `.venv-test` 各跑一次，Expected：全部 OK，Google 測試只在 `.venv-test` 執行。
- [ ] **Step 5：更新 README。**
  - 新增「證交所大盤」「熱門當沖名單」兩節，寫存放位置、補抓、status 欄位和失敗時的行為。
  - 「安裝與更新」寫 `-RadarSheet` 和附錄 A 的金鑰位置。
  - 「測試」寫 `.venv-test`。
- [ ] **Step 6：提交。** 訊息：`feat(fetcher): run TAIEX and the 當沖 list after every evening run (never blocking); install pins google-auth and writes the local sheet config`

### Task 4: 網站：讀檔與純函式（逐筆、大盤、五檔）

**Files:**
- Create:
  - `src/lib/lessons/trades.ts`、`src/lib/lessons/trades.test.ts`
  - `src/lib/lessons/taiex.ts`、`src/lib/lessons/taiex.test.ts`
  - `src/lib/lessons/books.ts`、`src/lib/lessons/books.test.ts`
  - `src/lib/lessons/market-files.server.ts`、`src/lib/lessons/market-files.test.ts`
  - `src/lib/lessons/types.ts`

**Interfaces:**
- Produces:
  ```ts
  // trades.ts
  export type TradeRow = readonly [ms: number, price: number, size: number, bid: number | null, ask: number | null];
  export const CELL_MS = 60_000, MORNING_CELLS = 90, MORNING_END_MS = 5_400_000;
  export function cellSlice(trades: readonly TradeRow[], cell: number): readonly TradeRow[]; // 二分搜尋，ms ∈ [cell·60000, (cell+1)·60000)
  export function morningBars(dayBars: readonly MarketBarRow[], trades: readonly TradeRow[]): Bar[] | null;
  // taiex.ts
  export function taiexMorningSeries(previousClose: number, points: readonly (readonly [number, number])[]): MorningIndexSeries | null;
  // books.ts
  export type BookLevels = { bids: [number, number][]; asks: [number, number][] };
  export type BookTimeline = { /* 實作者決定 */ };
  export function readBookTimeline(doc: unknown): BookTimeline | null;
  export function bookCell(timeline: BookTimeline, cell: number): { start: BookLevels | null; frames: [ms: number, book: BookLevels][] };
  // market-files.server.ts
  export function marketDataDir(): string; // process.env.MARKET_DATA_DIR?.trim() ?? ""
  export async function readTicksManifest(dir: string, date: string): Promise<TicksManifest | null>;
  export async function readMorningTrades(dir: string, date: string, code: string): Promise<TradeRow[] | null>;
  export async function readTaiexPoints(dir: string, date: string): Promise<{ previousClose: number; points: [number, number][] } | null>;
  export async function listRadarDates(dir: string): Promise<string[]>;
  export async function readRadarList(dir: string, date: string): Promise<RadarList | null>;
  export async function readBooks(dir: string, date: string, code: string): Promise<{ timeline: BookTimeline; sizeUnit: string } | null>;
  export async function sha256File(path: string): Promise<string | null>;
  ```
  - `TicksManifest = { date; symbols: { code; complete: boolean }[] }`，其他欄位不用。
  - 共用型別放新檔 `src/lib/lessons/types.ts`，前後端都可以 import，裡面只有型別：
    - 這個任務先放 `export type RadarList = { date: string; symbols: { code: string; name: string }[] }`；
    - Task 6 加 `PickerSymbol`、`LessonPicker`；
    - Task 7 加 `RunRecord`。
- 規則：
  - `morningBars` 逐格比對第 0–89 格：用逐筆算出的開高低收量，要和同一個 `t` 的 1 分 K 相同，價格容差 1e-9。
    - 1 分 K 沒有那一格 ⇔ 那一格沒有成交。
    - 有任何不符就回 `null`。
    - 回傳的 K 棒從第一筆成交所在的格開始，到第 89 格為止：
      - 有成交的格用 1 分 K，保留 `a`；
      - 沒成交的格是 `{t, o=h=l=c=上一格收盤, v:0, a: 上一格 a}`。
    - 整段沒成交就回 `[]`。
  - `readMorningTrades`：
    - 只取 `ms < MORNING_END_MS` 的成交；
    - 價格 > 0，張數是正整數，ms 不遞減；
    - 格式錯誤回 `null`。
  - `taiexMorningSeries` 的規則同 `scripts/lib/taiex-minutes.mjs`：
    - 第 m 格取 `(m·60, m·60+60]` 秒的 12 點；
    - 09:00:00 那點是佔位值，不當開盤；
    - 共 90 格，不足就回 `null`；
    - `name:"加權指數"`，`source:"證交所 每 5 秒"`。
  - `books.ts` 依 `tools/fubon-daily/fubon_daily/books_compact.py` 的格式：
    - 照到達順序逐列累加 `dt`；
    - FULL 列整個換掉，其他列逐檔更新，null 代表那一檔清空；
    - 只保留早盤；
    - 落在 `gaps` 區間內的時間，五檔是未知（`null`）；
    - `bookCell` 回傳那一格開始時的五檔，以及格內每次變動後的完整五檔。

- [ ] **Step 1：寫失敗的測試。** 測試資料用函式就地產生，不讀正式資料。
  - `trades.test.ts`：
    - `morningBars matches and keeps a`
    - `first trade at 09:03 → bars start at t=180`
    - `quiet cell → flat v:0 bar carrying previous close and a`
    - `one lot missing → null`
    - `trades after 10:30 ignored`
    - `cellSlice boundaries`：ms 59,999 在第 0 格，60,000 在第 1 格。
  - `taiex.test.ts`：
    - `90 cells × 12 points, o is the 09:00:05 point`
    - `missing point → null`
  - `books.test.ts`：用小份的壓縮列，例如一個 FULL 列加三個差異列，加一段 gap。
    - `replays in arrival order`
    - `cell start is the last state before the cell`
    - `inside a gap → null`
    - `frames are full snapshots`
  - `market-files.test.ts`：在 `mkdtemp` 寫入假的 `ticks/`、`taiex/`、`radar/`、`books/`。
    - `bad gzip → null`
    - `bad date or code → null`
    - `radar dates sorted ascending and invalid names ignored`
- [ ] **Step 2：執行，確認失敗。** `node --experimental-strip-types --test src/lib/lessons/*.test.ts`，Expected：模組找不到。
- [ ] **Step 3：實作。** `market-files.server.ts` 沿用 `src/lib/market-days.server.ts` 的 `readJson` 寫法和日期、代號檢查。
- [ ] **Step 4：執行，確認通過。** 同上指令，Expected：全部 pass。另外跑 `npm run typecheck`。
- [ ] **Step 5：提交。** 訊息：`feat(lessons): readers for real ticks, TAIEX 5-second points, recorded books and the 當沖 list`

### Task 5: 網站：預設股票規則

**Files:**
- Create: `src/lib/lessons/default-codes.ts`、`src/lib/lessons/default-codes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_RUN_CODES = 80;
  // RadarList 從 ./types.ts import（Task 4）
  export type ListCounts = { listed: number; otc: number; missing: number };
  export type DefaultChoice =
    | { basis: "radar"; radarDate: string; codes: string[]; counts: ListCounts }
    | { basis: "top5"; reason: "guest" | "no-list" | "stale" | "empty"; codes: string[]; counts?: ListCounts };
  export function chooseDefaultCodes(input: {
    lessonDate: string; fullMarketDays: readonly string[]; radar: RadarList | null;
    practisable: ReadonlySet<string>; otc: ReadonlySet<string>; top5: readonly string[]; guest: boolean;
  }): DefaultChoice;
  export function defaultNote(choice: DefaultChoice): { title: string; detail: string | null };
  ```
- 規則（名單設計決定 A–E、L）：
  - `guest` 優先：直接回 `top5`，`reason: "guest"`，不看名單。
  - `radar` 是 null，或 `radar.date >= lessonDate`：回 `no-list`。
  - `fullMarketDays` 裡有任何一天 d 滿足 `radar.date < d < lessonDate`：回 `stale`。
  - 名單去重（保留第一次出現的）後：
    - `listed` 是總數；
    - `otc` 是在 `otc` 集合裡的數量；
    - `missing` 是「不是上櫃、也不在 `practisable`」的數量，包括目錄查不到的代號；
    - `codes` 是 `practisable ∩ 名單`，照代號排序，最多 80 檔。
  - `codes` 是空的：回 `top5`，`reason: "empty"`，並帶 counts。
  - `top5` 由呼叫端算好，照代號排序後放進 `codes`。
  - `defaultNote` 的字照 Global Constraints：
    - `radar`：title 是「預設：前一交易日熱門當沖股（MM/DD 盤後）」，MM/DD 補零。otc 和 missing 都是 0 時 detail 是 null。
    - `no-list`、`stale`、`empty`：title 是「前一交易日沒有熱門當沖名單，改用成交值前 5 名」。只有 `empty` 有 detail。
    - `guest`：title 是「預設：成交值前 5 名」，detail 是 null。

- [ ] **Step 1：寫失敗的測試。** 每條規則一個 `test`，assert 確切的字串，包括：
  - `detail` 的三種組合：只有上櫃、只有沒資料、兩者都有。
  - `"10/27"` 的格式：`radar.date="2026-10-27"` 時 title 是 `預設：前一交易日熱門當沖股（10/27 盤後）`。
  - 過期：`radar.date=2026-10-21`，`fullMarketDays` 有 10/22，`lessonDate=2026-10-27`，回 `stale`。
  - 休市中間：`radar.date=2026-10-22`，`fullMarketDays` 沒有 10/23 和 10/26，`lessonDate=2026-10-27`，回 `radar`。
  - 去重、80 檔上限。
  - 訪客的回傳沒有 `radarDate`，也沒有 `counts`。
- [ ] **Step 2：執行，確認失敗。** `node --experimental-strip-types --test src/lib/lessons/default-codes.test.ts`
- [ ] **Step 3：實作。**
- [ ] **Step 4：執行，確認通過。**
- [ ] **Step 5：提交。** 訊息：`feat(lessons): default 自選 = previous day's 當沖 list (stale/empty/guest fall back to top 5) with the exact desk wording`

### Task 6: 網站：每日課程目錄與每局資料

**Files:**
- Create: `src/lib/lessons/daily-lessons.server.ts`、`src/lib/lessons/daily-lessons.test.ts`
- Modify: `src/lib/morning.ts`，型別見下。

**Interfaces:**
- Consumes: Task 4、5。另外用 `listPublishedDays`、`readDaySymbols`、`readSymbolBars`，來自 `src/lib/market-days.server.ts`；上櫃名單用 `src/lib/market/universe.ts` 的 `STOCK_CATALOGUE`（`market === "otc"`）。
- Produces:
  ```ts
  export const FIRST_LESSON_DAY = "2026-10-21";
  export const lessonIdFor: (date: string) => string;         // "fubon-20261027-am"
  export function parseLessonId(id: string): string | null;  // → "2026-10-27"
  export async function listLessonDays(dir: string): Promise<string[]>; // 新到舊
  // 這兩個型別寫在 ./types.ts：
  // export type PickerSymbol = { code: string; name: string; referencePrice: number; previousValue: number | null; disposition: boolean };
  // export type LessonPicker = { lessonId: string; date: string; symbols: PickerSymbol[]; defaults: string[];
  //   note: { title: string; detail: string | null }; booksAvailable: boolean; taiexAvailable: boolean };
  export async function lessonPicker(dir: string, date: string, opts: { guest: boolean }): Promise<LessonPicker | null>;
  export type RunSource = MorningSource & { trades: Record<string, readonly TradeRow[]>; sourceHash: string; booksAvailable: boolean };
  export async function buildRunSource(dir: string, date: string, codes: readonly string[]): Promise<RunSource>;
  export async function runBookCell(dir: string, date: string, code: string, cell: number): Promise<{ start: BookLevels | null; frames: [number, BookLevels][]; sizes: boolean } | null>;
  export function clearLessonCaches(): void; // 測試用
  ```
- `morning.ts` 型別修改：
  - `MorningCatalog.symbols[].previous5CloseMean: number | null`
  - `MorningCatalog` 新增 `note?: { title: string; detail: string | null }`、`booksAvailable?: boolean`
  - `MorningLessonSummary` 改成 `{ lessonId; date; title }`
- 規則：
  - **一天開放的條件（③ §1）**：
    - `date ≥ FIRST_LESSON_DAY`；
    - 根目錄 `index.json` 有這天，而且是 `full-market`；
    - 有 `ticks/<d>/manifest.json`；
    - 可練習的股票至少 5 檔。
  - **選股清單的「可練習」，也就是便宜檢查**：
    - 4 碼代號；
    - 在 days 的 index 裡；
    - ticks manifest 的 `complete: true`；
    - 1 分 K 在第 0–89 格裡至少有一格 `v > 0`。
  - **開局時的嚴格檢查**：對選的股票跑 `morningBars`，結果不是 null 才算通過。結果照（日期, 代號）快取。
  - `previousValue` 是前一個全市場日的 `tradeValue`，沒有就是 null。選股清單只放 `PickerSymbol` 的欄位，照代號排序。
  - `top5`：
    - 當天 days index 照 `tradeValue` 由大到小；
    - 跳過 `disposition` 和不可練習的；
    - 取前 5 檔。
    - 只用在伺服器端，回應裡只有照代號排序後的 5 個代號。
  - 名單：用 `listRadarDates` 找小於課程日的最新一天，再交給 `chooseDefaultCodes`。
  - `buildRunSource`：
    - 任一檔嚴格檢查失敗，拋 `MorningError(409, "這幾檔這天的資料對不起來：<代號,…>，請改選其他股票")`。
    - catalog 的內容：
      - `lessonId`；
      - `title: "M/D 早盤"`；
      - `start:"09:00"`、`end:"10:30"`、`maxCursor:90`；
      - `symbols` 是選的股票：`previousClose = referencePrice`；`previous5CloseMean` 用前 5 個全市場日的 `close` 平均，不足 5 天就是 null；
      - `context:[]`、`strategy:[]`、`notices:[]`、`videoUrl:null`、`volumeUnit:"lot"`。
    - `bars` 用 `morningBars` 的結果。
    - `index` 用 `taiexMorningSeries`，沒有大盤就省略。
    - `sourceHash = sha256(index.json 裡這天的 manifestSha256 + "\n" + ticks manifest 檔的 sha256)`。
  - `runBookCell`：
    - 沒有 `books/<d>/` 回 `null`；
    - `sizes` 只在 manifest 的 `sizeUnit === "lot"` 時是 true，其他時候掛單量顯示「—」。
  - **快取**：
    - 逐筆照（日期, 代號）放 LRU，合計最多 3,000,000 筆（`TRADE_CACHE_LIMIT`）；
    - 選股清單照日期快取；
    - 每次前進都不可以重新解壓。

- [ ] **Step 1：寫失敗的測試。** 用 `mkdtemp` 加一個小型的資料夾產生器。測試檔內 helper `writeDay(dir, date, stocks)` 會寫 days、ticks、taiex 和 index.json。
  - `listLessonDays excludes days before 10/21, selected coverage, missing ticks, fewer than 5 stocks`
  - `picker never includes close, change or tradeValue of the lesson day`：把回應 `JSON.stringify` 後，搜尋那天的收盤價字串和 `tradeValue` 字串，都要找不到。
  - `picker defaults: radar list, OTC counted, guest gets top5 without radar fields`：訪客回應的 JSON 不含 `radar`，也不含名單日期字串。
  - `top5 skips disposition and unpractisable`
  - `buildRunSource rejects a code whose ticks disagree with bars`：拋 409，訊息含那個代號。
  - `buildRunSource bars start at first trade; previous5CloseMean null with <5 days`
  - `sourceHash changes when the ticks manifest changes`
  - `trade cache stays under limit`：把上限調小再測，必要時 export 一個測試用的 setter。
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作。**
- [ ] **Step 4：執行，確認通過。** 加跑 `npm run typecheck`，這時 `morning.ts` 型別改了，可能有其他檔案報錯。只修必要的地方：`previous5CloseMean` 是 null 時顯示「—」。
- [ ] **Step 5：提交。** 訊息：`feat(lessons): daily lesson catalogue, pre-open-only picker and per-run sources from real Fubon data`

### Task 7: 引擎：照真實成交撮合、放棄這局、增量回應

**Files:**
- Create: `src/lib/lessons/matching.ts`、`src/lib/lessons/matching.test.ts`
- Modify: `src/lib/morning.ts`、`src/lib/morning-engine.ts`、`src/lib/morning-engine.test.ts`

**Interfaces:**
- Consumes: `RunSource`（Task 6）、`TradeRow` 和 `cellSlice`（Task 4）。
- Produces:
  ```ts
  // matching.ts
  export type PendingLike = { side: "buy" | "sell"; limitPrice?: number; seen?: boolean };
  export type MatchResult = { kind: "fill"; price: number; ms: number } | { kind: "wait"; seen: boolean };
  export function matchOrder(order: PendingLike, trades: readonly TradeRow[]): MatchResult;
  ```
  `morning.ts` 修改：
  - `MorningState` 新增 `codes?: string[]`、`sourceHash?: string`、`abandoned?: boolean`。
  - `MorningOrder` 新增 `seen?: boolean`；`MorningFill` 新增 `ms?: number`。
  - `MorningAction` 新增：
    - `{ action: "abandon"; requestId; id; expectedRevision }`
    - `start` 加 `codes: string[]`
    - `advance` 加可選的 `view?: string`
  - 新增：
    ```ts
    export type MorningDelta = { cell: number; bars: Record<string, Bar | null>; index: MorningIndexBar | null; trades: Record<string, TradeRow[]>; book?: { code: string; start: BookLevels | null; frames: [number, BookLevels][]; sizes: boolean } };
    export type MorningTape = Record<string, TradeRow[]>;
    ```
  - `MorningResponse` 新增 `delta?`、`tape?`、`picker?: LessonPicker`、`records?: RunRecord[]`、`book?: MorningDelta["book"]`、`retired?: boolean`。
  - `RunRecord` 寫進 `src/lib/lessons/types.ts`，欄位照 Task 8。`morning.ts` 只從 `types.ts`、`trades.ts`、`books.ts` import 型別，不 import `.server.ts`。
  - `morning-engine.ts`：
    - `applyMorningAction` 在 source 有 `trades` 時，用真實成交處理；
    - 新增 `visibleTape(state, source, limit = 40): MorningTape`，回傳每檔到游標為止最後 40 筆；
    - 新增 `advanceDelta(state, source): MorningDelta`，`cell = state.cursor - 1`。
- **撮合（③ §5）**：
  - 前進揭露第 c 格時，未成交委託用 `cellSlice(trades[code], c)` 撮合。
  - 規則：
    - 市價：第一筆成交，用它的價格。
    - 限價買：
      - 還沒看過成交（`!seen`）而且第一筆 ≤ 限價：用那一筆的價格成交；
      - 否則之後任一筆 ≤ 限價：用限價成交。
    - 限價賣比較 ≥。
    - 看過任何一筆就 `seen = true`。
  - 成交紀錄：`fill.t = floor(ms/1000)`，`fill.ms = ms`。資金、持股在成交時重新檢查，規則不變。
  - 游標到 90 時還掛著的委託取消：`seen` 是 false 的原因寫「之後沒有成交」，否則寫「教材結束，委託未成交」。
  - 持股市值用已揭露的最後成交價。
- **K 棒查找**：有 trades 時用 `t` 找；沒有 K 棒的格（第一筆成交之前）不揭露，也不報錯。
- **visibleMorningState**：
  - `bars` 只放 `state.codes` 裡的股票，`t < cursor·60`；
  - `index` 取前 `cursor` 格。
- **abandon**：
  - 標成 `completed: true`、`abandoned: true`，取消掛單；
  - 不寫復盤，也不觸發慶祝；
  - 第一次以後重送，回 409「這局已經結束」。
- **assertLesson**：`state.sourceHash` 存在而且和 `source.sourceHash` 不同時，回 409「課程版本已變更，請聯絡講師確認這份練習」。

- [ ] **Step 1：寫失敗的測試。**
  - `matching.test.ts`：每條規則一個測試。
    - 市價；
    - 限價可以立刻成交，用那一筆的價格；
    - 限價掛著、之後碰到，用限價；
    - 賣的方向；
    - 空的格回 wait，`seen` 不變。
  - `morning-engine.test.ts` 新增，用就地產生的 `RunSource`：
    - `advance never returns trades or bars at or after the cursor`：每一步都檢查 delta 和 visible state，裡面所有成交的 `ms < cursor·60000`。
    - `market order waits for a quiet stock and cancels at 10:30 with 之後沒有成交`
    - `fill records the real ms`
    - `abandon completes without reflection and refuses a second abandon`
    - `sourceHash mismatch → 409`
    - `visible bars only for chosen codes`
  - 舊的 next-open 相關測試改寫或刪掉，每一筆刪除的理由寫在帳本。
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作。** `advance` 只揭露一格，兩次前進之間仍然至少間隔 1 秒，規則不變。
- [ ] **Step 4：執行，確認通過。** 跑 `node --experimental-strip-types --test src/lib/lessons/matching.test.ts src/lib/morning-engine.test.ts` 和 `npm run typecheck`。
- [ ] **Step 5：提交。** 訊息：`feat(morning): match against real trades, abandon a run, and send per-step deltas instead of every bar`

### Task 8: 練習 API：選股開局、放棄、訪客、流量、沒有教材

**Files:**
- Modify:
  - `src/lib/morning-data.server.ts`：整個改寫。
  - `src/lib/morning-session.server.ts`、`src/routes/api/morning.ts`、`src/routes/morning.tsx`（課程 id 的 regex）。
  - `src/lib/discipline/records.server.ts`。
- Test:
  - `src/lib/morning-session.test.ts`：沿用既有的 PGlite 測試寫法。
  - 新增 `src/lib/morning-api.test.ts`：如果既有測試已經涵蓋 route，就併進那個檔。

**Interfaces:**
- Consumes: Task 6、7。
- Produces:
  - **GET `/api/morning?lesson=<id>`**：
    - 沒有 `lesson` 時，先找使用者最近一局還沒完成的 fubon 課；沒有就用最新一天。
    - 回 `{catalog, state, lessons, records, tape?, book?, picker?, retired?}`：
      - `lessons` 只在 GET 送；
      - `records` 是最近 20 局：`RunRecord = { id; lessonId; date; codes: number; pnl: number; reflected: boolean; abandoned: boolean; retired: boolean; completed: boolean }`；
      - 沒有局的時候，`state` 是 null，帶 `picker`，`catalog` 用預設股票組成。這樣今天三件事的卡片還能讀 `maxCursor`。
  - **POST start** `{action:"start", requestId, plan, codes, guestTerms?}`：
    - `codes` 不能重複，1 到 80 檔，每一檔都要在這天的選股清單裡；
    - `plan.focusCode` 必須在 `codes` 裡，否則 400「請從選的股票挑主角股」。
  - **POST advance** 回 `{catalog, state, delta}`，`state.bars` 是空的。`view` 有值、而且這天有五檔時，`delta.book` 帶那一檔這一格的五檔。
  - **POST abandon**。
  - **沒有教材**：
    - `MARKET_DATA_DIR` 是空的：回 200 `{unavailable:"此教室沒有每日教材"}`；
    - 有設定但沒有任何課程日：回 `{unavailable:"目前還沒有每日教材"}`。
  - **訪客**：選股清單用 `guest:true`。回應裡不可有 `radar` 字樣、名單日期或名單檔數。
  - **流量**：
    - 同一 IP 每分鐘上限從 240 改成 2,400；
    - 同時處理上限從 12 改成 40；
    - 每位使用者每分鐘 180 次，不變。
  - **紀律分數**：查詢加上 `AND NOT COALESCE((state_json->>'abandoned')::boolean, false)`。
  - **課程 id 的 regex**：`/^(morning-\d{8}-v\d+-[a-f0-9]{12}|fubon-\d{8}-am)$/`。

- [ ] **Step 1：寫失敗的測試。**
  - `start validates codes (0, 81, duplicate, not in picker) and focusCode`
  - `guest responses never contain radar data`：對訪客的 GET、start、advance，回應 JSON 都不含 `"radar"`、名單日期和名單檔數。
  - `GET resumes the latest unfinished run, else newest day picker`
  - `lessons only on GET, not on POST`
  - `unavailable when MARKET_DATA_DIR empty`
  - `30 practisers behind one IP at 2× are not rate-limited`：30 位使用者各在 60 秒內送 60 次。
  - `abandoned rounds are not counted in discipline records`
  - `advance with view returns only that code's book cell`
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作。** `morning-data.server.ts` 拿掉兩個 JSON 的 import，改成：
  - `resolveMorningSource(params, user)`
  - `RETIRED_LESSONS: Record<string, string>`，內容是兩個舊 id 對應的日期。
- [ ] **Step 4：執行，確認通過。** 跑這幾個測試檔和 `npm run typecheck`。
- [ ] **Step 5：提交。** 訊息：`feat(morning): daily lessons API — pick 1–80 stocks, abandon, guests without the list, per-practiser limits, on-prem empty state`

### Task 9: 舊課停用與建置檢查

**Files:**
- Modify:
  - `package.json` 的 `build`。
  - `scripts/verify-morning-build.mjs`、`scripts/check-symbols.mjs`、`scripts/check-symbols.test.mjs`。
  - `src/lib/morning-lessons.test.ts`、`src/lib/morning-source-contract.test.ts`、`src/lib/morning-expansion-source.test.ts`：改寫或刪除。
  - `src/lib/morning-engine.ts`：舊局的處理。
- Test: `src/lib/morning-retired.test.ts`

**Interfaces:**
- Consumes: `RETIRED_LESSONS`（Task 8）。
- 規則：
  - `build` 拿掉 `verify-morning-source.mjs`、`prepare-morning-data.mjs --check`、`prepare-morning-expansion.mjs --check`。
  - `verify-morning-build.mjs` 保留，當作外洩掃描：
    - 改成掃描所有還存在的 `server/data/morning-*.json`；
    - 拿掉「10/06 必須存在」和用課程 id 當正向對照字串的檢查，正向對照改成一段固定的假字串。
  - `check-symbols.mjs`：拿掉讀 10/06 課程那段，其他照舊（24 檔）。
  - 舊的 JSON、研究資料和產生器都留著，產生器的測試照跑。
  - **舊局**：
    - GET 舊 id：回 `{retired:true, state}`，`state.bars` 是空的。`catalog` 只有 `lessonId`、`title:"舊課（已停用）"`、`date`、`maxCursor:90` 和這局的股票，沒有 K 棒。
    - 還沒完成的舊局可以「完成並復盤」或「放棄這局」：
      - 損益用最後一次存下的資產，不需要教材資料；
      - 前進和下單一律 409「這堂舊課已停用，只能完成或放棄」。
    - 「回到最近那一局」不會回到舊局。

- [ ] **Step 1：寫失敗的測試。** `morning-retired.test.ts`：
  - `old run opens text-only`
  - `old unfinished run can finish with reflection and keeps its P/L`
  - `old run can be abandoned`
  - `advance and order on an old run → 409`
  - `no new run can start on an old lesson`
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作，並改寫或刪除三個綁舊課的測試。** 保留還有意義的部分，例如「未揭露的 K 棒不被讀取」改用 fubon 假資料測。每個刪除的測試在帳本寫一行理由。
- [ ] **Step 4：執行。** `npm test`、`npm run typecheck`、`npx eslint src --quiet`、`npm run check:symbols`。Expected：全綠。
- [ ] **Step 5：提交。** 訊息：`feat(morning): retire the 10/05–10/06 Yahoo lessons — old runs stay readable and can be finished or abandoned`

### Task 10: 瀏覽器：照秒數重播真實逐筆

**Files:**
- Create: `src/lib/market/real-replay.ts`、`src/lib/market/real-replay.test.ts`
- Modify:
  - `src/lib/morning-live.ts`、`src/components/use-tick-replay.ts`。
  - `src/components/morning-practice.tsx`：`useMorningData` 合併增量。
- Delete: `src/lib/market/tick-replay.ts`、`src/lib/market/tick-replay.test.ts`

**Interfaces:**
- Consumes: `MorningDelta`、`MorningTape`（Task 7）。
- Produces:
  ```ts
  export function mergeDelta(state: MorningState, delta: MorningDelta): MorningState; // 回新物件；同一格重複合併不變
  export type LiveTrade = { ms: number; price: number; size: number; side: "ask" | "bid" | null };
  export function tradeSide(row: TradeRow): "ask" | "bid" | null; // 價 = 賣價 → "ask"（外盤）；價 = 買價 → "bid"（內盤）；其他 null
  export function tradesUpTo(rows: readonly TradeRow[], ms: number): number; // 二分搜尋，回傳筆數
  export function formingBar(cellStart: number, rows: readonly TradeRow[], count: number, previous: Bar | undefined): Bar | null;
  ```
  - `morning-live.ts` 的 `liveSession`、`lastTrade`、`recentTrades` 改成讀「已揭露的逐筆加上這一格播到的部分」，對外的型別名稱不變，各元件不用跟著改 import。
- 規則：
  - 播放時間 = 實際播放時間（`REPLAY_DELAY[speed] × 0.9`）× `(ms − 格開始) / 60000`。
  - 每 100 ms 更新一次畫面，一次可以合併多筆。
  - 成交量、均價都由逐筆累加：均價 = 累計成交金額 ÷ 累計張數。
  - 頁面在背景時直接跳到這一格的結尾。
  - `tape`：GET 時是每檔最近 40 筆；每次前進把新的逐筆接在後面，再只留最近 40 筆。

- [ ] **Step 1：寫失敗的測試** `real-replay.test.ts`：
  - `mergeDelta appends bars, index and trades once`
  - `forming bar equals cell bar when all trades played`
  - `tradeSide classifies ask/bid/neither`
  - `tradesUpTo boundary`
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作，並刪掉模擬逐筆的檔案。**
- [ ] **Step 4：執行。** `npm test`、`npm run typecheck`。
- [ ] **Step 5：提交。** 訊息：`feat(desk): replay each minute's real Fubon trades on their real seconds; drop the simulated ticks`

### Task 11: 瀏覽器：真實五檔與買賣價

**Files:**
- Modify:
  - `src/lib/morning-book.ts`、`src/lib/morning-quote.ts`。
  - `src/components/morning-order-book.tsx`、`quote-hero.tsx`、`watch-table.tsx`（買進、賣出欄）、`morning-trading.tsx`（`DisplayBook`、`PaperOrder`）、`morning-practice.tsx`（把 `view` 加進前進）。
- Test: `src/lib/morning-book.test.ts`：沒有就新建。

**Interfaces:**
- Consumes: `MorningResponse.book`、`MorningDelta.book`（Task 7、8）；`tradesUpTo`（Task 10）。
- Produces:
  - `displayBook(input: { catalog; book: MorningDelta["book"] | undefined; lastTrade: LiveTrade | null; playedMs: number }): { bids: MorningBookLevel[]; asks: MorningBookLevel[]; depth: "full" | "top"; sizes: boolean }`
  - 有五檔資料：用 `frames` 裡 `ms ≤ playedMs` 的最後一筆，`depth:"full"`。
  - 沒有：用最近一筆成交的 bid 和 ask，`depth:"top"`，只有一檔、掛單量「—」。
  - 拿掉 `createMorningBook` 和模擬掛單量。
- 規則：
  - 每次前進的 `view` = 目前選中的股票。換股票之後，下一次前進才有那一檔的五檔；在那之前顯示買一、賣一。
  - `depth:"top"` 時，五檔區下方一行字：「這天沒有五檔掛單資料」。課程有五檔、但這一格落在 gap 時，改成「這段時間沒有五檔資料」。
  - 閃電下單的價格梯照常可以點；只有 `sizes` 是 true 才顯示掛單量。

- [ ] **Step 1：寫失敗的測試。**
  - `full book uses the last frame at or before playedMs`
  - `no book → best bid/ask from the last trade, sizes hidden`
  - `gap → top with the gap note`
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作。**
- [ ] **Step 4：執行。** `npm test`、`npm run typecheck`。
- [ ] **Step 5：提交。** 訊息：`feat(desk): real 五檔 when recorded, otherwise the real best bid/ask from the trades`

### Task 12: 自選表放到 80 列

**Files:**
- Modify: `src/components/watch-table.tsx`、`src/trading-desk.css`、`src/components/use-device-canvas.ts`（只在需要讓畫面外的小圖不畫時改）。

**Interfaces:**
- Consumes: `MorningCatalog.note`（Task 6）。
- 規則（名單設計決定 I）：
  - 自選表自己捲動，標題列、欄名和大盤列固定在上面（sticky）。
  - **桌面**：
    - 交易台第一列的高度不再由自選表撐開；
    - 自選區最高 `max(25vh, 6 列)`，超過就在區內捲動；
    - 圖表、下單區和帳務不能被推出畫面。
  - **平板、手機、長輩版**：自選區最高 50vh，在區內捲動。
  - 小走勢圖只畫看得到的列，用 `IntersectionObserver`，`rootMargin` 是一列高。
  - 每列用 `memo`，props 沒變就不重畫。
  - 標題列的模擬說明（第 78 行）換成 `catalog.note.title`，`detail` 放在下一行小字。手機上照 10/27 的換行規則。
  - 選中的列在捲動、前進後保持選中，必要時 `scrollIntoView({block:"nearest"})`。

- [ ] **Step 1：寫失敗的 QA 檢查。** 新增 `scripts/qa/desk-watch80.mjs`，用 Task 16 的 70 檔假課：
  - 自選區有捲軸；
  - 往下捲到最後一列時，表頭仍然看得到；
  - 畫面外的小走勢圖 canvas 沒有畫過，用 `data-painted` 判斷；
  - 1366×900、820×900、375×812、320×700 和長輩版都沒有水平捲動；
  - 桌面上下單區在第一屏內。
  這個任務先寫好腳本，等 Task 16 的假資料完成後才跑得起來，所以 Step 2 改成在 Task 16 完成後補跑，要記在帳本。
- [ ] **Step 2：實作。**
- [ ] **Step 3：執行。** `npm run typecheck`、`npx eslint src --quiet`、`npm test`。
- [ ] **Step 4：提交。** 訊息：`feat(desk): 自選 scrolls in place with a sticky header, minis paint only when visible, note shows the list's origin`

### Task 13: 選課、練習紀錄、放棄這局

**Files:**
- Create: `src/components/lesson-picker.tsx`、`src/components/run-records.tsx`
- Modify:
  - `src/components/morning-practice.tsx`、`morning-plan-form.tsx`、`morning-desk-bar.tsx`。
  - `src/trading-desk.css`。

**Interfaces:**
- Consumes: `LessonPicker`、`RunRecord`、`MorningResponse.retired`，以及 abandon 動作（Task 8、9）。
- **選課**（③ §7 加名單設計）：
  1. 日期：用 `lessons` 列出可選日期，預設最新一天。沒有時段選擇。
  2. 股票：
     - 預設帶入 `picker.defaults`，上方顯示 `picker.note.title`，下一行小字是 `detail`。
     - 可以刪除，也可以搜尋代號或名稱加入。搜尋在瀏覽器裡做，範圍是 `picker.symbols`。
     - 最少 1 檔、最多 80 檔，滿了就提示「最多 80 檔」。
     - 每檔顯示代號、名稱、參考價、前一交易日成交值；處置股標「處置（分盤交易）」。
  3. 主角股和計畫：主角股只能從選的股票挑，其他計畫欄位照舊。
- **已有未完成的局**：直接回到那一局，並提供「放棄這局、重新選股」，要確認後才放棄。
- **練習紀錄**：計畫區下方列出 `records`，包括日期、檔數、損益、是否已復盤；舊課標「舊課（已停用）」，點了可以打開。
- **舊課**：`retired` 時不顯示走勢圖，只顯示計畫、委託、成交、損益、復盤，以及「完成並復盤」「放棄這局」。
- **沒有教材**：`unavailable` 時，練習區只顯示那句話，其他功能照常。
- 手機、長輩、平板版都要能用；輸入框字級至少 16px，沿用 `desk-phone-fields` 的規則。
- 桌面工具列的課程選單改成日期選單，顯示「M/D 早盤」。

- [ ] **Step 1：寫失敗的 QA 檢查。** 新增 `scripts/qa/desk-picker.mjs`：
  - 預設股票和名單相符，說明文字確切相符；
  - 刪到剩 1 檔不能再刪；
  - 加到 80 檔出現提示；
  - 訪客版的說明是「預設：成交值前 5 名」；
  - 放棄這局後可以重新選股；
  - 舊課紀錄可以打開，不顯示圖表。
  這個任務同樣在 Task 16 後才跑得起來，記在帳本。
- [ ] **Step 2：實作。**
- [ ] **Step 3：執行。** `npm run typecheck`、`npx eslint src --quiet`、`npm test`。
- [ ] **Step 4：提交。** 訊息：`feat(desk): lesson picker with the day's default list, 1–80 stocks, run records, abandon and retired runs`

### Task 14: 文案、說明書、授權頁、講師卡片

**Files:**
- Modify:
  - 交易台元件：`trade-tape.tsx`、`quote-hero.tsx`、`stock-detail.tsx`、`morning-trading.tsx`、`morning-order-book.tsx`、`replay-notice.tsx`、`morning-practice.tsx`、`morning-plan-form.tsx`。
  - 說明書與授權：`manual-page.tsx`（`MANUAL_VERSION = "2026-10-28-lessons1"`）、`docs/pdf-source.json`、`docs/pdf-source.md`、`public/daytrade-tycoon-manual.pdf`、`scripts/build-manual-pdf.test.mjs`、`src/lib/license.ts`（`LICENSE_VERSION = "2026-10-28"`）、`license-page.tsx`。
  - 文件：`README.md`、`docs/broker-integration.md`。
  - 講師卡片：`src/lib/market-data-status.ts`、`src/components/market-data-card.tsx`，以及它們的測試。
- **行情的「模擬」**：
  - 拿掉代理人報告列出的那些行：quote-hero 89、93、100、115、118、124；trade-tape 28、34、36；stock-detail 44；watch-table 78；morning-order-book 124、132、186、190、234；morning-trading 788；morning-practice 1505、1558、1584–1591。
  - 換成真實的說法，例如 tape 的標籤是「富邦逐筆」，報價寫「歷史重播」。
  - 進場說明 `ReplayNotice` 不再出現。
- **撮合說明**改寫 morning-trading.tsx 的 104–105、543–544、643、784，寫法照 ③ §5：
  - 市價用委託後第一筆真實成交；
  - 限價碰到就成交，不考慮排隊與張數，所以對學員稍微有利。
- **紙上練習的標示保留**：模擬帳戶、模擬下單、確認模擬委託、「教學模擬・不連接券商、不送出真實委託」。
- **資料來源**：報價區的來源標籤（quote-hero 239）改成「富邦逐筆／證交所大盤」；沒有大盤的課只寫「富邦逐筆」。頂端顯示「M/D 早盤」（③ §6）。
- **成交時間**：成交紀錄顯示到秒（HH:MM:SS），用 `fill.ms` 算。舊局沒有 `ms`，照舊用 `t`。
- **說明書**（PDF 和網頁）的內容改成：
  - 每日真實教材，從 10/21 起，只有早盤 09:00–10:30；
  - 富邦逐筆、證交所大盤；
  - 有錄到的日子顯示真實五檔，其他日子只有買一賣一；
  - 撮合規則；
  - 自選預設是前一交易日的熱門當沖名單，訪客是成交值前 5 名；
  - 一局 1 到 80 檔；
  - 拿掉 Yahoo、10/05、10/06、「下一分鐘開盤價」和「模擬逐筆」。
  - `build-manual-pdf.test.mjs` 的必含字串照新內容改：拿掉「下一分鐘開盤價」和「模擬逐筆」；加上「富邦逐筆」「熱門當沖」「1 到 80 檔」。
- **授權頁**：寫每日真實教材和富邦行情的授權日期（2026-10-22 使用者確認），以及名單只在收盤後給學員看。
- **講師卡片**多三行：
  - 逐筆：最新一天的檔數、筆數、是否完整；
  - 大盤：有或沒有，失敗時寫原因；
  - 熱門當沖名單：最新日期與檔數，或失敗原因。不列股票。
- **`docs/broker-integration.md`**：記錄名單的使用範圍。
  - 收盤後才看得到；
  - 訪客看不到；
  - 只顯示代號與名稱。

- [ ] **Step 1：寫失敗的測試。**
  - `market-data-status.test.ts`：讀 `status.ticks`、`status.taiex`、`status.radar` 三個欄位，包括缺欄位和格式錯誤時的顯示。
  - `build-manual-pdf.test.mjs`：必含和必不含的字串。
  - 新增 `src/lib/desk-copy.test.ts`：讀上述元件的原始碼，assert 不含「模擬逐筆」「模擬成交」「教學模擬五檔」「Yahoo」，並且仍含「模擬帳戶」。
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：改文案，重建 PDF。** 指令 `node scripts/build-manual-pdf.mjs`，需要 reportlab；沒有就用 `py -3.12 -m pip install --user reportlab pypdf`。
- [ ] **Step 4：執行。** `npm test`、`npm run typecheck`、`npx eslint src --quiet`。
- [ ] **Step 5：提交。** 訊息：`docs(desk): real-data wording, matching rules, manual 2026-10-28-lessons1, licence page and teacher card lines for ticks, TAIEX and the list`

### Task 15: 今天三件事與其他入口

**Files:**
- Modify: `src/components/today-card.tsx`、`src/lib/today-steps.ts`、`src/lib/morning-access.ts`，以及其他連到 `/morning` 的頁面（只在需要時改）。
- 規則：
  - 入口一律不帶課程 id，由 GET 的預設決定：有未完成的局就回那一局，沒有就開最新一天的選課。
  - `unavailable` 時，今天三件事的練習那一步顯示那句話，不顯示按鈕。
  - `REVIEW_CURSOR = 60` 不變。
- [ ] **Step 1：寫失敗的測試** `today-steps.test.ts`：
  - `unavailable morning hides the practice step action`
  - `state null with picker → 開始今天的練習`
- [ ] **Step 2：執行，確認失敗。**
- [ ] **Step 3：實作。**
- [ ] **Step 4：執行，確認通過。**
- [ ] **Step 5：提交。** 訊息：`fix(today): entry points open the newest daily lesson or resume the open run; on-prem shows no practice button`

### Task 16: QA 假資料與交易台 QA 改寫

**Files:**
- Modify: `scripts/qa/make-market-fixture.mjs`、`scripts/qa/desk-seed.mjs`，以及所有用到舊課或固定股票的 `scripts/qa/desk-*.mjs`（代理人報告的表）。
- Create: `scripts/qa/desk-lessons.mjs`

**Interfaces:**
- Consumes: 全部前面任務的格式。
- **假資料**：`writeMarketFixture(dir)` 保留原本的 2026-10-14（每日一題用），另外加三個全市場交易日：2026-10-21、2026-10-22、2026-10-27。每天寫齊 days、ticks、taiex、index.json，名單寫在 `radar/`。資料要涵蓋：
  - 2330、2317、2454、2308、2382 五檔熱門股，保留舊 QA 會選到的股票；
  - 一檔處置股；
  - 一檔早盤完全沒成交的冷門股；
  - 一檔 `complete:false`；
  - 一檔逐筆和 1 分 K 對不起來的股票；
  - 10/22 沒有大盤；
  - 10/27 有 `books/`，其中一檔有 gap，而且 `sizeUnit:"lot"`；
  - `radar/2026-10-22.json` 有 70 檔，含上櫃股和查不到的代號。這份給 10/27 用。
  - `radar/2026-10-20.json` 給 10/21 用。
  - 10/22 這堂課沒有對應的名單，要退回前 5 名。
  - `status.json` 寫入 `ticks`、`taiex`、`radar` 欄位。
- **改寫既有的 QA 腳本**：
  - 寫死的 `OTHER_LESSON` 改成 `fubon-20261022-am`；
  - 「下一檔股票」照新的股票順序；
  - 「模擬逐筆」的公告檢查改成檢查真實逐筆；
  - 自選列數不再固定是 6；
  - `desk-seed` 開局時帶 `codes`。
- **`desk-lessons.mjs` 新增的檢查**：
  - 選課、沒有成交的分鐘、五檔只有買一賣一、五檔 gap、真實五檔；
  - 每次前進的回應大小：2× 時，70 檔那天的 POST 回應壓縮後不超過 60 KB，伺服器時間不超過 100 ms；
  - 訪客的網路回應裡都沒有名單。

- [ ] **Step 1：實作假資料，並改寫 QA 腳本。**
- [ ] **Step 2：建置並跑完整 QA 鏈。**
  - 建置：`rm -rf .output && npm run build:offline && npm run build`，完成後執行 `git checkout -- src/routeTree.gen.ts`。
  - 開三個教室：`PORT_APP=18881 PORT_PROXY=18882`、`18883/18884`、`18885/18886`。指令：`node scripts/qa/desk-server.mjs`，背景執行。
  - 照 `artifacts/mini-zoom-qa/` 的順序跑全部 `desk-*.mjs`：先 `desk-guest`，再 `desk-seed`，再其他。新增的是 `desk-watch80`、`desk-picker`、`desk-lessons`。
  - Expected：全部通過，證據放在 `artifacts/daily-lessons-qa/`。
- [ ] **Step 3：停掉教室。** `node scripts/qa/desk-stop.mjs <proxyPort>`。
- [ ] **Step 4：提交腳本。** 證據不提交。訊息：`test(qa): three-day Fubon fixture (ticks, TAIEX, books, 70-stock list) and desk QA for daily lessons`

### Task 17: 整合測試、真實資料與效能

**Files:**
- Modify:
  - `scripts/hosting/morning-integration.test.mjs`、`guest-integration.test.mjs`：設定 `MARKET_DATA_DIR`，指向假資料。
  - `scripts/onprem/integration.test.mjs`：改為檢查沒有教材時的字。
  - `scripts/hosting/verify-public.mjs`：拿掉兩個舊日期，改檢查 `/api/morning` 未登入時回 401 或 403。
- Create:
  - `scripts/qa/real-day-check.mjs`：讀正式 `market-data` 的唯讀複本，只在本機跑。
  - `scripts/qa/perf-lessons.mjs`
- **真實資料檢查**：
  - 在 scratch 資料夾建 `market-data` 的唯讀複本，只用 hard link 或複製 `index.json`、`days/2026-10-22`、`days/2026-10-27`、`ticks/2026-10-27`。
  - 大盤從證交所公開網址下載 10/27 一份，這是公開資料，不用登入。
  - 名單用 10/27 成交值前 30 名的上市股，自己做一份測試用的假名單，不讀試算表。
  - 用 `buildRunSource` 挑 5 檔熱門股跑完早盤：
    - 每格 K 棒和逐筆一致；
    - 撮合結果可以用逐筆手算重現：腳本裡獨立再算一次撮合，兩邊結果相同。
- **效能**：
  - 30 位練習者從同一個 IP 用 2× 前進，每人 30 秒，量回應時間的 p50/p95 和伺服器記憶體；
  - 標準：p95 < 300 ms，沒有 429。
  - 結果寫進上線紀錄。

- [ ] **Step 1：改寫整合測試。**
- [ ] **Step 2：建置後，用 release 跑整合測試。** `CLASSROOM_TEST_RELEASE=<絕對路徑 .output/server/index.mjs> node --test scripts/hosting/{auth,daily,guest,morning}-integration.test.mjs`。Expected：全部通過。
- [ ] **Step 3：跑真實資料檢查和效能腳本。** Expected：一致；p95 < 300 ms。
- [ ] **Step 4：提交。** 訊息：`test: integration on Fubon fixtures, a real-day consistency check and a 30-practiser load run`

### Task 18: 全套驗收與紀錄

**Files:**
- Create: `docs/daily-lessons-2026-10-28.md`，即建置與驗收紀錄。

- [ ] **Step 1：跑全套。** `npm test`、`npm run typecheck`、`npx eslint src --quiet`、`npm run check:symbols`、`npm run build:offline`、`npm run build`、Python 兩種測試，以及 Task 16 的完整 QA 鏈，Expected 全部綠。補跑 Task 12、13 延後的 QA。
- [ ] **Step 2：寫紀錄。** 內容包括：
  - 測試數量與結果；
  - QA 截圖目錄；
  - 每次前進的回應大小和效能數字；
  - 上線前需要使用者同意的步驟。上線步驟本計畫不執行：
    1. `install.ps1 -Sdk -App` 和 `-RadarSheet <id>`；
    2. 使用者完成附錄 A；
    3. 正式站的 stage、整合測試、備份、啟用、驗證；
    4. 推送。
- [ ] **Step 3：提交。** 訊息：`docs: daily lessons build and acceptance record`
