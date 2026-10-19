# 正式站發布 2026-10-19（第二次）：圖示審查的次要項目

使用者要求「把那些小問題也處理掉」，看過結果後核准：「直接上線」（2026-10-19）。上一版的紀錄是 `docs/deployment-2026-10-19-pixel-icons.md`。

## 內容

| 項目 | 說明 |
|---|---|
| `2c17066` | 先寫的測試，涵蓋以下各項。原始碼掃描刻意放進兩個錯誤驗證過：星芒 28px、圖示加 `size-4`，兩個都被抓到 |
| `603c868` | 修正，見下方清單 |

修正項目：
- **授權聲明**：新增 `/third-party-notices.txt`，含 Teenyicons 完整 MIT 授權；離線包也帶這個檔案；`npm run build` 一開始就跑 `build-icons --check`。
- **純圖示按鈕**：下拉／左右箭頭改畫成 4×8、加減號改成 9 像素實心線，和原本 lucide 一樣大。
- **容易混淆的圖示**：獎章改成勳章（不再像「自選」的星形）、講師工作台改成學士帽、面板改成有標題列的視窗。
- **`icon.ts`**：
  - 呼叫端傳入的寬、高、座標範圍、填色、線寬會被忽略；
  - 只有 aria-label、aria-labelledby 或 title 會讓圖示被讀出，title 改用 `<title>` 元素。
- **產生器**：不會畫出東西的路徑直接報錯；同一圖示的兩個名字共用一份資料；刪除不再使用的 8 個 Teenyicons 檔。
- **原始碼掃描**：圖示元素不得自帶尺寸設定，樣式表與 `[&_svg]` 設定只能是 15 的倍數 px。涵蓋畫面檢查看不到的對話框、收合區塊、`/teacher`、`/setup`。
- **空白庫存**：錢包圖示改成 30px，和其他「沒有資料」的畫面一致。

刻意保留：跟著文字的圖示維持 15px。圖示只有 15 或 30px 才會清晰，30px 放在標題旁太大。

不碰撮合、交易核心或資料。fast-forward 併入 `codex/course-handover`，已推送；`claude/pixel-icons` 已推送。

## 發布前驗證

**測試與檢查**
- 單元測試 783 個：779 通過、0 失敗、4 略過。
- typecheck 通過；`eslint src` 0 錯誤。

**畫面 QA**：分兩個全新教室，全部第一次就通過。
- 教室 A：`desk-discipline`、`desk-guest`、`desk-daily`、`desk-guest-resilience`、種子資料、`desk-premium`、`desk-layout --strict`、`desk-sharpness`、`desk-states`。
- 教室 B：`desk-pages`、種子資料、`desk-orders`、`desk-premium`（平盤）。

拆成兩個教室，是為了避開訪客匿名登入每 10 分鐘 60 次的上限；上一輪就是撞到這個上限。

**候選 release** `20261019T064801587Z`（比上一版多 1 個檔案，就是授權聲明）
- 乾淨 worktree 先 `build:offline` 再 `build`，離線包內確認有 `third-party-notices.txt`。
- 隔離整合測試 4/4。
- 拋棄式教室：首頁 200、授權聲明 200，種子資料、`desk-orders`、`desk-sharpness`、`desk-pages` 都通過。

## 停機與切換

- 06:49:57Z 正常停機，資料庫確認已關閉。
- 備份 `backups/2026-10-19T06-49-58-208Z`：1,059 個檔案，逐檔核對通過。
- 只改 `appEntry`：從 `20261019T040330511Z` 改成 `20261019T064801587Z`。
- 用主工作區的 `host.ps1` 啟動，06:50:12Z 恢復健康，由排程工作監督，停機約 15 秒。

## 發布後檢查

- 46 個公開 JS／CSS 資源的 SHA-256 和 release 相同。
- 設定除了 `appEntry` 都沒變；3 個秘密檔案的雜湊沒變（只比對雜湊）。
- 以下路由都是 200：`/`、`/daily`、`/progress`、`/teacher`、`/morning`、`/try`、`/license`、`/manual`、`/sw.js`、`/manifest.webmanifest`、`/third-party-notices.txt`。
- `/server/index.mjs` 404。
- 沒有入場碼時，`/api/daily`、`/api/morning`、`/api/discipline` 都回 403；8790 只綁 127.0.0.1。
- `/api/health`：`mode: simulation`。

## 仍未驗證

- Safari／iPad、Firefox、真實手機。
- Windows 125%／150% 縮放：在這種縮放下本來就無法逐像素。

## 回退

把 `appEntry` 指回 `20261019T040330511Z`（再前一版是 `20261019T023804091Z`）。這次沒有資料庫變更。

發布紀錄在 `artifacts/deploy-20261019-icon-minors/`，QA 在 `artifacts/pixel-icons-qa/minors/`。
