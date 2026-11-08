# 「你看看哪裡可以更好」— 2026-11-08 的四件事

使用者在說明書 `2026-11-07-class4` 上線後問「你看看哪裡可以更好」。我看了上線版本的手機實測截圖（390×844 行情、庫存）、電腦大字版下單頁、程式碼和主機排程，提出四項，使用者四項全選。目標仍是 11/06 石大哥的話：讓學員看懂 N 字攻擊、內外盤五檔的下單時機，之後系統自動停利、停損，讓學員感受到教學與系統的強大。

分支 `claude/one-screen`，接在 `9b4d054`（說明書上線紀錄）之後。

## 1. 先推 GitHub

本機主線 `codex/course-handover` 比 origin 多 55 個 commit（全部是這幾天的觸價單、五檔、說明書），使用者同意後推上 origin：`58a6b2a..cfe3b17`。

## 2. 網站看門狗（主機排程，使用者同意新增）

11/06 正式站停了 7 小時（16:18–23:38）才被發現。主機排程 `DayTradeTycoonHost` 只有「這個使用者登入時啟動」一個觸發條件，程式被結束就不會再起來。

- `scripts/hosting/watchdog.ps1`：問 `supervisor.mjs status`。有維護者（release-switch、backup）→ 只記錄；supervisor 在跑 → 記 `ok` 或 `unhealthy`（app 由 supervisor 自己重啟）；沒有 supervisor → 記一次 miss，**連續兩次**（排程下相隔五分鐘）才用 `host.ps1 -Action start` 啟動主機排程，並記 `started`／`start-failed`。每次順便記正式站 `/api/health` 的狀態碼。紀錄在 runtime 的 `logs/watchdog.log`（2 MB 輪替），狀態在 `logs/watchdog-state.json`。不讀 secrets、data。
- 為什麼要兩次：切換版本時主機會停約 18 秒，`stop` 到 `backup` 之間有一小段沒有鎖；五分鐘一次的檢查不可能跨過它看到兩次 miss。**維護超過五分鐘時，先 `Disable-ScheduledTask -TaskName DayTradeTycoonWatchdog`，做完再 enable。**
- `scripts/hosting/watchdog-install.ps1`：註冊 `DayTradeTycoonWatchdog`（同主機排程的 principal：kevin／Interactive／Limited，不存密碼，隱藏，IgnoreNew，4 分鐘上限），兩個觸發條件各每 5 分鐘重複、無期限：一個從現在起、一個在登入時。同名但不是這個指令的排程會拒絕覆蓋。`-Uninstall` 移除。
- 驗證：用 `-StatusJson` 餵四種狀態（healthy／maintenance／none／unhealthy）跑八次，判斷和 miss 計數都如預期，測試模式不會啟動任何東西；對正式站 `-DryRun` 一次得到 `ok supervisor=yes healthy=yes public=200`。2026-11-08 13:36 台北安裝，第一次排程執行 13:36:40 結果 0，紀錄 `ok … public=200`。
- 排程指向**主目錄**的 `scripts/hosting/watchdog.ps1`，所以這兩個檔先合併進主線（`74ebe62`、merge `2eab437`）再安裝。

## 3. 行情頁：觸價價位＋過前高提示

截圖看到：買進後手機行情頁右上只有「庫存 2 張／成本 1462.50／+32,499」，停利、停損價位要切到「庫存 → 委託」才看得到；江波圖有兩條虛線但沒有數字。快訊會跑「台化 過前高」，但常是別檔股票，這檔自己過前高時價格旁邊沒有提示。

- `exitStampParts(exit, firing)`（`morning-exit.ts`，先寫測試）：等待中的觸價單 →「停利 1485」「停損 1448」（各自上漲、下跌色）；其中一張觸發、市價賣單等量時 →「停利觸發 · 市價賣出中」；買在漲停只剩停損那一張；沒有觸價單什麼都不顯示。
- `freshBreakout(breakouts, cursorSec)`（`morning-alerts.ts`，先寫測試）：`breakoutsOf` 最新一筆、其分鐘完成後五分鐘內（含第 300 秒）才算，分鐘還沒完成不算。
- `QuoteHero`：庫存那一疊多一行 `.td-hero-exit`；價格的漲跌旁邊多一個琥珀色 `.td-hero-flag`「過前高 X」（手機上自成一行，在 ▲20 +1.37% 下面），`header` 帶 `data-breakout` 給驗收用。用已完成分鐘算（和圖上的前高、過前高標記同一套），只描述價格，不寫成進場訊號。
- 說明書網頁版「手機行情」補一句（版本不變，PDF 不動）。
- 驗收 `desk-exit.mjs`：觸價單等待時，行情頁的庫存標籤要含「停利 X／停損 Y」；另外用 API 回來的分鐘 K、同一套函式算出「現在該不該亮過前高」，和畫面上的 `data-breakout` 比對（該亮要亮、不該亮不能亮）。

## 4. 講師頁「本課總結」

講師專區原本只能一筆一筆開學員紀錄（而且早盤練習根本沒有同步進 `classroom_sessions`），看不到全班的觸價單結果。

- `summarizeMorningClass(rows)`（`morning-class-summary.ts`，先寫測試）：依課程日分組（新的在前，最多 8 天），每位學員加總：局數、買進次數、停利觸發、停損觸發、是否留到收盤、本輪損益（權益－期初，含已付費稅）；全班：人數、局數、買進、停利、停損、留到收盤人數、正報酬人數、平均。手動賣出不算停利也不算停損。
- `loadMorningClassSummary`（`morning-teacher.ts`，講師限定）：從 `morning_sessions` 取本班學員（`classroom_profiles.class_code`）已完成、未放棄、`fubon-*` 的局，只取 `equity`、`startingCash`、`orders`、`fills`、`positions` 幾個欄位，不取分鐘 K；訪客不是班員所以不會出現。
- `MorningClassCard`：講師工作區每日一題下面，每個課程日一個可展開區塊，第一天展開：摘要列＋學員表（學員／局數／買進／停利觸發／停損觸發／收盤庫存／本輪損益）。註明只算完成未放棄的局、訪客不計、是紙上成績。

## 沒做、順便看到的

- 庫存卡片「參考損益 +35,000（未含費稅）」和上方「本輪損益 +32,499（含已付費稅）」是同一檔兩個數字，初學者會問；這次沒動。
- N 字的前高、過前高標記、外／內盤比例、說明書都已經對得上。

## 驗收

- **先寫測試、看它失敗**：`exitStampParts`、`freshBreakout`、`summarizeMorningClass` 三組都先跑過確認失敗（找不到匯出），實作後通過。
- **全部測試**：`npm test` 共 1,218 項，1,214 通過、0 失敗、4 跳過（兩次）。型別檢查和 `eslint src` 都是 0 錯誤。
- **第一個候選版 `20261108T054053102Z`** 的 QA 鏈 31 項有 4 項沒過，都查出原因：
  - `exit`／`exit-webkit`：驗收腳本從 `advance` 的回應拿分鐘 K，但那只帶新揭露的那一格（`delta`），所以算成「不該亮」；畫面亮「過前高 993」是對的。改成用交易台重新載入時用的 GET（帶所有已揭露分鐘）來算。
  - `layout`（1200×700）：電腦版的過前高標籤帶價格，比「▲20／+1.37%」那一欄寬，把價格區撐寬，離「買進／賣出」只剩 13px（規則是至少 16px）。電腦版改成只顯示「過前高」兩字（價格在滑鼠提示和圖上的標記），手機版照常顯示價格。
  - `ticks`（390-slow）：主執行緒卡了一次 102 ms（門檻 100）。過前高原本每次重繪都重算前高與突破，改成用 `useMemo` 只在揭露新分鐘時重算；這一項本來就在機器忙時偶爾會超過門檻，所以不確定是不是這個原因。
  - 另外從截圖看到手機版的過前高標籤框被撐到整欄寬（flex-basis: 100%），改用一個零高度的換行元素，標籤保持自己的寬度。
- **第二個候選版 `20261108T060011095Z`**（307 個檔）：整合測試 4/4；完整 QA **31/31 全過**，紀錄在 `artifacts/daily-lessons-qa/rv2/`。`desk-exit` 的新檢查：行情頁庫存標籤讀到「庫存 1 張 成本 991 +2,153 停利 996／停損 986」，過前高標籤「993」與用 API 分鐘 K 算出的一致（Chromium 和 WebKit 都是）。
- **講師「本課總結」**：在 QA 伺服器用 API 完成一局（買 1 張、停損觸發、−14,680），講師頁讀到「10/27 · 1 人練 1 局 · 買進 1 次 · 停利觸發 0 · 停損觸發 1 · 留到收盤 0 · 正報酬 0 人 · 平均 −14,680」和該學員的一列，沒有主控台錯誤；沒有完成局時顯示「班上還沒有完成的早盤練習」。
- 正式站沒有動，候選版等使用者說「上線」才切換；退回目標是現在的 `20261107T125343554Z`。
