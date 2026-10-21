# 富邦每日行情抓取程式

每個平日 16:45、17:30、19:00 由 Windows 排程 `DayTradeTycoonMarketData` 執行，抓取上市普通股的富邦 1 分 K，寫入 `%USERPROFILE%\YilutekServices\DayTradeTycoon\market-data\`。設計見 `docs/superpowers/specs/2026-10-16-fubon-daily-pipeline-design.md`。

- **只讀行情**：不呼叫帳務或下單 API。
- **登入設定**：`C:\Users\kevin\.fubon\credentials.local.py`，由使用者自己填寫。程式只用 `ast` 讀字串、不執行；設定檔放在 Git 專案裡會被拒絕。
- **排程執行的複本**：排程跑的是 `DayTradeTycoon\fetcher\app\` 裡的複本，不是 repo 的工作目錄。改了程式要先提交，再執行 `install.ps1 -App`。
- **最後一次執行**：18:50 以後開始的執行，視為當天最後一次，失敗時跳出 Windows 通知。

## 逐筆成交（2026-10-20 起）

富邦的逐筆成交（`intraday/trades`）只提供當天，沒有日期參數，所以每天的排程都會順便收下來，錯過就補不回來。

- **抓哪些股票**：當天有成交的全部上市普通股（2026-10-21 起，約 1,050 檔；10/20 只抓教材股與成交值前 20 名）。成交值大的先抓，時間不夠被截斷時，先保住成交最多的股票。
  - 用 10/20 的資料估算：每天約 85–190 萬筆、3,500–5,600 次呼叫、20–40 分鐘、存檔 20–40 MB。
  - 16:45 那次因此會跑到 17:30 以後。排程設定是「已有工作在跑就不再啟動」，Windows 會直接略過 17:30 那次（日誌裡不會留下紀錄），所以通常只剩 19:00 一次重試。
- **順序**：快照之後馬上抓逐筆，接著才抓處置股清單和 1 分 K。逐筆失敗只記在狀態檔，不會擋住 1 分 K 上架。
- **先存再檢查**：富邦的回應一收到就先存進暫存區，再做檢查，所以檢查規則寫錯也不會丟資料。
- **重抓**：遇到下面幾種情況，這一次先不上架，下一次排程再處理：
  - 富邦回 404 或空的，抓到一半出錯，或逐筆量少於當日量：丟掉這次的回應，重抓。
  - 沒通過檢查：保留原本的回應，下一次直接拿它重新檢查，不再重抓。
  - 已經抓齊的股票，不會再抓一次。
- **最後一次執行**：18:50 以後那次，會把手上有的全部上架，並跳出 Windows 通知。
  - 少於當日量的，標成 `"complete": false`。
  - 沒通過檢查的，原始回應連同原因放進 `rejected`。
- **補上架**：前一天的逐筆如果還留在暫存區（例如晚上的排程沒跑到），之後任何一次執行都會先把它上架，不需要登入。
- **時間上限**：前兩次執行，逐筆超過 45 分鐘就不再開始抓新的股票，留時間給 1 分 K。最後一次最多 70 分鐘：排程跑滿兩小時會被 Windows 停掉，要留時間給 1 分 K、上架和通知。
- **富邦連續出錯**：連續 15 檔重試後仍然出錯，就當作富邦暫時故障，這次不再開始抓新的股票；已經抓到的照常檢查、上架。
- **存放位置**：`market-data\ticks\<日期>\`。
  - `manifest.json`：股票清單、筆數、`rejected`、警告，以及每個檔案的雜湊。
  - `symbols\<代號>.json.gz`：每筆 `[09:00 後的毫秒, 成交價, 單量(張), 買價, 賣價]`。
  - `raw\<代號>.json.gz`：富邦原始回應。
- **保留期限**：永久保留，不會被清理。
- **盤後定價**：14:30 的盤後定價成交也會出現在逐筆裡。2026-10-20 實測：這筆沒有累計量、沒有買賣價，流水號是 99999999，而且快照的當日量不含它。所以 13:35 以後的成交另外存在 `afterHours`，manifest 記下它的筆數和張數，不列入當日量比對。
- **檢查**（只看一般交易時段，也就是 13:35 以前，延後收盤也算在內）：
  - 時間必須在當天 09:00–14:30 之間。13:35–14:00 之間如果有成交，記成警告。
  - 流水號要遞增，累計量必須等於逐筆單量加總。
  - 一般時段的逐筆總量少於當日量時，判為不完整，要重抓。總量多於當日量，或最後成交價和快照收盤價不同時，記成警告。
- **實測的富邦格式**（2026-10-20）：
  - 每頁最多 500 筆，`limit` 設多大都一樣；抓到最後一頁之後會回空的頁面。
  - 時間是微秒，單量以張計算。台積電一天約 4,600 筆、11 次呼叫，原始資料約 530 KB。
- **狀態**：結果寫在 `status.json` 的 `ticks` 欄位。講師卡片目前還不顯示。
- **補抓**：用 `--date` 補抓過去的日子時，只抓 1 分 K，不抓逐筆。

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
