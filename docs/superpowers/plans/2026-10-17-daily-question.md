# 每日一題與連續天數（好玩計畫 子專案 B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每個平日 06:00 發出一道用前一交易日富邦 1 分 K 出的「前高／後高」判讀題。全班同一題，學員一兩分鐘在手機上答完，立刻看到揭曉、解說、全班分布、連續天數與本週完成天數。老師在講師頁看分布與名單。

**Architecture:**
- **出題、發題時間、連續天數、揭曉計算與文案**：全部是 `src/lib/daily/` 的純函式，用 `node:test` 先寫測試。
- **伺服器**：從 `MARKET_DATA_DIR` 讀富邦資料，在第一個請求時產生題目並存進資料庫。之後所有人讀同一列。
- **`/api/daily`**：保護方式和 `/api/morning` 相同。作答前只送出題目時間以前的 K 棒。
- **前端**：`/daily` 頁、大廳卡片、講師卡片，只負責畫面。

**Tech Stack:** React 19、TanStack Start／Router、Tailwind v4、zod 4、PGlite／Postgres、Node `node:test`（`--experimental-strip-types`）、Playwright（只用於檢查腳本）。

**Spec:** `docs/superpowers/specs/2026-10-17-daily-question-design.md`（已核准）

## Global Constraints

- **文案**：畫面文字一律用繁體中文，本計畫寫出的文案逐字照用。
- **時區**：一律用台北時間（UTC+8，沒有夏令時間）。不能依賴伺服器或測試機的時區設定。
- **答案不外洩**：作答前，任何回應都不能含題目時間之後的 K 棒或結果。學員看不到其他人的名字與答案，只看人數。
- **不像賭博**：不說「答對／答錯」，不顯示獲利排名；揭曉文字只陳述事實。
- **價位**：一律是合法跳動單位，用 `src/lib/market/ticks.ts` 的 `tickSize`、`roundToTick`、`stepTick`、`limitDown`。
- **手機與大字**：
  - 375、320、820、1366，以及大字模式 375、1366，都不能有水平溢出或截字。
  - 按鈕高度：手機與平板至少 44px；大字模式的主要按鈕與三顆作答按鈕至少 56px。
  - 字體大小：文字至少 11px，大字模式的說明文字至少 15px。
  - `prefers-reduced-motion` 開啟時，不能有動畫。
- **相依套件**：不新增 npm 套件。
- **共用工作區**：
  - 編輯前先看 `git status`／`git diff`。
  - `git add` 一律寫明確路徑，不提交 `當沖大富翁-地端/`、`Fubon_Codex_Handoff/`、`artifacts/`。
- **每次提交前**都要執行 `npm test`。子專案 A 的教訓：`scripts/login-profile-flow.test.mjs` 這類檢查只會在全套測試裡出現。
- **提交指令**：`git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`。
- **反斜線與正規表示式**：含反斜線的程式碼用 Write／Edit 工具寫，不用 bash heredoc 或 Python 字串。
- **部署**：本計畫不部署。

## 對規格的補充（寫計畫時決定）

1. **發題時機**：06:00 之後第一個 `/api/daily` 請求（大廳卡片也會發出）觸發發題。某個平日如果整天沒有任何請求，那天就沒有題目，算「休」，不會補發。這樣不會讓全班的連續天數因為沒人開網站而中斷。
2. **找不到題的資料日**：存一列 `payload` 與 `issue_date` 都是 NULL 的紀錄，避免每個請求都重新嘗試出題。
3. **QA 用的時鐘**：伺服器端讀 `DAILY_NOW_ISO` 環境變數當作現在時間，只給檢查腳本使用。正式站的設定沒有這個變數，也不會加。週末執行檢查時要靠它。
4. **理由標籤**：固定四個。`volume`「量能放大」、`resistance`「前高有賣壓」、`strong`「大盤偏強」、`unclear`「看不清楚先等」。
5. **圖表**：`TapeChart` 新增兩個可選屬性。
   - `levels`：有標籤的水平虛線，用於「昨高」。
   - `markT`：用外框標出題目那一分鐘的 K 棒。
   - 「前高」沿用既有的 `swingHighs`。
6. **訪客自動建立**：從 `MorningPractice` 抽出共用的 `useGuestBootstrap()`，練習頁與 `/daily` 一起用，行為不變。

## Review Focus

1. **股票池裡有一檔的 K 棒檔案缺漏或損壞**：要跳過那一檔，不能讓整天出不了題。測試：Task 2 `a missing or broken symbol is skipped`。
2. **06:00 換題前後送出答案**：學員帶著舊題的 `questionId` 送出，要回 409「題目已更新」，頁面重新載入新題，不能記到錯的題目。測試：Task 5 `an answer for a question that is no longer current is refused`。
3. **系統建議的停損被自己的檢查拒絕**：例如 36.75 元的 1%，或 50 元、500 元附近跳動單位的交界。兩個建議停損一定要能通過檢查。測試：Task 4 `suggested stops always pass validation across tick bands`。
4. **伺服器或測試機不在台北時區**：發題日、本週與連續天數仍要正確。測試：Task 3 `schedule does not depend on the process time zone`（用 `TZ=America/New_York` 再跑一次）。
5. **有小數的價位與百分比**：例如 36.75、98.5，不能出現 36.749999 或 -0.0%。測試：Task 4 `prices and percents read cleanly`。

## 共用指令

- **單一測試檔**：`node --experimental-strip-types --test <path>`
- **全部檢查**：`npm test`、`npm run typecheck`、`npx eslint src --quiet`
- **建置**：`npm run build`
- **整合測試**：`CLASSROOM_TEST_RELEASE=<絕對路徑>/.output/server/index.mjs node --experimental-strip-types --test --test-concurrency=1 <file>`。一定要用絕對路徑。

---

### Task 1: 讀富邦資料、補齊 K 棒、確認高點

**Files:**
- Create: `src/lib/market-days.server.ts`、`src/lib/market-days.server.test.ts`
- Create: `src/lib/daily/bars.ts`、`src/lib/daily/bars.test.ts`
- Modify: `src/lib/market/swing-highs.ts`（新增匯出）、`src/lib/market/swing-highs.test.ts`（若不存在就新建）

**Interfaces:**
- Produces:
  - `src/lib/market-days.server.ts`：
    - `export type PublishedDay = { date: string; coverage: string; symbols: number; publishedAt: string }`
    - `export type DaySymbol = { code: string; name: string; referencePrice: number; close: number; tradeVolume: number; tradeValue: number; disposition: boolean; bars: number }`
    - `export type MarketBarRow = [t: number, o: number, h: number, l: number, c: number, v: number, a: number]`
    - `export async function listPublishedDays(dir: string): Promise<PublishedDay[]>`：依日期由舊到新；檔案不存在或格式不對時回傳 `[]`
    - `export async function readDaySymbols(dir: string, date: string): Promise<DaySymbol[] | null>`
    - `export async function readSymbolBars(dir: string, date: string, code: string): Promise<MarketBarRow[] | null>`：解開 gzip；不存在或損壞時回傳 null
    - `date` 必須符合 `^\d{4}-\d{2}-\d{2}$`，`code` 必須符合 `^\d{4,6}[A-Z]?$`，不然回傳 null，避免路徑跳脫。
  - `src/lib/daily/bars.ts`：
    - `export const SESSION_LAST_CONTINUOUS_T = 13 * 60 * 60 + 24 * 60 - 9 * 60 * 60`（即 15840，13:24）
    - `export const CLOSE_T = 16200`
    - `export function densifyBars(rows: readonly MarketBarRow[]): Bar[]`：從第一根到 15840 每分鐘一根，缺的用前一根收盤補（o=h=l=c=前收，v=0）；15840 之後只保留原本的 16200 那根（若有）。`Bar` 來自 `src/lib/game/types.ts`。
  - `src/lib/market/swing-highs.ts`：
    - `export function confirmedHighIndexes(bars: readonly Bar[]): number[]`：所有確認高點的索引，規則與 `deriveSwingHighs` 相同（嚴格高於左右各兩根）。

- [ ] **Step 1: 寫失敗的測試**

`market-days.server.test.ts`：在暫存資料夾建 `index.json`、`days/2026-10-14/index.json`、一個 `symbols/2330.json.gz`（用 `node:zlib` 的 `gzipSync`）。
- `listPublishedDays` 讀回日期清單；沒有 `index.json` 時回傳 `[]`。
- `readDaySymbols` 讀回股票清單。
- `readSymbolBars` 讀回 K 棒；損壞的 gz 回傳 null；`code` 是 `../x` 時回傳 null。

`bars.test.ts`：

```ts
test("missing continuous minutes are filled flat from the previous close", () => {
  const bars = densifyBars([[0, 10, 11, 9, 10.5, 5, 10], [180, 11, 12, 10, 11.5, 3, 11]]);
  assert.deepEqual(bars.map(b => b.t), [0, 60, 120, 180]);
  assert.deepEqual(bars[1], { t: 60, o: 10.5, h: 10.5, l: 10.5, c: 10.5, v: 0 });
});
test("the closing auction is kept and 13:25–13:29 is not invented", () => {
  const bars = densifyBars([[15840, 20, 20, 20, 20, 1, 20], [16200, 21, 21, 21, 21, 9, 21]]);
  assert.deepEqual(bars.map(b => b.t), [15840, 16200]);
});
```

`swing-highs.test.ts`：
- `confirmedHighIndexes` 在一組手造 K 棒上，找出的索引與 `deriveSwingHighs(bars, 99999, 0, 99999).confirmed` 的時間一致。
- 等高平台不會被確認。

- [ ] **Step 2: 執行，確認失敗**

Run: `node --experimental-strip-types --test src/lib/market-days.server.test.ts src/lib/daily/bars.test.ts src/lib/market/swing-highs.test.ts`

Expected: FAIL，原因是找不到模組或匯出。

- [ ] **Step 3: 實作三個模組**

- 確認高點的判斷：抽成 `swing-highs.ts` 內部的共用函式，讓 `deriveSwingHighs` 與 `confirmedHighIndexes` 共用，不另寫一份規則。
- 讀檔都用 `node:fs/promises`；JSON 讀取要去掉 BOM。

- [ ] **Step 4: 執行，確認通過**

Run：同 Step 2。

Expected: PASS；接著跑 `npm test`，全部通過。

- [ ] **Step 5: 提交**

```bash
git add src/lib/market-days.server.ts src/lib/market-days.server.test.ts src/lib/daily/bars.ts src/lib/daily/bars.test.ts src/lib/market/swing-highs.ts src/lib/market/swing-highs.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: read Fubon daily data and fill continuous minutes for the daily question" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 出題（純函式）

**Files:**
- Create: `src/lib/daily/types.ts`
- Create: `src/lib/daily/pick.ts`、`src/lib/daily/pick.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Bar`、`DaySymbol`、`densifyBars`、`confirmedHighIndexes`
- Produces（`types.ts`）：

```ts
export type DailyKind = "intraday-high" | "previous-high";
export type DailyChoice = "enter" | "watch" | "skip";
export type DailyOutcome = {
  higherHigh: boolean;            // 之後出現高於關鍵價位的確認高點
  higherHighT: number | null;
  firstBreakT: number | null;     // 第一根最高價 > 關鍵價位的 K 棒
  firstBreakPrice: number | null; // 那根的最高價
  maxAfter: number;               // q 之後的最高價
  close: number;                  // 最後一根收盤
};
export type DailyQuestionPayload = {
  dataDate: string; code: string; name: string; kind: DailyKind;
  level: number; levelT: number | null; questionT: number;
  referencePrice: number; pullbackLow: number;
  stops: { pullback: number; belowLevel: number };
  bars: Bar[];                    // 整天（只在伺服器）
  outcome: DailyOutcome;          // 只在伺服器
};
export type DailyCandidate = Omit<DailyQuestionPayload, "dataDate"> & { tradeValue: number; pullbackPct: number };
```

- Produces（`pick.ts`）：
  - `export function poolSymbols(symbols: readonly DaySymbol[]): DaySymbol[]`：成交值前 50 名與成交量前 50 名的聯集；排除處置股與 K 棒少於 150 根的。
  - `export function intradayCandidate(symbol: DaySymbol, bars: Bar[], nearPct: number): DailyCandidate | null`
  - `export function previousHighCandidate(symbol: DaySymbol, bars: Bar[], previous: { high: number; close: number } | null, nearPct: number): DailyCandidate | null`
  - `export function pickQuestion(dataDate: string, candidates: readonly DailyCandidate[]): DailyCandidate | null`
  - `export function buildQuestion(input: { dataDate: string; symbols: DaySymbol[]; barsOf: (code: string) => Bar[] | null; previousOf: (code: string) => { high: number; close: number } | null }): DailyQuestionPayload | null`：先用 0.3%（`nearPct = 0.003`）找；完全沒有候選時才用 0.6% 再找一次。

規則逐字依規格第 2 節。以下是寫測試時要用的數值：

| 項目 | 值 |
|---|---|
| 前高時間 | 09:05–11:30（t 300–9000），而且是當天到那時為止的最高價 |
| 回檔 | 最低點 ≤ H × 0.995，而且 H − L ≥ 2 × `tickSize(H)` |
| 題目時間 q | 第一根收盤 ≥ H × (1 − nearPct) 的 K 棒，在這之前沒有高過 H；q ≤ 12:30（t ≤ 12600），之後至少 30 分鐘（最後一根 t − q ≥ 1800） |
| 昨高題 | 平盤參考價必須等於前一天收盤；開盤（第一根開盤）< Y；q 在 t 300–12600，第一根收盤 ≥ Y × (1 − nearPct)，在這之前沒有高過 Y |
| 後高 | q 之後有確認高點，而且最高價 > 關鍵價位 |
| 停損建議 | `pullback` = 前高題取 H 到 q 之間的最低點，昨高題取開盤到 q 的最低點；`belowLevel` = 關鍵價位 × 0.99 向下取到跳動單位；兩者都必須 < q 的收盤，不然往下調一個跳動單位 |
| 排序 | q 在 t 900–9000、回檔 0.5%–3% 的優先；再依成交值由大到小；取前 10 |
| 挑選 | 用 `createHash("sha256").update(dataDate)` 當種子；前 10 裡兩種結果都有時，先用種子第一個位元組的奇偶決定結果組，再用後面的位元組在那一組裡取餘數；只有一種結果時直接在 10 個裡取 |

- [ ] **Step 1: 寫失敗的測試**

用小工具 `day(spec)` 合成整天的 K 棒（從 09:00 起每分鐘一根）。

```ts
test("an intraday high, a real pullback and a return near it make a question", () => {
  const c = intradayCandidate(sym("2330"), retestBars({ high: 100, pullbackTo: 99, returnClose: 99.8 }), 0.003)!;
  assert.equal(c.kind, "intraday-high"); assert.equal(c.level, 100); assert.equal(c.stops.pullback, 99);
});
test("a high that is not the day's high so far is not used", () => { /* 先有 101，再在 100 做高點 → null */ });
test("trading above the high before the return disqualifies it", () => { /* 回檔途中有 100.5 → null */ });
test("a question too late in the day or without 30 minutes left is not used", () => { /* q 在 12:31；或 q 後只剩 20 分鐘 → null */ });
test("a higher high needs a new confirmed high above the level, not one tick", () => {
  assert.equal(intradayCandidate(sym("1"), afterRetest([100.5, 99.9, 99.8]), 0.003)!.outcome.higherHigh, false);
  assert.equal(intradayCandidate(sym("1"), afterRetest([100.2, 100.8, 100.3, 100.1]), 0.003)!.outcome.higherHigh, true);
});
test("previous-high questions need the reference price to equal yesterday's close", () => {
  assert.equal(previousHighCandidate(sym("1", { referencePrice: 50 }), bars, { high: 52, close: 49.9 }, 0.003), null);
  assert.equal(previousHighCandidate(sym("1", { referencePrice: 50 }), gapUpAbove52, { high: 52, close: 50 }, 0.003), null);
});
test("the same data always picks the same question", () => {
  assert.deepEqual(pickQuestion("2026-10-16", list), pickQuestion("2026-10-16", list));
});
test("with both outcomes in the top 10 the seed picks the outcome group first", () => {
  // 9 個有後高、1 個沒有：在 40 個不同日期裡，兩種結果都要出現至少 10 次
});
test("the wider 0.6% search is used only when 0.3% finds nothing", () => { /* buildQuestion */ });
test("a missing or broken symbol is skipped", () => {
  // barsOf 對其中一檔回傳 null，其餘正常 → 仍然出題，且不是那一檔
});
test("the pool is top 50 by value and by volume without disposition or thin stocks", () => { /* poolSymbols */ });
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node --experimental-strip-types --test src/lib/daily/pick.test.ts`

Expected: FAIL，原因是找不到模組。

- [ ] **Step 3: 實作 `types.ts` 與 `pick.ts`**

依上表與規格第 2 節。`levelT` 填前高那根 K 棒的 t；昨高題為 null。

- [ ] **Step 4: 執行，確認通過**

Run：同 Step 2。

Expected: PASS；接著跑 `npm test`。

- [ ] **Step 5: 提交**

```bash
git add src/lib/daily/types.ts src/lib/daily/pick.ts src/lib/daily/pick.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: pick the daily retest question from the previous trading day" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 發題時間、連續天數與本週天數（純函式）

**Files:**
- Create: `src/lib/daily/schedule.ts`、`src/lib/daily/schedule.test.ts`
- Create: `src/lib/daily/progress.ts`、`src/lib/daily/progress.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PublishedDay`
- Produces:
  - `schedule.ts`：
    - `export function taipeiParts(ms: number): { date: string; weekday: number; minutes: number }`：weekday 0=週日；minutes 是當天 0 時起的分鐘數。
    - `export function issueDayFor(now: number): string`：平日而且 ≥ 06:00 時是當天；否則往前找最近一個已過 06:00 的平日。
    - `export function dataDayForIssue(days: readonly PublishedDay[], issueDay: string): string | null`：`coverage === "full-market"`、`date < issueDay`、`publishedAt ≤ issueDay` 的 06:00（台北），其中日期最新的一天。
    - `export function weekDates(now: number): string[]`：本週週一到週五的台北日期。
  - `progress.ts`：
    - `export type WeekDot = { date: string; state: "done" | "missed" | "todo" | "off" }`
    - `export type DailyProgress = { streak: number; week: { done: number; total: number; days: WeekDot[] } }`
    - `export function dailyProgress(input: { issued: readonly string[]; answered: ReadonlySet<string>; currentIssue: string | null; now: number }): DailyProgress`：`issued` 是已發題的發題日（由舊到新），`answered` 是學員答過的題目的發題日。

`dailyProgress` 的規則：
- **連續天數**：從最新發題日往回數連續答過的題；最新一題沒答時，從前一題開始數。
- **本週五格**，依序判斷：
  - 有發題而且答了：`done`
  - 有發題、沒答，而且那天不是 `currentIssue`：`missed`
  - 是 `currentIssue` 而且還沒答：`todo`
  - 那天在今天之後：`todo`
  - 今天、還沒 06:00、也還沒發題：`todo`
  - 其餘沒發題的平日：`off`
- **本週天數**：`done` = 答了的格數；`total` = 5 − `off` 的格數。

- [ ] **Step 1: 寫失敗的測試**

```ts
const at = (iso: string) => Date.parse(iso); // 測試裡一律寫 +08:00
test("weekday mornings after 06:00 issue that day; before it, the previous weekday", () => {
  assert.equal(issueDayFor(at("2026-10-19T06:00:00+08:00")), "2026-10-19");
  assert.equal(issueDayFor(at("2026-10-19T05:59:00+08:00")), "2026-10-16");
  assert.equal(issueDayFor(at("2026-10-17T12:00:00+08:00")), "2026-10-16"); // 週六
  assert.equal(issueDayFor(at("2026-10-18T23:59:00+08:00")), "2026-10-16"); // 週日
});
test("Friday's data is issued on Monday; only full-market data published before 06:00 counts", () => {
  const days = [day("2026-10-15", "2026-10-15T18:10:00+08:00"), day("2026-10-16", "2026-10-16T18:14:00+08:00"),
    { ...day("2026-10-19", "2026-10-19T18:00:00+08:00") }, { ...day("2026-10-14", "x"), coverage: "selected" }];
  assert.equal(dataDayForIssue(days, "2026-10-19"), "2026-10-16");
  assert.equal(dataDayForIssue(days, "2026-10-16"), "2026-10-15");
});
test("schedule does not depend on the process time zone", () => {
  // 這個檔案也要用 TZ=America/New_York 再跑一次（Step 2、4 的指令）；斷言同上
});
test("the streak survives the morning before today's question is answered", () => {
  const p = dailyProgress({ issued: ["2026-10-15", "2026-10-16", "2026-10-19"], answered: new Set(["2026-10-15", "2026-10-16"]),
    currentIssue: "2026-10-19", now: at("2026-10-19T07:00:00+08:00") });
  assert.equal(p.streak, 2);
});
test("a missed question breaks the streak; a weekday without a question does not", () => { /* … */ });
test("a holiday week counts out of four and shows 休", () => {
  // 週三沒發題，現在是週四：days[2].state === "off"，week.total === 4
});
test("Friday's question answered on Saturday fills Friday", () => {
  // answered 以發題日記錄，所以週六答週五的題，週五那一格是 done
});
test("today before 06:00 is still to do, not off", () => { /* … */ });
```

- [ ] **Step 2: 執行，確認失敗**

Run（兩次）：
- `node --experimental-strip-types --test src/lib/daily/schedule.test.ts src/lib/daily/progress.test.ts`
- `TZ=America/New_York node --experimental-strip-types --test src/lib/daily/schedule.test.ts`

Expected: FAIL，原因是找不到模組。

- [ ] **Step 3: 實作 `schedule.ts` 與 `progress.ts`**

一律用 `ms + 8 * 3600_000` 再取 UTC 的年月日與星期，不使用 `getHours()` 這類依時區的方法。

- [ ] **Step 4: 執行，確認通過**

Run：同 Step 2 的兩個指令。

Expected: 兩次都 PASS；接著跑 `npm test`。

- [ ] **Step 5: 提交**

```bash
git add src/lib/daily/schedule.ts src/lib/daily/schedule.test.ts src/lib/daily/progress.ts src/lib/daily/progress.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: daily question issue times, streaks and the weekly count" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 作答檢查、揭曉計算與文案（純函式）

**Files:**
- Create: `src/lib/daily/answer.ts`、`src/lib/daily/answer.test.ts`
- Create: `src/lib/daily/reveal.ts`、`src/lib/daily/reveal.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `DailyQuestionPayload`、`DailyChoice`、`DailyKind`、`DailyOutcome`
- Produces：
  - `answer.ts`：
    - `export const DAILY_REASONS = [{ id: "volume", label: "量能放大" }, { id: "resistance", label: "前高有賣壓" }, { id: "strong", label: "大盤偏強" }, { id: "unclear", label: "看不清楚先等" }] as const`
    - `export const dailyAnswerSchema`：zod strict 物件 `{ questionId: /^\d{4}-\d{2}-\d{2}$/, choice: enum, stopPrice?: number, reason?: DAILY_REASONS 的 id, guestTerms?: literal(true) }`
    - `export function validateStop(question: Pick<DailyQuestionPayload, "bars" | "questionT" | "referencePrice">, choice: DailyChoice, stopPrice: number | undefined): string | null`：回傳錯誤訊息或 null。錯誤訊息：
      - 進場沒帶停損：「選進場要先設停損」
      - 觀望或不追帶了停損：「觀望或不追不需要停損」
      - 不是跳動單位、不低於 q 的收盤，或低於跌停：「停損要是合法價位，並且低於目前價格」
  - `reveal.ts`：
    - `export type EntryResult = { entryT: number; entryPrice: number; stopPrice: number; stopT: number | null; exitPrice: number; pct: number }`
    - `export function entryResult(question: Pick<DailyQuestionPayload, "bars" | "questionT">, stopPrice: number): EntryResult`：進場價是 q 的下一分鐘開盤價；之後第一根最低價 ≤ 停損的 K 棒觸發，出場價 = min(停損, 那根開盤價)；沒觸發時出場價用最後一根收盤；`pct` 四捨五入到一位小數，而且不會出現 `-0`。
    - `export function priceText(p: number): string`：千分位，最多兩位小數，例如 `2,590`、`36.75`、`98.5`。
    - `export function timeText(t: number): string`：`09:00 + t 秒`，例如 `10:12`。
    - `export function questionText(q: { name: string; code: string; kind: DailyKind; questionT: number; level: number }): string`
    - `export function revealCopy(input: { kind: DailyKind; level: number; outcome: DailyOutcome; choice: DailyChoice; entry: EntryResult | null }): { headline: string; facts: string[]; lessons: string[] }`

文案逐字如下（`{}` 代入 `priceText`、`timeText`，百分比帶正負號與一位小數）：

| 用途 | 文字 |
|---|---|
| 題目（前高） | `{name}（{code}）{q} 回到前高 {level} 附近。接下來你會怎麼做？` |
| 題目（昨高） | `{name}（{code}）{q} 漲到昨天最高價 {level} 附近。接下來你會怎麼做？` |
| 結論 | 前高題：`做出後高`／`沒有突破前高`；昨高題：`突破昨高`／`沒有突破昨高` |
| 事實（有後高） | `{firstBreakT} 突破 {level}，最高到 {maxAfter}（{+x.x%}）；收盤 {close}。` |
| 事實（碰到但沒站穩） | `{firstBreakT} 一度碰到 {firstBreakPrice} 又回落，沒有站穩；收盤 {close}。` |
| 事實（沒碰到） | `之後最高只到 {maxAfter}，沒有越過 {level}；收盤 {close}。` |
| 事實（進場，觸發） | `假設 {entryT} 開盤價 {entryPrice} 買進、停損 {stopPrice}：停損在 {stopT} 被觸發，約 {pct}%（不含手續費與稅）。` |
| 事實（進場，沒觸發） | `假設 {entryT} 開盤價 {entryPrice} 買進、停損 {stopPrice}：停損沒有被觸發，收盤約 {pct}%（不含手續費與稅）。` |
| 學到的（一律） | `前高後高：先出現一個高點，回檔之後，後面又做出更高的高點。` |
| 前高題、有後高 | `這次回到前高後，買盤把價格推上去，做出後高：多方結構延續。進場的人有停損保護，風險有限。` |
| 前高題、沒有 | `這次前高成了壓力，價格沒能做出後高。觀望或不追，避開了之後的回落。` |
| 昨高題、有 | `昨天的最高價被突破，代表買盤願意追價。有停損，就算判斷錯也只虧一小段。` |
| 昨高題、沒有 | `昨天的最高價擋住了價格，昨高成了壓力。等真的突破再說，比提前追價安全。` |
| 紀律（一律，最後一行） | `不論判斷對錯，先設停損，錯了也只虧一小段。` |

- [ ] **Step 1: 寫失敗的測試**

```ts
test("suggested stops always pass validation across tick bands", () => {
  for (const level of [9.98, 36.75, 49.95, 50, 99.9, 100, 499.5, 500, 999, 1000, 2590]) {
    const q = questionAround(level); // q 的收盤在 level × 0.998，pullbackLow 在 level × 0.99
    for (const stop of [q.stops.pullback, q.stops.belowLevel]) assert.equal(validateStop(q, "enter", stop), null, `${level} ${stop}`);
  }
});
test("entering needs a stop; watching or skipping must not carry one", () => { /* 三個錯誤訊息逐字 */ });
test("a stop at or above the current price, off tick, or under limit down is refused", () => { /* … */ });
test("entry uses the next minute's open and a gap through the stop exits at the open", () => {
  // q 後下一分鐘開 100，下一根開 97、最低 96，停損 98 → stopT 那根，exitPrice 97，pct -3
});
test("prices and percents read cleanly", () => {
  assert.equal(priceText(2590), "2,590"); assert.equal(priceText(36.75), "36.75"); assert.equal(priceText(98.5), "98.5");
  // 進場 36.75、出場 36.75 → pct 0，文字是「約 0.0%」，不是「-0.0%」
});
test("reveal copy follows the fixed sentences", () => {
  const copy = revealCopy({ kind: "intraday-high", level: 2590, outcome: brokeOut, choice: "watch", entry: null });
  assert.equal(copy.headline, "做出後高");
  assert.equal(copy.facts[0], "10:31 突破 2,590，最高到 2,615（+1.0%）；收盤 2,605。");
  assert.equal(copy.lessons.at(-1), "不論判斷對錯，先設停損，錯了也只虧一小段。");
});
test("the question sentence names the kind of high", () => { /* 兩種句型逐字 */ });
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node --experimental-strip-types --test src/lib/daily/answer.test.ts src/lib/daily/reveal.test.ts`

Expected: FAIL，原因是找不到模組。

- [ ] **Step 3: 實作 `answer.ts` 與 `reveal.ts`**

- [ ] **Step 4: 執行，確認通過**

Run：同 Step 2。

Expected: PASS；接著跑 `npm test`。

- [ ] **Step 5: 提交**

```bash
git add src/lib/daily/answer.ts src/lib/daily/answer.test.ts src/lib/daily/reveal.ts src/lib/daily/reveal.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: daily answer checks, entry results and reveal wording" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 資料表與伺服器邏輯

**Files:**
- Create: `migrations/0009_daily_questions.sql`
- Create: `src/lib/daily-question.server.ts`、`src/lib/daily-question.server.test.ts`
- Modify: `src/lib/guest-link.server.ts`、`src/lib/guest-link.server.test.ts`

**Interfaces:**
- Consumes: Task 1–4 的全部匯出、子專案 A 的 `guest_consents` 與 `linkGuestRecords`
- Produces：
  - 遷移：

```sql
CREATE TABLE IF NOT EXISTS daily_questions (
  id TEXT PRIMARY KEY,
  issue_date DATE UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB
);
CREATE TABLE IF NOT EXISTS daily_answers (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES daily_questions(id) ON DELETE CASCADE,
  choice TEXT NOT NULL CHECK (choice IN ('enter', 'watch', 'skip')),
  stop_price NUMERIC,
  reason TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, question_id),
  CHECK ((choice = 'enter') = (stop_price IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS daily_answers_question ON daily_answers(question_id);
```

  - `daily-question.server.ts`：
    - `export type DailyQuestionView = Omit<DailyQuestionPayload, "bars" | "outcome"> & { bars: Bar[]; issueDate: string }`：`bars` 只到 q（含）。
    - `export type DailyReveal = { bars: Bar[]; outcome: DailyOutcome; entry: EntryResult | null; counts: { enter: number; watch: number; skip: number; total: number } }`
    - `export type DailyResponse = { question: DailyQuestionView | null; answer: { choice: DailyChoice; stopPrice: number | null; reason: string | null } | null; reveal: DailyReveal | null; progress: DailyProgress; needsTerms: boolean }`
    - `export async function ensureCurrentQuestion(sql: Sql, dir: string, now: number): Promise<{ id: string; issueDate: string; payload: DailyQuestionPayload } | null>`
    - `export async function loadDaily(sql: Sql, userId: string, dir: string, now: number, options?: { teacherReveal?: boolean }): Promise<DailyResponse>`
    - `export async function answerDaily(sql: Sql, userId: string, input: unknown, dir: string, now: number): Promise<DailyResponse>`
    - `export async function dailyTeacherView(sql: Sql, classCode: string, dir: string, now: number): Promise<{ question: DailyQuestionView | null; reveal: DailyReveal | null; rows: { name: string; choice: DailyChoice | null; stopPrice: number | null; reason: string | null; answeredAt: string | null }[]; guests: number }>`
    - 錯誤一律用 `MorningError`（`src/lib/morning-engine.ts`）：
      - 400：格式或停損錯誤，訊息用 `validateStop` 的文字
      - 403：「請先確認教學聲明」
      - 409：「題目已更新，請重新載入」

`ensureCurrentQuestion` 的流程：
1. `issueDay = issueDayFor(now)`；`dataDay = dataDayForIssue(await listPublishedDays(dir), issueDay)`。
2. 有 `dataDay`，而且資料庫沒有 `id = dataDay` 的列時：
   - 依 `buildQuestion` 產生；`previousOf` 讀前一個全市場日的 K 棒，取最高價與收盤。
   - `INSERT … (id, issue_date, payload) VALUES (dataDay, 有題目 ? issueDay : NULL, payload 或 NULL) ON CONFLICT DO NOTHING`。
3. 回傳 `issue_date` 最新、而且 `payload` 不是 NULL 的那一列；沒有就回傳 null。

`answerDaily`：
- 用 `dailyAnswerSchema` 解析；`questionId` 不是目前那一題時回 409。
- 訪客權限沿用 `/api/morning` 的規則：
  - 正式帳號需要已同意的學員資料，否則 403。
  - 訪客需要 `guest_consents`，或這次帶 `guestTerms: true`；帶了就在同一個交易寫入。
- 呼叫 `validateStop`。
- `INSERT … ON CONFLICT (user_id, question_id) DO NOTHING`；已經有答案時，保留原答案並回傳它。

- [ ] **Step 1: 寫失敗的測試**

`daily-question.server.test.ts`：用 PGlite，遷移 0001、0003、0007、0008、0009，加上 Task 1 測試用的合成 `market-data` 資料夾。

```ts
test("two first requests at once create one question", async () => { /* Promise.allSettled 兩個 ensureCurrentQuestion → 一列 */ });
test("before answering only bars up to the question minute are sent", async () => {
  const r = await loadDaily(sql, "alice", dir, MON_0700);
  assert.ok(r.question!.bars.every(b => b.t <= r.question!.questionT)); assert.equal(r.reveal, null);
  assert.equal(JSON.stringify(r).includes("higherHigh"), false);
});
test("answering reveals the day, the entry result and class counts", async () => { /* enter + stop → reveal.entry 不是 null，counts.enter === 1 */ });
test("one answer per learner; a resend returns the first answer", async () => { /* 先 watch，再送 skip → 仍是 watch */ });
test("an answer for a question that is no longer current is refused", async () => { /* 週一題，週二 06:01 送 → 409 */ });
test("guests answer after accepting the statement once", async () => { /* 沒 guestTerms → 403；帶了 → 200 且寫入 guest_consents */ });
test("teachers can see the reveal without answering", async () => { /* loadDaily(..., { teacherReveal: true }) */ });
test("a data day without a candidate is remembered and never retried", async () => { /* payload NULL 的列 */ });
test("progress counts by issue day", async () => { /* 用不同 now 發兩題、答一題 → streak 與 week */ });
```

`guest-link.server.test.ts` 新增：

```ts
test("guest daily answers move to the account unless it already answered", async () => { /* … */ });
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node --experimental-strip-types --test src/lib/daily-question.server.test.ts src/lib/guest-link.server.test.ts`

Expected: FAIL，原因是找不到模組；新的搬移測試也失敗。

- [ ] **Step 3: 實作遷移、`daily-question.server.ts`，並擴充 `linkGuestRecords`**

- `linkGuestRecords`：
  - 在刪除訪客之前，先刪掉帳號已經答過的同題訪客作答。
  - 再把其餘的作答改到帳號名下。
  - `moved` 不含作答數，回傳格式不變。
- `NUMERIC` 讀出來是字串，要轉成數字。

- [ ] **Step 4: 執行，確認通過**

Run：同 Step 2。

Expected: PASS；接著跑 `npm test` 與 `npm run typecheck`。

- [ ] **Step 5: 提交**

```bash
git add migrations/0009_daily_questions.sql src/lib/daily-question.server.ts src/lib/daily-question.server.test.ts src/lib/guest-link.server.ts src/lib/guest-link.server.test.ts
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: store the daily question once for everyone and record one answer per learner" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/api/daily` 與整合測試

**Files:**
- Create: `src/routes/api/daily.ts`
- Create: `scripts/qa/make-market-fixture.mjs`（之後的 QA 也會用）
- Create: `scripts/hosting/daily-integration.test.mjs`

**Interfaces:**
- Consumes: Task 5 的 `loadDaily`、`answerDaily`
- Produces：
  - `GET /api/daily`（`?reveal=1` 只限講師）、`POST /api/daily`，回傳 `DailyResponse`。
  - `scripts/qa/make-market-fixture.mjs`：
    - `export async function writeMarketFixture(dir: string): Promise<{ dataDate: "2026-10-14" }>`：寫一個 2026-10-14 的全市場日，`publishedAt` 為 `2026-10-14T18:00:00+08:00`。
    - 內容：至少 12 檔、每檔 ≥ 150 根 K 棒。其中兩檔手造前高回測型態，一檔之後做出後高、一檔沒有；其餘是平穩的填充股票。
    - 直接執行 `node scripts/qa/make-market-fixture.mjs <dir>` 也可以。
  - 伺服器端的「現在時間」：`process.env.DAILY_NOW_ISO` 有值時用 `Date.parse` 它，否則用 `Date.now()`。只在這個路由與 Task 8 的講師伺服器函式讀取。

- [ ] **Step 1: 寫整合測試（先失敗）**

`daily-integration.test.mjs` 照抄 `guest-integration.test.mjs` 的骨架：
- port 18798，暫存前綴 `daily-http-test-`。
- 環境加上 `MARKET_DATA_DIR`（用 `writeMarketFixture` 建立）與 `DAILY_NOW_ISO: "2026-10-19T07:00:00+08:00"`。

依序斷言：
1. 沒有入場碼時，`GET /api/daily` 回 403。
2. 訪客建立後，`GET` 回 200，題目的 `id` 是 `2026-10-14`。所有 `bars` 的 `t ≤ questionT`，回應字串不含 `higherHigh`，而且 `needsTerms === true`。
3. 選進場但不帶停損 → 400；帶 `guestTerms` 與 `stops.pullback` → 200，回傳 `reveal.entry` 與 `counts.total === 1`。
4. 第二位學員（正式帳號，用 `createProfile`）選觀望 → `counts.total === 2`。
5. 學員用 `GET /api/daily?reveal=1`，只會拿到自己的狀態（沒答過就沒有 `reveal`）。
6. 日誌沒有任何秘密（沿用原檔最後的斷言）。

- [ ] **Step 2: 建置並執行，確認失敗**

Run: `npm run build`，再用絕對路徑的 `CLASSROOM_TEST_RELEASE` 執行這個測試。

Expected: FAIL，`/api/daily` 回 404。

- [ ] **Step 3: 實作路由**

- 照 `src/routes/api/morning.ts` 的結構：入場碼、同源檢查（POST）、兩層頻率上限、取得 session，`withSqlTransaction` 包住 `loadDaily` 或 `answerDaily`。
- `MARKET_DATA_DIR` 沒設定時，回 `{ question: null, … }`，不回 500。
- `?reveal=1` 只有 `classroomRole(...) === "teacher"` 時才傳 `teacherReveal: true`。

- [ ] **Step 4: 重新建置並執行，確認通過**

Run：同 Step 2。

Expected: PASS；再跑既有的 auth、morning、guest 三個整合測試，也都通過。

- [ ] **Step 5: 全部檢查並提交**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`

Expected: 全部通過。

```bash
git add src/routes/api/daily.ts scripts/qa/make-market-fixture.mjs scripts/hosting/daily-integration.test.mjs
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: daily question API behind the classroom gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 作答頁 `/daily`

**Files:**
- Create: `src/components/use-guest-bootstrap.ts`
- Modify: `src/components/morning-practice.tsx`（改用 `useGuestBootstrap`）
- Modify: `src/components/charts.tsx`（`levels`、`markT`）、`src/lib/market/chart-data.ts`
- Test: `src/lib/market/chart-data.test.ts`
- Create: `src/routes/daily.tsx`、`src/components/daily-question.tsx`
- Modify: `src/trading-desk.css`（`.td-daily*` 樣式）

**Interfaces:**
- Consumes: Task 4 的 `questionText`、`revealCopy`、`DAILY_REASONS`、`priceText`；Task 5 的 `DailyResponse`；子專案 A 的 `useSay`、`speakNow`、`GUEST_TERMS_TEXT`、`useTerminalLayout`、`DisplayControls`
- Produces：
  - `export function useGuestBootstrap(): { user: AppUser | null; guest: { id: string } | null; isPending: boolean; status: "ready" | "pending" | "failed"; retry: () => void }`：把子專案 A 在 `MorningPractice` 裡的邏輯原樣搬出來。
  - `TapeChartProps` 新增：
    - `levels?: { price: number; label: string }[]`
    - `markT?: number`
  - `chart-data.ts` 新增 `export function levelLabels(levels, …)`：把 `levels` 的標籤併入既有的 `resolveChartLabels`，避免與「昨」「前高」標籤重疊。

- [ ] **Step 1: 寫失敗的測試（圖表標籤）**

`chart-data.test.ts`：
- `levels` 的標籤會出現在標籤清單。
- 與昨收的標籤靠太近時，依既有規則合併或錯開，不會重疊。

- [ ] **Step 2: 執行確認失敗，實作後確認通過**

Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`

Expected: 先 FAIL；實作 `levels`、`markT` 的繪製與標籤之後 PASS。

- [ ] **Step 3: 抽出 `useGuestBootstrap` 並改用**

`MorningPractice` 改用它，畫面與行為不變。

Run: `npm test`（含 `login-profile-flow`）、`npm run typecheck`

Expected: 通過。

- [ ] **Step 4: 作答頁**

`src/routes/daily.tsx`：路由 `/daily`，`head` 標題「每日一題 · 當沖大富翁」。

`daily-question.tsx`：
- **外層**：`<div className="trading-desk td-daily" data-layout={layout}>`，`layout` 用 `useTerminalLayout(mode === "senior")`。
- **頁首**：返回大廳、標題「每日一題」、`題目取自 {M/D（週X）} 真實走勢`、`<DisplayControls compact />`。
- **題目卡**：股票名稱與代號，加上 `questionText` 的問題文字。
- **圖表**：`TapeChart`：
  - `variant="candles"`、`presentation="terminal"`、`completedBarSeconds={60}`、`appendCurrentQuote={false}`、`showVolume`。
  - `prev={referencePrice}`、`startT={0}`、`endT={16200}`、`now` 為最後一根 t + 60、`markT={questionT}`。
  - 前高題傳 `swingHighs=[{ t: levelT, p: level, confirmedAt: levelT + 180 }]`；昨高題傳 `levels=[{ price: level, label: "昨高" }]`。
  - 手機上圖高 220px，大字模式 240px，讓題目、圖與三顆按鈕都在第一個畫面內。
- **作答區**：
  - `role="radiogroup"`、`aria-label="你的選擇"`，三顆大按鈕，文字與小字依規格第 3 節：
    - 進場：站上去就買，先設好停損
    - 觀望：等它真的突破再說
    - 不追：這裡不做
  - 選進場後展開停損：
    - `role="radiogroup"`、`aria-label="停損"`，三個選項：`回檔低點 {price}`、`{前高|昨高}下方 1%：{price}`、`自己設`。
    - 「自己設」用 `stepTick` 的加減按鈕，從 q 收盤下一檔往下到跌停。
  - 理由標籤：`DAILY_REASONS`，可選、單選、可取消。
  - 送出按鈕「送出答案」：選進場而沒選停損時停用，上方顯示「先選一個停損」。
  - `needsTerms` 時，送出按鈕上方顯示 `GUEST_TERMS_TEXT`，並帶 `guestTerms: true`。
- **送出時**：
  - 在點按當下 `say("已送出")`。
  - 收到 409 時重新載入，並顯示一行「題目已更新，已換成最新的題目」。
- **揭曉**（依規格第 4 節，同一頁接在下方）：
  - 圖表換成整天的 K 棒。沒有開啟減少動態效果時，用 600ms 淡入新增的部分。
  - 結論句：大字，放在 `aria-live="polite"` 區，並 `say(headline)`。
  - 事實、學到的、全班分布。分布是三色比例條加文字：`已有 {total} 人作答：進場 {enter}、觀望 {watch}、不追 {skip}`。
  - 進度：`連續 {streak} 天 · 本週 {done}／{total} 天`。
  - 兩顆按鈕：「回大廳」「去模擬練習」。
- **已答過的人**：直接看到揭曉。
- **沒有題目時**：`question === null` 顯示「今天還沒有題目。每個平日早上 6 點會出新的一題。」，加上「回大廳」。
- **載入、錯誤與入場碼問題**：沿用練習頁的 `AccessCard` 樣式與 `describeAccessProblem`。

- [ ] **Step 5: 全部檢查並提交**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`、`npm run build`

Expected: 全部通過。

```bash
git add src/components/use-guest-bootstrap.ts src/components/morning-practice.tsx src/components/charts.tsx src/lib/market/chart-data.ts src/lib/market/chart-data.test.ts src/routes/daily.tsx src/components/daily-question.tsx src/trading-desk.css
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: the daily question page with answer, stop and reveal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 大廳卡片與講師卡片

**Files:**
- Create: `src/components/daily-card.tsx`
- Modify: `src/components/lobby.tsx`（放在 `TodayCard` 之上）、`src/classroom-refresh.css`（`.daily-card*`）
- Create: `src/lib/daily-teacher.ts`（伺服器函式）、`src/components/daily-teacher-card.tsx`
- Modify: `src/components/teacher-workspace.tsx`（放在 `MarketDataCard` 之後）
- Modify: `src/routes/daily.tsx`（`validateSearch` 加 `teacher?: "1"`）、`src/components/daily-question.tsx`（講師參數）

**Interfaces:**
- Consumes: Task 5 的 `DailyResponse`、`dailyTeacherView`；Task 3 的 `WeekDot`
- Produces：
  - `export const loadDailyForTeacher = createServerFn({ method: "GET" })`：
    - 用 `authMiddleware`，講師權限檢查和 `loadTeacherRoster` 相同。
    - 班級代碼取講師自己的 `classroom_profiles.class_code`。
    - 回傳 `{ ok: true, view } | { ok: false, reason }`。

- [ ] **Step 1: 大廳卡片**

`daily-card.tsx`：
- **讀取**：
  - 有 `user` 或 `guest` 時，`fetch("/api/daily")`。
  - 失敗或沒有身分時，顯示預設狀態（標題、一行副標、「開始作答」），不顯示錯誤。
- **未作答**：
  - 標題「今天的一題」。
  - 副標 `約 1 分鐘 · 題目取自 {M/D（週X）} 真實走勢`。
  - 主要按鈕「開始作答」，連到 `/daily`。
- **已作答**：
  - 標題「今天的一題 · 已完成」，副標是揭曉的結論句。
  - 按鈕「看解說」。
- **進度**：
  - 「連續 {N} 天」，搭配 `Flame` 圖示。
  - 五個圓點標「一 二 三 四 五」：`done` 填滿、`off` 標「休」、`missed` 空心、`todo` 虛線。圓點加上 sr-only 文字，例如「週三：已完成」。
- **沒有題目**（`question === null`）：
  - 副標「每個平日早上 6 點出新的一題」，不顯示主要按鈕。
- **大小**：大字模式主要按鈕至少 56px；手機上全寬。

- [ ] **Step 2: 講師卡片**

`daily-teacher-card.tsx`：
- 標題「每日一題」；題目摘要：股票、題型、關鍵價位、題目時間。
- 三色分布條與人數。
- 作答名單表格：學員、選擇（進場／觀望／不追）、停損、理由、作答時間。
- 「尚未作答」名單，以及「訪客 {n} 人」。
- 「看題目與解說」按鈕：開啟 `/daily?teacher=1`。`/daily` 頁看到這個參數時，改用 `GET /api/daily?reveal=1`，直接顯示揭曉。
- 沒有題目時，顯示「今天還沒有題目」。

- [ ] **Step 3: 全部檢查並提交**

Run: `npm test`、`npm run typecheck`、`npx eslint src --quiet`、`npm run build`

Expected: 全部通過。

```bash
git add src/components/daily-card.tsx src/components/lobby.tsx src/classroom-refresh.css src/lib/daily-teacher.ts src/components/daily-teacher-card.tsx src/components/teacher-workspace.tsx src/components/daily-question.tsx src/routes/daily.tsx
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat: daily question cards for the lobby and the teacher page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 畫面檢查、真實資料試出題與紀錄

**Files:**
- Modify: `scripts/qa/desk-server.mjs`：
  - 環境加上 `MARKET_DATA_DIR`：外部有設定就用外部的，否則用 `writeMarketFixture` 在暫存資料夾建立。
  - 外部有設定 `DAILY_NOW_ISO` 時，傳給 app；否則預設 `2026-10-19T07:00:00+08:00`，讓題目固定是 2026-10-14 那一題。
- Create: `scripts/qa/desk-daily.mjs`
- Create: `scripts/daily-preview.mjs`
- Create: `docs/daily-question-2026-10-17.md`

**Interfaces:**
- Consumes: 前面所有 Task 的畫面與 accessible name
- Produces：
  - `node scripts/qa/desk-daily.mjs <label>`：沿用 `desk-guest.mjs` 的作法，全新瀏覽器直接連 `appBase`。
  - `node --experimental-strip-types scripts/daily-preview.mjs <market-data 目錄> <資料日>`：只讀，印出挑中的題目摘要與揭曉結果，並列出前 10 個候選。

- [ ] **Step 1: 寫 `desk-daily.mjs`**

案例：375、320、375 大字、820、1366。每個案例：
1. 過入場碼（勾選同意）→ 大廳 → 「開始作答」（第 1 下）。
2. 題目頁：
   - 手機尺寸時，題目文字、圖表 canvas、三顆作答按鈕的下緣都在第一個畫面內。
   - 第一次的訪客看得到聲明句。
3. **觀望流程**：按「觀望」（第 2 下）→「送出答案」（第 3 下）→ 揭曉結論句出現 → 看得到「已有」與「連續 1 天」。
4. **進場流程**（另一個全新瀏覽器，375 與 1366）：
   - 按「進場」→ 確認「送出答案」為停用、看得到「先選一個停損」。
   - 選「回檔低點」→ 送出，共 4 下 → 揭曉出現「假設」開頭的進場事實。
5. 回大廳：卡片顯示「已完成」與「看解說」。
6. 每個畫面都套用 `desk-guest.mjs` 的檢查：
   - 文字至少 11px，沒有水平溢出。
   - 寬度 < 1200 時新控制項至少 44px；大字模式的作答按鈕與主要按鈕至少 56px。
7. 講師：經 proxy（已登入的講師）打開 `/teacher` → 每日一題卡片顯示人數 ≥ 2 → 「看題目與解說」→ 看得到結論句。

- [ ] **Step 2: 執行全部檢查**

依序執行：
1. `npm test`、`npm run typecheck`、`npx eslint src --quiet`、`npm run build`
2. 啟動 `desk-server.mjs`
3. `desk-seed.mjs`、`desk-layout.mjs --strict`、`desk-orders.mjs`、`desk-guest.mjs`、`desk-daily.mjs daily`
4. 四個整合測試：auth、morning、guest、daily

Expected: 全部通過。用 Read 工具逐張看 `artifacts/trading-desk-qa/daily/` 的手機、大字與桌機截圖。

- [ ] **Step 3: 用真實資料試出題**

Run: `node --experimental-strip-types scripts/daily-preview.mjs "C:/Users/kevin/YilutekServices/DayTradeTycoon/market-data" 2026-10-16`

Expected: 印出一題（股票、時間、價位、結果）與前 10 個候選。

再截一張這一題的作答頁：
- 用 `MARKET_DATA_DIR=<上面的目錄>`、`DAILY_NOW_ISO=2026-10-19T07:00:00+08:00` 啟動 `desk-server.mjs`。
- 截 375 與 1366 各一張作答前、揭曉後的畫面。
- 只讀這個目錄，不寫入。

- [ ] **Step 4: 寫紀錄**

`docs/daily-question-2026-10-17.md`（繁體中文）記錄：
- 完成的功能
- 真實資料試出的題目：摘要、前 10 個候選與截圖路徑，給使用者判斷題目品質
- 測試與檢查結果，含數字
- 尚未驗證的項目：真實手機、第一次自動發題的日期 2026-10-19 06:00
- 部署注意：遷移 `0009`；回退時舊版不讀新表，可直接切回

- [ ] **Step 5: 提交**

```bash
git add scripts/qa/desk-server.mjs scripts/qa/desk-daily.mjs scripts/daily-preview.mjs docs/daily-question-2026-10-17.md
git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "test: daily question screen checks, a real-data preview and the record" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
