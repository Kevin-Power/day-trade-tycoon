import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyMorningAction, createMorningState, visibleMorningState,
  type MorningSource, type MorningStoredState } from "./morning-engine.ts";
import type { MorningAction, MorningPlan } from "./morning.ts";
import { chartLinePoints, chartWindow, completedBarsInWindow } from "./market/chart-data.ts";

// Use the actual private lesson, not a replacement price generator. Its retained
// vendor-byte provenance is independently checked by verify-morning-source.mjs.
function sourceFixture(): MorningSource {
  return JSON.parse(readFileSync(new URL("../../server/data/morning-2026-10-06.json", import.meta.url), "utf8"));
}
const plan: MorningPlan = { bias: "observe", focusCode: "2330", reason: "觀察已完成分鐘", entry: "條件成立後才委託", stop: "判斷失效時退出" };
function advance(state: MorningStoredState): Exclude<MorningAction, { action: "start" }> {
  return { action: "advance", requestId: randomUUID(), id: state.id, expectedRevision: state.revision };
}
function pendingState(source: MorningSource): MorningStoredState {
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, advance(state), source, 1000);
  return applyMorningAction(state, {
    action: "order", requestId: randomUUID(), id: state.id, expectedRevision: state.revision,
    code: "2330", side: "buy", lots: 1,
  }, source, 1100);
}

test("all 450 retained source bars reach completed-minute chart inputs unchanged and without synthetic ticks", () => {
  const source = sourceFixture();
  const original = structuredClone(source);
  let state = createMorningState(randomUUID(), plan, source, 0);
  let compared = 0;
  for (let cursor = 1; cursor <= 90; cursor++) {
    state = applyMorningAction(state, advance(state), source, cursor * 1000);
    const visible = visibleMorningState(state, source);
    const window = chartWindow({ startT: 0, endT: 5400, now: cursor * 60, range: { start: 0, end: cursor * 60 } });
    for (const symbol of source.catalog.symbols) {
      const expected = source.bars[symbol.code].slice(0, cursor);
      assert.deepEqual(visible.bars[symbol.code], expected);
      const chartBars = completedBarsInWindow(visible.bars[symbol.code], window, 60);
      assert.deepEqual(chartBars, expected, `${symbol.code}: chart must preserve original OHLC and timestamp`);
      const points = chartLinePoints({ bars: chartBars, ticks: [], variant: "stock", completedBarSeconds: 60,
        current: { t: cursor * 60, p: -999 } });
      assert.deepEqual(points, expected.map(bar => ({ t: bar.t + 60, p: bar.c })), "only original minute closes, no current-quote substitute");
      assert.ok(points.every(point => point.t <= cursor * 60));
      compared++;
    }
    assert.equal(Object.hasOwn(state, "bars"), false, "persisted state must not contain future source data");
  }
  assert.equal(compared, 450);
  assert.deepEqual(source, original, "neither the engine nor chart preparation may rewrite source values");
});

test("missing or invalid next-minute source stops the whole replay before any fill, cash or cursor mutation", () => {
  const source = sourceFixture();
  const original = pendingState(source);
  const mutations: [string, (source: MorningSource, code: string) => void][] = [
    ["missing symbol", (source, code) => { delete source.bars[code]; }],
    ["missing minute", (source, code) => { source.bars[code].splice(1, 1); }],
    ["series ends early", (source, code) => { source.bars[code].length = 1; }],
    ["duplicate timestamp", (source, code) => { source.bars[code][1].t = 0; }],
    ["future timestamp", (source, code) => { source.bars[code][1].t = 120; }],
    ["invalid open", (source, code) => { source.bars[code][1].o = NaN; }],
    ["invalid close", (source, code) => { source.bars[code][1].c = Infinity; }],
    ["zero price", (source, code) => { source.bars[code][1].l = 0; }],
    ["impossible high", (source, code) => { source.bars[code][1].h = source.bars[code][1].l - 1; }],
    ["missing volume", (source, code) => { source.bars[code][1].v = NaN; }],
    ["negative volume", (source, code) => { source.bars[code][1].v = -1; }],
  ];
  // A missing non-traded stock must stop the synchronized replay just like the
  // pending order's stock; no carry-forward, next-bar or other-stock fallback.
  for (const code of ["2330", "2308"]) {
    for (const [label, mutate] of mutations) {
      const broken = structuredClone(source);
      mutate(broken, code);
      const state = structuredClone(original);
      assert.throws(() => applyMorningAction(state, advance(state), broken, 2000), { status: 503 }, `${code}: ${label}`);
      assert.deepEqual(state, original, `${code}: ${label} must not partially fill or advance`);
    }
  }
});

test("unrevealed future is never consulted, while a corrupt completed minute cannot be replaced on restore", () => {
  const source = sourceFixture();
  const state = pendingState(source);
  const futureBroken = structuredClone(source);
  futureBroken.bars["2308"][89].c = NaN;
  assert.deepEqual(visibleMorningState(state, futureBroken), visibleMorningState(state, source));
  assert.deepEqual(applyMorningAction(state, advance(state), futureBroken, 2000), applyMorningAction(state, advance(state), source, 2000));

  const knownBroken = structuredClone(source);
  knownBroken.bars["2308"][0].h = 0;
  assert.throws(() => visibleMorningState(state, knownBroken), { status: 503 });
  const wrongLesson = structuredClone(source);
  wrongLesson.catalog.lessonId = "another-unverified-source";
  assert.throws(() => visibleMorningState(state, wrongLesson), { status: 409 });
  assert.throws(() => applyMorningAction(state, advance(state), wrongLesson, 2000), { status: 409 });
});
