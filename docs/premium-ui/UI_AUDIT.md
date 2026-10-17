# UI 盤點（Phase 0）— 當沖大富翁 Premium Trading UI

2026-10-17／18，Claude。依 `CLAUDE_CODE_HANDOFF.md`（工作包 `DayTradeTycoon_Premium_UI_20261017.zip`）執行。

## 1. Git 與工作區現況

| 項目 | 結果 |
|---|---|
| 主工作區 | `C:\Users\kevin\Documents\ChatGPT\當沖大富翁`，分支 `codex/course-handover` |
| 主工作區 HEAD（開工時） | `071aad0`（子專案 B「每日一題」最後一個 commit，未推送） |
| 與 `origin/main` 的關係 | `codex/course-handover` = `main`（`57b2286`，PR #7）再加 114 個 commit；`main` 沒有比它新的 commit |
| 正式站跑的版本 | `codex/course-handover` 的建置（rich.yilutek.com，release 20261017T011132536Z） |
| 未提交的變更 | 只有未追蹤資料夾 `當沖大富翁-地端/`。**完全沒有碰** |
| 本次工作區 | `.worktrees/premium-ui`，新分支 `claude/premium-trading-ui`，從 `071aad0` 開出 |
| `.worktrees/` 忽略方式 | 寫在本機 `.git/info/exclude`，沒有改動任何追蹤中的檔案 |
| PR #2 | `grok/p0-p2-classroom`（新帳號、教師台、22 檔 SSOT），仍是 OPEN。**沒有引入、沒有合併** |

**為什麼從 `codex/course-handover` 開分支，而不是交接文件假設的 `main`**：
- 交接文件的程式快照讀的是 GitHub `main`。它以為活站可能落後 `main`，實際上剛好相反：正式站跑的是比 `main` 新 114 個 commit 的 `codex/course-handover`。
- 在 `main` 上改版，正式站永遠用不到，之後還要再搬一次。
- 這是我做的判斷，若你要以 `main` 為準，請告訴我。

## 2. 交接文件的檔案清單 vs 實際在用的畫面

在 `codex/course-handover` 上：
- `src/routes/index.tsx` 的 `AppShell` 現在只顯示大廳 `Lobby`，**沒有任何路由載入 `terminal.tsx`**。
- `terminal.tsx` 是唯一引用 `quote-book.tsx`、`watchlist.tsx`、`order-ticket.tsx`、`positions.tsx` 的檔案，所以這幾個都是沒人用的舊程式。
- 離線包（`vite.offline.config.ts` → `src/offline/main.tsx`）只有說明書、授權頁、固定示例與舊復盤，也不用它們（頁面上寫「離線包不再啟動合成行情」）。
- 真正的交易畫面是 **`/morning`（真實歷史 1 分 K 重播＋紙上委託）**。

| 交接文件指定 | 實際對應（本次改的檔案） |
|---|---|
| `terminal.tsx`（版面、手機分頁） | `morning-practice.tsx`（`MorningLesson` 版面、手機底部分頁 `MobileDock`）＋新 `quote-hero.tsx` |
| `quote-book.tsx`（五檔） | `morning-order-book.tsx`、`morning-quotes.tsx`（`MorningQuoteDetail`） |
| `watchlist.tsx` | `morning-practice.tsx` 內的 `MorningWatchlist` |
| `charts.tsx`（`TapeChart`） | 同一個 `charts.tsx`（顏色由 CSS token 帶入；只加了「最新價標籤不蓋住百分比刻度」的避讓） |
| `order-ticket.tsx` | `morning-trading.tsx` 的 `PaperOrder` |
| `positions.tsx` | `morning-trading.tsx` 的 `Ledger`、`AccountSummary` |
| `styles.css` | `src/trading-desk.css`（交易畫面唯一的樣式表，根節點 `.trading-desk`） |
| `provenance.tsx` | `/morning` 不用它；資料來源標示在畫面各處的 chip 與文字（見第 4 節） |

## 3. 交易邏輯清冊（本次全部不動）

- **引擎**：`src/lib/morning-engine.ts`、`morning-session.server.ts`，經 `/api/morning` 的 `start／advance／order／cancel／finish`。
- **委託類型**：
  - 市價：下一分鐘開盤價撮合。
  - 限價：之後每分鐘開盤價達價才成交，未達價留單到撤回或教材結束。
  - 每筆 1–3 張，同時只能有一筆待撮合；賣出不能超過庫存。
- **費稅**：手續費買賣各 0.0855%（最低 20 元），賣出稅 0.15%。
- **閃電下單**：點五檔價格即送限價；切換視窗或失焦會自動關閉（`PaperOrder` 既有邏輯）。
- **實盤**：`/api/broker/order` 永遠回 501「實盤尚未接上券商 API」。本分支沒有改這支路由，畫面也沒有呼叫它（`desk-premium` 會監聽網路請求確認）。
- **沒有 ROD／IOC／FOK 選項**：`/morning` 引擎本來就只有市價與限價，本次沒有加任何委託類型。

## 4. 資料來源清冊

| 畫面上的值 | 來源 | 改版前標示 | 改版後標示 |
|---|---|---|---|
| K 線、分時、成交價、漲跌、開高低、自選報價、走勢小圖 | 真實歷史 1 分 K（`MorningDataDetails` 寫明 Yahoo Finance 歷史 1 分鐘 OHLC），逐分鐘揭露 | 灰框 chip「真實 1 分 K」 | 綠點 chip「真實歷史 1 分 K」／「真實歷史・分鐘收價」；報價下方「09:27 收價・歷史重播」 |
| 五檔價量、委買委賣比 | 教學生成（`createMorningBook`，依代號與分鐘產生） | 灰框 chip「教學模擬五檔」＋「五檔價量為教學生成，非真實委託簿。」 | 琥珀色 chip「教學模擬五檔」，原說明保留 |
| **新：**報價區「買價／賣價」 | 與五檔相同的教學委託簿（買1／賣1） | （改版前沒有） | 每個框都有琥珀色「模擬」標籤；手機另有說明 |
| 庫存、委託、成交、損益 | 本輪紙上交易紀錄 | 「紙上交易」「教學模擬・不連接券商、不送出真實委託」 | 保留，另加「參考損益（未含費稅）」欄 |
| 加權指數（官方） | `/morning` 沒有指數區塊 | — | — |

## 5. 改版前的問題（依截圖，`TEST_EVIDENCE/before/`）

1. **手機**：
   - 上方狀態列與重播控制有 4 列，約佔 844px 中的 350px（約 41%），報價要往下捲才看到。
   - 5 個分頁（分時／K線／自選／下單／庫存）擠在頁面中段，單手按不到。
2. **報價太小**：
   - 桌面成交價只有 28px，塞在標題列右側；手機約 36px。
   - 沒有買價／賣價，和券商 App 的閱讀習慣不同。
3. **配色像 SaaS 後台**：
   - 標題列、狀態列是海軍藍（`#14305a`）大色塊。
   - 真實與教學生成的標示用同一種灰框，無法一眼分辨。
4. **桌面**：
   - 從自選點另一檔時，圖表模式會被重設成 K 線。
   - 庫存沒有損益欄。
5. **平板**：上方工具列、圖表切換、五檔按鈕只有 28px 高，觸控困難。
6. **大字模式**：
   - 上方工具列與重播按鈕只有 28／44px，未達大字模式 56px 的標準。
   - 在寬螢幕上整頁拉滿 1366px，閱讀距離太長。
7. **對比**：
   - 白字在藍色實心按鈕（1x、市價、標準）上只有 3.29:1，白字在紅色送單按鈕上 3.53:1，都低於 WCAG AA 一般文字 4.5:1。
   - 次要文字 `#8a9bb6` 在面板上 6.71:1（合格）。
8. **平盤**：平盤在自選清單顯示成「— 0」，看起來像負號。

## 6. 既有技術債（本次沒有處理，記錄於 `BUG_LIST.md`）

- 舊交易桌 `terminal.tsx` 已無路由使用；只被它引用的 `quote-book`、`watchlist`、`order-ticket`、`positions`、`mobile-market`、`lightning-order`、`account-bar`、`lesson-card`、`result-screen` 也一起成為沒人用的程式，可另案刪除（`app-shell.tsx` 仍在使用，它負責顯示大廳）。
- `npm run check:auth`：
  - 需要開發伺服器提供 `/__app-env`，但 commit `3de5eb3` 已從 `vite.config.ts` 移除 `appEnvPlugin`。
  - 所以在這個分支永遠回 2（無法觀察）。開工前就是如此。
- `npm run lint`：`research/daily-market/...` 下 4 個舊研究腳本有錯誤，開工前就是如此；`src` 沒有錯誤。
- 每日一題大字模式揭曉後圖表固定 240px（子專案 B 已記錄為暫緩項目）。
