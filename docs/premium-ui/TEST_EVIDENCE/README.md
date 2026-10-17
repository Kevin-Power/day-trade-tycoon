# TEST_EVIDENCE

| 資料夾／檔案 | 內容 | 有沒有進 git |
|---|---|---|
| `compare/` | 改版前後並排對照：desktop 1440、tablet 768、phone 390、phone 360，以及手機四個分頁 | 有 |
| `before/` | 改版前（`071aad0`）的截圖：1440×900、768×1024、390×844、360×740，手機每個分頁另有一張 | 只在本機（PNG 太大） |
| `after/` | 改版後（`de136fc`）同一組截圖 | 只在本機 |
| `states/` | 交易狀態截圖：限價、核對、待撮合、閃電、紀錄、手機教材抽屜 | 只在本機 |
| `gates/before/`、`gates/after/` | 8 項指令的完整輸出：`gates.json` 有指令、秒數、exit code；另有 `check-auth-with-dev.log` | 有 |
| `checks/` | 最終建置上的畫面與流程檢查： | 有（PNG 除外） |
| | `summary.txt`、`premium/premium.json`、`premium-flat/` | |
| | `layout-strict.log`、`sharpness.log`、`orders.log`、`guest.log`、`daily.log` | |
| | `integration.log` | |
| `merge-check/` | 與子專案 B 修正合併後的測試輸出 | 有 |
| `contrast.txt` | 色票對比計算 | 有 |

- **截圖環境**：拋棄式 PGlite 測試伺服器（`scripts/qa/desk-server.mjs`，只綁 127.0.0.1）。
- **測試資料**：`desk-seed.mjs` 建立一輪練習，買兩張台積電，重播到 09:27。
- **瀏覽器**：Playwright Chromium，裝置像素比 2。
- **重跑方式**：
  1. `npm run build`
  2. `PORT_APP=18820 PORT_PROXY=18821 node scripts/qa/desk-server.mjs`
  3. `node scripts/qa/desk-seed.mjs http://127.0.0.1:18821`
  4. `node scripts/qa/desk-premium.mjs http://127.0.0.1:18821 <輸出資料夾>`，其他檢查同理。
