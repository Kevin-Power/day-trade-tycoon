# 正式站發布 2026-10-19：逐像素圖示組

使用者要求「換成逐像素設計的圖示組」，看過成品與前後對照後核准：「直接上線」（2026-10-19）。

## 內容

| 項目 | 說明 |
|---|---|
| `d57e7e0` | 畫面 QA 新增圖示檢查（`scripts/qa/icon-grid.mjs`）：圖示必須是 15 的倍數 px、不能留有舊圖示。在上一個正式版上全部失敗 |
| `49f8113` | 改用 Teenyicons 0.4.1（MIT，15×15 格、1 像素線條）＋ 8 個自繪圖示，取代 lucide。來源在 `scripts/icons/`，由 `scripts/build-icons.mjs` 產生 `src/lib/icons/index.ts`；42 個檔案改匯入來源，尺寸對齊 15／30／45px；移除 `lucide-react` |
| `ff38b7f` | 升級慶祝的星芒 28px → 30px（QA 第一次執行抓到） |
| `b65510b` | 手機底部分頁圖示：標準字 15px、大字 30px |
| `361c24c`、`4926f1c` | 大字模式下，只有圖示的按鈕（兩個登出、顯示密碼）圖示放大到 30px（最終審查抓到） |

- 不碰撮合、交易核心或資料。
- 合併方式：fast-forward 併入 `codex/course-handover`，已推送；`claude/pixel-icons` 也已推送。
- 建置：在乾淨的 worktree 先 `npm run build:offline` 再 `npm run build`，離線包驗證通過。

## 效果（交易台上全部 15 個圖示實測）

圖示用到的像素裡，完全上色、不是灰色過渡的比例：

| 螢幕 | 改前 | 改後 |
|---|---|---|
| 1 倍 | 3.8% | 30.5% |
| 2 倍 | 26.6% | 38.3% |

剩下的過渡像素是斜線與圓弧。只有整數倍的螢幕縮放（1 倍、2 倍）能做到逐像素；Windows 125%／150% 縮放無法完全對齊。

## 發布前驗證

**測試與檢查**
- 單元測試 776 個：772 通過、0 失敗、4 略過。
- typecheck 通過；`eslint src` 0 錯誤（5 個警告原本就有）。

**畫面 QA**：以下都通過。
- 依序跑 `desk-discipline`、`desk-guest`、`desk-daily`、`desk-guest-resilience`。
- 種子資料後跑 `desk-premium`、`desk-layout --strict`、`desk-sharpness`（4 種實際縮放倍率）、`desk-states`、`desk-orders`、`desk-premium`（平盤）。
- `desk-pages`：大廳、體驗、手冊、登入、授權頁，涵蓋 1366、375、375 大字。

**候選 release** `20261019T040330511Z`
- 隔離整合測試 4/4。
- 拋棄式教室：首頁 200，種子資料、`desk-orders`、`desk-sharpness`、`desk-pages` 都通過。

**過程紀錄**
- 平盤 `desk-premium` 前兩次都是 429：測試教室的訪客匿名登入上限是每 10 分鐘 60 次，整串檢查在 10 分鐘內開了太多新瀏覽器。等 10 分鐘重跑就通過。屬環境問題。
- 兩次失敗的紀錄都保留在 `artifacts/pixel-icons-qa/first-run/`。

## 停機與切換

- 04:05:38Z 正常停機，資料庫確認已關閉。
- 備份 `backups/2026-10-19T04-05-39-291Z`：1,059 個檔案，逐檔核對通過。
- 只改 `appEntry`：從 `20261019T023804091Z` 改成 `20261019T040330511Z`。
- 用主工作區的 `host.ps1` 啟動，04:05:53Z 恢復健康，由排程工作監督，停機約 15 秒。

## 發布後檢查

- 46 個公開 JS／CSS 資源的 SHA-256 和 release 相同。比上一版少 14 個，因為 16 個 lucide 圖示小檔不再存在。
- 設定除了 `appEntry` 都沒變；3 個秘密檔案的雜湊沒變（只比對雜湊，沒有讀內容）。
- `/`、`/daily`、`/progress`、`/teacher`、`/morning`、`/try`、`/license`、`/manual`、`/sw.js`、`/manifest.webmanifest` 都是 200；`/server/index.mjs` 404。
- 沒有入場碼時，`/api/daily`、`/api/morning`、`/api/discipline` 都回 403；8790 只綁 127.0.0.1。
- `/api/health`：`mode: simulation`。

## 已知、未處理（最終審查的次要項目）

- 前端打包會刪掉所有授權註解，所以瀏覽器下載的程式碼沒有 Teenyicons 的 MIT 聲明。原始碼和伺服器端打包檔有。之後可以補一份第三方授權聲明。
- 幾個只有圖示的小按鈕（切換股票、張數加減、下拉箭頭）的圖示偏小，按得到的範圍沒有變。
- 原本 20–22px 的卡片圖示變成 15px。
- 圖示檢查掃不到沒打開的對話框、收合的區塊，以及 `/teacher`、`/setup`。
- Safari／iPad、Firefox 與真實手機尚未驗證。

## 回退

把 `appEntry` 指回 `20261019T023804091Z`。這次沒有資料庫變更。

發布紀錄在 `artifacts/deploy-20261019-pixel-icons/`，QA 與前後對照在 `artifacts/pixel-icons-qa/`。
