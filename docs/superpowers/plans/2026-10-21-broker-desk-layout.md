# 券商式交易台改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the morning trading desk into the four-pane broker layout agreed at the 10/20 meeting, with a real TAIEX panel, a left-buy/right-sell side-by-side order book, order reports next to the ticket and a large-order confirmation, and restructure the phone, senior and tablet layouts in the same broker style.

**Architecture:** TAIEX minute bars and 5-second points are derived from the retained TWSE raw files by a shared script module and added to both lesson JSON files through the approval path (lesson IDs and stock bars unchanged). The server reveals `state.index` exactly like stock bars; the client replays the newest index minute from its real 5-second points. On desktop the workbench becomes a CSS grid with areas `watch | index` over `center | book | ticket/ledger`. `PaperOrder` renders the book pane and the ticket as siblings inside a `display: contents` wrapper, so they land in their own grid areas while still sharing ticket state.

**Tech Stack:** React 19, TanStack Start, TypeScript, plain CSS (`src/trading-desk.css`), node:test (`--experimental-strip-types`), Playwright QA scripts against a disposable classroom (`scripts/qa/desk-server.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-21-broker-desk-layout-design.md`

## Global Constraints

- Real data only. In-minute stock movement, the trade tape, the five-level book and its totals are labelled 「模擬」. TAIEX values are real (TWSE 5-second) and show their source.
- No future leak: the server returns exactly `cursor` index bars, and the client reveals the newest index minute's points only as the replay advances.
- Lesson IDs and stock bars must not change. `src/lib/morning-lessons.test.ts` keeps pinning both.
- Lesson data changes only through the generator scripts. Re-pin `preservedLessonSha256` with an approval comment. Approval by the product owner, 2026-10-21: 「想辦法做到好」.
- Matching, order validation and P&L must not read `index`. No change to fills, the stored-state format or retry semantics.
- Unverified volume stays hidden. Volume columns appear only when `catalog.volumeUnit === "lot"`. Today neither lesson has it.
- Large order: buy only, `amount >= 0.5 * availableCash` (`LARGE_ORDER_CASH_SHARE = 0.5`).
- Lightning: left column (委買) buys at that price; right column (委賣) sells at that price.
- The existing error banner and its 「重試這次操作」 stay exactly as they are; order reports add a red row beside them.
- UI copy is Traditional Chinese.
- Desktop text is at least 11px. Phone controls are at least 44px tall; senior controls at least 56px.
- Breakpoints stay: phone < 768, tablet 768–1199, desktop ≥ 1200 (`src/lib/use-terminal-layout.ts`).
- Work only in `.worktrees/broker-desk` (branch `claude/broker-desk`).
- Commit identity: `git -c user.name=Claude -c user.email=noreply@anthropic.com`, with the message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No push, merge or deploy without the user's explicit OK.
- Never touch other worktrees or `當沖大富翁-地端/`.

## Review Focus

1. **A session without `index`** (older saved state, or a lesson with no index data). Every pane renders and the index panel shows 「本教材沒有大盤資料」. Test in Task 4 (`liveSession` without index) and Task 6 QA (plan screen).
2. **Cursor 0 / plan screen.** The watch table, index panel and quote grid show 「—」, never NaN, an empty canvas error or a 0.00% change. Test in Task 4 (`indexSummary([])`) and Task 6 QA.
3. **Large-order checkbox after the order changes.** Ticking it for 2 lots, going back and choosing 1 lot must show no large-order block. Reopening a large order starts unticked. Test in Task 8 QA.
4. **Lightning sell with no holdings.** The right column is disabled and a click sends nothing. Test in Task 8 QA.
5. **Short desktops (1366×768, 1200×800).** All four panes fit with no page scroll, the ticket's submit button is visible, and the chart meets its floor. Test in Task 10 (`desk-layout`).

---

### Task 1: TAIEX minute bars from the TWSE 5-second files

**Files:**
- Create: `scripts/lib/taiex-minutes.mjs`
- Test: `scripts/lib/taiex-minutes.test.mjs`

**Interfaces:**
- Produces:
  - `parseTwseIndex5s(raw: { fields: string[]; data: string[][] }): { time: string; value: number }[]`. Uses columns `時間` and `發行量加權股價指數`. Strips the thousands commas.
  - `taiexMinuteBars(points, { previousClose: number, minutes: number }): { t: number; o: number; h: number; l: number; c: number; p: number[] }[]`.
  - Both functions throw `Error` with a Chinese message on any violation.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/taiex-minutes.test.mjs`, reading the real raw files under `research/daily-market/2026-10-06-collection/taiwan/raw/`:
  - `test("10/06: 90 bars of 12 real points, the 09:00:00 placeholder left out")`:
    - `bars.length === 90`;
    - every `p.length === 12`;
    - `bars[0]` deepEquals `{ t: 0, o: 49736.37, h: 49932.26, l: 49736.37, c: 49932.26, p: [...] }` (check `o`, `h`, `l`, `c` exactly, `p[0] === 49736.37`, `p[11] === 49932.26`);
    - `bars[1]` is `{ t: 60, o: 49933.58, h: 49968.92, l: 49884.75, c: 49966.88 }`;
    - `bars[89]` is `{ t: 5340, o: 49611.45, h: 49639.18, l: 49589.01, c: 49590.16 }`;
    - for every bar: `o === p[0]`, `c === p[11]`, `h === Math.max(...p)`, `l === Math.min(...p)`.
  - `test("10/05: the open is 09:00:05 (48,574.95), never the 48,475.74 placeholder")`:
    - `bars[0]` is `{ o: 48574.95, h: 49441.55, l: 48574.95, c: 49441.55 }`;
    - `Math.min(...bars.map(b => b.l)) === 48574.95`;
    - `bars[89]` is `{ o: 49735.16, h: 49739.19, l: 49687.69, c: 49739.19 }`.
  - `test("parse: 3,241 points 09:00:00–13:30:00 every 5 seconds")`:
    - for both files: `points.length === 3241`;
    - `points[0].time === "09:00:00"`;
    - `points.at(-1).time === "13:30:00"`.
  - `test("the first point must equal the previous close, or the file is not the expected kind")`: calling `taiexMinuteBars` with `previousClose: 1` throws.
  - `test("a missing 5-second point is refused")`: drop one point from the middle; it throws.

- [ ] **Step 2: Run to see them fail**
  Run: `node --experimental-strip-types --test scripts/lib/taiex-minutes.test.mjs`
  Expected: FAIL, cannot find module `./taiex-minutes.mjs`.

- [ ] **Step 3: Implement both functions in `scripts/lib/taiex-minutes.mjs`**
  - Times are seconds after 09:00.
  - Assert points are exactly every 5 s with no gap.
  - Assert the first point is at 0 s and equals `previousClose`.
  - Bar i takes the points with `i*60 < s <= i*60+60`; assert there are exactly 12.
  - The module must be plain ESM with no dependencies; both generators import it.

- [ ] **Step 4: Run to see them pass.** Same command. Expected: PASS, 5 tests.

- [ ] **Step 5: Commit** — `feat: TAIEX minute bars from TWSE 5-second files (placeholder 09:00:00 left out)`

### Task 2: Lesson data gains the real TAIEX (approval path)

**Files:**
- Modify: `scripts/prepare-morning-data.mjs` (10/06), `scripts/prepare-morning-expansion.mjs` (10/05, plus `preservedLessonSha256`)
- Regenerate: `server/data/morning-2026-10-06.json`, `server/data/morning-2026-10-05.json`, `research/daily-market/2026-10-07-morning-expansion/verification-report.json`
- Modify: `src/lib/morning-engine.ts` (`MorningSource`), `src/lib/morning-data.server.ts`
- Test: `src/lib/morning-lessons.test.ts`
- Create: `docs/lesson-index-2026-10-21.md`

**Interfaces:**
- Consumes: Task 1 `parseTwseIndex5s`, `taiexMinuteBars`.
- Produces:
  - Lesson JSON top-level key `index: { code: "TAIEX", name: "加權指數", previousClose: number, source: string, bars: { t, o, h, l, c, p }[] }`, with 90 bars.
  - `MorningSource.index?: MorningIndexSeries` (type from Task 3; declare it in `src/lib/morning.ts` in this task).
  - `MorningIndexSeries = { code: "TAIEX"; name: string; previousClose: number; source: string; bars: MorningIndexBar[] }`.
  - `MorningIndexBar = { t: number; o: number; h: number; l: number; c: number; p: number[] }`.

- [ ] **Step 1: Write failing tests** in `src/lib/morning-lessons.test.ts`:
  - `test("every lesson carries the real TAIEX: 90 bars of 12 five-second points")`: for each source,
    - `source.index.code === "TAIEX"`;
    - `bars.length === 90`;
    - `bars[0].t === 0`;
    - `source.index.source` includes `"TWSE"`.
  - Previous closes:
    - 10/06 `index.previousClose === 49712.04` and `bars[0].o === 49736.37`;
    - 10/05 `index.previousClose === 48475.74` and `bars[0].o === 48574.95`.
  - `test("every lesson's notices explain the TAIEX source and its 09:00:05 open")`: some notice includes `"加權指數"`, `"證交所"` and `"09:00:05"`.
  - The existing test `"notice edits never change a lesson's identity or its real minute bars"` stays unchanged and must keep passing.

- [ ] **Step 2: Run to see them fail**
  Run: `node --experimental-strip-types --test src/lib/morning-lessons.test.ts`
  Expected: FAIL, `source.index` is undefined.

- [ ] **Step 3: Generators**
  - In both scripts, read and hash-check the raw file (`twse-index5s-20261006.json` sha256 `6863c329125b815a5265a3fc21ad89eab2661af3b5930e6d47b9d7dcf000e988`; `twse-index5s-20261005.json` sha256 `cdfcde9033334832e7e8a50bad1d2a6a31ac342f40cfd14416e4aa244864cb1f`).
  - Read the previous close from `twse-indexdaily-202610.json` (sha256 `5ef2353dbb11721239ce0fdd6ace91739755fb27fd9b4e9d98426168682bb054`): row `115/10/02` gives 48475.74 for 10/05; row `115/10/05` gives 49712.04 for 10/06.
  - Assert the 13:30:00 point equals that day's close row (10/05: 49712.04; 10/06: 49822.55).
  - Build `index` with `minutes: 90` and `source: "證交所 MI_5MINS_INDEX 每 5 秒發行量加權股價指數"`.
  - Add `index` to the dataset after `bars`. Add `index` source paths and sha256s to `provenance` (`indexSourcePath`, `indexSourceSha256`, `indexDailyPath`, `indexDailySha256`).
  - Append this notice to each catalog's `notices`, verbatim:
    「大盤：證交所每 5 秒加權指數，每分鐘揭露後依真實 5 秒值重播；09:00:00 是前一日收盤的佔位值，不列入，開盤取 09:00:05 第一個計算值。」
  - The 10/05 lesson ID must still come from `minuteHash` of the stock bars only.

- [ ] **Step 4: Regenerate and re-pin**
  Run in order:
  1. `node scripts/prepare-morning-data.mjs`
  2. Compute the new sha256 of `server/data/morning-2026-10-06.json`. Set `preservedLessonSha256` to it, with the comment `// 2026-10-21 approved by the product owner (「想辦法做到好」): TAIEX added; stock bars and lesson IDs unchanged.`
  3. `node scripts/prepare-morning-expansion.mjs`
  4. `node scripts/prepare-morning-data.mjs --check && node scripts/prepare-morning-expansion.mjs --check && node scripts/verify-morning-source.mjs`

  Expected: all three checks print their success line.

- [ ] **Step 5: Server source**
  - In `src/lib/morning-engine.ts`: `export type MorningSource = { catalog: MorningCatalog; bars: Record<string, Bar[]>; index?: MorningIndexSeries }`.
  - In `src/lib/morning-data.server.ts`: pass `index: octoberFifth.index` and `index: dataset.index`.

- [ ] **Step 6: Run the tests and the full suite**
  Run: `node --experimental-strip-types --test src/lib/morning-lessons.test.ts && npm test`
  Expected: the new tests PASS; the full suite shows 0 failures.

- [ ] **Step 7: Approval record**
  Write `docs/lesson-index-2026-10-21.md` in the style of `docs/lesson-notice-2026-10-20.md`:
  - the approval quote and reason;
  - what changed (the `index` key and one notice per lesson);
  - a table of IDs and hashes (lesson IDs unchanged, stock bars hashes unchanged, before/after data-file sha256);
  - the check commands and their results.

- [ ] **Step 8: Commit** — `feat(data): lessons carry the real TAIEX (TWSE 5-second), lesson IDs and stock bars unchanged`

### Task 3: Server reveals the index minute by minute

**Files:**
- Modify: `src/lib/morning.ts` (`MorningState.index?`), `src/lib/morning-engine.ts` (`MorningStoredState`, `visibleMorningState`)
- Test: `src/lib/morning-engine.test.ts`

**Interfaces:**
- Consumes: Task 2 `MorningSource.index`.
- Produces:
  - `MorningState.index?: MorningIndexSeries`, with exactly `state.cursor` bars.
  - `MorningStoredState = Omit<MorningState, "bars" | "index">`.

- [ ] **Step 1: Failing tests** in `src/lib/morning-engine.test.ts`:
  - `test("the index is revealed exactly like stock bars")`: with a source whose `index` has 3 bars, `visibleMorningState` at cursor 0, 1 and 3 returns `index.bars.length` 0, 1 and 3. `index.previousClose` and `name` pass through.
  - `test("a source without an index reveals none")`: `visibleMorningState(...).index === undefined`.
  - `test("the stored state never contains index bars")`: after `start` then `advance`, the persisted state object has no `index` key. Use the same helpers the file already uses to read stored state.

- [ ] **Step 2: Run to see them fail**
  Run: `node --experimental-strip-types --test src/lib/morning-engine.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - In `visibleMorningState`, add `...(source.index ? { index: { ...source.index, bars: source.index.bars.slice(0, state.cursor) } } : {})`.
  - Make sure nothing in apply/advance/order/fill reads `index`.

- [ ] **Step 4: Run the tests and the suite.** Expected: PASS, and 0 failures in `npm test`.

- [ ] **Step 5: Commit** — `feat(engine): reveal TAIEX bars with the cursor; never stored`

### Task 4: Client replays the index minute from real 5-second points

**Files:**
- Create: `src/lib/morning-index.ts`
- Modify: `src/lib/morning-live.ts`
- Test: `src/lib/morning-index.test.ts`, `src/lib/morning-live.test.ts`

**Interfaces:**
- Consumes: `MorningIndexBar`, `MorningIndexSeries` (Task 2), `LiveMorningState` (existing).
- Produces:
  - `formingIndexBar(bar: MorningIndexBar, fraction: number): MorningIndexBar`. Shown points = `bar.p.slice(0, max(1, floor(fraction * 12)))`; at `fraction >= 1` it returns `{ ...bar }`.
  - `indexSummary(bars: readonly MorningIndexBar[], previousClose: number): { last: number | null; change: number | null; changeText: string; percentText: string; tone: "up" | "down" | "flat"; open: number | null; high: number | null; low: number | null }`. Number text uses `formatIndex` from `src/lib/market/week.ts`.
  - `liveSession` replaces the newest index bar with `formingIndexBar(..., fraction)` while replaying.
  - `withoutNewestMinute` drops the newest index bar too.

- [ ] **Step 1: Failing tests**
  - `formingIndexBar` at fraction 0: `o === p[0]`, `c === p[0]`, `h === p[0]`, `l === p[0]`.
  - At fraction 0.5: `c === p[5]`, `h === max(p[0..5])`, `l === min(p[0..5])`.
  - At 1: equals the bar. At 0.999: never above the bar's real `h` or below its `l`.
  - `indexSummary([] , 49712.04)` gives `last: null`, `changeText: ""`, `percentText: ""`, `tone: "flat"`.
  - `indexSummary` of the real 10/06 first bar against 49712.04: `last === 49932.26` and `changeText === "220.22"`, `percentText === "+0.44%"`.
  - In `src/lib/morning-live.test.ts`: `liveSession` of a session with index at fraction 0.25 has newest index `c === p[2]` and other bars untouched. `liveSession` and `withoutNewestMinute` of a session **without** `index` return no `index` and do not throw (Review Focus 1). `withoutNewestMinute` drops one index bar.

- [ ] **Step 2: Run to see them fail**
  Run: `node --experimental-strip-types --test src/lib/morning-index.test.ts src/lib/morning-live.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** both functions and the two `morning-live.ts` changes.
  - `percentText` formatting must match the stock `formatPercentChange` convention (sign and two decimals).

- [ ] **Step 4: Run to see them pass, then `npm test`.** Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `feat: TAIEX replays its real 5-second points inside the minute`

### Task 5: Order rules and reports (pure)

**Files:**
- Create: `src/lib/morning-orders.ts`
- Test: `src/lib/morning-orders.test.ts`

**Interfaces:**
- Produces:
  - `LARGE_ORDER_CASH_SHARE = 0.5`.
  - `isLargeOrder(input: { side: "buy" | "sell"; amount: number | null; availableCash: number }): boolean`. True only for buys with `amount !== null && availableCash > 0 && amount >= LARGE_ORDER_CASH_SHARE * availableCash`.
  - `type LocalOrderFailure = { id: string; cursor: number; second: number; code: string; side: "buy" | "sell"; lots: number; limitPrice?: number; message: string }`.
  - `type OrderReport = { key: string; time: string | null; tone: "sent" | "filled" | "closed" | "failed"; text: string }`.
  - `orderReports(state: MorningState | null, names: Record<string, string>, failures: readonly LocalOrderFailure[], limit = 5): OrderReport[]`. Newest first.

- [ ] **Step 1: Failing tests**
  - `isLargeOrder`:
    - buy 2,580,000 of 10,000,000 → false;
    - buy 5,160,000 of 10,000,000 → true;
    - buy 5,165,000 of 9,990,000 → true;
    - sell 9,000,000 of 1,000 → false;
    - amount null → false;
    - availableCash 0 → false.
  - `orderReports` for a run with:
    - order A: buy 2330, 1 lot, market, submittedCursor 20, filled, `fill.t = 1200`, price 2575;
    - order B: sell 2330, 1 lot, limit 2595, cancelled with reason 「由學員取消」;
    - one local failure at cursor 41, second 2460, with message 「目前模擬資金不足，無法委託」.

    It returns, newest first:
    1. `{ tone: "failed", time: "09:41", text: "送出失敗 · 買進 台積電 1 張 · 目前模擬資金不足，無法委託" }`
    2. `{ tone: "closed", time: null, text: "已撤回 · 賣出 台積電 1 張 限價 2595 · 由學員取消" }`
    3. `{ tone: "sent", time: "<B's submitted HH:MM>", text: "委託成功 · 賣出 台積電 1 張 限價 2595" }`
    4. `{ tone: "filled", time: "09:20", text: "成交 · 買進 台積電 1 張 @ 2575" }`
    5. `{ tone: "sent", time: "09:20", text: "委託成功 · 買進 台積電 1 張 市價（待下一分鐘開盤撮合）" }`

    Build the exact fixture in the test.
  - `orderReports` caps at `limit`. With `state === null` it returns only the local failures.
  - A rejected order shows `tone: "closed"` and the text `未成交 · … · <reason>`.

- [ ] **Step 2: Run to see them fail**
  Run: `node --experimental-strip-types --test src/lib/morning-orders.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The sequence is each order's submit, then its result: a fill matched by side/code/shares in fill order, or its status.
  - A local failure goes after server events of the same or earlier cursor.
  - Then reverse and slice.
  - Time: `formatTime(cursor * 60).slice(0, 5)` for submits and failures; `formatTime(fill.t).slice(0, 5)` for fills.

- [ ] **Step 4: Run to see them pass, then `npm test`.**

- [ ] **Step 5: Commit** — `feat: large-order rule and order reports for the ticket`

### Task 6: Broker-layout QA first (RED against the current release)

**Files:**
- Create: `scripts/qa/desk-broker.mjs` (usage `node scripts/qa/desk-broker.mjs <base> <label> [--strict]`, after `desk-seed`)

**Interfaces:**
- Consumes: the selectors below, which Tasks 7–9 must provide exactly:
  - `.td-workbench` areas: `[data-pane="watch"]`, `[data-pane="index"]`, `[data-pane="center"]`, `[data-pane="book"]`, `[data-pane="ticket"]`, `[data-pane="ledger"]`;
  - watch rows `.td-watch-row[data-code]`, index row `[data-code="TAIEX"]`;
  - index value `.td-index-value`;
  - book cells `.td-book-cell[data-side="bid"|"ask"][data-level]`, each a button with `data-price`;
  - large-order block `.sim-large`, checkbox `#sim-large-ack`;
  - reports `.sim-reports li[data-tone]`;
  - quote grid `.td-quote-grid`;
  - stock tabs `nav[aria-label="個股資訊分頁"]` with buttons 「五檔」「明細」「分鐘」 (phone also 「詳細」).

Checks at 1440×900, unless noted:

1. **Four panes**: the six panes are visible, `watch` and `index` share a top edge (±2px), `center`/`book` are left of `ticket`/`ledger`, no two pane rects overlap, and there is no page scroll.
2. **Index**: `.td-index-value` text equals `formatIndex` of the last revealed index bar's `c` read from `/api/morning` `state.index`. After `+1 分`, during the replay, sample it 10 times every 150 ms: every sampled value must be one of that minute's `p` values. At rest it equals the newest `c`.
3. **No leak**: `/api/morning` `state.index.bars.length === state.cursor`.
4. **Watch table**: 6 rows (TAIEX first). The TAIEX row's price equals the index value. Clicking the 2317 row changes `#morning-practice-title` to 鴻海. Clicking TAIEX does not change it.
5. **Lightning left-buy**: arm 閃電, click the bid row at level 1 (`.td-book-cell[data-side="bid"][data-level="1"]`). The new pending order from `/api/morning` is `side: "buy"` with `limitPrice` equal to that cell's `data-price`. Cancel it with 撤回委託. Disarm.
6. **Right column without holdings** (Review Focus 4): use a fresh guest round or select a stock with no position. The ask cells are disabled.
7. **Large order** (Review Focus 3): choose 2 lots of 台積電, market, 核對. `.sim-large` is visible and the 確認送出 button is disabled. Tick `#sim-large-ack`; it becomes enabled. Press 返回修改, choose 1 lot, 核對: no `.sim-large`. With 閃電 armed and 2 lots, a bid click opens the confirm card instead of sending (the pending count does not change).
8. **Reports**: after a confirmed market buy, `.sim-reports li[data-tone="sent"]` contains 委託成功. After advancing, a `[data-tone="filled"]` row exists. Then buy 3 lots, advance, and buy 1 more. The banner appears and `.sim-reports li[data-tone="failed"]` contains 資金不足.
9. **Plan screen** (Review Focus 2): before 開始, `/morning` with a fresh guest shows the index pane text 「開始練習後顯示大盤」 and no `NaN` anywhere in `document.body.innerText`.
10. **Phone 390×844**:
    - The dock 自選 shows the TAIEX row first. Tapping it shows `.td-index-value` on the 行情 pane, and 下單 shows 「指數不能下單，請選一檔股票」.
    - Tapping 台積電 then 行情: the book on 行情 has no `.td-flash` switch.
    - Tapping a bid price there switches to 下單, with the side 買進 pressed and the limit field holding that price.

- [ ] **Step 1: Write the script** with the checks above. Write `broker.json` and screenshots into `artifacts/trading-desk-qa/<label>/`. Use a `--strict` exit code.
- [ ] **Step 2: Run it against the current release** in a disposable classroom on ports 18882/18883:
  1. `PORT_APP=18882 PORT_PROXY=18883 APP_ENTRY=<release>/server/index.mjs DOWNLOADS=<release>/downloads node scripts/qa/desk-server.mjs`
  2. `node scripts/qa/desk-seed.mjs http://127.0.0.1:18883`
  3. `node scripts/qa/desk-broker.mjs http://127.0.0.1:18883 broker-red --strict`
  4. `node scripts/qa/desk-stop.mjs 18883`

  Expected: exit 1, with failures for the missing panes and selectors.
- [ ] **Step 3: Commit** — `test(qa): broker-layout desk checks (RED on the current release)`

### Task 7: Desktop four-pane workbench, watch table, index panel, stock detail

**Files:**
- Create: `src/components/watch-table.tsx`, `src/components/index-panel.tsx`, `src/components/stock-detail.tsx`
- Modify:
  - `src/components/morning-practice.tsx`: workbench children carry `data-pane`. Replace `MorningWatchlist` with `WatchTable`. Add `IndexPanel` (desktop). Remove the left plan note (it moves to `HintBar`). The tape leaves `.td-chart-row`.
  - `src/components/quote-hero.tsx`: remove `td-hero-stats`.
  - `src/components/morning-desk-bar.tsx`: `HintBar` gets `plan?: { code: string; label: string; onOpen: () => void }`, rendered as a button 「本輪計畫：{code} {label}」.
  - `src/components/morning-quotes.tsx`: `MorningQuoteDetail` is removed; the minute table moves to `stock-detail.tsx`.
  - `src/lib/coach-steps.ts`: unchanged selectors; `data-coach="ticket"` moves to the ticket section in Task 8.
  - `src/trading-desk.css`.

**Interfaces:**
- Consumes: Task 4 `indexSummary`, `LiveMorningState.index`.
- Produces:
  - `WatchTable({ catalog, session, code, compact, onSelect, onIndex }: { catalog: MorningCatalog; session: LiveMorningState | null; code: string; compact?: boolean; onSelect: (code: string) => void; onIndex: () => void })`.
    - Rows `.td-watch-row[data-code]`, buttons with `aria-pressed`.
    - Columns: 商品, 成交, 漲跌, 漲跌%, 買進, 賣出, 最高, 最低, 走勢 (MiniCandles).
    - `compact` keeps 商品, 成交, 漲跌%, 走勢.
    - The TAIEX row is first.
  - `MiniCandles({ bars, previous, endT }: { bars: readonly { t: number; o: number; h: number; l: number; c: number }[]; previous: number; endT: number })`: canvas via the existing `useDeviceCanvas` hook, about 120×28 CSS px, with a dashed previous-close line.
  - `IndexPanel({ series, date, placeholder }: { series: MorningIndexSeries | undefined; date: string; placeholder: string })`:
    - header `.td-index-value` + change + percent + time `HH:MM:SS` + 「證交所 每 5 秒」;
    - `IndexChart` (canvas line + area against the previous close, x from 0 to 16200 s, y from `jiangboPriceRange(previousClose, high, low)`);
    - stats 開盤, 最高, 最低, 昨收;
    - `placeholder` when `series` is undefined or has no bars. `MorningLesson` passes 「開始練習後顯示大盤」 when there is no running session, and 「本教材沒有大盤資料」 when the session has no `index`.
  - `QuoteDetailGrid({ catalog, session, code })`: `.td-quote-grid` `dl` with 成交, 漲跌, 漲跌幅, 開盤, 最高, 最低, 昨收, 振幅, 時間.
    - 振幅 = (最高 − 最低) ÷ 昨收, with two decimals and %.
    - 均價 appears only when every revealed bar has `a`. **(Ruling: hidden rather than 「—」, matching the volume rule; the spec said 「—」.)**
  - `StockTabs({ tabs, initial }: { tabs: { id: "book" | "tape" | "minutes" | "detail"; label: string; content: ReactNode }[]; initial?: string })`: `nav[aria-label="個股資訊分頁"]`.
  - `MinuteTable({ session, code })`: the old minute table.

- [ ] **Step 1: Build the components and the desktop grid.**

  ```
  grid-template-columns: minmax(0,1fr) 300px clamp(380px,30vw,500px);
  grid-template-rows: clamp(188px,25vh,272px) auto minmax(0,1fr);
  areas: "watch watch index" "center book ticket" "center book ledger"
  ```

  - Panes scroll internally.
  - On desktop, `.td-trade` and the `PaperOrder` root become `display: contents`. The book pane (Task 8) takes `grid-area: book`, the ticket takes `ticket`.
  - Until Task 8, the existing `PaperOrder` sits in `book`.
- [ ] **Step 2: `npm run typecheck && npx eslint src --quiet && npm test`.** Expected: clean, 0 failures.
- [ ] **Step 3: Build and run `desk-broker`** (same sequence as Task 6, label `broker-t7`). Expected: checks 1–4 and 9 pass; 5–8 and 10 may still fail.
- [ ] **Step 4: Commit** — `feat(desk): four-pane broker workbench with watch table, TAIEX panel and quote grid`

### Task 8: Side-by-side book, 左買右賣 lightning, large-order confirm, reports beside the ticket

**Files:**
- Modify:
  - `src/components/morning-order-book.tsx`: rewrite the layout.
    - Header: `教學模擬五檔` chip, 「最新 {price}」, 可賣 N 張.
    - Column heads: 「委買｜點價買進」「委賣｜點價賣出」.
    - Five rows: `.td-book-cell[data-side="bid"][data-level=n][data-price]` (bar, lots, price) on the left and `.td-book-cell[data-side="ask"]` (price, lots, bar) on the right.
    - A totals row with the 「模擬」 pressure bar.
    - The 閃電 switch and lots only when `mode === "trade"`.
  - `src/components/morning-trading.tsx`:
    - `PaperOrder` renders `<section className="td-book-pane" data-pane="book">` (QuoteDetailGrid + StockTabs [五檔, 明細 (TradeTape), 分鐘]).
    - It also renders `<section className="sim-ticket" data-pane="ticket" data-coach="ticket">` (ticket, then `OrderReports`).
    - Large-order block and checkbox in the confirm card.
    - New props `failures: readonly LocalOrderFailure[]` and `prefill?: { price: number; side: "buy" | "sell"; nonce: number }`.
  - Create `src/components/order-reports.tsx`.
  - `src/components/morning-practice.tsx`: keep `failures` state and pass it in.
  - `src/components/morning-practice.tsx` `useMorningData`: also return `lastError: () => string`, a ref set wherever `setError` is called with a message.
  - `src/lib/coach-steps.ts`: unchanged (`ticket` now on the section).
  - `src/trading-desk.css`.

**Interfaces:**
- Consumes: Task 5 `isLargeOrder`, `orderReports`, `LocalOrderFailure`; Task 7 `QuoteDetailGrid`, `StockTabs`, `MinuteTable`.
- Produces:
  - `MorningOrderBook` prop `mode: "trade" | "display"` and `onPick(price, side)`, where `side` is `"buy"` for bid cells and `"sell"` for ask cells. Accessible name: `買{n} {price}，點擊以 {price} 限價買進 {lots} 張` and `賣{n} {price}，點擊以 {price} 限價賣出 {lots} 張`.
  - `OrderReports({ reports }: { reports: OrderReport[] })`: `.sim-reports` list with `li[data-tone]`, heading 「委託回報」, and the note 「送出失敗只記在這次瀏覽」.

- [ ] **Step 1: Implement the book, the ticket split, the large-order rule and the reports.**
  - Large order:
    - `ack` state resets whenever `review` changes.
    - Submit is disabled while `isLargeOrder(...) && !ack`.
    - In `pickBookPrice` with 閃電 armed: if `isLargeOrder({ side: pickedSide, amount: price * lots * 1000, availableCash: session.cash })`, call `setReview(...)` plus a `setLargeNotice("大額委託需要確認")` instead of sending.
  - Failures: in `MorningLesson.order`, when `request` returns null and `lastError()` is non-empty, append a `LocalOrderFailure` with `crypto.randomUUID()`, `cursor`, the replay clock second, `code`, `side`, `lots`, `limitPrice` and the message.
- [ ] **Step 2: `npm run typecheck && npx eslint src --quiet && npm test`.**
- [ ] **Step 3: Build and run `desk-broker`** (label `broker-t8`). Expected: checks 1–9 pass.
- [ ] **Step 4: Commit** — `feat(desk): side-by-side book with left-buy/right-sell lightning, large-order confirm, order reports`

### Task 9: Phone, senior and tablet in the broker style

**Files:**
- Modify: `src/components/morning-practice.tsx`, `src/components/quote-hero.tsx`, `src/components/morning-trading.tsx`, `src/trading-desk.css`

**Interfaces:**
- Consumes: Tasks 7–8 components.
- Produces:
  - In `MorningLesson`: `indexView` state, set by `WatchTable onIndex` on single-pane layouts and cleared by `onSelect`.
  - `prefill` handoff from the 行情 book: `mode="display"`, whose `onPick` sets prefill and `activePane("trade")`.

- [ ] **Step 1: Phone and senior (single pane)**
  - **行情**: either `IndexPanel` (when `indexView`), or:
    1. `QuoteHero` with the quote block layout (price, change, 買進/賣出 boxes);
    2. the code-and-time line `2330 · {date} {HH:MM:SS}`;
    3. the chart toolbar and chart;
    4. `StockTabs` [五檔 (display book), 明細, 詳細 (QuoteDetailGrid + MinuteTable)].
  - **下單**: when `indexView`, the message 「指數不能下單，請選一檔股票」 plus a button to 自選. Otherwise `QuoteLine` + `PaperOrder` (its book pane shows only the 五檔 tab with `mode="trade"`, then the ticket and reports).
  - **自選**: `WatchTable compact`, with the TAIEX row first.
  - **Senior**: same structure, controls ≥56px.
- [ ] **Step 2: Tablet**
  ```
  areas: "watch watch" "center book" "center ticket" "ledger ledger"
  ```
  - `WatchTable compact`; no index pane (the TAIEX row only).
- [ ] **Step 3: `npm run typecheck && npx eslint src --quiet && npm test`;** build; run `desk-broker` (label `broker-t9`). Expected: all checks 1–10 pass.
- [ ] **Step 4: Commit** — `feat(desk): phone, senior and tablet in the broker layout`

### Task 10: Existing QA scripts and the manual follow the new desk

**Files:**
- Modify:
  - `scripts/qa/desk-layout.mjs`:
    - Add the case 1366×768.
    - Desktop chart floors: 1920×1080 ≥ 600, 1440×900 ≥ 420, 1366×900 ≥ 420, 1366×768 ≥ 300, 1280×800 ≥ 360, 1200×800 ≥ 340. Width ≥ 1.2 × height.
    - The ledger is always shown on desktop. Drop the collapse expectation there, and keep it for tablets only if the tablet still collapses.
    - The submit button is visible inside `[data-pane="ticket"]`.
    - Mini candles at least 100×24.
  - `scripts/qa/desk-premium.mjs`: `td-watch-item` → `.td-watch-row`; drop `td-hero-stats`; ladder selectors → `.td-book-cell`.
  - `scripts/qa/desk-ticks.mjs`:
    - Click the 「明細」 tab before reading the tape.
    - Hero equals the book: compare against the `.td-book-cell[data-level="1"]` prices.
    - The held-ladder check uses the bid/ask cells.
    - Add: the index value moves during the replay and rests on the real `c`.
  - `scripts/qa/desk-orders.mjs`: lightning now buys from the left column; adapt the 閃電 sell step to the right column after a buy.
  - `scripts/qa/desk-sharpness.mjs`, `scripts/qa/desk-states.mjs`, `scripts/qa/desk-pages.mjs`: update selectors only where they fail.
  - `src/components/manual-page.tsx`: copy rows describing the layout, the book direction (左買右賣), the large-order confirm and the TAIEX source.

- [ ] **Step 1: Update the scripts and the manual.**
- [ ] **Step 2: Run the full QA chain over three fresh classrooms** (the `run-qa3.sh` pattern: A — discipline, guest, daily, guest-resilience, seed, premium, layout --strict, sharpness, states; B — pages, seed, orders, premium-flat; C — seed, ticks, broker --strict). Expected: 15/15 pass.
- [ ] **Step 3: Commit** — `test(qa): desk checks follow the broker layout; manual updated`

### Task 11: Whole-branch verification and review

- [ ] **Step 1:** Run `npm test`, `npm run typecheck`, `npx eslint src --quiet`, and `rm -rf .output && npm run build:offline && npm run build`. Then `git checkout -- src/routeTree.gen.ts` if only its line endings changed. Expected: all clean.
- [ ] **Step 2:** Take screenshots at 1920×1080, 1440×900, 1366×768, 820×1180, 390×844 and senior 390×844 into `artifacts/broker-desk/`.
- [ ] **Step 3:** Hand off to the final reviewer (most capable model) with the review package, this plan, the spec and the Review Focus. One fix pass for Critical and Important findings, each with a test that failed first.
- [ ] **Step 4:** Write `docs/deployment-2026-10-21-broker-desk.md` (draft), covering what changed, the measurements and what is unverified. Stop and ask the user before any merge, push or deploy.
