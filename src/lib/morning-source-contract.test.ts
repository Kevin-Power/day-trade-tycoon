import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { advanceDelta, applyMorningAction, createMorningState, visibleMorningState, visibleTape,
  type MorningSource, type MorningStoredState } from "./morning-engine.ts";
import type { MorningAction, MorningPlan } from "./morning.ts";
import { chartLinePoints, chartWindow, completedBarsInWindow } from "./market/chart-data.ts";
import { buildRunSource, type RunSource } from "./lessons/daily-lessons.server.ts";
import type { TradeRow } from "./lessons/trades.ts";
import { SIX_ALL_MORNING, everyMinute, twoTrades, withMarket, writeDay } from "./morning-fixtures.ts";

// A run's data as the API builds it from a published day (the real reading path, real strict check), not a
// generator: a stock that trades every minute, one whose first trade is at 09:12:30 and one with two trades only.
const DATE = "2026-10-28";
const CODES = ["2330", "2881", "1101"];
const LATE: TradeRow[] = [[750_000, 60.5, 4, 60, 60.5], [751_000, 60.6, 1, 60.5, 60.6], [2_000_000, 61, 2, 60.9, 61]];
async function runSource(dir: string): Promise<RunSource> {
  await writeDay(dir, DATE, [
    ...SIX_ALL_MORNING.filter((stock) => stock.code !== "1101"),
    { code: "2881", referencePrice: 60, tradeValue: 1, trades: LATE },
    { code: "1101", referencePrice: 30, tradeValue: 2, trades: twoTrades(30) },
  ], { taiex: true });
  return buildRunSource(dir, DATE, CODES);
}
const plan: MorningPlan = { bias: "observe", focusCode: "2330", reason: "觀察已完成分鐘", entry: "條件成立後才委託", stop: "判斷失效時退出" };
function advance(state: MorningStoredState): Exclude<MorningAction, { action: "start" }> {
  return { action: "advance", requestId: randomUUID(), id: state.id, expectedRevision: state.revision };
}
/** At 09:01 with a market buy of 2330 waiting for the next minute's trades. */
function pendingState(source: MorningSource): MorningStoredState {
  let state = createMorningState(randomUUID(), plan, source, 0, CODES);
  state = applyMorningAction(state, advance(state), source, 1000);
  return applyMorningAction(state, {
    action: "order", requestId: randomUUID(), id: state.id, expectedRevision: state.revision,
    code: "2330", side: "buy", lots: 1,
  }, source, 1100);
}

test("a run's source bars reach completed-minute charts unchanged, without synthetic ticks", () => withMarket(async (dir) => {
  const source = await runSource(dir);
  const original = structuredClone(source);
  let state = createMorningState(randomUUID(), plan, source, 0, CODES);
  let compared = 0;
  for (let cursor = 1; cursor <= source.catalog.maxCursor; cursor++) {
    state = applyMorningAction(state, advance(state), source, cursor * 1000);
    const visible = visibleMorningState(state, source);
    const window = chartWindow({ startT: 0, endT: 5400, now: cursor * 60, range: { start: 0, end: cursor * 60 } });
    for (const code of CODES) {
      const expected = source.bars[code].filter((bar) => bar.t < cursor * 60);
      assert.deepEqual(visible.bars[code], expected);
      const chartBars = completedBarsInWindow(visible.bars[code], window, 60);
      assert.deepEqual(chartBars, expected, `${code}: chart must preserve the published OHLC and timestamp`);
      const points = chartLinePoints({ bars: chartBars, ticks: [], variant: "stock", completedBarSeconds: 60,
        current: { t: cursor * 60, p: -999 } });
      assert.deepEqual(points, expected.map(bar => ({ t: bar.t + 60, p: bar.c })), "only published minute closes, no current-quote substitute");
      assert.ok(points.every(point => point.t <= cursor * 60));
      compared++;
    }
    // The late stock has no bar before its first trade's minute (09:12).
    assert.equal(visible.bars["2881"].length, Math.max(0, cursor - 12));
    assert.equal(Object.hasOwn(state, "bars"), false, "persisted state must not contain source data");
  }
  assert.equal(compared, 90 * CODES.length);
  assert.deepEqual(source, original, "neither the engine nor chart preparation may rewrite the cached source");
}));

test("an invalid bar of the minute being revealed stops the whole advance before any fill, cash or cursor change", () => withMarket(async (dir) => {
  const source = await runSource(dir);
  const original = pendingState(source);
  const cellOne = (copy: MorningSource, code: string) => copy.bars[code].find((bar) => bar.t === 60)!;
  const mutations: [string, (copy: MorningSource, code: string) => void][] = [
    ["invalid open", (copy, code) => { cellOne(copy, code).o = NaN; }],
    ["invalid close", (copy, code) => { cellOne(copy, code).c = Infinity; }],
    ["zero price", (copy, code) => { cellOne(copy, code).l = 0; }],
    ["impossible high", (copy, code) => { const bar = cellOne(copy, code); bar.h = bar.l - 1; }],
    ["missing volume", (copy, code) => { cellOne(copy, code).v = NaN; }],
    ["negative volume", (copy, code) => { cellOne(copy, code).v = -1; }],
  ];
  // A broken stock without the waiting order stops the synchronized replay just like the order's own stock.
  for (const code of ["2330", "1101"]) {
    for (const [label, mutate] of mutations) {
      const broken = structuredClone(source);
      mutate(broken, code);
      const state = structuredClone(original);
      assert.throws(() => applyMorningAction(state, advance(state), broken, 2000), { status: 503 }, `${code}: ${label}`);
      assert.deepEqual(state, original, `${code}: ${label} must not partially fill or advance`);
    }
  }
}));

test("the unrevealed future is never consulted, while a corrupt revealed minute cannot be replaced on restore", () => withMarket(async (dir) => {
  const source = await runSource(dir);
  const state = pendingState(source);
  const futureBroken = structuredClone(source);
  futureBroken.bars["1101"].find((bar) => bar.t === 89 * 60)!.c = NaN;
  futureBroken.bars["2330"].at(-1)!.o = NaN;
  const later = futureBroken.trades as Record<string, TradeRow[]>;
  later["2330"] = later["2330"].map((row) => (row[0] >= 120_000 ? [row[0], -1, row[2], row[3], row[4]] as TradeRow : row));
  later["2881"] = everyMinute(1, 5); // a different future entirely
  futureBroken.index!.bars.at(-1)!.c = NaN;
  assert.deepEqual(visibleMorningState(state, futureBroken), visibleMorningState(state, source));
  assert.deepEqual(visibleTape(state, futureBroken), visibleTape(state, source));
  assert.deepEqual(applyMorningAction(state, advance(state), futureBroken, 2000), applyMorningAction(state, advance(state), source, 2000));
  const next = applyMorningAction(state, advance(state), source, 2000);
  assert.deepEqual(advanceDelta(next, futureBroken), advanceDelta(next, source));

  const knownBroken = structuredClone(source);
  knownBroken.bars["1101"][0].h = 0;
  assert.throws(() => visibleMorningState(state, knownBroken), { status: 503 });
  const wrongLesson = structuredClone(source);
  wrongLesson.catalog.lessonId = "another-unverified-source";
  assert.throws(() => visibleMorningState(state, wrongLesson), { status: 409 });
  assert.throws(() => applyMorningAction(state, advance(state), wrongLesson, 2000), { status: 409 });
  const republished = { ...structuredClone(source), sourceHash: "0".repeat(64) };
  assert.throws(() => visibleMorningState(state, republished), { status: 409 });
}));
