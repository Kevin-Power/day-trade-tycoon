# 學員 PDF 維護

`docs/pdf-source.json` 是十頁學員手冊的編輯來源。`scripts/build-manual-pdf.py` 負責 A4 排版，`scripts/build-manual-pdf.mjs` 在 Windows 選用本機 Python 並驗證輸出。

```powershell
npm run build:manual-pdf
node --test scripts/build-manual-pdf.test.mjs
```

產物固定為 `public/daytrade-tycoon-manual.pdf`，不需要網路、教室登入、開發伺服器或瀏覽器。程式先寫暫存 PDF，通過頁數與文字檢查後才取代正式檔案。

環境需要 Python、ReportLab 與 pypdf；本機 Codex bundled Python 會自動找到。其他環境可指定 `MANUAL_PDF_PYTHON` 或 `--python`。字型預設嵌入 Windows 微軟正黑體；可用 `MANUAL_PDF_FONT` 及 `MANUAL_PDF_FONT_BOLD` 指定本機 CJK TrueType 字型。

每次內容或版面修改後，需重新產生並用 Poppler 渲染檢視。特別核對課程的模擬分鐘數、費稅示例、入場／帳號區別、提交成功訊息與離線限制。費用、開課日期與付款方案未正式確認前，不加入虛構資訊。

線上下載使用 `?v=${MANUAL_VERSION}`，避開固定網址的 CDN 舊快取。每次修改 PDF 都需同步更新線上手冊的 `MANUAL_VERSION` 與 PDF 來源版本，同日再修改需加修訂碼，不能重用已發佈的版本值。HTTP 驗收按來源版本核對正式 PDF 的 SHA-256；另在外部 Chrome 由 `/manual` 實際按鈕下載，核對網址與檔案。該頁的入場狀態由瀏覽器解析，初始 HTML 不含下載連結，不能把 HTTP 原始 HTML 當作已渲染畫面。

2026-10-02 版共 8 頁；已逐頁檢視中文、表格、頁眉頁腳與留白，使用 pypdf／pdfplumber 驗證文字及頁數。現有 `--start`、`--url` 參數已移除，避免舊瀏覽器列印流程依賴登入狀態。

2026-10-03 版更新委託估算、ROD／IOC／FOK、部分成交、預留資金、平倉及 API 串接界線。重建 8 頁，通過 PDF 結構與文字測試；重新渲染並檢視內容變更的第 5、8 頁，其餘頁僅更新版本日期。

2026-10-05 版擴為 10 頁，新增手機／長輩模式四步操作，拆開送單與費稅收尾。同步保持暫停、送單結果、保存失敗、重練按鈕，以及本筆金額 30% 提醒；六組任務不代表承諾六堂課。售價、招生聯絡管道與開課日期仍未公告。原始內容已對照當前元件與模擬撮合規則。

## 本版驗證與發佈

最新 `2026-10-05-r2` 隨課程詢問功能發布至 release `20261004T203203228Z`。第 2、10 頁改為網站課程頁詢問入口，保留費用／日期未定及詢問不等於報名付款的說明；其餘頁僅更新版本頁腳。兩個內容變更頁已重新用 Poppler 渲染檢視，仍為 10 頁。正式 `/manual` 按鈕實際下載的 `?v=2026-10-05-r2` 檔案與來源 SHA-256 相同：`9cfde3658a6c96f72c2c7993c4e60fdbb6bb0526969115d1debc85a69cc07507`，440174 bytes。離線包同步此 PDF，ZIP 為 912635 bytes，SHA-256 `027acf531bc202ddc8cde9527b1c3be072a305d67dcefae63d408a45b808006c`。切換與最新驗證見 [課程詢問發布紀錄](course-inquiries-2026-10-05.md)。

以下保留 `2026-10-05` 初版的驗證與發布紀錄，release 與檔案雜湊不是目前最新值。

- 10 頁經 Poppler 渲染逐頁檢視；最後修改第 6、8 頁後重新渲染與檢視。未見文字、表格或頁眉頁腳重疊。pypdf／pdfplumber 檢查 10 頁、版本日期、頁碼、必要文字及字元邊界通過。
- 既有 PDF 4 項測試、TypeScript、修改元件 ESLint、維運檢查腳本語法及正式／離線建置通過；93 個 server modules 語法通過。此輪主要為文案、PDF 與下載網址，未重跑全套撮合測試。
- 最終候選 release 的隔離 HTTP 登入、角色隔離、復盤回饋及重啟持久化測試通過，沒有使用正式學員資料測試寫入。
- 外部 Chrome 正式站登入入場後，確認下載按鈕為 `/daytrade-tycoon-manual.pdf?v=2026-10-05`；實際按下下載，所得檔案 SHA-256 與來源相同。最終版本亦確認重練說明文字。画面保存在忽略目錄 `artifacts/manual-2026-10-05/manual-live.png`。本輪未另做實體手機、iPad 或 Safari 驗收。
- 固定 PDF URL 曾回傳 Cloudflare HIT 舊版，origin 已是新版。版本參數已解決現行按鈕的舊快取；沒有清除 CDN 全站快取，舊書籤的無版本網址可能暫時仍讀到舊檔。
- 正式外網 health、免費體驗、入場保護及離線下載通過；26 個引用資產與 build SHA-256 相同。HTTP 另核對版本化 PDF；券商 endpoint 仍回覆 501，不能送出實單。
- 最終 release `20261004T164619591Z`，147 檔；前版 `20261004T164211610Z` 與本輪前的 `20261004T162056718Z` 均保留。切換前正常停機並確認資料庫關閉，最新一致備份 `backups/2026-10-04T16-46-37-326Z` 的 1025 檔驗證通過。
- 最終 instance `4a3f8701-a045-40b0-9340-f67e0b0ca7dc`，經專用排程啟動；healthy、healthFailures 0、restartCount 0。主機仍須開機、連網且目前使用者保持登入。
- PDF：442225 bytes；SHA-256 `7b547bfaa712eda66a5ddb55e73273b6822aad706badc7c34ea03be55d2f7c22`。
- 離線 ZIP：914353 bytes；SHA-256 `b8ab62b4dd7f2d2e5a5d2dbe3bd6892d9418239494be30ccdc0c352fcbb21b84`。

這是教材與交付一致性的驗證，不是年長學員已學會、模擬技術提升或招生轉換的證據。既有 `first-cohort-pilot.md` 與 `instructor-first-lesson.md` 按鈕名稱已同步；目前仍待安排真人首次與隔日試教，沒有填入虛構結果。
