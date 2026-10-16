# 江波圖放大與畫質 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓交易畫面的分時大圖與左側小走勢更大、刻度更合理、標籤不重疊，並預先完成「有可信資料才顯示」的均價線與成交量。

**Architecture:** 所有刻度、寬度、標籤避讓、讀數與小走勢座標都寫成 `src/lib/market/chart-data.ts` 的純函式，先寫 node 測試。`charts.tsx` 的 `paint()` 只在 `presentation="terminal"` 時改走新規則，其他畫面不受影響。帳務區改成可收合，狀態用 zustand 存在瀏覽器；小走勢改成 canvas，與大圖共用新抽出的 `useDeviceCanvas` hook。

**Tech Stack:** React 19、TanStack Start、Tailwind v4（交易畫面只用 `src/trading-desk.css`）、zustand、Canvas 2D、Node `node:test`（`--experimental-strip-types`）、Playwright QA 腳本（`scripts/qa/`）。

**Spec:** `docs/superpowers/specs/2026-10-15-jiangbo-chart-quality-design.md`

## Global Constraints

- 只改交易畫面（`/morning?panel=trade`）；伺服器 API、撮合規則、`server/data/*.json` 資料檔一律不動。
- 交易畫面的樣式只寫在 `src/trading-desk.css`，根選擇器 `.trading-desk`；不新增其他樣式檔。
- 不新增 npm 依賴。
- `src/lib/**` 中會被 node 測試載入的模組，彼此匯入一律用相對路徑加 `.ts` 副檔名（例如 `./ticks.ts`）；不可用 `@/` 別名。
- `TapeChart` 的新規則只在 `presentation === "terminal"` 且不是指數（`variant !== "index"`）時生效；其他呼叫者（`terminal.tsx`、`mobile-market.tsx`）的畫法必須完全不變。
- 分時刻度：以昨收為中心對稱，半幅 = max(最大偏離 ×1.1，昨收 ×1%)。K 線刻度：高低（含昨收）上下各留 8%，整體至少昨收 ×1.5%。K 棒實體 = 欄寬 ×0.7，上限 13 CSS px。
- 均價線與成交量只在 `catalog.volumeUnit === "lot"` 且每根分 K 都有有效 `a`、整數非負 `v` 時顯示；現有 Yahoo 教材一律不顯示。
- 目標：1366×900 圖高 ≥ 700px；1920×1080 圖高 ≥ 880px；桌機小走勢 ≥ 200×48px。
- 既有驗收門檻不得退步：可見文字 ≥ 11px、無水平溢出、桌機整頁不捲動、手機控制項 ≥ 44px、下單按鈕可見。
- 介面文字一律繁體中文。
- 工作區與另一個工作階段共用：編輯前先 `git status`／`git diff` 目標檔；`git add` 只列明確路徑，絕不 `git add -A`；絕不提交 `Fubon_Codex_Handoff/`、`Fubon_Codex_Handoff.zip`、`當沖大富翁-地端/`。
- 提交指令格式：`git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`。
- 不推送、不部署；完成後等使用者指示。

## Review Focus

1. **平盤或只有一分鐘的資料**（最高 = 最低 = 昨收）：刻度不可退化成 0 高度，分時仍有 ±1%、K 線仍有 1.5%。→ Task 1 測試 `jiangboPriceRange` 與 `candlePriceRange` 的平盤案例。
2. **昨收缺漏或無效**（0、NaN）：刻度與小走勢座標仍要是有限數字，不得畫出 NaN。→ Task 1 測試兩個刻度函式的退回規則與 `sparklineLayout`。
3. **繪圖區很小、標籤很多**（手機圖高 260px、長輩模式 16px 字）：標籤必須留在繪圖區內，避讓迴圈必須結束。→ Task 2 測試 `resolveChartLabels` 的擁擠案例。
4. **瀏覽器封鎖 storage**（無痕模式、存取 `localStorage` 直接丟出例外）：帳務區預設收起，切換仍能在記憶體中運作。→ Task 3 測試 `readLedgerOpen`／`writeLedgerOpen` 搭配會丟例外的 storage。
5. **帳務收起時有待成交委託**：摘要要顯示「1 待成交」，點「委託」會展開並能撤回。→ Task 3 在 `desk-orders.mjs` 加入斷言。

## 共用的 QA 操作

以下步驟在 Task 3–6 重複使用。QA 伺服器使用暫時的 PGlite 資料庫與 loopback 埠，不碰正式站。

```bash
npm run build
```

啟動 QA 伺服器（背景執行，跑在 `.output/server/index.mjs`；每次重新建置後都要先停掉再重啟）：

```bash
PORT_APP=18830 PORT_PROXY=18831 node scripts/qa/desk-server.mjs
```

等 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18831/` 回 `200` 後，建立練習進度（買兩張、回放到 09:27）：

```bash
node scripts/qa/desk-seed.mjs http://127.0.0.1:18831
```

停止伺服器（讓資料庫正常關閉）：

```bash
node scripts/qa/desk-stop.mjs 18831
```

`desk-layout.mjs` 與 `desk-orders.mjs` 會把截圖與 JSON 寫到 `artifacts/trading-desk-qa/<label>/`（`artifacts/` 不進版控）。

**分時頁截圖**（`desk-layout` 截的是預設的 K 線分頁）。在專案根目錄執行，`LABEL` 換成該步驟的標籤：

```bash
LABEL=chart-after node --input-type=module -e '
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const dir = `artifacts/trading-desk-qa/${process.env.LABEL}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const [w, h] of [[1366, 900], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:18831/morning?panel=trade", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "分時", exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/quote-${w}x${h}.png` });
  await page.close();
}
await browser.close();
'
```

---

### Task 1: 刻度、K 棒寬度、虛線與小走勢的純函式

**Files:**
- Modify: `src/lib/game/types.ts:14-21`（`Bar` 加選填 `a`）
- Modify: `src/lib/market/chart-data.ts`（檔尾新增函式）
- Test: `src/lib/market/chart-data.test.ts`（檔尾新增測試）

**Interfaces:**
- Consumes: 既有的 `splitPriceLine`、`snapColumn`、`hairlineDevicePixels`（同檔）。
- Produces（之後的 Task 會用到）:
  - `jiangboPriceRange(previous: number, high: number, low: number, minFraction = 0.01): { min: number; max: number }`
  - `candlePriceRange(high: number, low: number, previous: number, minFraction = 0.015, padding = 0.08): { min: number; max: number }`
  - `candleBodyWidth(plotWidth: number, timeSpan: number): number`（CSS px，1–13）
  - `deviceDashPattern(pattern: readonly number[], scale: number): number[]`
  - `showVolumeAndAverage(volumeUnit: string | undefined, bars: readonly Bar[]): boolean`
  - `volumeTone(close: number, previousClose: number): "up" | "down" | "flat"`
  - `type SparkPoint = { x: number; y: number }`
  - `sparklineLayout(input: { bars: readonly Bar[]; previous: number; startT: number; endT: number; width: number; height: number; intervalSeconds?: number }): { previousY: number; runs: { above: boolean; points: SparkPoint[] }[]; last: (SparkPoint & { above: boolean }) | null }`
  - `Bar.a?: number`

- [ ] **Step 1: 在 `Bar` 型別加入選填的均價欄位**

`src/lib/game/types.ts` 的 `Bar` 改成：

```ts
export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Session average price (開盤至今成交均價) when the data source provides one; never derived here. */
  a?: number;
};
```

- [ ] **Step 2: 寫失敗的測試**

在 `src/lib/market/chart-data.test.ts` 的 import 清單加入 `candleBodyWidth, candlePriceRange, deviceDashPattern, jiangboPriceRange, showVolumeAndAverage, sparklineLayout, volumeTone`（維持字母順序），並在 import 區加入：

```ts
import type { Bar } from "../game/types.ts";
```

檔尾加上（檔案前段已有 `const near = (actual, expected) => …`，容差 1e-6，直接沿用，不要重複宣告）：

```ts
const bar = (t: number, c: number, extra: Partial<Bar> = {}): Bar => ({
  t, o: c, h: c, l: c, c, v: 1, ...extra,
});

test("jiangboPriceRange centres on the previous close with at least ±1%", () => {
  // 10/06 台積電: 昨收 2575, 高 2590, 低 2575 → 半幅 max(16.5, 25.75).
  const range = jiangboPriceRange(2575, 2590, 2575);
  near(range.min, 2549.25);
  near(range.max, 2600.75);
  // A wide day uses 1.1 × the largest deviation instead.
  const wide = jiangboPriceRange(100, 104, 99);
  near(wide.max - 100, 4.4);
  near(100 - wide.min, 4.4);
});

test("jiangboPriceRange never collapses on a flat day", () => {
  const flat = jiangboPriceRange(50, 50, 50);
  near(flat.max - flat.min, 1);
});

test("jiangboPriceRange falls back to the data when the previous close is unusable", () => {
  for (const previous of [0, Number.NaN, -5]) {
    const range = jiangboPriceRange(previous, 110, 90);
    near(range.min, 89);
    near(range.max, 111);
  }
  assert.deepEqual(jiangboPriceRange(Number.NaN, Number.NaN, Number.NaN), { min: 0, max: 1 });
});

test("candlePriceRange pads 8% and keeps at least 1.5% of the previous close", () => {
  const narrow = candlePriceRange(2590, 2575, 2575);
  near(narrow.min, 2563.1875);
  near(narrow.max, 2601.8125);
  const wide = candlePriceRange(2700, 2575, 2575);
  near(wide.min, 2565);
  near(wide.max, 2710);
  // The previous close is always inside the range.
  const above = candlePriceRange(120, 118, 100);
  assert.ok(above.min < 100 && above.max > 120);
});

test("candlePriceRange stays finite without a previous close or on a flat minute", () => {
  const flat = candlePriceRange(80, 80, 80);
  near(flat.max - flat.min, 1.2);
  const missing = candlePriceRange(110, 90, Number.NaN);
  assert.ok(Number.isFinite(missing.min) && Number.isFinite(missing.max) && missing.max > missing.min);
  assert.deepEqual(candlePriceRange(Number.NaN, Number.NaN, 0), { min: 0, max: 1 });
});

test("candleBodyWidth is 70% of a minute column, between 1 and 13 CSS px", () => {
  near(candleBodyWidth(1000, 3600), 1000 / 60 * 0.7);
  assert.equal(candleBodyWidth(2000, 3600), 13);
  assert.equal(candleBodyWidth(10, 3600), 1);
  assert.equal(candleBodyWidth(1000, 0), 13);
});

test("candle bodies keep the wick's pixel parity at every screen scale", () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    const stroke = hairlineDevicePixels(scale);
    for (const [plot, span] of [[1000, 3600], [2000, 3600], [700, 3600], [900, 16200]]) {
      const column = snapColumn(500, candleBodyWidth(plot, span), scale, stroke);
      const device = Math.round(column.width * scale);
      assert.equal(device % 2, stroke % 2, `scale ${scale}, plot ${plot}`);
      assert.ok(device <= Math.round(13 * scale) + 1);
    }
  }
});

test("deviceDashPattern rounds every dash to whole device pixels", () => {
  for (const scale of [1, 1.25, 1.5, 2])
    for (const pattern of [[4, 4], [2, 5], [5, 4], [2, 3]])
      for (const length of deviceDashPattern(pattern, scale)) {
        const device = length * scale;
        near(device, Math.round(device));
        assert.ok(device >= 1);
      }
  assert.deepEqual(deviceDashPattern([0.2], 1), [1]);
});

test("showVolumeAndAverage requires lot volume and a source average on every bar", () => {
  const sourced = [bar(0, 10, { a: 10.1, v: 3 }), bar(60, 11, { a: 10.4, v: 0 })];
  assert.equal(showVolumeAndAverage("lot", sourced), true);
  assert.equal(showVolumeAndAverage(undefined, sourced), false);
  assert.equal(showVolumeAndAverage("share", sourced), false);
  assert.equal(showVolumeAndAverage("lot", []), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: 10, v: 1 }), bar(60, 10)]), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: Number.NaN })]), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: 10, v: 1.5 })]), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: 10, v: -1 })]), false);
});

test("volumeTone compares a minute's close with the minute before", () => {
  assert.equal(volumeTone(101, 100), "up");
  assert.equal(volumeTone(99, 100), "down");
  assert.equal(volumeTone(100, 100), "flat");
  assert.equal(volumeTone(100, Number.NaN), "flat");
});

test("sparklineLayout centres the previous close and maps the whole session", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 100.5, { h: 101, l: 99 })],
    previous: 100,
    startT: 0,
    endT: 5400,
    width: 263,
    height: 56,
  });
  near(layout.previousY, 28);
  assert.equal(layout.runs.length, 1);
  assert.equal(layout.runs[0]!.points.length, 1);
  near(layout.last!.x, 3 + (60 / 5400) * 257);
  assert.equal(layout.last!.above, true);
  const end = sparklineLayout({
    bars: [bar(5340, 100)], previous: 100, startT: 0, endT: 5400, width: 263, height: 56,
  });
  near(end.last!.x, 260);
});

test("sparklineLayout breaks the line at missing minutes", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 101), bar(60, 102), bar(300, 103)],
    previous: 100,
    startT: 0,
    endT: 5400,
    width: 263,
    height: 56,
  });
  assert.deepEqual(layout.runs.map((run) => run.points.length), [2, 1]);
});

test("sparklineLayout keeps finite coordinates without a previous close", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 101), bar(60, 99)], previous: 0, startT: 0, endT: 5400, width: 263, height: 56,
  });
  for (const run of layout.runs)
    for (const point of run.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.equal(Number.isFinite(layout.previousY), false);
});
```

- [ ] **Step 3: 跑測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`
Expected: FAIL（`SyntaxError`／`does not provide an export named 'candleBodyWidth'` 之類的匯入錯誤）

- [ ] **Step 4: 實作**

在 `src/lib/market/chart-data.ts` 檔尾加上：

```ts
type PriceRange = { min: number; max: number };
const positive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * Intraday (分時) price range for the trading desk: symmetric about the previous close, so the
 * percent axis reads −x% / 0 / +x%, and never narrower than ±minFraction of that close.
 */
export function jiangboPriceRange(
  previous: number,
  high: number,
  low: number,
  minFraction = 0.01,
): PriceRange {
  const prices = [high, low].filter(positive);
  if (!positive(previous)) {
    if (!prices.length) return { min: 0, max: 1 };
    const top = Math.max(...prices);
    const bottom = Math.min(...prices);
    const middle = (top + bottom) / 2;
    const half = Math.max(((top - bottom) / 2) * 1.1, middle * minFraction);
    return { min: middle - half, max: middle + half };
  }
  const reach = Math.max(0, ...prices.map((price) => Math.abs(price - previous)));
  const half = Math.max(reach * 1.1, previous * minFraction);
  return { min: previous - half, max: previous + half };
}

/**
 * Candle price range for the trading desk: the visible high and low (and the previous close),
 * padded by `padding` on each side, and never narrower than `minFraction` of the previous close.
 */
export function candlePriceRange(
  high: number,
  low: number,
  previous: number,
  minFraction = 0.015,
  padding = 0.08,
): PriceRange {
  const prices = [high, low, previous].filter(positive);
  if (!prices.length) return { min: 0, max: 1 };
  const top = Math.max(...prices);
  const bottom = Math.min(...prices);
  const middle = (top + bottom) / 2;
  const base = positive(previous) ? previous : middle;
  const span = Math.max((top - bottom) * (1 + 2 * padding), base * minFraction);
  return { min: middle - span / 2, max: middle + span / 2 };
}

/** Desk candle body: 70% of a minute column, 1–13 CSS px. snapColumn then fixes pixel parity. */
export function candleBodyWidth(plotWidth: number, timeSpan: number): number {
  const column = (plotWidth * 60) / Math.max(1, timeSpan);
  return Math.max(1, Math.min(13, column * 0.7));
}

/** Dash lengths rounded to whole device pixels, so each dash starts and ends on a pixel edge. */
export function deviceDashPattern(pattern: readonly number[], scale: number): number[] {
  const usable = usableScale(scale) ? scale : 1;
  return pattern.map((length) => Math.max(1, Math.round(length * usable)) / usable);
}

/**
 * Volume bars and the average line need a documented unit and the source's own session average;
 * a lesson without them (e.g. Yahoo minutes) shows neither, rather than a guess.
 */
export function showVolumeAndAverage(volumeUnit: string | undefined, bars: readonly Bar[]): boolean {
  return (
    volumeUnit === "lot" &&
    bars.length > 0 &&
    bars.every(
      (bar) =>
        typeof bar.a === "number" &&
        Number.isFinite(bar.a) &&
        bar.a > 0 &&
        Number.isInteger(bar.v) &&
        bar.v >= 0,
    )
  );
}

/** Colour of a volume bar: this minute's close against the minute before (or the previous close). */
export function volumeTone(close: number, previousClose: number): "up" | "down" | "flat" {
  if (!Number.isFinite(close) || !Number.isFinite(previousClose) || close === previousClose)
    return "flat";
  return close > previousClose ? "up" : "down";
}

export type SparkPoint = { x: number; y: number };

/**
 * Watchlist sparkline geometry in CSS pixels. Uses the same symmetric range as the big intraday
 * chart and the whole lesson as its time axis, so both charts have the same shape. Closes sit at
 * the end of their minute; a missing minute breaks the line.
 */
export function sparklineLayout(input: {
  bars: readonly Bar[];
  previous: number;
  startT: number;
  endT: number;
  width: number;
  height: number;
  intervalSeconds?: number;
}): {
  previousY: number;
  runs: { above: boolean; points: SparkPoint[] }[];
  last: (SparkPoint & { above: boolean }) | null;
} {
  const interval = input.intervalSeconds ?? 60;
  const padX = 3;
  const padY = 4;
  const bars = input.bars.filter((bar) => [bar.t, bar.h, bar.l, bar.c].every(Number.isFinite));
  const range = jiangboPriceRange(
    input.previous,
    bars.length ? Math.max(...bars.map((bar) => bar.h)) : Number.NaN,
    bars.length ? Math.min(...bars.map((bar) => bar.l)) : Number.NaN,
  );
  const span = Math.max(range.max - range.min, Number.EPSILON);
  const plotHeight = Math.max(1, input.height - padY * 2);
  const plotWidth = Math.max(1, input.width - padX * 2);
  const yOf = (price: number) => padY + ((range.max - price) / span) * plotHeight;
  const timeSpan = Math.max(interval, input.endT - input.startT);
  const xOf = (time: number) => padX + ((time - input.startT) / timeSpan) * plotWidth;
  const points = bars.map((bar) => ({ t: bar.t + interval, p: bar.c }));
  const runs = splitPriceLine(points, input.previous, interval).map((run) => ({
    above: run.above,
    points: run.points.map((point) => ({ x: xOf(point.t), y: yOf(point.p) })),
  }));
  const tail = points.at(-1);
  return {
    previousY: positive(input.previous) ? yOf(input.previous) : Number.NaN,
    runs,
    last: tail ? { x: xOf(tail.t), y: yOf(tail.p), above: tail.p >= input.previous } : null,
  };
}
```

註：`usableScale` 已在同檔（`const usableScale = ...`）定義於前面，`splitPriceLine` 也在同檔。

- [ ] **Step 5: 跑測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`
Expected: PASS（含既有測試全部通過）

- [ ] **Step 6: 全套檢查**

Run: `npm test` 、 `npm run typecheck` 、 `npx eslint src --quiet`
Expected: 全部通過，eslint 沒有輸出

- [ ] **Step 7: 提交**

```bash
git add src/lib/game/types.ts src/lib/market/chart-data.ts src/lib/market/chart-data.test.ts
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: chart ranges, candle width, dash and sparkline geometry for the desk" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 讀數列欄位與標籤避讓

**Files:**
- Modify: `src/lib/market/chart-data.ts`（檔頭加一個 import，檔尾新增函式）
- Test: `src/lib/market/chart-data.test.ts`

**Interfaces:**
- Consumes: `formatPercentChange`（同檔）、`formatPrice`（`./ticks.ts`）、`Bar.a`（Task 1）。
- Produces:
  - `type ReadoutTone = "muted" | "fg" | "up" | "down" | "average"`
  - `type ReadoutField = { text: string; tone: ReadoutTone }`
  - `terminalReadout(input: { bar: Bar; previousClose: number; candles: boolean; intervalSeconds: number; withVolume: boolean }): ReadoutField[]`
  - `type ChartLabel = { key: string; text: string; price: number; priceText: string; color: string; x: number; anchor: "start" | "center" | "end"; y: number }`
  - `type PlacedChartLabel = { keys: string[]; price: number; parts: { text: string; color: string }[]; priceText: string; left: number; width: number; y: number }`
  - `const LABEL_PADDING = 4`
  - `chartLabelText(label: Pick<PlacedChartLabel, "parts" | "priceText">): string`
  - `resolveChartLabels(labels: readonly ChartLabel[], bounds: { left: number; right: number; top: number; bottom: number }, measure: (text: string) => number, lineHeight: number): PlacedChartLabel[]`

- [ ] **Step 1: 寫失敗的測試**

在 `chart-data.test.ts` 的 import 清單加入 `chartLabelText, resolveChartLabels, terminalReadout`，型別匯入加入 `type ChartLabel`。檔尾加上（沿用檔案既有的 `near` 與 Task 1 新增的 `bar`）：

```ts
const minute = bar(1560, 2580, { o: 2580, h: 2580, l: 2575, v: 12, a: 2581.234 });

test("terminalReadout lists time, price and change for the intraday chart", () => {
  assert.deepEqual(
    terminalReadout({ bar: minute, previousClose: 2575, candles: false, intervalSeconds: 60, withVolume: false }),
    [
      { text: "09:26–09:27", tone: "muted" },
      { text: "價 2580", tone: "fg" },
      { text: "▲5 +0.19%", tone: "up" },
    ],
  );
});

test("terminalReadout lists OHLC for candles and adds source average and lots when allowed", () => {
  const fields = terminalReadout({
    bar: minute, previousClose: 2575, candles: true, intervalSeconds: 60, withVolume: true,
  });
  assert.deepEqual(fields.map((field) => field.text), [
    "09:26–09:27", "開 2580", "高 2580", "低 2575", "收 2580", "▲5 +0.19%", "均 2581.23", "量 12 張",
  ]);
  assert.equal(fields.at(-2)!.tone, "average");
});

test("terminalReadout marks falling and unchanged minutes", () => {
  const down = terminalReadout({
    bar: bar(0, 2570), previousClose: 2575, candles: false, intervalSeconds: 60, withVolume: false,
  });
  assert.deepEqual(down.at(-1), { text: "▼5 -0.19%", tone: "down" });
  const flat = terminalReadout({
    bar: bar(0, 2575), previousClose: 2575, candles: false, intervalSeconds: 60, withVolume: false,
  });
  assert.deepEqual(flat.at(-1), { text: "0 0.00%", tone: "muted" });
});

const measure = (text: string) => text.length * 10;
const bounds = { left: 56, right: 600, top: 20, bottom: 400 };
const label = (key: string, text: string, price: number, x: number, y: number, anchor: ChartLabel["anchor"] = "start"): ChartLabel => ({
  key, text, price, priceText: String(price), color: "#fff", x, y, anchor,
});

test("labels at the same price and place merge into one", () => {
  const placed = resolveChartLabels(
    [label("prev", "昨", 2575, 60, 300), label("open", "開", 2575, 60, 300), label("low", "低", 2575, 70, 312, "center")],
    bounds, measure, 16,
  );
  assert.equal(placed.length, 1);
  assert.deepEqual(placed[0]!.keys, ["prev", "open", "low"]);
  assert.equal(chartLabelText(placed[0]!), "昨・開・低 2575");
  assert.equal(placed[0]!.width, measure("昨・開・低 2575") + 8);
});

test("labels at the same price far apart stay separate", () => {
  const placed = resolveChartLabels(
    [label("prev", "昨", 2575, 60, 300), label("low", "低", 2575, 500, 312, "center")],
    bounds, measure, 16,
  );
  assert.equal(placed.length, 2);
});

test("nearby labels at different prices are moved apart", () => {
  const placed = resolveChartLabels(
    [label("high", "高", 2590, 300, 100, "center"), label("swing", "前高", 2585, 310, 106, "center")],
    bounds, measure, 16,
  );
  const [a, b] = placed;
  assert.ok(Math.abs(b!.y - a!.y) >= 16);
});

test("a label pushed past the bottom moves above instead", () => {
  const placed = resolveChartLabels(
    [label("a", "低", 1, 300, 392, "center"), label("b", "開", 2, 300, 395, "center")],
    bounds, measure, 16,
  );
  const moved = placed.find((item) => item.keys[0] === "b")!;
  near(moved.y, 376);
});

test("end-anchored labels are kept inside the plot", () => {
  const [inside] = resolveChartLabels([label("swing", "前高", 2590, 650, 200, "end")], bounds, measure, 16);
  near(inside!.left + inside!.width, 600);
});

test("a crowded tiny plot still finishes with every label inside it", () => {
  const crowded = Array.from({ length: 8 }, (_, i) => label(`k${i}`, "高", 100 + i, 300, 50, "center"));
  const tiny = { left: 0, right: 600, top: 0, bottom: 60 };
  const placed = resolveChartLabels(crowded, tiny, measure, 16);
  assert.equal(placed.length, 8);
  for (const item of placed) assert.ok(item.y >= 8 && item.y <= 52, `y ${item.y}`);
});

test("labels with non-finite positions are skipped", () => {
  assert.equal(resolveChartLabels([label("x", "昨", Number.NaN, 60, 100)], bounds, measure, 16).length, 0);
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`
Expected: FAIL（`terminalReadout`／`resolveChartLabels` 不存在）

- [ ] **Step 3: 實作**

`src/lib/market/chart-data.ts` 檔頭的 import 下面加：

```ts
import { formatPrice } from "./ticks.ts";
```

檔尾加上：

```ts
/** "HH:MM" for seconds after 09:00, matching formatTime(...).slice(0, 5) in src/lib/utils. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = 9 + Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export type ReadoutTone = "muted" | "fg" | "up" | "down" | "average";
export type ReadoutField = { text: string; tone: ReadoutTone };

/**
 * Fields of the desk chart's readout strip for one completed minute: its interval, its price (or
 * OHLC for candles), the change from the previous close and, only when the source supports them,
 * the source session average and volume in lots.
 */
export function terminalReadout(input: {
  bar: Bar;
  previousClose: number;
  candles: boolean;
  intervalSeconds: number;
  withVolume: boolean;
}): ReadoutField[] {
  const { bar, previousClose } = input;
  const fields: ReadoutField[] = [
    { text: `${clock(bar.t)}–${clock(bar.t + input.intervalSeconds)}`, tone: "muted" },
  ];
  if (input.candles)
    fields.push(
      { text: `開 ${formatPrice(bar.o)}`, tone: "fg" },
      { text: `高 ${formatPrice(bar.h)}`, tone: "fg" },
      { text: `低 ${formatPrice(bar.l)}`, tone: "fg" },
      { text: `收 ${formatPrice(bar.c)}`, tone: "fg" },
    );
  else fields.push({ text: `價 ${formatPrice(bar.c)}`, tone: "fg" });
  if (positive(previousClose)) {
    const change = bar.c - previousClose;
    const size = Math.abs(change).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
    fields.push({
      text: `${change > 0 ? "▲" : change < 0 ? "▼" : ""}${size} ${formatPercentChange(bar.c, previousClose)}`,
      tone: change > 0 ? "up" : change < 0 ? "down" : "muted",
    });
  }
  if (input.withVolume) {
    if (typeof bar.a === "number" && Number.isFinite(bar.a))
      fields.push({ text: `均 ${bar.a.toFixed(2)}`, tone: "average" });
    fields.push({ text: `量 ${bar.v.toLocaleString("zh-TW")} 張`, tone: "fg" });
  }
  return fields;
}

export type ChartLabel = {
  key: string;
  /** Short name, e.g. 昨, 開, 高, 低, 前高, 均. */
  text: string;
  price: number;
  priceText: string;
  color: string;
  /** Anchor in CSS px; `anchor` says whether it is the label's left edge, centre or right edge. */
  x: number;
  anchor: "start" | "center" | "end";
  /** Preferred vertical centre in CSS px. */
  y: number;
};
export type PlacedChartLabel = {
  keys: string[];
  price: number;
  parts: { text: string; color: string }[];
  priceText: string;
  left: number;
  width: number;
  y: number;
};
export const LABEL_PADDING = 4;

export function chartLabelText(label: Pick<PlacedChartLabel, "parts" | "priceText">): string {
  return `${label.parts.map((part) => part.text).join("・")} ${label.priceText}`;
}

/**
 * Places the desk chart's in-plot labels so none overlaps another. Labels at the same price that
 * would touch merge into one ("昨・開・低 2575"); others that would overlap move down by one line,
 * or up when there is no room below. Every label stays inside `bounds`.
 */
export function resolveChartLabels(
  labels: readonly ChartLabel[],
  bounds: { left: number; right: number; top: number; bottom: number },
  measure: (text: string) => number,
  lineHeight: number,
): PlacedChartLabel[] {
  const widthOf = (label: Pick<PlacedChartLabel, "parts" | "priceText">) =>
    measure(chartLabelText(label)) + LABEL_PADDING * 2;
  const clampLeft = (left: number, width: number) =>
    Math.max(bounds.left, Math.min(bounds.right - width, left));
  const placed: PlacedChartLabel[] = [];
  for (const label of labels) {
    if (![label.price, label.x, label.y].every(Number.isFinite)) continue;
    const single: PlacedChartLabel = {
      keys: [label.key],
      price: label.price,
      parts: [{ text: label.text, color: label.color }],
      priceText: label.priceText,
      left: 0,
      width: 0,
      y: label.y,
    };
    single.width = widthOf(single);
    const preferred =
      label.anchor === "start"
        ? label.x
        : label.anchor === "center"
          ? label.x - single.width / 2
          : label.x - single.width;
    single.left = clampLeft(preferred, single.width);
    const twin = placed.find(
      (other) =>
        other.price === label.price &&
        single.left < other.left + other.width + lineHeight &&
        other.left < single.left + single.width + lineHeight,
    );
    if (twin) {
      twin.keys.push(label.key);
      twin.parts.push(single.parts[0]!);
      twin.width = widthOf(twin);
      twin.left = clampLeft(twin.left, twin.width);
    } else placed.push(single);
  }
  const half = lineHeight / 2;
  const clampY = (y: number) => Math.min(bounds.bottom - half, Math.max(bounds.top + half, y));
  const settled: PlacedChartLabel[] = [];
  for (const label of [...placed].sort((a, b) => a.y - b.y)) {
    const overlapping = (y: number) =>
      settled.find(
        (other) =>
          label.left < other.left + other.width &&
          other.left < label.left + label.width &&
          Math.abs(other.y - y) < lineHeight,
      );
    let y = clampY(label.y);
    let hit = overlapping(y);
    for (let guard = 0; hit && guard <= settled.length; guard++) {
      y = hit.y + lineHeight;
      hit = overlapping(y);
    }
    if (y > bounds.bottom - half) {
      y = clampY(label.y);
      hit = overlapping(y);
      for (let guard = 0; hit && guard <= settled.length; guard++) {
        y = hit.y - lineHeight;
        hit = overlapping(y);
      }
    }
    label.y = clampY(y);
    settled.push(label);
  }
  return settled;
}
```

註：`positive` 是 Task 1 在同檔定義的小工具。

- [ ] **Step 4: 跑測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/market/chart-data.test.ts`
Expected: PASS

- [ ] **Step 5: 全套檢查**

Run: `npm test` 、 `npm run typecheck` 、 `npx eslint src --quiet`
Expected: 全部通過

- [ ] **Step 6: 提交**

```bash
git add src/lib/market/chart-data.ts src/lib/market/chart-data.test.ts
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: chart readout fields and non-overlapping chart labels" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 帳務區預設收成一行

**Files:**
- Create: `src/lib/morning-ledger.ts`、`src/lib/morning-ledger.test.ts`
- Create: `src/lib/ledger-preferences.ts`、`src/lib/ledger-preferences.test.ts`
- Modify: `src/components/morning-trading.tsx:1-2`（import）、`:598-640`（`Ledger`）
- Modify: `src/components/morning-practice.tsx`（`MorningLesson` 內的 hook 與 `.td-ledger` 區塊，約 `:254-300`、`:757-766`）
- Modify: `src/trading-desk.css:413-421`、`:464-470`、帳務樣式區（`:664-733`）
- Modify: `scripts/qa/desk-orders.mjs`、`scripts/qa/desk-layout.mjs`

**Interfaces:**
- Consumes: `MorningState`（`src/lib/morning.ts`）。
- Produces:
  - `type LedgerSummary = { positions: number; orders: number; pending: number; fills: number }`
  - `ledgerSummary(session: Pick<MorningState, "positions" | "orders" | "fills">): LedgerSummary`
  - `readLedgerOpen(storage: Pick<Storage, "getItem"> | undefined): boolean`
  - `writeLedgerOpen(storage: Pick<Storage, "setItem"> | undefined, open: boolean): void`
  - `useLedgerPreferences`（zustand store：`{ open: boolean; hydrate(): void; setOpen(open: boolean): void }`）
  - `Ledger` 新增選填 prop `collapsible?: { open: boolean; onOpenChange: (open: boolean) => void }`
  - DOM：`.td-ledger[data-open]`、`.sim-ledger-toggle[aria-expanded]`、`.sim-pending-badge`

- [ ] **Step 1: 寫失敗的單元測試**

`src/lib/morning-ledger.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerSummary } from "./morning-ledger.ts";

test("ledgerSummary counts holdings, orders, pending orders and fills", () => {
  const order = (status: "pending" | "filled" | "cancelled" | "rejected") => ({
    id: status, code: "2330", side: "buy" as const, shares: 1000, status, submittedCursor: 1,
  });
  assert.deepEqual(
    ledgerSummary({
      positions: [{ code: "2330", shares: 2000, averageCost: 2582.5 }],
      orders: [order("filled"), order("pending"), order("cancelled")],
      fills: [{ id: "f", code: "2330", side: "buy", shares: 1000, price: 2580, fee: 0, tax: 0, t: 60 }],
    }),
    { positions: 1, orders: 3, pending: 1, fills: 1 },
  );
  assert.deepEqual(ledgerSummary({ positions: [], orders: [], fills: [] }), {
    positions: 0, orders: 0, pending: 0, fills: 0,
  });
});
```

`src/lib/ledger-preferences.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readLedgerOpen, writeLedgerOpen } from "./ledger-preferences.ts";

const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};
const blocked = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

test("the ledger starts collapsed unless the viewer opened it before", () => {
  const storage = memory();
  assert.equal(readLedgerOpen(storage), false);
  writeLedgerOpen(storage, true);
  assert.equal(readLedgerOpen(storage), true);
  writeLedgerOpen(storage, false);
  assert.equal(readLedgerOpen(storage), false);
});

test("blocked or missing storage keeps the default and never throws", () => {
  assert.equal(readLedgerOpen(undefined), false);
  assert.equal(readLedgerOpen(blocked), false);
  assert.doesNotThrow(() => writeLedgerOpen(blocked, true));
  assert.doesNotThrow(() => writeLedgerOpen(undefined, true));
});
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `node --experimental-strip-types --test src/lib/morning-ledger.test.ts src/lib/ledger-preferences.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 實作兩個 lib 模組**

`src/lib/morning-ledger.ts`：

```ts
import type { MorningState } from "./morning.ts";

export type LedgerSummary = { positions: number; orders: number; pending: number; fills: number };

/** Counts for the ledger tabs; `pending` is highlighted while the ledger is collapsed. */
export function ledgerSummary(
  session: Pick<MorningState, "positions" | "orders" | "fills">,
): LedgerSummary {
  return {
    positions: session.positions.length,
    orders: session.orders.length,
    pending: session.orders.filter((order) => order.status === "pending").length,
    fills: session.fills.length,
  };
}
```

`src/lib/ledger-preferences.ts`：

```ts
import { create } from "zustand";

const STORAGE_KEY = "day-tycoon-ledger-v1";

/** Accessing localStorage itself throws when site data is blocked. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readLedgerOpen(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

export function writeLedgerOpen(storage: Pick<Storage, "setItem"> | undefined, open: boolean): void {
  try {
    storage?.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    /* Session-only preference. */
  }
}

type LedgerPreferences = {
  open: boolean;
  hydrate: () => void;
  setOpen: (open: boolean) => void;
};

/** Desk ledger: collapsed to one row by default; the viewer's choice is remembered per browser. */
export const useLedgerPreferences = create<LedgerPreferences>((set) => ({
  open: false,
  hydrate: () => set({ open: readLedgerOpen(browserStorage()) }),
  setOpen: (open) => {
    set({ open });
    writeLedgerOpen(browserStorage(), open);
  },
}));
```

- [ ] **Step 4: 跑單元測試，確認通過**

Run: `node --experimental-strip-types --test src/lib/morning-ledger.test.ts src/lib/ledger-preferences.test.ts`
Expected: PASS

- [ ] **Step 5: 在 QA 腳本加入帳務檢查（先讓它失敗）**

`scripts/qa/desk-orders.mjs`：在「2. Lightning sell」區塊，把

```js
await page.getByRole("button", { name: "撤回委託" }).first().click();
```

換成：

```js
// The ledger starts collapsed; a pending order is flagged, and the 委託 tab opens it.
const ledger = page.locator(".td-ledger");
const ledgerToggle = ledger.locator(".sim-ledger-toggle");
assert.equal(await ledgerToggle.getAttribute("aria-expanded"), "false");
await until(
  async () => /1 待成交/.test((await ledger.locator(".sim-pending-badge").textContent().catch(() => "")) ?? ""),
  "pending badge missing while the ledger is collapsed",
);
await ledger.getByRole("button", { name: /^委託/ }).click();
await until(async () => (await ledgerToggle.getAttribute("aria-expanded")) === "true", "ledger did not open");
await page.getByRole("button", { name: "撤回委託" }).first().click();
```

並在 `result.lightning` 物件加一個欄位 `ledgerOpenedFromTab: true`。

`scripts/qa/desk-layout.mjs`：在 `scan` 回傳物件加入

```js
    ledgerExpanded: document.querySelector(".td-ledger .sim-ledger-toggle")?.getAttribute("aria-expanded") ?? null,
    ledgerHeight: Math.round(document.querySelector(".td-ledger")?.getBoundingClientRect().height ?? 0),
```

在截圖之後、`await context.close()` 之前加入展開測試：

```js
  let ledgerToggle = null;
  const toggle = page.locator(".td-ledger .sim-ledger-toggle");
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(200);
    ledgerToggle = await page.evaluate(() => ({
      expanded: document.querySelector(".td-ledger .sim-ledger-toggle")?.getAttribute("aria-expanded"),
      height: Math.round(document.querySelector(".td-ledger")?.getBoundingClientRect().height ?? 0),
    }));
  }
```

把 `rows.push({ name, width, height, senior, ...report });` 改成 `rows.push({ name, width, height, senior, ...report, ledgerToggle });`，並在 `failures` 迴圈加入：

```js
  if (!row.senior && row.width >= 768) {
    if (row.ledgerExpanded !== "false" || row.ledgerHeight > 40)
      failures.push(`${row.name}: ledger not collapsed by default (${row.ledgerExpanded}, ${row.ledgerHeight}px)`);
    if (row.ledgerToggle?.expanded !== "true" || row.ledgerToggle.height < 150)
      failures.push(`${row.name}: ledger did not expand (${JSON.stringify(row.ledgerToggle)})`);
  }
```

- [ ] **Step 6: 用目前的建置跑 QA，確認失敗**

依「共用的 QA 操作」啟動 QA 伺服器（先不要重新建置，使用目前的 `.output`）並 seed，然後：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 ledger-before --strict`
Expected: FAIL，桌機與平板各列出 `ledger not collapsed by default`

Run: `node scripts/qa/desk-orders.mjs http://127.0.0.1:18831 ledger-before`
Expected: FAIL（等不到 `.sim-ledger-toggle`，`getAttribute` 逾時）

停止 QA 伺服器。

- [ ] **Step 7: `Ledger` 加入收合**

`src/components/morning-trading.tsx`：

lucide import 改成：

```ts
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronUp, Clock3, Minus, Plus, Wallet } from "lucide-react";
```

並在 import 區加入：

```ts
import { ledgerSummary } from "@/lib/morning-ledger";
```

`Ledger` 的參數與開頭（`export function Ledger({` 到 `const active = ...` 那行）改成：

```tsx
export function Ledger({
  catalog,
  session,
  busy,
  onCancel,
  collapsible,
}: {
  catalog: MorningCatalog;
  session: MorningState;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
  /** Desktop and tablet: one summary row until the viewer opens it. */
  collapsible?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const [pane, setPane] = useState<LedgerPane>("positions");
  const summary = ledgerSummary(session);
  const open = collapsible?.open ?? true;
  const name = (code: string) => catalog.symbols.find((item) => item.code === code)?.name ?? code;
  const panes = [
    { id: "positions" as const, label: "庫存", count: summary.positions },
    { id: "orders" as const, label: "委託", count: summary.orders },
    { id: "fills" as const, label: "成交", count: summary.fills },
  ];
  const active = panes.find((item) => item.id === pane)!;
```

header 內的分頁按鈕改成：

```tsx
          {panes.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={pane === item.id}
              aria-controls="sim-ledger-content"
              onClick={() => {
                setPane(item.id);
                if (!open) collapsible?.onOpenChange(true);
              }}
            >
              {item.label}
              <span>{item.count}</span>
              {item.id === "orders" && summary.pending > 0 && (
                <em className="sim-pending-badge">{summary.pending} 待成交</em>
              )}
            </button>
          ))}
```

在 `<span className="td-ledger-meta">…</span>` 之後、header `</div>` 之前加入：

```tsx
        {collapsible && (
          <button
            type="button"
            className="sim-ledger-toggle"
            aria-expanded={open}
            aria-controls="sim-ledger-content"
            onClick={() => collapsible.onOpenChange(!open)}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
            {open ? "收起" : "展開"}
          </button>
        )}
```

內容 `div` 加上 `hidden`：

```tsx
      <div
        id="sim-ledger-content"
        className="sim-ledger-content"
        aria-label={active.label}
        hidden={!open}
      >
```

- [ ] **Step 8: 在交易畫面接上偏好**

`src/components/morning-practice.tsx`：

import 區加入：

```ts
import { useLedgerPreferences } from "@/lib/ledger-preferences";
```

`MorningLesson` 中 `const singlePane = ...` 之後加入：

```ts
  const ledgerOpen = useLedgerPreferences((value) => value.open);
  const setLedgerOpen = useLedgerPreferences((value) => value.setOpen);
```

並在既有的 `useEffect(() => { setAuto(false); ... }, [sessionId]);` 之前加入：

```ts
  useEffect(() => {
    useLedgerPreferences.getState().hydrate();
  }, []);
```

`.td-ledger` 區塊改成：

```tsx
                {!singlePane && session && !newPlan && (
                  <div className="td-ledger" data-open={ledgerOpen}>
                    <Ledger
                      catalog={catalog}
                      session={session}
                      busy={Boolean(busy)}
                      onCancel={cancel}
                      collapsible={{ open: ledgerOpen, onOpenChange: setLedgerOpen }}
                    />
                  </div>
                )}
```

（手機與長輩模式的「庫存」分頁沿用不帶 `collapsible` 的 `Ledger`，行為不變。）

- [ ] **Step 9: 樣式**

`src/trading-desk.css`：

桌機 workbench 的列高改成：

```css
  grid-template-rows: minmax(0, 1fr) auto;
```

`.trading-desk .td-ledger { … }` 規則之後加入：

```css
.trading-desk .td-ledger[data-open="true"] {
  height: 190px;
}
.trading-desk .td-ledger[data-open="false"] {
  overflow: hidden;
}
```

`.trading-desk .td-ledger-meta b { … }` 規則之後加入：

```css
.trading-desk .td-ledger-meta {
  margin-left: auto;
}
.trading-desk .sim-ledger-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 10px;
  color: var(--td-fg);
  background: rgb(0 0 0 / 0.25);
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.trading-desk .sim-ledger-toggle svg {
  width: 14px;
  height: 14px;
}
.trading-desk .sim-pending-badge {
  padding: 0 5px;
  color: #1a1300;
  background: var(--td-prev);
  border-radius: 2px;
  font: 600 11px/16px var(--font-mono);
  font-style: normal;
}
/* Tablet center column (~508px) cannot fit tabs, account line and toggle on one row; the status
   bar already shows 本輪損益 and 可用資金. */
.trading-desk[data-layout="tablet"] .td-ledger[data-open="false"] .td-ledger-meta {
  display: none;
}
```

- [ ] **Step 10: 建置並跑 QA，確認通過**

Run: `npm run typecheck` 、 `npx eslint src --quiet` 、 `npm test`
Expected: 全部通過

依「共用的 QA 操作」重新建置、啟動、seed，然後：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 ledger-after --strict`
Expected: `All layout checks passed.`

Run: `node scripts/qa/desk-orders.mjs http://127.0.0.1:18831 ledger-after`
Expected: 印出 JSON，`lightning.status` 為 `cancelled`、`lightning.ledgerOpenedFromTab` 為 `true`，沒有例外

打開 `artifacts/trading-desk-qa/ledger-after/1366x900.png` 目視：帳務區只剩一行，圖變高。停止 QA 伺服器。

- [ ] **Step 11: 提交**

```bash
git add src/lib/morning-ledger.ts src/lib/morning-ledger.test.ts src/lib/ledger-preferences.ts src/lib/ledger-preferences.test.ts src/components/morning-trading.tsx src/components/morning-practice.tsx src/trading-desk.css scripts/qa/desk-orders.mjs scripts/qa/desk-layout.mjs
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: collapse the desk ledger to one row with a pending-order badge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 大圖繪製與資訊列合一

**Files:**
- Modify: `src/components/charts.tsx`（import 與 `paint()`）
- Modify: `src/lib/morning.ts:11-23`（`MorningCatalog.volumeUnit`）
- Modify: `src/components/morning-practice.tsx`（`MorningQuote` 約 `:917-1002`、其呼叫處約 `:675-682`、`MorningChart` 約 `:1342-1435`、import）
- Modify: `src/trading-desk.css:38`（`--color-vwap`）、`:593-640`（資訊列與 legend）、`:1796`（長輩模式選擇器）
- Modify: `scripts/qa/desk-layout.mjs`

**Interfaces:**
- Consumes: Task 1 的 `jiangboPriceRange`、`candlePriceRange`、`candleBodyWidth`、`deviceDashPattern`、`showVolumeAndAverage`、`volumeTone`；Task 2 的 `terminalReadout`、`resolveChartLabels`、`LABEL_PADDING`、`type ChartLabel`、`type ReadoutTone`。
- Produces:
  - `MorningCatalog.volumeUnit?: "lot"`
  - `MorningQuote` 新 prop `source: string`
  - DOM：`.td-quote-info`（包住 `dl.td-quote-stats` 與 `p.td-chart-source`）；`.td-chart-legend` 移除

- [ ] **Step 1: 在 QA 腳本加入圖高門檻（先讓它失敗）**

`scripts/qa/desk-layout.mjs` 的 `scan` 回傳物件加入：

```js
    chartHeight: canvas ? Math.round(canvas.getBoundingClientRect().height) : null,
```

`console.table` 的欄位加入 `chartPx: row.chartHeight,`；`failures` 迴圈加入：

```js
  const minChart = { "1366x900": 700, "1920x1080": 880 }[row.name];
  if (minChart && !(row.chartHeight >= minChart))
    failures.push(`${row.name}: chart ${row.chartHeight}px, needs ${minChart}px`);
```

- [ ] **Step 2: 用目前的建置跑，確認失敗**

啟動 QA 伺服器（使用 Task 3 的 `.output`）並 seed：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 chart-before --strict`
Expected: FAIL，至少 `1920x1080: chart …px, needs 880px`（帳務收合後約 876px；1366×900 約 696px，也可能未達 700）

停止 QA 伺服器。

- [ ] **Step 3: 型別與色票**

`src/lib/morning.ts` 的 `MorningCatalog` 在 `videoUrl` 之後加入：

```ts
  /** Present only when the source documents whole-share minute volume in lots (張). */
  volumeUnit?: "lot";
```

`src/trading-desk.css` 第 38 行改成：

```css
  --color-vwap: #f0a73a;
```

- [ ] **Step 4: `paint()` — import、虛線、讀數列高度、刻度、偶數格線**

`src/components/charts.tsx` 的 chart-data import 改成：

```ts
import {
  LABEL_PADDING,
  candleBodyWidth,
  candlePriceRange,
  canvasResolution,
  chartLinePoints,
  chartWindow,
  completedBarsInWindow,
  deviceDashPattern,
  formatPercentChange,
  hairlineDevicePixels,
  inChartWindow,
  jiangboPriceRange,
  minuteColumnWidth,
  nearestTimePoint,
  resolveChartLabels,
  sessionExtremes,
  snapColumn,
  snapEdge,
  snapStroke,
  splitPriceLine,
  terminalReadout,
  timeAxisTicks,
  volumeTone,
  type ChartLabel,
  type ChartRange,
  type ReadoutTone,
} from "@/lib/market/chart-data";
```

（`canvasResolution` 在 Task 5 搬走後會從這裡移除；這個 Task 先保留。）

在 `paint()` 中：

1. 刪除區域函式 `const dashes = (pattern: number[], scale: number) => …;`（含上方註解），並把檔中所有 `dashes(` 呼叫改成 `deviceDashPattern(`。
2. `const terminal = opt.presentation === "terminal";` 之後加入：

```ts
  // The trading desk's own rules (spec 2026-10-15): symmetric intraday range, padded candle range,
  // wider candles, merged labels and a readout strip. Other screens keep the previous drawing.
  const deskChart = terminal && !isIndex;
```

3. `const padT = c.fontSize;` 改成：

```ts
  // The desk draws its readout in a strip above the plot, so it never covers the line or axis text.
  const infoH = deskChart ? c.fontSize + 10 : 0;
  const padT = deskChart ? infoH + 6 : c.fontSize;
```

4. `values` 陣列在 `...points.map((point) => point.p),` 之後加入：

```ts
    ...(deskChart && opt.showAverage ? bars.map((bar) => bar.a) : []),
```

5. 把

```ts
  const high = Math.max(...values);
  const low = Math.min(...values);
  const span = Math.max((high - low) * 1.16, Math.abs(opt.prev) * 0.003, isIndex ? 40 : 0.05);
  const max = (high + low + span) / 2;
```

換成：

```ts
  const high = Math.max(...values);
  const low = Math.min(...values);
  const legacySpan = Math.max((high - low) * 1.16, Math.abs(opt.prev) * 0.003, isIndex ? 40 : 0.05);
  const range = deskChart
    ? isCandles
      ? candlePriceRange(high, low, opt.prev)
      : jiangboPriceRange(opt.prev, high, low)
    : { min: (high + low - legacySpan) / 2, max: (high + low + legacySpan) / 2 };
  const max = range.max;
  const span = range.max - range.min;
```

6. 把 `const rows = Math.max(2, Math.min(5, Math.floor(plotH / (c.fontSize * 2.6))));` 換成：

```ts
  const fittedRows = Math.max(2, Math.min(5, Math.floor(plotH / (c.fontSize * 2.6))));
  // An even count puts the previous close (0.00%) on the middle grid line of the intraday chart.
  const rows = deskChart && !isCandles ? Math.max(2, fittedRows - (fittedRows % 2)) : fittedRows;
```

- [ ] **Step 5: `paint()` — 均價線、K 棒寬度、移除舊標籤**

1. 把從 `let vwapNow = current;` 開始、到原本均價區塊 `if (!isIndex && opt.showAverage !== false) { … ctx.stroke(); }` 結束為止的整段，換成：

```ts
  let vwapNow = current;
  let averageNow: number | undefined;
  if (!isIndex) {
    reference(opt.open, c.muted, [2, 4]);
    reference(opt.cost, c.warn, [6, 3]);
    reference(opt.poc, c.vol, [1, 4]);
  }
  if (deskChart) {
    // The desk draws only the source's own session average (bar.a); it never derives one.
    if (opt.showAverage) {
      ctx.save();
      ctx.strokeStyle = c.vwap;
      ctx.lineWidth = cssPixels(hairline);
      ctx.lineJoin = "round";
      ctx.beginPath();
      let begun = false;
      for (const bar of bars) {
        if (typeof bar.a !== "number" || !Number.isFinite(bar.a)) continue;
        const x = xOf(isCandles ? candleTime(bar) : bar.t + (interval ?? 0));
        if (begun) ctx.lineTo(x, yOf(bar.a));
        else ctx.moveTo(x, yOf(bar.a));
        begun = true;
        averageNow = bar.a;
      }
      ctx.stroke();
      ctx.restore();
    }
  } else if (!isIndex && opt.showAverage !== false) {
    // Accumulate existing session bars before the window to retain the same VWAP definition.
    let weighted = 0;
    let volume = 0;
    let begun = false;
    ctx.beginPath();
    ctx.strokeStyle = c.vwap;
    ctx.lineWidth = 1.25;
    for (const bar of opt.bars) {
      if (bar.t + (interval ?? 0) > window.dataEnd || ![bar.t, bar.c, bar.v].every(Number.isFinite))
        continue;
      weighted += bar.c * bar.v;
      volume += bar.v;
      vwapNow = volume > 0 ? weighted / volume : bar.c;
      if (bar.t < window.start) continue;
      const x = xOf(bar.t + (interval ?? 0));
      const y = yOf(vwapNow);
      if (!begun) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      begun = true;
    }
    ctx.stroke();
  }
```

（`else if` 分支與原本的 VWAP 程式碼逐字相同，其他畫面的均價線不變。）

2. 把 `const barWidth = Math.min(minuteColumnWidth(plotW, timeSpan), terminal ? 7 : Infinity);` 換成：

```ts
  const barWidth = deskChart
    ? candleBodyWidth(plotW, timeSpan)
    : Math.min(minuteColumnWidth(plotW, timeSpan), terminal ? 7 : Infinity);
```

3. 刪除整段 `if (terminal && !isIndex) { const extremes = sessionExtremes(bars); … tag(extremes.low, …); ctx.restore(); } }`（舊的高／低標籤，約 `:506-534`）。
4. 在前高迴圈的 `if (terminal) { … }` 區塊中，刪除從 `ctx.setLineDash([]);` 之後到 `ctx.restore();` 之前的文字繪製（`ctx.fillStyle = c.warn;` … `ctx.fillText(\`前高 …\`, …);`），只保留虛線本身。

- [ ] **Step 6: `paint()` — 合併標籤**

在前高迴圈之後、`ctx.restore();`（結束繪圖區裁切）之後、`if (opt.showVolume) {` 之前加入：

```ts
  if (deskChart) {
    // Every in-plot label is placed together, so no two overlap (昨・開・低 2575 when they meet).
    const lineHeight = c.fontSize + 4;
    const labels: ChartLabel[] = [
      { key: "prev", text: "昨", price: opt.prev, priceText: label(opt.prev), color: c.tape, x: padL + 4, anchor: "start", y: yOf(opt.prev) },
    ];
    if (opt.open)
      labels.push({ key: "open", text: "開", price: opt.open, priceText: label(opt.open), color: c.muted, x: padL + 4, anchor: "start", y: yOf(opt.open) });
    if (averageNow !== undefined)
      labels.push({ key: "average", text: "均", price: averageNow, priceText: averageNow.toFixed(2), color: c.vwap, x: padL + 4, anchor: "start", y: yOf(averageNow) });
    const extremes = sessionExtremes(bars);
    if (extremes && extremes.high.p > extremes.low.p) {
      const at = (point: TickPt) => xOf(point.t + (interval ? interval / 2 : 0));
      labels.push(
        { key: "high", text: "高", price: extremes.high.p, priceText: label(extremes.high.p), color: c.up, x: at(extremes.high), anchor: "center", y: yOf(extremes.high.p) - lineHeight },
        { key: "low", text: "低", price: extremes.low.p, priceText: label(extremes.low.p), color: c.down, x: at(extremes.low), anchor: "center", y: yOf(extremes.low.p) + lineHeight },
      );
    }
    (opt.swingHighs ?? [])
      .filter((point) => point.confirmedAt <= window.dataEnd && point.t >= window.start && point.t <= window.dataEnd)
      .forEach((point, index) => {
        const y = yOf(point.p);
        const above = y - padT >= lineHeight;
        labels.push({ key: `swing-${index}`, text: "前高", price: point.p, priceText: label(point.p), color: c.warn, x: w - padR - 4, anchor: "end", y: above ? y - lineHeight / 2 - 1 : y + lineHeight / 2 + 1 });
      });
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const placed = resolveChartLabels(
      labels,
      { left: padL + 2, right: w - padR - 2, top: padT, bottom: plotBottom },
      (text) => ctx.measureText(text).width,
      lineHeight,
    );
    for (const item of placed) {
      const left = snapEdge(item.left, sx);
      const top = snapEdge(item.y - lineHeight / 2, sy);
      ctx.fillStyle = c.bg;
      ctx.fillRect(left, top, snapEdge(item.left + item.width, sx) - left, snapEdge(item.y + lineHeight / 2, sy) - top);
      let x = item.left + LABEL_PADDING;
      item.parts.forEach((part, index) => {
        const text = index ? `・${part.text}` : part.text;
        ctx.fillStyle = part.color;
        ctx.fillText(text, snapEdge(x, sx), snapEdge(item.y, sy));
        x += ctx.measureText(text).width;
      });
      ctx.fillStyle = item.parts[0]!.color;
      ctx.fillText(` ${item.priceText}`, snapEdge(x, sx), snapEdge(item.y, sy));
    }
    ctx.restore();
  }
```

- [ ] **Step 7: `paint()` — 成交量顏色與分隔線、舊左側標記只給其他畫面**

1. 在 `if (opt.showVolume) {` 區塊裡、`for (const bar of bars) {` 之前加入：

```ts
    const closeBefore = new Map<number, number>();
    opt.bars.forEach((bar, index) => closeBefore.set(bar.t, index ? opt.bars[index - 1]!.c : opt.prev));
```

並把迴圈中的 `ctx.fillStyle = isIndex ? … : c.down;` 換成：

```ts
      if (deskChart) {
        const tone = volumeTone(bar.c, closeBefore.get(bar.t) ?? opt.prev);
        ctx.fillStyle = tone === "up" ? c.up : tone === "down" ? c.down : c.muted;
      } else
        ctx.fillStyle = isIndex
          ? c.vol
          : (isCandles ? bar.c >= bar.o : bar.c >= opt.prev)
            ? c.up
            : c.down;
```

在該區塊的 `ctx.restore();` 之後（仍在 `if (opt.showVolume) {` 內）加入：

```ts
    if (deskChart) {
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = cssPixels(gridPixels);
      ctx.beginPath();
      ctx.moveTo(gridLeft, hRule(plotBottom + 2, gridPixels));
      ctx.lineTo(gridRight, hRule(plotBottom + 2, gridPixels));
      ctx.stroke();
    }
```

2. 舊的左側標記（`const marks = [{ text: "昨", … }];` 到其 `for (const mark of visibleMarks) { … }` 迴圈結束）整段包進 `if (!deskChart) { … }`。

- [ ] **Step 8: `paint()` — 讀數列取代游標浮動框**

把 `if (cursor && (cursor.keyboard || …)) { … return fields.join("，"); } return "";`（檔尾整段）換成：

```ts
  let focus: Bar | undefined;
  if (cursor && (cursor.keyboard || (cursor.x >= padL && cursor.x <= w - padR))) {
    const time = window.start + Math.min(1, Math.max(0, (cursor.x - padL) / plotW)) * timeSpan;
    const point = isCandles
      ? nearestTimePoint(bars, time - (interval ? interval / 2 : 0))
      : nearestTimePoint(points, time);
    if (point) {
      const candle = "c" in point ? point : undefined;
      const price = candle ? candle.c : (point as TickPt).p;
      const x = xOf(candle ? candleTime(candle) : point.t);
      const y = yOf(price);
      ctx.save();
      ctx.strokeStyle = c.fg;
      ctx.lineWidth = cssPixels(hairline);
      ctx.setLineDash(deviceDashPattern([3, 3], Math.min(sx, sy)));
      ctx.beginPath();
      ctx.moveTo(vRule(x), gridTop);
      ctx.lineTo(vRule(x), gridBottom);
      ctx.moveTo(gridLeft, hRule(y));
      ctx.lineTo(gridRight, hRule(y));
      ctx.stroke();
      ctx.restore();
      if (deskChart) {
        focus = candle ?? bars.find((bar) => bar.t + (interval ?? 0) === point.t);
      } else {
        const intervalLabel = interval
          ? `${formatTime(candle ? point.t : point.t - interval).slice(0, 5)}–${formatTime(candle ? point.t + interval : point.t).slice(0, 5)}`
          : undefined;
        const fields = candle
          ? [
              intervalLabel ?? formatTime(point.t).slice(0, 5),
              `開 ${label(candle.o)}`,
              `高 ${label(candle.h)}`,
              `低 ${label(candle.l)}`,
              `收 ${label(candle.c)}`,
              ...(opt.showVolumeReadout !== false ? [`量 ${candle.v} 張`] : []),
            ]
          : [intervalLabel ?? formatTime(point.t), `${interval ? "收價" : "價格"} ${label(price)}`];
        ctx.font = font;
        const lines: string[] = [];
        let line = "";
        for (const field of fields) {
          const next = line ? `${line}  ${field}` : field;
          if (line && ctx.measureText(next).width > w - 32) {
            lines.push(line);
            line = field;
          } else line = next;
        }
        if (line) lines.push(line);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const boxWidth = Math.min(
          w - 16,
          Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16,
        );
        const boxHeight = lines.length * (c.fontSize + 7) + 9;
        const boxX = Math.max(8, Math.min(w - boxWidth - 8, x - boxWidth / 2));
        const boxLeft = vRule(boxX);
        const boxTop = hRule(3);
        const boxRect = [
          boxLeft,
          boxTop,
          vRule(boxX + boxWidth) - boxLeft,
          hRule(3 + boxHeight) - boxTop,
        ] as const;
        ctx.fillStyle = c.bg;
        ctx.fillRect(...boxRect);
        ctx.strokeStyle = c.grid;
        ctx.lineWidth = cssPixels(hairline);
        ctx.strokeRect(...boxRect);
        ctx.fillStyle = c.fg;
        lines.forEach((line, i) =>
          ctx.fillText(
            line,
            snapEdge(boxX + 8, sx),
            snapEdge(8 + i * (c.fontSize + 7), sy),
            boxWidth - 16,
          ),
        );
        return fields.join("，");
      }
    }
  }
  if (deskChart) {
    const bar = focus ?? bars.at(-1);
    if (!bar) return "";
    const fields = terminalReadout({
      bar,
      previousClose: opt.prev,
      candles: isCandles,
      intervalSeconds: interval ?? 60,
      withVolume: opt.showVolume === true && opt.showVolumeReadout !== false,
    });
    const tones: Record<ReadoutTone, string> = {
      muted: c.muted,
      fg: c.fg,
      up: c.up,
      down: c.down,
      average: c.vwap,
    };
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let x = padL;
    for (const field of fields) {
      if (x + ctx.measureText(field.text).width > w - 4) break;
      ctx.fillStyle = tones[field.tone];
      ctx.fillText(field.text, snapEdge(x, sx), snapEdge(infoH / 2 + 1, sy));
      x += ctx.measureText(field.text).width + 14;
    }
    ctx.restore();
    // Announce only what the viewer pointed at; the latest minute is already in the chart label.
    return focus ? fields.map((field) => field.text).join("，") : "";
  }
  return "";
```

（非 desk 分支與原本的程式碼逐字相同，只是改成巢狀在 `if (point)` 裡。）

- [ ] **Step 9: 交易畫面 — 資訊列合一與 `MorningChart`**

`src/components/morning-practice.tsx`：

1. chart-data import 改成 `import { candleWindow, formatPercentChange, showVolumeAndAverage } from "@/lib/market/chart-data";`
2. `MorningQuote` 的 props 型別加入 `source: string;`、解構加入 `source`，並把 `<dl className="td-quote-stats" …>…</dl>` 換成：

```tsx
      <div className="td-quote-info">
        <dl className="td-quote-stats" aria-label="已揭露行情摘要">
          {[
            ["昨收", symbol.previousClose],
            ["開盤", revealed[0]?.o],
            ["最高", revealed.length ? Math.max(...revealed.map((bar) => bar.h)) : undefined],
            ["最低", revealed.length ? Math.min(...revealed.map((bar) => bar.l)) : undefined],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{typeof value === "number" ? formatPrice(value) : "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="td-chart-source">
          <span className="td-chip">{source}</span>
          <span>{catalog.date} 台北時間</span>
        </p>
      </div>
```

3. 呼叫處 `<MorningQuote … nav={singlePane ? undefined : paneNav} />` 加上 `source={activePane === "quote" ? "分時・分鐘收價" : "真實 1 分 K"}`。
4. `MorningChart`：在 `const fills = …;` 之後加入 `const sourceBacked = showVolumeAndAverage(catalog.volumeUnit, bars);`；刪除整個 `<div className="td-chart-legend">…</div>`；`TapeChart` 的三個量／均價 prop 改成 `showVolume={sourceBacked}`、`showAverage={sourceBacked}`、`showVolumeReadout={sourceBacked}`；`ariaLabel` 改成：

```tsx
            ariaLabel={`${catalog.date} ${code} ${symbol.name}歷史${candles ? "一分鐘K線" : "分鐘收價連線"}，只包含目前已完成分鐘，${sourceBacked ? "含均價與成交量（張）" : "不顯示成交量或均價"}。最新完整分鐘 ${formatTime(last.t).slice(0, 5)} 開 ${formatPrice(last.o)} 高 ${formatPrice(last.h)} 低 ${formatPrice(last.l)} 收 ${formatPrice(last.c)}。`}
```

- [ ] **Step 10: 樣式 — 資訊列**

`src/trading-desk.css`：把 `.trading-desk .td-quote-stats { … }` 規則換成：

```css
.trading-desk .td-quote-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 18px;
  padding: 5px 12px;
  border-bottom: var(--td-hairline) solid var(--td-line);
  font-size: 12px;
}
.trading-desk .td-quote-stats {
  display: flex;
  gap: 18px;
  margin: 0;
}
.trading-desk .td-chart-source {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 0 auto;
  color: var(--td-muted);
  font-size: 11px;
}
```

刪除 `.td-chart-legend`、`.td-chart-legend > span[aria-label]`、`.td-chart-legend :is(time, strong)`、`.td-chart-date` 四條規則。長輩模式的字級選擇器（`:is(.td-hints, .td-quote-stats, …, .td-chart-legend, .td-level-rank)`）中的 `.td-chart-legend` 改成 `.td-chart-source`。

- [ ] **Step 11: 檢查並跑 QA，確認通過**

Run: `npm run typecheck` 、 `npx eslint src --quiet` 、 `npm test`
Expected: 全部通過

依「共用的 QA 操作」重新建置、啟動、seed：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 chart-after --strict`
Expected: `All layout checks passed.`，表格中 1366x900 的 `chartPx` ≥ 700、1920x1080 ≥ 880

Run: `node scripts/qa/desk-orders.mjs http://127.0.0.1:18831 chart-after`
Expected: 無例外

依「共用的 QA 操作」的「分時頁截圖」以 `LABEL=chart-after` 截圖。

目視 `artifacts/trading-desk-qa/chart-after/1366x900.png`（K 線分頁）：最上方有讀數列；K 棒不再是大塊；左下「昨・開・低 2575」合成一個標籤，沒有疊字。目視 `quote-1366x900.png`（分時分頁）：刻度以 2575 為中心，右側百分比上下對稱，中間格線是 0.00%。停止 QA 伺服器。

- [ ] **Step 12: 提交**

```bash
git add src/components/charts.tsx src/lib/morning.ts src/components/morning-practice.tsx src/trading-desk.css scripts/qa/desk-layout.mjs
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: symmetric intraday scale, wider candles, merged labels and readout strip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Canvas 小走勢與共用的畫布 hook

**Files:**
- Create: `src/components/use-device-canvas.ts`
- Modify: `src/components/charts.tsx`（`TapeChart` 元件，約 `:82-244`；import）
- Modify: `src/components/morning-quotes.tsx:1-62`（`MorningSparkline`）
- Modify: `src/components/morning-practice.tsx`（`MorningWatchlist` 內的 `<MorningSparkline …/>`）
- Modify: `src/trading-desk.css`（自選列 `:853-917`、平板 compact `:958-979`、長輩模式）
- Modify: `scripts/qa/desk-layout.mjs`、`scripts/qa/desk-sharpness.mjs`

**Interfaces:**
- Consumes: Task 1 的 `sparklineLayout`、`deviceDashPattern`；既有的 `canvasResolution`、`hairlineDevicePixels`、`snapEdge`、`snapStroke`。
- Produces:
  - `useDeviceCanvas(ref: RefObject<HTMLCanvasElement | null>, render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, options?: { opaque?: boolean }): () => void`
  - `MorningSparkline({ bars, previous, endT }: { bars: Bar[]; previous: number; endT: number })`
  - DOM：`.td-watch-item canvas.td-spark`（`aria-hidden`，沒有 `role`）

- [ ] **Step 1: 在 QA 腳本加入小走勢尺寸與銳利度截圖（先讓它失敗）**

`scripts/qa/desk-layout.mjs` 的 `scan` 回傳物件加入：

```js
    sparkSize: (() => {
      const spark = document.querySelector(".td-watch-item .td-spark");
      if (!spark) return null;
      const rect = spark.getBoundingClientRect();
      return [Math.round(rect.width), Math.round(rect.height)];
    })(),
```

`failures` 迴圈加入：

```js
  if (!row.senior && row.width >= 1200 && !(row.sparkSize && row.sparkSize[0] >= 200 && row.sparkSize[1] >= 48))
    failures.push(`${row.name}: sparkline ${JSON.stringify(row.sparkSize)}, needs 200x48`);
```

`scripts/qa/desk-sharpness.mjs`：在 `rows.push(...)` 之前加入（取未選取的一列，背景就是面板色）：

```js
  const spark = page.locator('.td-watch-item[aria-pressed="false"] canvas.td-spark').first();
  if (await spark.count()) writeFileSync(`${out}spark-dpr${ratio}.png`, await spark.screenshot());
```

- [ ] **Step 2: 用目前的建置跑，確認失敗**

啟動 QA 伺服器（使用 Task 4 的 `.output`）並 seed：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 spark-before --strict`
Expected: FAIL，桌機各列 `sparkline [92,52], needs 200x48`

停止 QA 伺服器。

- [ ] **Step 3: 抽出 `useDeviceCanvas`**

建立 `src/components/use-device-canvas.ts`：

```ts
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { canvasResolution } from "@/lib/market/chart-data";

type Render = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/**
 * Keeps a canvas's backing store at the screen's exact device pixels and repaints it after every
 * React render and whenever its size, theme, reading mode, fonts or screen resolution change.
 * `render` draws in CSS pixels. An opaque canvas must paint its whole area (browsers then use
 * sharper text); a transparent one is cleared first. Returns a function that schedules a repaint.
 */
export function useDeviceCanvas(
  ref: RefObject<HTMLCanvasElement | null>,
  render: Render,
  { opaque = false }: { opaque?: boolean } = {},
): () => void {
  const latest = useRef(render);
  const redraw = useRef<() => void>(() => {});

  // Keep observers stable even when the caller supplies a new render function each render.
  useEffect(() => {
    latest.current = render;
    redraw.current();
  });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    let disposed = false;
    // Exact device pixels the browser gives this canvas, where ResizeObserver reports them.
    let deviceBox: { width: number; height: number } | undefined;
    const draw = () => {
      frame = 0;
      if (disposed) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (width < 8 || height < 8) return;
      // Backing pixels must match the screen's device pixels one to one: any other size is
      // resampled by the browser, which blurs every snapped line and every glyph.
      const size = canvasResolution(width, height, window.devicePixelRatio, deviceBox);
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      const ctx = canvas.getContext("2d", { alpha: !opaque });
      if (!ctx) return;
      ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
      if (!opaque) ctx.clearRect(0, 0, width, height);
      latest.current(ctx, width, height);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const resize = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.devicePixelContentBoxSize?.[0];
      if (box) deviceBox = { width: box.inlineSize, height: box.blockSize };
      schedule();
    });
    try {
      resize.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      // Browsers without the device-pixel box (older Safari) round CSS size times ratio instead.
      resize.observe(canvas);
    }
    const changes = new MutationObserver(schedule);
    for (let element: HTMLElement | null = canvas; element; element = element.parentElement) {
      changes.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-market-theme", "data-reading-mode"],
      });
    }
    const palette = window.matchMedia("(prefers-color-scheme: dark)");
    palette.addEventListener("change", schedule);
    let resolution: MediaQueryList | undefined;
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution.addEventListener("change", watchResolution);
      schedule();
    };
    watchResolution();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      palette.removeEventListener("change", schedule);
      resolution?.removeEventListener("change", watchResolution);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      redraw.current = () => {};
    };
  }, [ref, opaque]);
  return useCallback(() => redraw.current(), []);
}
```

- [ ] **Step 4: `TapeChart` 改用 hook**

`src/components/charts.tsx`：

1. React import 改成 `import { useId, useRef, useState } from "react";`，加入 `import { useDeviceCanvas } from "@/components/use-device-canvas";`，並從 chart-data import 移除 `canvasResolution`。
2. `TapeChart` 從開頭到 `const clear = () => { … };` 換成：

```tsx
export function TapeChart(props: TapeChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<Cursor>(null);
  const readoutId = useId();
  const [readout, setReadout] = useState("");
  // paint() fills the whole canvas with an opaque colour, so an opaque context lets browsers use
  // their sharper (LCD) text rendering on it.
  const redraw = useDeviceCanvas(
    ref,
    (ctx, width, height) => {
      const description = paint(
        ctx,
        width,
        height,
        props,
        tokens(ctx.canvas),
        props.interactive === false ? null : cursor.current,
      );
      setReadout(description ?? "");
    },
    { opaque: true },
  );

  const clear = () => {
    cursor.current = null;
    redraw();
  };
```

3. 元件其餘部分中所有 `redraw.current()` 改成 `redraw()`（`onPointerDown`、`onPointerMove`、`onKeyDown` 各一處）。

- [ ] **Step 5: Canvas 小走勢**

`src/components/morning-quotes.tsx`：

1. React import 中移除 `useId`（若檔中其他地方不再使用），加入 `useRef`；加入：

```ts
import { useDeviceCanvas } from "@/components/use-device-canvas";
import {
  deviceDashPattern,
  hairlineDevicePixels,
  snapEdge,
  snapStroke,
  sparklineLayout,
} from "@/lib/market/chart-data";
```

2. 把整個 `MorningSparkline`（`/** Use only the completed bars … */` 到其結尾 `}`）換成：

```tsx
/** Use only the completed bars already disclosed by the morning API. */
export function MorningSparkline({
  bars,
  previous,
  endT,
}: {
  bars: Bar[];
  previous: number;
  endT: number;
}) {
  if (!bars.length) return <span className="td-spark td-spark-empty">等待開盤</span>;
  return <SparkCanvas bars={bars} previous={previous} endT={endT} />;
}

/** A separate component so the canvas hook mounts with the canvas, not before it. */
function SparkCanvas({ bars, previous, endT }: { bars: Bar[]; previous: number; endT: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useDeviceCanvas(ref, (ctx, width, height) =>
    paintSparkline(ctx, width, height, { bars, previous, startT: 0, endT }),
  );
  return <canvas ref={ref} className="td-spark" aria-hidden="true" />;
}

function paintSparkline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: { bars: Bar[]; previous: number; startT: number; endT: number },
) {
  const style = getComputedStyle(ctx.canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const up = read("--color-up", "#ff3b3b");
  const down = read("--color-down", "#17c964");
  const tape = read("--color-tape", "#e8c547");
  const transform = ctx.getTransform();
  const sx = transform.a > 0 ? transform.a : 1;
  const sy = transform.d > 0 ? transform.d : 1;
  const hairline = hairlineDevicePixels(Math.min(sx, sy));
  const layout = sparklineLayout({ ...input, width, height });
  const base = layout.previousY;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Shade between the line and the previous close, like the big intraday chart.
  if (Number.isFinite(base)) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (const run of layout.runs) {
      if (run.points.length < 2) continue;
      ctx.fillStyle = run.above ? up : down;
      ctx.beginPath();
      ctx.moveTo(run.points[0]!.x, base);
      for (const point of run.points) ctx.lineTo(point.x, point.y);
      ctx.lineTo(run.points.at(-1)!.x, base);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // The previous close: whole device pixels, so it stays crisp at every screen scale.
    ctx.save();
    ctx.strokeStyle = tape;
    ctx.lineWidth = hairline / sy;
    ctx.setLineDash(deviceDashPattern([2, 3], sx));
    const y = snapStroke(base, sy, hairline);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(snapEdge(width, sx), y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = 1.5;
  for (const run of layout.runs) {
    if (run.points.length < 2) continue;
    ctx.strokeStyle = run.above ? up : down;
    ctx.beginPath();
    run.points.forEach((point, index) => {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.stroke();
  }
  if (layout.last) {
    ctx.fillStyle = layout.last.above ? up : down;
    ctx.beginPath();
    ctx.arc(layout.last.x, layout.last.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

3. `src/components/morning-practice.tsx` 的 `MorningWatchlist` 中，`<MorningSparkline … />` 加上 `endT={catalog.maxCursor * 60}`。

- [ ] **Step 6: 樣式 — 兩層自選列**

`src/trading-desk.css`：

`.trading-desk .td-watch-item { … }` 中的格線設定改成：

```css
  grid-template-areas:
    "name price"
    "name change"
    "spark spark";
  grid-template-columns: minmax(0, 1fr) auto;
```

`.trading-desk .td-watch-name { … }` 改成：

```css
.trading-desk .td-watch-name {
  grid-area: name;
  display: flex;
  flex-direction: column;
  align-self: start;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
```

`.td-watch-price` 與 `.td-watch-change` 各加一行 `justify-self: end;`。

`.trading-desk .td-spark { … }` 改成：

```css
.trading-desk .td-spark {
  grid-area: spark;
  display: block;
  width: 100%;
  height: 56px;
  margin-top: 6px;
}
```

刪除 `.trading-desk .td-spark-prev { … }`（SVG 已移除）。

平板 compact 區（`.td-watchlist[data-compact="true"] .td-watch-item { … }` 之後）加入，維持原本的橫向名稱與靠左價格：

```css
.trading-desk .td-watchlist[data-compact="true"] .td-watch-name {
  flex-direction: row;
  justify-content: space-between;
}
.trading-desk .td-watchlist[data-compact="true"] :is(.td-watch-price, .td-watch-change) {
  justify-self: start;
}
```

長輩模式區（`.trading-desk[data-layout="senior"] .td-watch-price { … }` 之後）加入：

```css
.trading-desk[data-layout="senior"] .td-spark {
  height: 64px;
}
```

- [ ] **Step 7: 檢查並跑 QA，確認通過**

Run: `npm run typecheck` 、 `npx eslint src --quiet` 、 `npm test`
Expected: 全部通過

依「共用的 QA 操作」重新建置、啟動、seed：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 spark-after --strict`
Expected: `All layout checks passed.`（桌機 `sparkSize` 約 1366 寬 `[265,56]`、1920 寬 `[383,56]`）

Run: `node scripts/qa/desk-sharpness.mjs http://127.0.0.1:18831 spark-after`
Expected: 產生 `sharp-dpr{1,1.25,1.5,2}.png` 與 `spark-dpr{1,1.25,1.5,2}.png`

對每個倍率產生小走勢遮罩：

Run: `node scripts/qa/desk-softmask.mjs artifacts/trading-desk-qa/spark-after/spark-dpr1.5.png artifacts/trading-desk-qa/spark-after/spark-mask-dpr1.5.png "#0b111b" "#e8c547" "#ff3b3b" "#19d36b"`（1、1.25、2 同樣各跑一次）
Expected: 打開遮罩，洋紅色只出現在價格線邊緣、線下填色與最新價圓點；昨收虛線本身不是洋紅色。

停止 QA 伺服器。

- [ ] **Step 8: 提交**

```bash
git add src/components/use-device-canvas.ts src/components/charts.tsx src/components/morning-quotes.tsx src/components/morning-practice.tsx src/trading-desk.css scripts/qa/desk-layout.mjs scripts/qa/desk-sharpness.mjs
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: full-width canvas sparklines sharing the chart canvas hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 全面驗收、改前改後對照與紀錄

**Files:**
- Create: `docs/jiangbo-chart-2026-10-16.md`

**Interfaces:**
- Consumes: Task 1–5 的全部成果與 QA 腳本。
- Produces: 驗收紀錄文件；交給使用者的改前／改後截圖。

- [ ] **Step 1: 全套自動檢查**

Run: `npm test` 、 `npm run typecheck` 、 `npx eslint src --quiet`
Expected: 全部通過

- [ ] **Step 2: 全套畫面 QA**

依「共用的 QA 操作」重新建置、啟動、seed，然後依序：

Run: `node scripts/qa/desk-layout.mjs http://127.0.0.1:18831 jiangbo-final --strict`
Expected: `All layout checks passed.`

Run: `node scripts/qa/desk-orders.mjs http://127.0.0.1:18831 jiangbo-final`
Expected: 無例外；`marketBuy.newFills` 為 1、`lightning.status` 為 `cancelled`、`sellWithoutHolding.submitDisabled` 為 `true`

Run: `node scripts/qa/desk-sharpness.mjs http://127.0.0.1:18831 jiangbo-final`
Expected: 產生 4 個倍率的大圖與小走勢截圖

對 4 個倍率的大圖截圖跑遮罩（色票順序與 `desk-sharpness.mjs` 讀到的相同）：

Run: `node scripts/qa/desk-softmask.mjs artifacts/trading-desk-qa/jiangbo-final/sharp-dpr1.25.png artifacts/trading-desk-qa/jiangbo-final/mask-dpr1.25.png "#0b111b" "#1c2636" "#ff3b3b" "#19d36b" "#e8c547" "#8a9bb6" "#e7b549"`（1、1.5、2 同樣各跑一次）
Expected: 格線、昨收線、前高虛線都沒有洋紅色；洋紅色只在文字、價格線與標記上。小走勢遮罩同 Task 5 Step 7。

- [ ] **Step 3: 分時頁截圖**

依「共用的 QA 操作」的「分時頁截圖」以 `LABEL=jiangbo-final` 截圖，得到 `artifacts/trading-desk-qa/jiangbo-final/quote-1366x900.png` 與 `quote-1920x1080.png`。核對：
  - 刻度以昨收為中心，右側百分比上下對稱，中間格線是 0.00%。
  - 最上方讀數列顯示「09:26–09:27　價 2580　▲5 +0.19%」。
  - 標籤沒有重疊。

完成後停止 QA 伺服器。

- [ ] **Step 4: 寫驗收紀錄**

建立 `docs/jiangbo-chart-2026-10-16.md`，內容依實際 QA 結果填入（數字取自 `artifacts/trading-desk-qa/jiangbo-final/layout.json` 的 `chartHeight`、`sparkSize`，以及 Step 2–3 的結果）：

```markdown
# 江波圖放大與畫質 — 2026-10-16

依 `docs/superpowers/specs/2026-10-15-jiangbo-chart-quality-design.md`（子專案 1）實作。

## 改了什麼

- 帳務區預設收成一行，有待成交委託時顯示「N 待成交」，按「展開」或「委託」分頁可展開；狀態記在瀏覽器。
- 「昨收／開／高／低」與資料說明合成一列；每分鐘讀數移到圖表最上方的讀數列。
- 分時刻度以昨收為中心對稱、至少 ±1%；K 線範圍至少 1.5%、K 棒最寬 13px。
- 圖內標籤（昨、開、高、低、前高、均）會合併或錯開，不再重疊。
- 左側小走勢改成整列寬的 canvas，與大圖同刻度、同時間軸。
- 均價線與成交量窗格已完成，但只在教材標明 `volumeUnit: "lot"` 且每分鐘有均價時顯示；現有 Yahoo 教材不顯示。

## 量測（改前 → 改後）

| 項目 | 改前（2026-10-14 release-candidate） | 改後 |
|---|---|---|
| 1366×900 圖高 | 539px | <layout.json 1366x900 chartHeight>px |
| 1920×1080 圖高 | 719px | <layout.json 1920x1080 chartHeight>px |
| 1366 寬小走勢 | 92×52 | <sparkSize> |
| 1920 寬小走勢 | 92×52 | <sparkSize> |

## 驗收結果

- `npm test`、`npm run typecheck`、`npx eslint src --quiet`：<結果>
- `desk-layout --strict`（8 種尺寸 + 長輩模式）：<結果>
- `desk-orders`：<結果>
- 銳利度遮罩（1、1.25、1.5、2 倍）：<結果>

截圖：`artifacts/trading-desk-qa/jiangbo-final/`（不進版控）。改前截圖：`artifacts/trading-desk-qa/release-candidate/`。

## 尚未驗證

- 均價線與成交量的真實畫面要等子專案 3（富邦教材）才能驗收。
```

把每個 `<…>` 換成實際數值或結果後再提交（這些是填寫欄位，不是待辦）。

- [ ] **Step 5: 提交**

```bash
git add docs/jiangbo-chart-2026-10-16.md
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "docs: record jiangbo chart enlargement and sharpness verification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 交付給使用者**

用 SendUserFile 傳給使用者這幾張對照圖：
  - 改前：`artifacts/trading-desk-qa/release-candidate/1366x900.png`
  - 改後：`artifacts/trading-desk-qa/jiangbo-final/1366x900.png`
  - 分時頁：`artifacts/trading-desk-qa/jiangbo-final/quote-1366x900.png`

說明可以推送與部署，但等使用者指示再做。
