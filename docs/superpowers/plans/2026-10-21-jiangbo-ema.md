# 江波圖 ±10% 與 EMA11／EMA24 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desk's 分時 view into a ±10% 江波圖 (the default view) with 漲停／跌停 lines and EMA11／EMA24, draw the same EMAs on the K線 view, and replace the watch table's 簡易K線 with a fixed ±10% mini 江波圖.

**Architecture:**
- Pure helpers go in `src/lib/market/chart-data.ts`, each covered by node:test:
  - `emaSeries`, `bandPriceRange`, `jiangboGridRows`, `jiangboGridPrices`;
  - `limitChartLabels`, `lineRuns`, `emaReadout`;
  - legend-aware `wrapReadout`;
  - a `band`/`pad` option on `sparklineLayout`.
- `TapeChart` gains two desk-only props, `priceBand` and `emaPeriods`. `MorningChart` passes them.
- The watch table paints its minis from `sparklineLayout`.
- A new Playwright check (`scripts/qa/desk-jiangbo.mjs`) is written first and must fail on the current build.

**Tech Stack:** React 19, TanStack Start, TypeScript, canvas painters, plain CSS (`src/trading-desk.css`), node:test (`--experimental-strip-types`), Playwright QA on disposable classrooms (`scripts/qa/desk-server.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-21-jiangbo-ema-design.md` (design canvas https://claude.ai/artifact/55dbCC6eteS5Vnf5Jz8XAq; the user chose mini option B).

## Global Constraints

**Data and behaviour**
- No future leak. EMAs and every range use only revealed minutes. The minute being replayed uses its current close, which settles at the real close.
- No signals: no thresholds, no buy/sell marks, no 「小馬上／小馬下」 wording. EMAs are plain lines and readout values.
- ±10% means exactly `previousClose × (1 ± 0.1)` (`JIANGBO_BAND = 0.1`). 漲停／跌停 lines sit at `limitUp(previousClose)` / `limitDown(previousClose)` from `src/lib/market/ticks.ts`.
- EMA: `α = 2 / (period + 1)`; the first minute's EMA is its close. Periods are `DESK_EMA_PERIODS = [11, 24]`.
- Unchanged: the 大盤 panel, the daily-question chart, the old terminal screens, matching/orders/P&L, and lesson data. Volume stays hidden.

**Look**
- Colours: EMA11 `#7dd3fc` (`--td-ema-fast`), EMA24 `#c084fc` (`--td-ema-slow`), line width 1.25px.
- Limit lines: hairline, up/down colour at `globalAlpha` 0.7.
- Mini shading: 0.18 alpha. Main-chart shading stays 0.16.
- Copy is Traditional Chinese, exactly:
  - toolbar 「江波」「K線」;
  - watch headers 「江波圖」 (desk) and 「江波」 (compact);
  - labels 「漲停」「跌停」;
  - readout `EMA11 256.38` (two decimals).
- Desktop text ≥ 11px; phone controls ≥ 44px; senior ≥ 56px. Breakpoints unchanged.

**Process**
- Work only in `.worktrees/short-desk` (branch `claude/jiangbo-ema`). Never touch other worktrees or `當沖大富翁-地端/`.
- Commits: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Repo files are CRLF (`core.autocrlf=true`). Edits must keep each file's line endings.
- Lint only `src` (`npx eslint src --quiet`). Do not reformat files you only touch lightly.
- No push, merge or deploy without the user's explicit OK.

## Review Focus

1. **Short or narrow charts** (phone 320 wide, senior large text, tablet, 1366×657).
   - Expect: the grid falls back to 5% steps; the two EMA fields wrap together; 漲停／跌停 labels stay inside the plot and never cover each other or 昨.
   - Pinned by: `jiangboGridRows` tests (Task 1), `wrapReadout` legend tests (Task 1), `desk-layout --strict` and the phone part of `desk-jiangbo` (Task 6).
2. **The newest minute while it replays.**
   - Expect: the EMA end point and the readout follow the replayed price, then settle on the real close. No NaN and no page error.
   - Pinned by: `desk-jiangbo` check 9 (Task 2), which presses 「+1 分」 and records page errors during the replay; `desk-ticks` (Task 6).
3. **Cursor 0 and 1.**
   - Expect: the plan screen still shows the waiting chart and 「等待開盤」 minis. At one revealed minute the EMA is a single value (readout shows it), and no line is drawn.
   - Pinned by: `emaSeries` single-value test and `lineRuns` single-point test (Task 1); `desk-states` (Task 6).
4. **Missing minutes.**
   - Expect: the EMA line breaks where the price line breaks.
   - Pinned by: the `lineRuns` gap test (Task 1).
5. **A ±10% axis that crosses a tick-size boundary** (e.g. previous close 950 → 1045).
   - Expect: the left gutter is wide enough for every grid label.
   - Pinned by: the `jiangboGridPrices` test (Task 1), with paint measuring the labels of both grids (Task 3).

---

### Task 1: Pure chart helpers

**Files:**
- Modify: `src/lib/market/chart-data.ts`
- Test: `src/lib/market/chart-data.test.ts`

**Interfaces:**
- Produces:
  - Constants:
    - `JIANGBO_BAND = 0.1`
    - `DESK_EMA_PERIODS = [11, 24] as const`
    - `LEGEND_SWATCH = 14`
  - Range and grid:
    - `emaSeries(values: readonly number[], period: number): number[]` returns `[]` for an empty input, or when `period` is not an integer ≥ 1.
    - `bandPriceRange(previous: number, band: number): PriceRange | null` returns `null` unless `previous > 0` and `0 < band < 1`. Export `PriceRange`.
    - `jiangboGridRows(plotHeight: number, fontSize: number): 10 | 4` returns 10 when `plotHeight >= fontSize * 22`.
    - `jiangboGridPrices(previous: number, band: number, rows: number): number[]` returns `rows + 1` prices from top to bottom.
  - Labels and lines:
    - `limitChartLabels(previous: number, place: { x: number; lineHeight: number; up: string; down: string; yOf: (price: number) => number; priceText: (price: number) => string }): ChartLabel[]`.
      - Keys are `limit-up` and `limit-down`; anchor is `start`.
      - y is `yOf(up) + lineHeight / 2 + 2` and `yOf(down) - lineHeight / 2 - 2`.
      - Returns `[]` when a limit is 0.
    - `lineRuns<T extends { t: number }>(points: readonly T[], maxGap: number): T[][]`.
  - Readout:
    - `ReadoutTone` adds `"emaFast" | "emaSlow"`; `ReadoutField` adds `legend?: boolean`.
    - `emaReadout(values: readonly { period: number; value: number }[]): ReadoutField[]` gives text `EMA${period} ${value.toFixed(2)}`. Tone is `emaFast` for index 0 and `emaSlow` for index 1. Every field has `legend: true`; non-finite values are skipped.
    - `wrapReadout`: a legend field's width is `LEGEND_SWATCH + measure(text)`. A run of consecutive legend fields moves to the next line as one unit. A unit wider than `maxWidth` wraps field by field.
  - `sparklineLayout` input gains:
    - `band?: number`: fixed `bandPriceRange` when set and valid;
    - `pad?: { x: number; y: number }`: default `{ x: 3, y: 4 }`.
    - `bars` is typed `readonly Pick<Bar, "t" | "h" | "l" | "c">[]`.

- [ ] **Step 1: Write the failing tests** in `chart-data.test.ts`. Reuse the file's `bar()` and `near()` helpers; `measure = (text: string) => text.length * 10`.
  - `emaSeries seeds with the first close and smooths with 2/(N+1)`:
    - `emaSeries([10, 11, 12], 3)` → `[10, 10.5, 11.25]`;
    - `emaSeries([12, 18], 11)` → `[12, 13]`;
    - `emaSeries([10, 20], 1)` → `[10, 20]`.
  - `emaSeries returns nothing for no closes or an invalid period`:
    - `[]` → `[]`;
    - `([10, 11], 0)` → `[]`;
    - `([10, 11], 2.5)` → `[]`;
    - `([7], 11)` → `[7]`.
  - `bandPriceRange spans the previous close ±band`:
    - `(254, 0.1)` → min ≈ 228.6, max ≈ 279.4;
    - `(0, 0.1)`, `(254, 0)`, `(254, 1)`, `(Number.NaN, 0.1)` → `null`.
  - `jiangboGridRows uses 2% steps only when each row is 2.2 lines tall`:
    - `(404, 12)` → 10;
    - `(264, 12)` → 10;
    - `(263, 12)` → 4;
    - `(352, 16)` → 10;
    - `(351, 16)` → 4.
  - `jiangboGridPrices lists the grid from the top`:
    - `(254, 0.1, 10)`: first ≈ 279.4, index 5 = 254, last ≈ 228.6, length 11;
    - `(950, 0.1, 4)` ≈ `[1045, 997.5, 950, 902.5, 855]`.
  - `limitChartLabels marks 漲停 below its line and 跌停 above its line`:
    - with `yOf = (p) => 1000 - p`, `lineHeight = 16`, previous 254:
      - texts `["漲停", "跌停"]`, prices `[279, 229]`;
      - y `[1000 - 279 + 10, 1000 - 229 - 10]`;
      - priceText via the passed formatter.
    - previous 0 → `[]`.
  - `lineRuns breaks where minutes are missing`:
    - `[{t:0},{t:60},{t:300}]` with 60 → `[[{t:0},{t:60}],[{t:300}]]`;
    - `[]` → `[]`;
    - one point → one run.
  - `emaReadout labels each EMA with two decimals`:
    - `[{period:11,value:256.383},{period:24,value:257.0906}]` → `[{text:"EMA11 256.38",tone:"emaFast",legend:true},{text:"EMA24 257.09",tone:"emaSlow",legend:true}]`;
    - `[{period:11,value:NaN},{period:24,value:1}]` → `[{text:"EMA24 1.00",tone:"emaSlow",legend:true}]`.
  - `wrapReadout counts the swatch before each EMA value`:
    - `[{text:"0123456789",tone:"fg"}, ...emaReadout([{period:11,value:256.38}])]` at maxWidth 240, gap 14 → two lines (100 + 14 + 134 = 248 > 240).
  - `wrapReadout keeps the EMA legend together on the next line`. Fields are `09:49–09:50` (muted), `價 256.0` (fg), and the two-EMA legend:
    - at 400 → `[["09:49–09:50","價 256.0"],["EMA11 256.38","EMA24 257.09"]]`;
    - at 500 → one line;
    - at 200 → `[["09:49–09:50","價 256.0"],["EMA11 256.38"],["EMA24 257.09"]]`.
  - `sparklineLayout with a band uses the fixed ±band scale and its padding`:
    - inputs: `bars: [bar(0, 110, { h: 110, l: 100 }), bar(60, 99)]`, previous 100, startT 0, endT 5400, width 100, height 24, band 0.1, pad `{x:2,y:2}`;
    - expect: `previousY` ≈ 12, first run's first point y ≈ 2, `last.y` ≈ 13, `last.x` ≈ 2 + (120 / 5400) × 96.

- [ ] **Step 2: Run them and watch them fail**
  - Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`
  - Expected: FAIL on the missing exports. The legend wrap test fails on today's per-field wrapping; the band layout test fails on the auto range.

- [ ] **Step 3: Implement the helpers in `chart-data.ts`.** Keep existing behaviour for callers that pass no legend fields and no band. In `wrapReadout`, walk units: a single non-legend field, or a maximal run of legend fields.

- [ ] **Step 4: Run the file, then the suite**
  - Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`, then `npm test`
  - Expected: all pass.

- [ ] **Step 5: Commit** — `feat(chart): EMA, ±10% band, limit labels and legend-aware readout helpers`.

### Task 2: The 江波 QA check, failing first

**Files:**
- Create: `scripts/qa/desk-jiangbo.mjs`

**Interfaces:**
- Consumes: a disposable classroom after `desk-seed` (09:27, 台積電 held).
- Usage: `node scripts/qa/desk-jiangbo.mjs <base> <label>`.
- Writes `artifacts/trading-desk-qa/<label>/jiangbo.json` and screenshots.
- Exits 1 on any failure.

- [ ] **Step 1: Write the script.**
  - Setup:
    - Desktop context 1440×900 at deviceScaleFactor 2; phone context 390×844 at DPR 2 (`isMobile`, `hasTouch`).
    - Dismiss the 「知道了」 notice and wait for the replay to rest, as `desk-broker.mjs` does.
    - Record `pageerror` events on both pages.
  - Pixel checks: decode the canvas screenshot in-page, as `desk-sharpness.mjs` does. Read colours from the canvas's computed CSS variables, with the spec's hex values as fallbacks.
  - Checks:
    1. `default-jiangbo`: the pressed button in `nav[aria-label="看盤分頁"]` reads 「江波」.
    2. `watch-header`: the last `.td-watch-cols span` reads 「江波圖」.
    3. `ema-lines`: in the 江波 chart, at least 15 pixels within distance 40 of `--color-ema-fast`, and at least 15 of `--color-ema-slow`.
    4. `limit-lines`: within the plot's x-range, a pixel row in the top 15% of the canvas, and one in the bottom 25%, has at least 40% of its pixels within distance 12 of `up × 0.7 + bg × 0.3` and of `down × 0.7 + bg × 0.3` respectively.
    5. `kline-ema`: after clicking 「K線」, the same EMA pixel counts hold. Click 「江波」 afterwards.
    6. `mini-scale`: for every `.td-watch-row canvas.td-mini`:
       - from `/api/morning` state, compute `dev = max |h or l / previousClose − 1|` over that row's revealed bars;
       - every up- or down-coloured pixel must lie within `3 + 10 × dev / 0.1` CSS px of the canvas's vertical centre.
    7. `readout-ema`: focus `.td-chart canvas[role="img"]` and press ArrowLeft. The `.td-chart output` text contains 「EMA11」 and 「EMA24」.
    8. `phone`: 行情 shows 「江波」 pressed. The 自選 compact header's last column reads 「江波」.
    9. `replay`: on the desktop, click 「+1 分」, then sample the chart three times during the next 2 seconds. No `pageerror`; the readout text after rest contains no `NaN`.

- [ ] **Step 2: Run it against the current build and watch it fail**
  - Run the current build in classroom A: `PORT_APP=18880 PORT_PROXY=18881 APP_ENTRY=<abs>/.output/server/index.mjs DOWNLOADS=<abs>/.output/downloads node scripts/qa/desk-server.mjs` (background); then `node scripts/qa/desk-seed.mjs http://127.0.0.1:18881`; then `node scripts/qa/desk-jiangbo.mjs http://127.0.0.1:18881 jiangbo-red`.
  - Expected: FAIL on checks 1–8. Check 9 may pass. Keep the log as the RED evidence.

- [ ] **Step 3: Commit** — `test(qa): 江波 ±10%, EMA and mini-scale checks (fail on the current desk)`.

### Task 3: TapeChart ±10% band and EMA lines; desk wiring

**Files:**
- Modify:
  - `src/components/charts.tsx`
  - `src/components/morning-practice.tsx`: `ChartMode` default, `MorningChart`, `MorningDataDetails` copy
  - `src/components/quote-hero.tsx`: `ChartToolbar` label
  - `src/trading-desk.css`: tokens

**Interfaces:**
- Consumes everything Task 1 produces.
- Produces two new `TapeChartProps`:
  - `priceBand?: number`;
  - `emaPeriods?: readonly number[]` (first → `--color-ema-fast`, second → `--color-ema-slow`).
  - Both apply only when `presentation === "terminal"` and the variant is not `index`.

- [ ] **Step 1: CSS tokens.** In the `.trading-desk` token block add:
  - `--td-ema-fast: #7dd3fc; --td-ema-slow: #c084fc;`
  - `--color-ema-fast: var(--td-ema-fast); --color-ema-slow: var(--td-ema-slow);`

- [ ] **Step 2: `tokens()` and props.** Add `emaFast` and `emaSlow` (read with those fallbacks). Add both props with doc comments.

- [ ] **Step 3: `paint()` changes.** All of these are desk-only.
  - Band:
    - `band = !isCandles && opt.priceBand ? bandPriceRange(opt.prev, opt.priceBand) : null`.
    - When `band` is set:
      - use it as the range;
      - set `rows = jiangboGridRows(plotH, c.fontSize)`;
      - draw the grid at `jiangboGridPrices`;
      - include the labels of both `jiangboGridPrices(prev, band, 10)` and `(…, 4)` in `axisWidth`.
  - EMA data:
    - EMA source = `opt.bars` with finite closes and `t + interval <= window.dataEnd` (or `t <= dataEnd` without an interval).
    - Compute `emaSeries` per period (at most two). Keep a `Map<t, {period, value}[]>` for the readout.
  - In the clipped layer, when `band` is set:
    - first draw the 漲停／跌停 hairlines (`hRule` snapped, alpha 0.7);
    - skip the open reference line.
  - EMA lines: one `lineRuns(points, interval ?? 60)` polyline per run, 1.25px, round joins.
    - Points are at `t + interval` in 江波 and at `candleTime` in K線.
    - Draw them after the shading and before the price line in 江波, and after the candles in K線.
    - In K線, add the windowed EMA values to the range `values`.
  - Labels:
    - when `band` is set, drop 開／高／低 and add `limitChartLabels(opt.prev, { x: padL + 4, … })`;
    - give the limit keys importance 6 in the `fitLabels` order.
  - Readout:
    - `readoutLinesFor(bar)` appends `emaReadout(emaAt.get(bar.t) ?? [])` to `terminalReadout(...)`;
    - add the `emaFast`/`emaSlow` tones;
    - draw a 10×2 swatch before each `legend` field and advance `x` by `LEGEND_SWATCH`.

- [ ] **Step 4: Desk wiring.**
  - `MorningChart` passes `priceBand={candles ? undefined : JIANGBO_BAND}` and `emaPeriods={DESK_EMA_PERIODS}`.
  - Its aria-label says 「江波圖（昨收上下 10%）」 or 「一分鐘K線」, and adds 「，含 EMA11、EMA24（一分鐘收盤價）」.
  - `useState<ChartMode>("quote")`, with the comment updated to 江波／K線.
  - `ChartToolbar` label 「分時」 → 「江波」, doc comment too.
  - In `MorningDataDetails`, replace 「分時只連接各分鐘收價，點位標在分鐘結束時間；缺漏區間保留斷線。」 with 「江波圖只連接各分鐘收價，點位標在分鐘結束時間，刻度固定為昨收上下 10%；缺漏區間保留斷線。EMA11、EMA24 以已揭露的一分鐘收盤價計算，從 09:00 第一分鐘起算，只供觀察。」.

- [ ] **Step 5: Verify**
  - Run: `npm run typecheck`, `npx eslint src --quiet`, `npm test`
  - Expected: clean, all pass.

- [ ] **Step 6: Commit** — `feat(desk): ±10% 江波 view as the default, 漲停／跌停 lines, EMA11／EMA24 on 江波 and K線`.

### Task 4: Watch-table mini 江波圖 (option B)

**Files:**
- Modify:
  - `src/components/watch-table.tsx`
  - `src/trading-desk.css`: the broker-pane comment only
  - `scripts/qa/desk-layout.mjs`: the failure message
  - `scripts/qa/desk-sharpness.mjs`: mode clicks

**Interfaces:**
- Consumes: `sparklineLayout({ …, band: JIANGBO_BAND, pad: { x: 2, y: 2 } })` (Task 1).
- Produces: `MiniJiangbo({ bars, previous, endT, empty })`, replacing `MiniCandles`.

- [ ] **Step 1: Replace the mini.**
  - Rename `MiniCandles` → `MiniJiangbo` and `paintMiniCandles` → `paintMiniJiangbo`. Remove the five-minute slot code.
  - The painter draws, in order:
    1. the snapped previous-close dash (kept as it is today);
    2. per-run shading at alpha 0.18 down to `previousY`, skipped when `previousY` is not finite;
    3. run polylines at 1.25px in up/down;
    4. an end dot of r 1.75.
  - Headers: desk 「江波圖」, compact 「江波」.
  - Update the doc comments.

- [ ] **Step 2: QA script housekeeping.**
  - `desk-sharpness.mjs`:
    - click 「K線」 before the K線 stats (the default is now 江波);
    - click 「江波」 (was 「分時」) for the intraday dash check;
    - update its comments.
  - `desk-layout.mjs`: change the message 「簡易K線」 → 「江波圖」.

- [ ] **Step 3: Verify**
  - Run: `npm run typecheck`, `npx eslint src --quiet`, `npm test`
  - Expected: clean, all pass.

- [ ] **Step 4: Commit** — `feat(watch): fixed ±10% mini 江波圖 replaces 簡易K線`.

### Task 5: Manual and lesson-spec notes

**Files:**
- Modify:
  - `src/components/manual-page.tsx`: 資料哪裡來 and the desk rows
  - `docs/daily-market-lesson-spec.md`

- [ ] **Step 1: Manual.**
  - Row 「收價連線」 → key 「江波圖」, value 「連接已完成分鐘的收盤價，點位標在分鐘結束時間；刻度固定為昨收上下 10%，並標出漲停、跌停價。這不是分鐘內的逐筆江波路徑，缺漏不以生成價格補齊。」
  - Row 「參考均值」 → 「前 5 個完整交易日收盤均值，不含本日，不是當日 SMA5。」
  - New row 「EMA11／EMA24」 → 「交易台的江波圖與 K 線都畫 EMA11（淺藍）和 EMA24（紫）：以已揭露的一分鐘收盤價計算，從當天 09:00 第一分鐘起算（第一分鐘的收盤價當起始值）。只供觀察，不是買賣訊號；講師若有不同的計算方式，以講師說明為準。」
  - Next to the 大盤指數／五檔點價 rows, a row 「自選江波圖」 → 「自選報價每列右側的小江波圖：已揭露的每分鐘收盤價，刻度固定為昨收上下 10%，中間虛線是昨收。」

- [ ] **Step 2: Lesson spec.** After the 2026-10-06 EMA11 paragraph, add a 2026-10-21 paragraph covering:
  - the user's instruction and the definition used on the desk (one-minute closes, first minute seeds, α = 2/(N+1), the replayed minute settles at its close);
  - that there are still no thresholds or signals;
  - that a different teacher definition would replace it.
  - Update the open-item bullet to match.

- [ ] **Step 3: Verify**
  - Run: `npm run typecheck`, `npx eslint src --quiet`, `npm test`
  - Expected: clean, all pass.

- [ ] **Step 4: Commit** — `docs: 江波圖 and EMA notes in the manual and lesson spec`.

### Task 6: Build, GREEN run, full QA chain, record

**Files:**
- Create: `docs/jiangbo-ema-2026-10-21.md` (what changed, QA results, open items)

- [ ] **Step 1: Build.**
  - Run: `npm run build`, then `git checkout -- src/routeTree.gen.ts`.
  - Expected: build exits 0.

- [ ] **Step 2: GREEN run.**
  - Start a fresh classroom A from the new build and seed it.
  - Run `node scripts/qa/desk-jiangbo.mjs http://127.0.0.1:18881 jiangbo-green`.
  - Expected: all nine checks pass.

- [ ] **Step 3: Full chain.**
  - Use three fresh classrooms (A 18880/18881, B 18882/18883, C 18884/18885) and the chain from the broker-desk record:
    - A: discipline, guest, daily, guest-resilience, seed, premium, layout --strict, sharpness, states;
    - B: pages, seed, orders, premium-flat;
    - C: seed, jiangbo, ticks, broker --strict.
  - Expected: every step exits 0.

- [ ] **Step 4: Screenshots.**
  - Desk at 1440×900 and 1366×657, phone 行情／自選, senior 行情 → `artifacts/jiangbo-ema-qa/`.
  - Compare them with the design canvas.

- [ ] **Step 5: Record and commit.** Write `docs/jiangbo-ema-2026-10-21.md` and commit — `docs: record the 江波 ±10% and EMA change`.
