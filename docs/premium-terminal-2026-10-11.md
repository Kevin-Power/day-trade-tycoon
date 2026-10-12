# 2026-10-11 專業模擬交易介面

使用者要求可供付費產品使用的高級、專業下單畫面。此次修改登入後 `/morning` 的實際交易工作台，並沿用已授權的本機服務與 Cloudflare 正式發布流程。

## 畫面與操作

- 石墨黑背景、霧金識別、紅色買進／綠色賣出；一致的數字字體、邊線、狀態與鍵盤焦點。
- 桌面採左側觀察清單、中央行情與 K 線、右側下單、中央下方交易紀錄。帳戶總覽置頂，顯示可用資金、帳戶估值、持有商品與待處理委託。
- 商品標題、已揭露收價與漲跌集中呈現；昨收、開盤、最高、最低直接由該次已揭露資料計算。K 棒詳細資料收進可展開區域。
- 下單區提供設定／核對兩步進度、商品選擇、張數快捷鍵、參考金額、確認送出；待撮合時顯示前進撮合與撤單操作。
- 庫存、委託、成交使用對齊表格。平均成本保留兩位小數；委託保留取消原因；成交列明價格、手續費與稅費。手機改為有欄位標籤的卡片列。
- 手機播放、逐分鐘推進、復盤與快捷張數按鈕至少 44px；送單按鈕 49px。320px 長輩模式下單按鈕至少 56px，交易紀錄不限制固定捲動高度。

主要檔案：`src/components/morning-practice.tsx`、`src/components/morning-trading.tsx`、`src/terminal-premium.css`、`src/styles.css`。

保留原有歷史資料揭露、下一完整分鐘開盤價紙上撮合、資金／庫存限制、費稅與身分驗證。沒有修改交易引擎、資料結構或帳號。未加入券商實單、即時五檔或未支援的限價委託。

## 驗收

- TypeScript、變更元件 ESLint、Prettier 與 `git diff --check` 通過。
- 全套測試 542 項：540 通過、0 失敗、2 個預設整合案例略過；另外指定最終 release 重跑認證與早盤 HTTP 整合測試，2／2 通過。
- 離線包、正式 build、server module 語法、來源 900 根歷史 K 與 build 教材檢查通過。
- 外部 Chrome 的隔離測試帳戶實際操作：核對買進、確認中更新行情導致舊確認停用、買進委託撤回、手機兩張賣出撮合、庫存歸零、再次買進一張、重新載入後保留部位與紀錄。
- 該操作驗收最終有五筆委託（含一筆撤回）、四筆成交，庫存一張；可用資金 7,391,222、帳戶估值 9,971,222。證據為 `browser-trading-result.json`，只含隔離資料。
- 最終視覺驗收另以正常 API 建立兩筆不同價格成交與 27 分鐘進度，平均成本 `2,582.50`；截圖直接使用最終 immutable release `20261011T030009879Z`。
- 桌面 1366×900 的文件寬 1359；平板 820×900 為 813；手機 375×812 為 368；長輩 320×700 為 313。皆無整頁橫向溢出。桌面行情分頁與播放按鈕無重疊。
- React 檢查：hooks 位於元件頂層，摘要由既有狀態推導；單一有效下單區；原有 review revision、雙擊鎖、庫存約束保留；表格具 caption、欄位標題與手機標籤；選單具明確可存取名稱。

Console 仍觀察到既有 `Access to storage is not allowed from this context` 訊息，其中有 Chrome 擴充套件來源；未將它宣稱已修復或宣稱 console 零錯誤。交易與重新載入持久化流程已實測通過。未做實體 iOS／Android、Safari 或讀屏驗收。

證據目錄：`artifacts/premium-terminal-20261011/`。`desktop-final.jpg`、`tablet-final.jpg`、`mobile-ticket-final.jpg`、`senior-final.jpg` 為最終發行版的隔離帳戶畫面。正式站瀏覽器只驗證公開入場頁，未在正式學員帳戶建立測試交易；公開前端檔案逐一比對最終版本雜湊。

## 建置相容性

本機 Windows Application Control 阻擋舊 `rolldown@1.1.0` 原生模組。官方 WASM 路徑在此 Windows 環境無法解析專案入口，未採用。改用 Vite 8.1.5 所相容的固定修補版本 `rolldown@1.1.5`，透過 npm 官方 registry 安裝，未變更任何 Windows 防護設定。package 與 lockfile 已同步；SSR、HTTP 整合和 Chrome 重新通過。參考 [Rolldown 1.1.5 官方版本紀錄](https://github.com/rolldown/rolldown/releases/tag/v1.1.5)。

## 正式發布

- 台北時間 2026-10-11 11:01:48 切換；11:02:02 透過既有 Windows 排程啟動並健康。
- 正式 release：`20261011T030009879Z`，174 個檔案。
- 原正式 release `20261010T033641062Z` 保留。前一候選 `20261011T025651259Z` 僅暫存，未套用；最終差異是手機播放與快捷張數按鈕加大。
- 切換前正常停止與資料庫關閉確認；一致備份 1,043 個檔案且 SHA-256 驗證通過：`C:/Users/kevin/YilutekServices/DayTradeTycoon/backups/2026-10-11T03-01-42-687Z`。
- 僅變更 `hosting.json.appEntry`；其他設定、三個秘密檔案一致，資料未重設。服務仍只監聽 `127.0.0.1:8790`，app PID 為 39520，經原 Cloudflare Tunnel 對外。
- 正式 health HTTP 200；47 個公開 JS／CSS 雜湊符合 release manifest；公共試用、受保護 API、授權 ZIP 與 PDF 檢查通過。Chrome 公開頁面顯示正確標題與教室入場保護。
- 入口：[新版模擬下單](https://rich.yilutek.com/morning?panel=trade)。登入後使用新的實際工作台。

回退仍先正常停止與備份，再將 appEntry 指向保留版本。無 schema 變更，不用舊資料庫覆蓋後續學員紀錄。
