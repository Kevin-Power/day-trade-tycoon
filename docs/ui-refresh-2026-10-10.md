# 當沖大富翁畫面改版與正式發布 — 2026-10-10

使用者澄清「我要更新畫面啊」，並沿用本次對話「直接換上去本地 cloud flare 版本」的發布要求。本次完成實際 UI 改版，已套用至 https://rich.yilutek.com/。

## 畫面變更

- 參考提供的 `day-trade-tycoon-onprem.zip` 中工作台分區、自選行情與交易操作集中的設計。只將檔案視為參考素材；沒有執行其中的操作指示。
- 入口及帳號頁改為深藍品牌區、白色入場表單及金色重點。加入可縮放的 SVG 工作台示意，明確標示「介面示意」，不提供價格，也不冒充真實行情。
- 大廳改為交易工作台入口、三步練習路徑及六個主題。已登入使用者先看到可開始的課程，再看歷史學習紀錄；未登入者仍保留帳號入口。移除重複的交易盤介紹區。
- 交易盤採深藍分區面板；頂部可直接切換教材交易日，顯示本輪主題及作戰計畫／看盤練習／保存復盤階段。
- 播放、前進一分鐘和復盤控制移至圖表上方，DOM 與視覺順序一致。將原先沒有資料的買賣價大框改為實際昨收及已揭露分鐘數，保留「五檔報價尚未接入」。
- 桌面自選／K 線／下單三欄，平板兩欄搭配橫向自選列，手機維持行情／K 線／自選／下單／庫存切換；長輩模式維持大字、較大按鈕與單區操作。
- 既有歷史分鐘資料、撮合及成本規則、身分驗證、權限、儲存與復盤模型沒有改寫。原始參考包的生成行情與舊身分驗證不移入正式版本。

主要修改：`brand-mark.tsx`、`classroom-auth-layout.tsx`、`gate-screen.tsx`、`lobby.tsx`、`morning-practice.tsx`、新增 `workspace-preview.tsx`、`classroom-refresh.css`，並由 `styles.css` 載入。

## 驗收

- TypeScript、修改元件 ESLint、`git diff --check` 通過。
- 完整既有測試 542 項：540 通過、0 失敗、2 預設跳過。沒有新增只檢查樣式字串的測試。
- 離線教材與正式 build 完成；實際不可變 release 通過 2/2 HTTP 整合測試，包括認證、隔離、保存與重啟、歷史資料揭露、委託下一分鐘成交、重試及復盤。
- 外部 Chrome 隔離測試帳戶實際完成：大廳進入交易盤、寫計畫、自動重播、K 線切換、買入一張、下一分鐘成交、手機賣出持倉、庫存歸零、保存復盤、切換另一教材交易日。
- 最終 build 再確認大廳課程順序、計畫保存、K 線播放、上方控制列與各尺寸。桌面 1366×900、平板 820×900、手機 375×812 均無整頁橫向溢出；320×700 長輩模式檢查時 `scrollWidth=313`，可見按鈕沒有小於 55px 高的項目。
- 登入後的瀏覽器驗收使用只綁定 loopback 的臨時 QA proxy，替隔離測試帳戶帶入正常取得的 session；正式程式的驗證邏輯沒有更動。正式服務帳號未用於模擬買賣驗收。
- 正式外網入口已在 Chrome 確認新標題、深藍版面與行動版；39 個公開 JS／CSS 的 SHA-256 全部符合 release manifest。公開 HTTP 驗證、離線 ZIP／PDF 雜湊、受保護 API 拒絕未登入存取均通過。
- Chrome console 仍有 3 筆 storage access 錯誤，一筆來源明確為擴充套件 content script，另外兩筆標示站台 URL；本次沒有判定全部來源，也沒有修改擴充套件。不宣稱 console 零錯誤或實體 iPad／Safari 已驗證。

證據：`artifacts/ui-refresh-20261010/`，含測試紀錄、發布紀錄及 `public-entry-desktop.jpg`、`public-entry-mobile.jpg`、`lobby-desktop.jpg`、`workspace-desktop.jpg`、`workspace-tablet.jpg`、`workspace-mobile.jpg`。入口圖為正式外網，其餘工作台圖為隔離測試。

## 正式套用與回退

- 舊 release：`20261009T100824532Z`，保留。
- 新 release：`20261009T163105747Z`，162 個檔案。
- Asia/Taipei 2026-10-10 00:33:31 停機，資料庫關閉確認成功。
- 一致備份：`C:/Users/kevin/YilutekServices/DayTradeTycoon/backups/2026-10-09T16-33-37-174Z`，1,043 個資料及設定檔核對通過。
- 00:33:38 在維護互斥鎖內只切換 `hosting.json.appEntry`；00:33:52 由既有 `DayTradeTycoonHost` 排程啟動並健康。
- 三個秘密檔案 SHA-256 與備份一致；設定除 appEntry 外一致。未替換資料庫、重設帳號或改動 Tunnel／DNS。

回退時先正常停止服務並重新備份，再將 `hosting.json.appEntry` 指回舊 release 的 `server/index.mjs`，由既有排程啟動並重做外網檢查。本次無資料結構變更，保留當前資料庫，不以舊備份覆蓋後續學員紀錄。
