# 合併建議 — Premium Trading UI

## 結論：**CONDITIONAL PASS**

- **為什麼不是 FAIL**：功能與畫面驗收全部通過，與子專案 B 合併後也全部通過；交易邏輯與實盤設定沒有任何改動。
- **為什麼不是 PASS**：
  - 還沒在真實手機上看過。
  - 交接文件要求的 8 項指令中有 2 項回非 0。這 2 項在改版前就是這樣、和本次無關，但它們確實沒有通過，所以不能報 PASS。
- **我沒有做的事**：沒有 merge、沒有 push、沒有部署、沒有改正式站設定，也沒有啟用實盤下單。

## 分支

| 項目 | 內容 |
|---|---|
| 分支 | `claude/premium-trading-ui`，本機 worktree `.worktrees/premium-ui` |
| 基底 | `codex/course-handover` 的 `071aad0`（正式站使用的分支，不是 `main`，原因見 `UI_AUDIT.md` 第 1 節） |
| Commits | `e7d447b` 報價計算函式與測試 |
| | `292976e` 交易畫面改版 |
| | `ed76c61` 驗收腳本 |
| | `c770cc8` 畫面檢視後的修正 |
| | `69167c8` 對比修正 |
| | `9171b0b` 平板觸控 |
| | `c702d95` 報告與證據 |
| | `ddbf9ee` 安靜的控制項（精品精修） |
| | `a6ff145` 最新價標籤不蓋住刻度 |
| | `de136fc` 手機分頁不透明 |
| | 另有一個報告更新 commit |
| 與 B 的修正 | `codex/course-handover` 之後多了每日一題的審查修正（到 `df969f3`）。兩邊合併沒有衝突 |

## 8 項指令（最終 commit `de136fc`，紀錄在 `TEST_EVIDENCE/gates/`）

| 指令 | 改版前 `071aad0` | 改版後 `de136fc` | 說明 |
|---|---|---|---|
| `npm ci` | 通過（11s） | 通過（12s） | |
| `npm run check:auth` | **exit 2** | **exit 2** | 無法觀察，不是兩邊不一致。這個分支在 `3de5eb3` 移除了開發伺服器的 `/__app-env`，對開發伺服器（18790）實測也一樣是 2（`check-auth-with-dev.log`）。**阻塞，但不是本次造成的** |
| `npm run check:symbols` | 通過 | 通過 | 歷史封存 24 檔；可用真實分鐘教材 5 檔 |
| `npm run test` | 通過：708 個，704 過、4 略過* | 通過：714 個，710 過、4 略過* | 多出的 6 個是新的報價函式與標籤避讓測試。*4 個整合測試需要指定建置，已另外執行：4／4 通過 |
| `npm run typecheck` | 通過 | 通過 | |
| `npm run lint` | **exit 1** | **exit 1** | 4 個錯誤全在 `research/` 舊研究腳本，前後輸出完全相同；`npx eslint src` 0 錯誤。**不是本次造成的** |
| `npm run build` | 通過 | 通過 | |
| `npm run build:offline` | 通過 | 通過 | |

## 畫面與流程驗收

（`TEST_EVIDENCE/checks/`，在最終建置上執行）

- `desk-premium`：通過。
  - 尺寸：1440×900、1366×900、768×1024、390×844、360×740，以及大字模式 375×812、1366×900。
  - 平盤狀態在下單流程後又跑一次，也通過。
- `desk-layout --strict`：通過。
  - 尺寸：1920／1366／1280／1200／820／375／320，以及大字模式。
  - 1366×900 走勢圖 701px。
- `desk-sharpness`、`desk-orders`、`desk-guest`、`desk-daily`：通過。
- `desk-states`：交易狀態截圖都已產生。
- 隔離環境整合測試（auth、morning、guest、daily）：4／4 通過。

## 與子專案 B 修正合併後的驗收

- **怎麼驗**：用暫時的本機 worktree 測試合併結果，測完已刪除，也沒有建立任何分支；紀錄在 `TEST_EVIDENCE/merge-check/`。
- **合併來源**：`de136fc` 與 `df969f3`，git 判斷沒有衝突。
- **結果**：
  - `npm test`：728 個，724 過、4 略過、0 失敗。
  - typecheck、`eslint src`、build 都通過。
  - `desk-premium`、`desk-layout --strict`、`desk-sharpness`、`desk-orders`、`desk-guest`、`desk-daily` 都通過。
  - 整合測試 4／4 通過。

## 交接文件的界線，逐條確認

| 界線 | 狀態 |
|---|---|
| 不動模擬撮合、風控、費稅、時序、課綱、帳戶、資料來源、委託 API | 沒有改。`git diff 071aad0..de136fc --stat` 只有 UI 元件、`trading-desk.css`、`charts.tsx` 的一處標籤避讓、新的顯示用函式與 QA 腳本 |
| 不啟用實盤 | `/api/broker/order` 沒動，仍回 501；`desk-premium` 確認畫面沒有送出 `/api/broker` 請求 |
| 委託類型 | `/morning` 只有市價／限價，沒有新增任何類型 |
| 閃電下單、撤單、離開確認、結算 | `desk-orders`、`desk-guest` 通過 |
| 資料來源標示 | 真實歷史（綠）與教學模擬（琥珀）都更清楚，沒有弱化；`desk-premium` 會檢查 |
| 示意數字不進正式資料 | 工作包的 6820、356.5 等數字完全沒有使用；畫面只用 session 資料與 `createMorningBook` |
| 地端離線包、入口密碼、課程 | `build:offline` 通過；`desk-guest` 走完入口密碼流程 |
| 不引入 PR #2、不合併大分支 | 沒有 |
| 不改主工作區未提交的變更 | 未追蹤的 `當沖大富翁-地端/` 沒碰；全部工作在獨立 worktree |

## 合併前的條件

1. **你看過對照圖並同意設計**：`TEST_EVIDENCE/compare/` 共 5 張。
2. **用真實手機看一次**：
   - iPhone Safari 與 Android Chrome：底部分頁與安全區、網址列收合、單手操作。
   - 建議用大字模式也看一次。
3. **決定 `check:auth` 怎麼處理**：
   - 把 `appEnvPlugin` 接回 `vite.config.ts`；或者從必要指令中拿掉。
   - 這要另外決定，不在本次 UI 範圍。
4. **合併順序建議**：
   - 先把子專案 B 的修正（`codex/course-handover`）推上去；推送需要你同意。
   - 再把 `claude/premium-trading-ui` 合併進 `codex/course-handover`。
   - 合併結果已在本機驗證過。

## 不影響合併的已知事項

- 舊交易桌程式（`terminal.tsx` 等）已沒有人使用，可另案刪除。
- 每日一題頁面在大字模式，標題副標會斷成兩行（子專案 B 的頁面，屬於外觀問題）。
- 平板與手機的走勢圖讀數列（K 線的開高低收）在窄寬度會換成兩行，這是圖表本身既有的行為。
