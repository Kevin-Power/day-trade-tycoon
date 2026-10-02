# 本機接手發布紀錄

狀態：2026-10-02 16:58（Asia/Taipei）已正式切換並完成外部 HTTPS 驗證。

## 發布結果

- 正式網址：https://rich.yilutek.com
- 應用：Windows 本機 `127.0.0.1:8790`；專用 Cloudflare Tunnel `daytrade-tycoon`。
- Tunnel ID：`ef508929-b616-44aa-b295-9a681e114b57`。
- 正式 release：`%LOCALAPPDATA%\DayTradeTycoon\releases\20261002T085537842Z`，116 個檔案附 SHA-256 manifest。
- 原 Vercel CNAME：`14c2250074a6dbcc.vercel-dns-013.com`，回滾步驟見 [維運文件](self-hosting.md)。
- 專用排程 `DayTradeTycoonHost`：Interactive、Limited、目前使用者登入後啟動。主機須保持開機、連網並登入；不是登入前可運作的系統服務。
- Grok 不再負責正式登入、資料庫或服務執行。原 TAIFEX 與波哥服務未修改。

## 教室交付

- 依使用者確認，建立全新班級，不搬移舊學員。
- 五課加期末練習、個人帳號、講師班級檢視、排行、逐筆復盤、24 檔自選與 1,979 檔教材搜尋目錄。
- 入場碼伺服器驗證；正式講師 Email 已在私密設定指定，學生不可透過班級碼或自行聲明取得講師權限。
- 講師初始化入口已設定但尚未建立 owner。使用者需在私密 `/setup#token=...` 入口自行設定密碼；runtime 內另有 `講師首次設定.url`。不得分享該連結或捷徑。
- 帳號不代表付款完成；開課日期、價格、名額與收款方式待教室確認，未啟用線上金流。
- 所有下單仍為模擬；教材快照與投影限制見 [來源紀錄](source-recovery.md)。

## 驗證證據

- 完整測試：239 passed、0 failed、0 skipped。真實 HTTP auth integration 另外通過角色隔離、一次性初始化、限速及重啟後持久化。
- 建置成功；79 個 server module 語法檢查通過；TypeScript 通過；ESLint 0 errors、4 個既有/開發熱更新 warnings；正式依賴 audit 0 vulnerabilities。
- 正式外部 health 200、首頁及 12 個引用資源 200、授權頁新文案可見。
- 未入場的初始化 API 與教材下載均 403；已入場下載 200 且與本機 ZIP SHA-256 相同。驗證腳本：`scripts/hosting/verify-public.mjs`。
- 真實離線瀏覽器：第一课買進、平倉、結算，2 筆成交、0 庫存；無頁面錯誤或外部 API 請求。
- 線上瀏覽器已驗證入場頁、授權頁與無 console error；正式線上完整模擬流程仍待使用者同意勾選入場免責後驗收。不得把離線測試說成已完成線上全流程。

## 教材與備份

- PDF：8 頁、401,971 bytes，逐頁渲染及文字/越界檢查通過；SHA-256 `7429a173cbeb46c4d5b3afb72eabcfa427f7720ec919a79fe9a3a326e653f259`。
- ZIP：802,392 bytes；SHA-256 `6e8d9230a229e8110186e1e28deb5e703e19a279833622c92dde2991ee58a63f`。
- 下載路由 `/api/download/offline` 驗證入場並禁止快取，檔案置於私有 release/downloads。測試網域的舊靜態 URL 有先前 CDN 快取，已不再作為下載入口；其內容只有舊版公開教材。
- 停機一致備份：`%LOCALAPPDATA%\DayTradeTycoon\backups\2026-10-02T08-53-17-237Z`；1,018 檔 SHA-256 核對通過。
- 隔離恢復演練：1,015 個資料檔一致，PGlite 開啟/正常關閉成功；3 個 migrations，帳號、session、profile、交易、初始化 marker 均為 0。原備份未變。演練報告在 runtime `restore-check/drill-2026-10-02T08-59-06-072Z-a81380e7.json`。
- 備份仍在同一台主機；未宣稱具備異地災難恢復。
