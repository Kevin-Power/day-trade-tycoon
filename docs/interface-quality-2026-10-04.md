# 教室介面質感升級（2026-10-04）

教室入口、首頁、公開課程說明與學習紀錄已更新到正式網站 https://rich.yilutek.com/ 。本輪為展示與操作呈現調整；課程資料、身份守衛、撮合引擎與券商能力沒有變更。

## 改版內容

- 新增共用 SVG 品牌圖示，入口、課程、首頁與講師工作區採一致識別。
- 教學頁使用暖白、深綠與少量金色；統一字重、留白、邊框、按鈕與卡片層次。
- 首頁加入三步練習方法，六張課程卡以課序和對應圖示辨識。
- 公開課程頁以封面、學習收穫、章節導覽與階段分組呈現。階段依原資料分成 1／3／2 組任務。
- 學習紀錄以一致卡片與統計呈現；數字仍來自已存在的資料，不新增虛構成就。
- 長輩模式保留大字與 56px 主要按鈕，強化輸入邊線；列印明確轉換深底面板文字顏色。
- 樣式限教學頁使用，未更動交易終端的深色市場配色。

## 驗證

- scoped ESLint、TypeScript 通過；`npm test`：445 tests / 22 suites 通過。
- `npm run build:offline`、`npm run build` 通過；93 個 server module 語法驗證通過。
- 新 release 的隔離 HTTP 整合測試通過：入場、登入、講師與學生權限、復盤、回饋、重啟持久化。
- 本機隔離測試資料庫驗收學習頁回饋篩選、講師工作區，沒有向正式資料庫寫入測試學員。
- 瀏覽器檢查桌機 1440、平板 820、手機 390 與小手機 320 寬度；手機與平板長輩模式未見横向溢出。
- 收到更新的本機瀏覽器操作規則後，立即停止內建瀏覽器的尺寸操作與清理，改用外部 Chrome。外部 Chrome 公開課程頁另驗證 1440 桌機與 390 手機長輩模式，頁面、按鈕切換與章節呈現正常。
- Chrome console 有 `Access to storage is not allowed from this context` 訊息，其中一筆來源為擴充套件 content script；未定位另外同時訊息的根因，不能宣稱外部 Chrome console 完全無錯誤，也不代表 Codex 原生當機已修復。
- 公開 health／首頁／課程與免費體驗／入場保護／離線包驗證通過；26 個頁面引用資產 SHA-256 與本機產出相符，測試 fixture 字串未進入正式資產。
- 券商下單端點仍回 501，未啟用真實委託。

視覺證據保存在忽略的 `artifacts/quality-2026-10-04/`；其中 `public-course-chrome-desktop.png`、`public-course-chrome-phone-senior.png` 為正式網站的外部 Chrome 截圖，其餘 learning／teacher 圖使用隔離測試資料。

## 發佈與回復

- 新 release：`20261004T151021308Z`，146 個檔案。
- 前版：`20261003T232959301Z`，保留供回復。
- 正常停止前版後備份：`%USERPROFILE%\YilutekServices\DayTradeTycoon\backups\2026-10-04T15-14-01-606Z`，1025 檔驗證通過。
- 新 instance：`a78f5d07-3dab-44a4-a111-cd7f0ddd412e`；啟動後 healthy，restartCount 0。
- 離線 ZIP：874834 bytes，SHA-256 `9900f5b667fa8898d094b8325f6c865e91e7e4e3fc44fb80d5d3c0d339d50cb4`。
- PDF 未重建，正式檔案 SHA-256 `36f977166b97869bffb104c5cac71fda05f5fe106f40a7d52d16fbb7c04da7e7`。

若需回復，依 `docs/self-hosting.md` 正常停止服務、建立當下備份，再將 runtime 的 `hosting.json` 中 `appEntry` 指回前版 `server/index.mjs`，啟動並跑外網驗證；不回滾學員資料庫，也不覆蓋既有 release。

維運仍為目前使用者登入後啟動，主機需保持開機、連網且避免休眠。本輪不新增收費、金流、券商連線或招生日期承諾。
