# 正式站發布 2026-10-19：重試後確認卡殘留修正（B-07）

使用者核准：「直接做了」（2026-10-19）。

## 內容

| 項目 | 說明 |
|---|---|
| `44d23a0` | 送單斷線、按「重試這次操作」成功後，舊的確認卡會關閉（`src/components/morning-trading.tsx` 一行）。不碰撮合或交易核心 |
| `83cb962` | `scripts/qa/desk-orders.mjs` 新增「送單斷線後重試」情境。在舊 release 上失敗（確認卡一直開著），修正後通過 |

- 合併方式：fast-forward 併入 `codex/course-handover`，已推送。
- 建置：改在**乾淨的 worktree** 建置，先 `npm run build:offline`，再 `npm run build`，離線包驗證通過。
- 正式站 CSS 和 GitHub 乾淨建置相同：比上一個 release 少了 280 個沒用到的選擇器，沒有新增任何規則。原因是上一個 release 在主工作區建置時，Tailwind 掃到了未追蹤的資料夾。

這個缺陷是教材驗收的模擬學生旅程發現的（`docs/acceptance-20261018/`，分支 `claude/workbook-revision`）。

## 發布前驗證（新建置）

**測試與檢查**
- 單元測試 767 個：763 通過、0 失敗、4 略過。
- typecheck 通過；`eslint src` 0 個錯誤，5 個警告原本就有，都在這次沒改的檔案。
- 隔離整合測試 4/4（auth、morning、guest、daily）。

**畫面 QA**：以下都通過。
- `desk-discipline`（排第一個跑）、`desk-guest`、`desk-daily`、`desk-guest-resilience`（拒絕 3 次、在全新教室拒絕 50 次）；
- 種子資料後：`desk-premium`、`desk-layout --strict`、`desk-sharpness`、`desk-states`、`desk-orders`（含新情境），以及下單流程後再跑一次 `desk-premium`（平盤）。

**候選 release** `20261019T023804091Z`：用拋棄式教室跑種子資料加 `desk-orders`，通過；首頁 200。

**過程紀錄**：第一次跑平盤 `desk-premium` 不通過，底部分頁出現「庫存1」。原因是新情境留下了一筆掛單（測試腳本缺陷）。新情境改成最後撤回委託後，在全新教室重跑整串都通過。第一次的紀錄保留在 `first-run/`。

## 停機與切換

- 02:39:16Z 正常停機，資料庫確認已關閉。
- 備份 `backups/2026-10-19T02-39-17-160Z`：1,059 個檔案，逐檔核對通過。
- 只改 `appEntry`：從 `20261018T022941927Z` 改成 `20261019T023804091Z`。
- 第一次啟動被拒絕：「Dedicated task ownership does not match this workspace」。我從 release worktree 執行 `host.ps1`，但排程綁定的是主工作區。改用主工作區的同一支腳本後啟動成功。
- 02:39:41Z 恢復健康，由排程工作監督，停機約 26 秒。

## 發布後檢查

- 60 個公開資源的 SHA-256 和 release 相同；設定除了 `appEntry` 都沒變；3 個秘密檔案的雜湊沒變（只比對雜湊，沒有讀內容）。
- `/`、`/daily`、`/progress`、`/teacher`、`/morning`、`/try`、`/sw.js`、`/manifest.webmanifest` 都是 200；`/server/index.mjs` 404。
- 沒有入場碼時，`/api/daily`、`/api/morning`、`/api/discipline` 都回 403；8790 只綁 127.0.0.1。
- `/api/health`：`mode: simulation`。

## 回退

把 `appEntry` 指回 `20261018T022941927Z`。這次沒有資料庫變更。

發布紀錄在 `artifacts/deploy-20261018-retry-confirm/`。
