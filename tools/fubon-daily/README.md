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
