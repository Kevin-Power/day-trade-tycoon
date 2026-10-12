# 本機 Cloudflare 正式發布 — 2026-10-09

使用者在新版地端包驗證完成後明確要求「直接換上去本地 cloud flare 版本」。已將同一份驗證過的正式程式部署到 `https://rich.yilutek.com`，繼續由既有 Cloudflare Tunnel 轉送至 `127.0.0.1:8790`。

## 發布結果

- 舊 release：`20261008T011056339Z`，保留可供回退。
- 新 release：`20261009T100824532Z`，164 個檔案雜湊核對通過。server/public/downloads 的 163 個檔案與前一階段完成驗證的部署包完全相同。
- 2026-10-09 18:10:40（Asia/Taipei）舊服務正常停止，收到資料庫關閉確認，app 與 tunnel 均退出。
- 一致備份：`C:/Users/kevin/YilutekServices/DayTradeTycoon/backups/2026-10-09T10-10-51-274Z`，1,043 個檔案核對通過。
- 18:10:52 在維護互斥鎖內僅修改 `hosting.json` 的 `appEntry`。切換前再次核對備份與原始檔案一致，沒有替換資料庫或重設帳號。
- 18:11:06 已由既有 `DayTradeTycoonHost` 排程啟動，`launchMode=scheduled-task`；新 instance 為 `83fa0b94-899a-4e44-a3f6-16a762e018aa`。
- 完成檢查時 `healthFailures=0`、`restartCount=0`；實際 app PID 28848 使用新 release，8790 listener 僅綁定 `127.0.0.1`。

保留原本 HTTPS、認證秘密、班級資料、一次性講師設定完成狀態與 Tunnel 設定。三個秘密檔案的 SHA-256 與停機備份一致；除 `appEntry` 外所有 hosting 設定值均一致。正式環境沒有啟用 `CLASSROOM_LOCAL_ONLY`，也沒有執行地端 ZIP 的首次初始化。未更動其他產品服務、DNS 或防火牆。

## 驗證

- 新的不可變 release 在隔離資料庫通過 2/2 真實 HTTP 整合測試：HTTPS 認證設定下的講師初始化、帳號登入、角色隔離、回饋及詢問、重啟持久化；真實分鐘資料揭露、重試、紙上委託與次分鐘成交、持久化。
- 正式外網 HTTPS 健康檢查回覆 200。首頁 18 個引用資產與公開體驗 11 個引用資產可讀；完整公開 JS/CSS 共 41 個檔案 SHA-256 與新 release manifest 一致。
- 未入場的受保護 API／下載回覆 403；只入場、未登入帳號時真實課程 API 回覆 401；私人來源檔案不可公開讀取，舊生成行情入口維持停用。
- 講師首次設定狀態仍為 initialized。經入場驗證的 PDF 與學生離線 ZIP 內容雜湊符合目前正式產物。
- 外部 Chrome 已開啟正式 `/morning` 入口，並實際完成 `/try` 的委託確認、查看成交、平倉與成本三步驟。正式帳號的密碼未在這次驗收使用；完整帳號登入與持久化由上述隔離測試驗證，不混稱為使用既有帳號登入正式站。
- Chrome console 出現 storage access 錯誤，其中一筆明確來自瀏覽器擴充套件 content script，另外兩筆附頁面 URL。本次沒有判定全部錯誤的來源，也未修改使用者擴充套件；正式入口與完整公開體驗仍正常完成，不宣稱該瀏覽器 console 零錯誤。

證據在 `artifacts/cloudflare-release-20261009/`：`preflight.json`、`stage.json`、`candidate-http.log`、`stop.json`、`backup.json`、`activation.json`、`start.json`、`public-verification.log`、`public-assets.json`、`preservation.json`、`final-status.json`、`browser-verification.json` 及正式畫面截圖。網站入口已留在外部 Chrome。

## 回退

先依 `scripts/hosting/host.ps1 stop` 正常停止，確認資料庫關閉並重新備份；再將 `hosting.json` 的 `appEntry` 指回舊 release 的 `server/index.mjs`，用既有排程正常啟動並重做外網驗證。保留目前正式資料庫；本次沒有資料格式變更，不需用舊備份覆寫新產生的學員資料。
