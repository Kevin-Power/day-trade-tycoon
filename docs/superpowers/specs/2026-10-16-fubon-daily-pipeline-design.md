# 富邦每日資料管線設計（子專案 2）— 2026-10-16

## 背景與目標

使用者要求教室改用真實的富邦 1 分 K，每個交易日自動新增一天教材，正式站全班可用。方向已在 `docs/superpowers/specs/2026-10-15-jiangbo-chart-quality-design.md`（「子專案 2、3」段）定案。本文件只涵蓋子專案 2，也就是每天把資料抓下來、驗證、存證、放到正式站資料夾，並讓講師看得到狀態。學員選股與網站讀取教材屬於子專案 3。

**成功的樣子**：
- 每個交易日 19:30 前，`DayTradeTycoon\market-data\days\<日期>\` 出現一份完整、驗證過的全市場資料：當天有成交的上市普通股，每檔都有 1 分 K（開高低收、量、均價）。
- 抓取失敗或資料不完整時，當天不上架，講師頁顯示原因，必要時跳出 Windows 通知。
- 金鑰與憑證只留在 `C:\Users\kevin\.fubon\`，不進 Git、網站程式、日誌或狀態檔。

## 已確認的決策

1. **範圍**：全部上市普通股（TSE、`COMMONSTOCK`），不含上櫃與 ETF。
2. **資料來源**：只用歷史 K 線 `historical/candles`（`timeframe=1`）。官方保證 16:30 前更新完成，同一套程式也能補抓過去交易日。盤中 K 線不用。
3. **執行方式**：本機獨立的 Python 程式，由 Windows 工作排程器執行；網站只讀檔案，碰不到券商與金鑰。
4. **SDK**：富邦官方 2.4.0，安裝在專用的 Python 3.12 環境。下載時記錄並核對 SHA-256。
5. **保存期限**：教材永久保存；原始存證保存 1 年，之後自動刪除。
6. **失敗通知**：講師頁顯示狀態，再加 Windows 桌面通知。
7. **授權**：行情顯示給全班的授權由使用者向富邦確認（沿用子專案 1 規格的前提）。

## 實測結果（2026-10-16 只讀探針，SDK 2.3.0）

報告在 `artifacts/fubon-probe-20261016/probe.json`（不進版控，只含行情統計）。

**快照與清單**
- `snapshot/quotes`（`market=TSE`、`type=COMMONSTOCK`）一次回傳 **1,054 檔**，日期是當天。欄位有 `symbol, name, openPrice, highPrice, lowPrice, closePrice, change, changePercent, tradeVolume（張）, tradeValue, lastPrice, lastUpdated, type`。
- 當天完全沒成交的 5 檔 `closePrice` 為空；`change` 每檔都有。
- `snapshot/actives`（依成交值排行）回傳全部 1,054 檔，但快照本身已有 `tradeValue`，所以不另外呼叫。
- `intraday/tickers` 加上 `isDisposition=true` 可以取得處置股清單（當天 7 檔）。

**1 分 K（10/15 的資料）**
- **熱門股**：266 根，09:00–13:24 每分鐘一根，再加 13:30 一根。13:25–13:29 沒有 K 棒。
- **冷門股**：沒成交的分鐘不回傳 K 棒，不會出現量為 0 的 K 棒。有些整天只有 5–15 根，也可能沒有 13:30 那根。
- **處置股**：K 棒稀疏，例如 2424 有 91 根，最後一根在 13:14。
- **欄位**：時間是 ISO 8601、`+08:00`。每根都有 `average`，`volume` 是整數（張）。
- **量的差異**：冷門股的分 K 量加總約等於日 K 量。熱門股只有日 K 量的 78–94%，因為日 K 量還含盤後與鉅額交易。
- **未指定 `sort` 時**，回傳順序是由晚到早。

**速度與可用時間**
- 歷史 K 線每次呼叫中位數 0.06 秒、最長 0.35 秒。每秒呼叫一次、連續 30 次都沒有被限流。
- 上限每分鐘 60 次，換算 1,054 檔約 18 分鐘。
- 16:36 查當天的歷史 1 分 K，已經有完整的 266 根。

## 範圍

**包含**：
- 抓取程式：`tools/fubon-daily/`。
- 安裝腳本：建立專用環境、安裝 SDK、複製程式、建立排程。
- 每日抓取、驗證、存證、上架、保存期限、狀態檔與日誌。
- 補抓過去交易日。
- Windows 通知。
- 正式站把 `MARKET_DATA_DIR` 傳給網站。
- 講師頁的「富邦每日行情」卡片。

**不包含**：
- 網站讀取教材、學員選股、早盤／整天的選擇、撮合處理稀疏分鐘（子專案 3）。
- 上櫃、ETF、盤中即時行情、下單。
- 地端版的抓取程式。地端版講師頁會顯示「此教室未設定富邦每日資料」。

## 設計

### 1. 程式與執行環境

- **程式放在 repo 的 `tools/fubon-daily/`**，每個模組只做一件事：
  - `credentials.py`：用 `ast` 讀設定檔的字串，從不執行它。設定檔位在任何 Git 工作目錄內（往上找得到 `.git`）時，拒絕執行。
  - `fubon_client.py`：唯一直接呼叫 SDK 的地方。對外提供 `login()`、`snapshot_quotes()`、`disposition_symbols()`、`minute_candles(symbol, date)`、`daily_candle(symbol, date)`、`listed_names()`、`logout()`，回傳一般的 dict。
  - `normalize.py`：純函式，負責驗證 SDK 回應並轉成教材格式，不連網。
  - `store.py`：暫存區、原子上架、清單、保存期限、狀態檔、單一執行鎖。
  - `notify.py`：Windows 通知，用 PowerShell 內建的通知 API，不需要額外套件。
  - `fetch_daily.py`：命令列入口，串起整個流程。
  - `tests/`：`unittest`，用假的 client，不登入、不需要 SDK。
- **安裝腳本 `tools/fubon-daily/install.ps1`**（每一步可重複執行）：
  1. 在 `DayTradeTycoon\fetcher\.venv` 用 Python 3.12 建立專用環境。
  2. 下載富邦官方 `fubon_neo-2.4.0-cp37-abi3-win_amd64.zip`（`https://www.fbs.com.tw/TradeAPI_SDK/fubon_binary/`），把壓縮檔與內含 wheel 的 SHA-256 記到 `fetcher\sdk-lock.json`。之後重裝都比對這組雜湊，不一致就停止。
  3. 安裝 wheel 與它的相依套件。
  4. 把 `tools/fubon-daily/*.py` 複製到 `DayTradeTycoon\fetcher\app\`，並記錄來源提交。排程只執行這份複本，不直接跑 repo 的工作目錄。
  5. 建立排程。
- **排程**：
  - 工作名稱 `DayTradeTycoonMarketData`，週一到週五 16:45、17:30、19:00 各觸發一次。
  - 19:00 那次加 `--last-attempt`。
  - 工作目錄是 `DayTradeTycoon\fetcher\work\`，SDK 自己產生的 `log/` 會放在這裡。
  - 與現有的 `DayTradeTycoonHost` 一樣，只在使用者登入時執行，不保存 Windows 密碼。這台電腦平日 16:45–19:00 必須開機並登入。
- **登入設定**：用 `--credentials C:\Users\kevin\.fubon\credentials.local.py`，欄位有 `PERSON_ID`、`API_KEY` 或 `SECRET_KEY`、`CERT_PATH`、`CERT_PASSWORD`。

### 2. 每日流程

`fetch_daily.py --data <market-data> --credentials <path> [--date YYYY-MM-DD [--symbols a,b]] [--last-attempt]`

`--symbols` 只能搭配 `--date` 使用。結束碼：`ok`、`closed`、`already-done` 為 0；`failed` 為 1；設定檔、登入、憑證或 SDK 載入錯誤為 2。

1. **單一執行鎖**：取得 `market-data\.lock`，內含 PID 與開始時間；原本的 PID 已不存在時，視為過期的鎖。取不到就結束，記為「上一個工作仍在執行」。取得鎖後，先把狀態寫成 `running`。
2. **已完成就結束**：目標日期已經在 `days\<日期>\` 就結束，記為 `already-done`。沒有 `--date` 時，目標日期是台北時間的今天。
3. **登入**：失敗時把原因寫進狀態，立刻通知，結束碼 2。
4. **快照（每日模式）**：
   - 取得上市普通股快照。快照日期不是目標日期，就記為 `closed`（休市）並結束，結束碼 0。
   - 取得處置股清單。
   - 名單是 `tradeVolume > 0` 的股票。平盤參考價 = `closePrice − change`。
5. **資料是否已更新**：先抓成交值第一名的 1 分 K，必須有 13:30 那根。沒有就記為 `failed`，原因是「富邦歷史資料尚未更新」，交給下一次排程。
6. **逐檔抓 1 分 K**：
   - 使用 `sort=asc`，`fields=open,high,low,close,volume,average`。
   - 呼叫間隔至少 1.1 秒。
   - 被限流（HTTP 429）時等 60 秒再試一次；其他錯誤最多重試 2 次。
   - 回應立刻寫進暫存區的原始存證，下一次執行時已經抓到的就不重抓。
   - 回傳空資料或 404 的股票（當天只有盤後或鉅額交易），排除並記為警告。
7. **驗證**（見第 3 節）：任何一檔出現「錯誤」，當天就不上架，狀態記為 `failed`，原因列出前幾檔與錯誤種類。
8. **上架**：
   1. 在暫存區寫好每日資料夾，最後寫 `manifest.json`。
   2. 整個資料夾改名搬到 `days\<日期>\`；原始存證搬到 `raw\<日期>\`。
   3. 用「暫存檔＋改名」更新總清單 `index.json`。
9. **收尾**：刪除超過 365 天的 `raw\<日期>\`（`days\` 永不刪），以及超過 90 天的日誌。最後寫入狀態。

**補抓模式（`--date` 指定過去的日期）**
- 沒有當日快照，所以：
  - 股票名稱來自上市清單（`intraday/tickers`）。
  - 每檔另查當天日 K，得到收盤、漲跌與成交量；平盤參考價 = 收盤 − 漲跌。
  - 是否為處置股記為 `null`（未知）。
- 加 `--symbols` 時只抓指定的股票，每日清單標記 `coverage: "selected"`；全市場標記 `"full-market"`。
- 首次上線時補抓 10/05、10/06 的 2330、2317、2454、2382、2308，供子專案 3 取代 Yahoo 教材。

### 3. 驗證規則

**錯誤（擋下上架）**
- 回應不是物件，或 `data` 不是陣列；`symbol` 與要求的不同。
- 時間無法解析、不是 `+08:00`，或日期不是目標日期。
- 時間不在 09:00–13:24 或剛好 13:30，或不是嚴格遞增（有重複或倒序）。
- 開高低收不是正數，或 `low > min(open, close)`、`high < max(open, close)`、`low > high`。
- `volume` 不是非負整數，或 `average` 不是正數。

**警告（記在清單，不擋上架）**
- 分 K 量加總大於快照當日量（張）。
- 最後一根收盤價不等於快照收盤價。
- 快照有成交量，但歷史 K 線回傳空資料。

### 4. 資料格式

全部放在 `%USERPROFILE%\YilutekServices\DayTradeTycoon\market-data\`。這個位置在 `releases` 之外，正式站備份（只備份 `data`、`secrets`、`hosting.json`）也不會包含它。

- **總清單 `index.json`**：
```json
{ "schema": 1,
  "days": [{ "date": "2026-10-16", "coverage": "full-market", "symbols": 1049,
             "manifestSha256": "…", "publishedAt": "2026-10-16T17:05:12+08:00" }] }
```
- **每日清單 `days/<日期>/index.json`**（依 `tradeValue` 由大到小排序）：
```json
{ "schema": 1, "date": "2026-10-16", "coverage": "full-market", "volumeUnit": "lot",
  "source": "fubon-neo 2.4.0 historical/candles timeframe=1",
  "fetchedAt": "2026-10-16T17:04:58+08:00",
  "symbols": [{ "code": "2330", "name": "台積電", "referencePrice": 2490, "close": 2440,
                "change": -50, "tradeVolume": 58487, "tradeValue": 80781285000,
                "disposition": false, "bars": 266 }] }
```
- **每檔分 K `days/<日期>/symbols/<代號>.json.gz`**：
```json
{ "schema": 1, "code": "2330", "date": "2026-10-16", "volumeUnit": "lot",
  "bars": [[0, 2420, 2435, 2420, 2435, 6446, 2420.92], [16200, 2440, 2440, 2440, 2440, 5833, 2437.47]] }
```
  每根是 `[t, open, high, low, close, volume, average]`。`t` 是距離 09:00 的秒數，與網站的 `Bar.t` 相同，13:30 是 16200。
- **`days/<日期>/manifest.json`**：
  - 每個檔案的 `path`、`bytes`、`sha256`。
  - `symbols`、`bars` 與 `excluded` 的數量。
  - `warnings`（含代號、種類、說明）、建立時間與程式版本（來源提交）。
- **原始存證 `raw/<日期>/`**：
  - 內容：`snapshot.json.gz`、`disposition.json.gz`、`minute/<代號>.json.gz`，補抓模式另有 `daily/<代號>.json.gz`。
  - 格式是 SDK 回應的完整 JSON（鍵排序後壓縮）。SDK 不提供原始 HTTP 位元組。
- **狀態檔 `status.json`**：
```json
{ "schema": 1, "latestDay": "2026-10-16",
  "lastRun": { "date": "2026-10-16", "mode": "daily", "startedAt": "…", "finishedAt": "…",
               "outcome": "ok", "reason": null,
               "symbols": { "total": 1049, "fetched": 1049, "failed": 0, "excluded": 0 } },
  "history": [{ "date": "2026-10-16", "outcome": "ok", "finishedAt": "…" }] }
```
  `outcome` 是 `running`、`ok`、`closed`、`failed`、`already-done` 之一；`history` 保留最近 30 次。
- **日誌 `logs/<日期>.log`**：每次執行的步驟、耗時與錯誤摘要。
- **預估大小**（以實測結果推算，驗收時再量實際值）：教材每天約 1–2 MB（壓縮後），原始存證每天約 3–4 MB。

### 5. 秘密保護

- 狀態檔、日誌、清單與錯誤訊息寫出前，一律把 `PERSON_ID`、金鑰與憑證密碼字串換成 `＊＊＊`。
- 登入回傳的帳戶物件只在記憶體使用，不寫入任何檔案。
- 抓取程式不呼叫任何帳務或下單 API。
- 設定檔位在 Git 工作目錄內時拒絕執行。

### 6. 失敗通知

只在兩種情況跳出 Windows 通知（PowerShell 內建 API，標題「當沖大富翁每日行情」）：
- 加了 `--last-attempt` 的 19:00 那次仍然 `failed`。
- 重試也救不了的錯誤：設定檔缺欄位或位置不允許、登入失敗、憑證錯誤、SDK 無法載入。這類錯誤每次都立即通知。

### 7. 網站端（正式站與講師頁）

- **`scripts/hosting/supervisor.mjs`**：傳給網站的環境多一項 `MARKET_DATA_DIR=<runtime>\market-data`。地端版的 `scripts/onprem/launcher.mjs` 不設定。
- **新增 `src/lib/market-data-status.ts`（純函式，附測試）**：
  - `parseMarketDataStatus(status, index)`：驗證兩份 JSON 的格式。不符合就回傳「狀態檔格式錯誤」，不拋出例外。
  - `expectedTradingDay(now)`：最近一個已過 19:30 的平日（台北時間）。
  - `marketDataSummary(parsed, now)`：回傳卡片要顯示的資料。若預期日期既沒有教材，也沒有 `closed` 紀錄，就加上「預期應有 <日期> 的教材，請檢查排程」。
- **新增 `src/lib/market-data.ts`**：伺服器函式 `loadMarketDataStatus`。講師權限檢查與 `loadTeacherRoster` 相同。讀取 `MARKET_DATA_DIR` 下的 `status.json` 與 `index.json`，只回傳卡片需要的欄位。
- **`src/components/teacher-workspace.tsx`**：最上方加「富邦每日行情」卡片，顯示：
  - 狀態標籤：成功／休市／失敗／執行中／尚未執行／未設定。
  - 最新教材日、股票數、已累積天數。
  - 最近一次執行的時間與耗時。
  - 失敗原因與「請檢查排程」的提醒。
- **其他**：學員看到的畫面不變。

## 受影響的檔案（預估）

- **新增 `tools/fubon-daily/`**：
  - `credentials.py`、`fubon_client.py`、`normalize.py`、`store.py`、`notify.py`、`fetch_daily.py`
  - `install.ps1`、`README.md`
  - `tests/`（含固定測試資料）
- **新增網站端**：`src/lib/market-data-status.ts`（含測試）、`src/lib/market-data.ts`。
- **修改**：
  - `src/components/teacher-workspace.tsx`、`src/routes/teacher.tsx`（載入狀態）
  - `scripts/hosting/supervisor.mjs`（含既有測試的調整）
- **紀錄**：`docs/fubon-daily-2026-10-16.md`（驗收與上線紀錄）。

## 測試與驗收

1. **Python 單元測試**（`tools/fubon-daily/tests`，假 client，不登入）：
   - **驗證**：完整 266 根、稀疏冷門股、處置股、沒有 13:30 那根的股票都通過；時間錯誤、重複、倒序、開高低收不合理、量是小數或負數、均價缺漏都被擋下。
   - **流程**：
     - 休市時記為 `closed`。
     - 第一名沒有 13:30 那根時記為「尚未更新」。
     - 限流時等待後重試成功。
     - 單檔失敗時整天不上架。
     - 第二次執行只抓缺的股票。
     - 已完成時記為 `already-done`。
     - 單一執行鎖與過期的鎖都正確處理。
   - **上架**：每日資料夾整批改名；清單的 SHA-256 正確；總清單只有在上架後才更新。
   - **保存期限**：刪除超過 365 天的 `raw`，保留 `days`。
   - **秘密**：
     - 設定檔在 Git 工作目錄內時拒絕執行。
     - 用假的設定字串跑完整流程，包括故意讓登入失敗，之後掃描狀態檔、日誌與清單，都找不到那些字串。
   - **通知**：只在上述兩種情況呼叫通知（用假的通知函式驗證）。
2. **Node 測試**：
   - `parseMarketDataStatus` 的正確與錯誤格式。
   - `expectedTradingDay` 遇到週末與 19:30 前後的結果。
   - 「請檢查排程」提醒的判斷。
   - `npm test`、`npm run typecheck`、`npx eslint src --quiet` 全部通過。
3. **實機驗收**（需要使用者同意的步驟會先問）：
   1. 執行 `install.ps1`：下載 SDK 2.4.0 前，先告知檔名、來源與大小；建立排程前也先詢問。
   2. 手動抓一次 10/16：股票數與快照中有成交的檔數一致；`manifest` 核對通過；記錄耗時與資料大小。
   3. 補抓 10/05、10/06 的 5 檔，標記為 `coverage: "selected"`。
   4. 重新部署正式站（`MARKET_DATA_DIR`＋講師卡片），用講師帳號登入確認卡片內容。這一步由使用者登入。
   5. 確認 10/19（週一）排程自動執行成功。

## 風險

- **電腦必須開機並登入**：平日 16:45–19:00 這台電腦要開機並登入，否則排程不會執行。講師卡片會在 19:30 後提醒。
- **金鑰到期或被停用**：會登入失敗並立刻通知；需要使用者到富邦更新金鑰，再更新設定檔。
- **富邦 API 或 SDK 改版**：SDK 版本固定為 2.4.0，雜湊也鎖定。若回應格式改變，驗證會擋下上架，不會寫入錯誤資料。
- **富邦事後修正歷史資料**：已上架的日期不會自動重抓，也沒有覆寫機制。若之後發現需要重抓，另開工作處理。
- **授權**：行情授權由使用者向富邦確認。
- **空間**：預估每年教材約 0.3–0.6 GB、原始存證約 1 GB（保留一年）。驗收時記錄實際大小。
