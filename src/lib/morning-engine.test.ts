import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  advanceDelta,
  applyMorningAction,
  createMorningState,
  parseMorningAction,
  visibleMorningState,
  visibleTape,
  MORNING_STARTING_CASH,
  type MorningSource,
  type MorningStoredState,
} from "./morning-engine.ts";
import type { MorningAction, MorningIndexSeries, MorningPlan } from "./morning.ts";
import type { Bar } from "./game/types.ts";
import type { TradeRow } from "./lessons/trades.ts";
import { commission, DAYTRADE_TAX } from "./market/ticks.ts";
import { exceedsCash } from "./morning-orders.ts";
import { DEFAULT_EXIT, EXIT_CANCEL, exitPrices } from "./morning-exit.ts";
import { VOLUME_CANCEL } from "./lessons/matching.ts";

const plan: MorningPlan = {
  bias: "observe",
  focusCode: "2330",
  reason: "先觀察市場",
  entry: "等自己的條件成立",
  stop: "理由不成立就離場",
};
function fixture(): MorningSource {
  return {
    catalog: {
      lessonId: "test-immutable-v1",
      title: "fixture",
      date: "2026-10-06",
      start: "09:00",
      end: "10:30",
      maxCursor: 90,
      symbols: [{ code: "2330", name: "fixture", previousClose: 99, previous5CloseMean: 98 }],
      context: [],
      strategy: [],
      notices: [],
      videoUrl: null,
    },
    bars: {
      "2330": Array.from({ length: 90 }, (_, minute) => ({
        t: minute * 60,
        o: 100 + minute,
        h: 200 + minute,
        l: 90 + minute,
        c: 101 + minute,
        v: 1,
      })),
    },
  };
}
function action(
  state: MorningStoredState,
  value: object,
): Exclude<MorningAction, { action: "start" }> {
  return parseMorningAction({
    id: state.id,
    expectedRevision: state.revision,
    requestId: randomUUID(),
    ...value,
  }) as Exclude<MorningAction, { action: "start" }>;
}

test("limit buy waits across minutes despite intraminute lows, then fills at a better OPEN", () => {
  const source = fixture();
  source.bars["2330"][2] = { t: 120, o: 99, h: 104, l: 97, c: 102, v: 1 };
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  const send = action(state, {
    action: "order",
    code: "2330",
    side: "buy",
    lots: 2,
    limitPrice: 100,
    entryMode: "lightning",
  });
  state = applyMorningAction(state, send, source, 1100);
  assert.equal(state.orders[0].limitPrice, 100);
  assert.equal(state.orders[0].entryMode, "lightning");
  assert.equal(state.fills.length, 0);
  assert.throws(() => applyMorningAction(state, send, source, 1150), { status: 409 });
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  assert.equal(
    state.orders[0].status,
    "pending",
    "A low below the limit cannot establish an intraminute fill",
  );
  assert.equal(state.cash, MORNING_STARTING_CASH);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 3000);
  assert.equal(state.orders[0].status, "filled");
  assert.equal(state.orders[0].price, 99);
  assert.equal(state.fills[0].t, 120);
  assert.equal(state.fills[0].fee, commission(198000));
  assert.equal(state.cash, MORNING_STARTING_CASH - 198000 - commission(198000));
  assert.equal(visibleMorningState(state, source).bars["2330"].length, 3);
});

test("limit sell waits for a qualifying OPEN and preserves long-only inventory and costs", () => {
  const source = fixture();
  source.bars["2330"][3] = { t: 180, o: 105, h: 106, l: 103, c: 104, v: 1 };
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  assert.throws(
    () =>
      applyMorningAction(
        state,
        action(state, { action: "order", code: "2330", side: "sell", lots: 1, limitPrice: 104 }),
        source,
        1001,
      ),
    { status: 400 },
  );
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 1 }),
    source,
    1100,
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "sell", lots: 1, limitPrice: 104 }),
    source,
    2100,
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 3000);
  assert.equal(state.orders[1].status, "pending", "A high above the limit is not a fill");
  assert.equal(state.positions[0].shares, 1000);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 4000);
  assert.equal(state.fills[1].price, 105);
  assert.equal(state.fills[1].tax, Math.round(105000 * DAYTRADE_TAX));
  assert.deepEqual(state.positions, []);
});

test("server rejects bad limit ticks, bands, funds and lightning without a price", () => {
  const source = fixture();
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  for (const limitPrice of [0, -1, NaN, Infinity, "100", null])
    assert.throws(
      () => action(state, { action: "order", code: "2330", side: "buy", lots: 1, limitPrice }),
      { status: 400 },
    );
  assert.throws(
    () =>
      action(state, {
        action: "order",
        code: "2330",
        side: "buy",
        lots: 1,
        entryMode: "lightning",
      }),
    { status: 400 },
  );
  for (const limitPrice of [100.1, 110, 88])
    assert.throws(
      () =>
        applyMorningAction(
          state,
          action(state, { action: "order", code: "2330", side: "buy", lots: 1, limitPrice }),
          source,
          1100,
        ),
      { status: 400 },
    );
  state.cash = 105000;
  assert.throws(
    () =>
      applyMorningAction(
        state,
        action(state, { action: "order", code: "2330", side: "buy", lots: 1, limitPrice: 108.5 }),
        source,
        1100,
      ),
    { status: 400 },
  );
  assert.equal(state.orders.length, 0);
});

test("unfilled limits can be cancelled, expire at the last minute, and do not change cash", () => {
  const source = fixture();
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 1, limitPrice: 90 }),
    source,
    1100,
  );
  state = applyMorningAction(
    state,
    action(state, { action: "cancel", orderId: state.orders[0].id }),
    source,
    1200,
  );
  assert.equal(state.orders[0].status, "cancelled");
  assert.equal(state.cash, MORNING_STARTING_CASH);
  state.cursor = 89;
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 1, limitPrice: 90 }),
    source,
    89000,
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 90000);
  assert.equal(state.cursor, 90);
  assert.equal(state.orders[1].status, "cancelled");
  assert.match(state.orders[1].reason!, /教材已結束/);
  assert.equal(state.fills.length, 0);
  assert.equal(state.cash, MORNING_STARTING_CASH);
});

test("exercise selection is optional for legacy plans and restricted to the six reviewed lessons", () => {
  const source = fixture();
  const start = { action: "start", requestId: randomUUID(), plan, codes: ["2330"] };
  assert.deepEqual(parseMorningAction(start), start);
  for (const exerciseId of [
    "first-order",
    "position",
    "exit",
    "n-breakout",
    "patience",
    "review",
  ] as const) {
    const parsed = parseMorningAction({ ...start, plan: { ...plan, exerciseId } });
    assert.equal(parsed.action, "start");
    if (parsed.action !== "start") throw new Error("Expected a start action");
    const state = createMorningState(randomUUID(), parsed.plan, source, 0);
    assert.equal(state.plan.exerciseId, exerciseId);
    assert.equal(visibleMorningState(state, source).plan.exerciseId, exerciseId);
  }
  for (const exerciseId of ["", "tycoon", "future-course", 1, null])
    assert.throws(() => parseMorningAction({ ...start, plan: { ...plan, exerciseId } }), {
      status: 400,
    });
});
test("replay exposes only completed minutes and rejects client progress or policy overrides", () => {
  const source = fixture();
  const state = createMorningState(randomUUID(), plan, source, 1000);
  assert.equal(state.cash, MORNING_STARTING_CASH);
  assert.deepEqual(visibleMorningState(state, source).bars["2330"], []);
  assert.equal(Object.hasOwn(state, "bars"), false);
  for (const extra of [
    { cursor: 90 },
    { now: 999999 },
    { speed: 100 },
    { userId: "owner" },
    { bars: source.bars },
  ])
    assert.throws(() => parseMorningAction({ ...action(state, { action: "advance" }), ...extra }));
  assert.throws(
    () => applyMorningAction(state, action(state, { action: "advance" }), source, 1999),
    { status: 429 },
  );
  const first = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  assert.equal(first.cursor, 1);
  assert.equal(first.revision, 1);
  assert.equal(first.nextAdvanceAt, 3000);
  assert.deepEqual(visibleMorningState(first, source).bars["2330"], [source.bars["2330"][0]]);
  assert.equal(state.cursor, 0);
  assert.throws(
    () =>
      applyMorningAction(
        first,
        action(first, { action: "advance", expectedRevision: 0 }),
        source,
        3000,
      ),
    { status: 409 },
  );
  const altered = structuredClone(source);
  altered.bars["2330"][89].c = 123;
  assert.deepEqual(visibleMorningState(first, altered), visibleMorningState(first, source));
});

test("long-only orders wait for the next OPEN and apply stated paper costs without intraminute inference", () => {
  const source = fixture();
  let state = createMorningState(randomUUID(), plan, source, 0);
  assert.throws(() =>
    applyMorningAction(
      state,
      action(state, { action: "order", code: "2330", side: "buy", lots: 1 }),
      source,
      1,
    ),
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  for (const lots of [0, 1.5, 401, -1])
    assert.throws(() => action(state, { action: "order", code: "2330", side: "buy", lots }));
  assert.throws(
    () =>
      applyMorningAction(
        state,
        action(state, { action: "order", code: "2330", side: "sell", lots: 1 }),
        source,
        1100,
      ),
    { status: 400 },
  );
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 2 }),
    source,
    1100,
  );
  assert.equal(state.orders[0].status, "pending");
  assert.equal(state.orders[0].price, undefined);
  assert.deepEqual(state.fills, []);
  assert.throws(
    () =>
      applyMorningAction(
        state,
        action(state, { action: "order", code: "2330", side: "buy", lots: 1 }),
        source,
        1200,
      ),
    { status: 409 },
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  const buyNotional = 101 * 2000;
  assert.equal(state.orders[0].price, 101);
  assert.equal(state.fills[0].t, 60);
  assert.equal(state.cash, MORNING_STARTING_CASH - buyNotional - commission(buyNotional));
  assert.equal(state.equity, state.cash + 102 * 2000);
  assert.deepEqual(state.positions, [{ code: "2330", shares: 2000, averageCost: 101 }]);
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "sell", lots: 1 }),
    source,
    2100,
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 3000);
  assert.equal(state.fills[1].price, 102);
  assert.equal(state.fills[1].tax, Math.round(102000 * DAYTRADE_TAX));
  assert.equal(state.positions[0].shares, 1000);
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 1 }),
    source,
    3100,
  );
  const beforeFinish = structuredClone(state);
  state = applyMorningAction(
    state,
    action(state, { action: "finish", reflection: "觀察與原先判斷不同，保留持倉做復盤。" }),
    source,
    3200,
  );
  assert.equal(state.completed, true);
  assert.equal(state.cursor, 3);
  assert.equal(state.orders.at(-1)?.status, "cancelled");
  assert.deepEqual(state.positions, beforeFinish.positions);
  assert.deepEqual(state.fills, beforeFinish.fills);
  assert.equal(state.cash, beforeFinish.cash);
  assert.equal(state.equity, beforeFinish.equity);
  assert.throws(
    () => applyMorningAction(state, action(state, { action: "advance" }), source, 4000),
    { status: 409 },
  );
});

test("price gaps reject unaffordable fills, cancellation preserves money, and minute 90 requires reflection", () => {
  const source = fixture();
  source.bars["2330"][1] = { t: 60, o: 5000, h: 5001, l: 4900, c: 4950, v: 0 };
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 3 }),
    source,
    1100,
  );
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  assert.equal(state.orders[0].status, "rejected");
  assert.equal(state.cash, MORNING_STARTING_CASH);
  assert.deepEqual(state.fills, []);
  assert.deepEqual(state.positions, []);
  const normal = fixture();
  state = applyMorningAction(
    state,
    action(state, { action: "order", code: "2330", side: "buy", lots: 1 }),
    normal,
    2200,
  );
  state = applyMorningAction(
    state,
    action(state, { action: "cancel", orderId: state.orders.at(-1)!.id }),
    normal,
    2300,
  );
  assert.equal(state.orders.at(-1)?.status, "cancelled");
  assert.equal(state.cash, MORNING_STARTING_CASH);
  for (let cursor = 3; cursor <= 90; cursor++)
    state = applyMorningAction(state, action(state, { action: "advance" }), normal, cursor * 1000);
  assert.equal(state.cursor, 90);
  assert.equal(state.completed, false);
  assert.equal(visibleMorningState(state, normal).bars["2330"].at(-1)?.t, 89 * 60);
  assert.throws(() =>
    applyMorningAction(state, action(state, { action: "advance" }), normal, 91000),
  );
  assert.throws(() =>
    applyMorningAction(
      state,
      action(state, { action: "order", code: "2330", side: "buy", lots: 1 }),
      normal,
      91000,
    ),
  );
  assert.throws(() => action(state, { action: "finish", reflection: " " }));
  state = applyMorningAction(
    state,
    action(state, { action: "finish", reflection: "已看完90分鐘，按計畫觀察。" }),
    normal,
    91000,
  );
  assert.equal(state.completed, true);
  const capped = createMorningState(randomUUID(), plan, normal, 0);
  capped.cursor = 1;
  capped.orders = Array.from({ length: 200 }, () => ({
    id: randomUUID(),
    code: "2330",
    side: "buy",
    shares: 1000,
    status: "cancelled",
    submittedCursor: 1,
  }));
  assert.throws(
    () =>
      applyMorningAction(
        capped,
        action(capped, { action: "order", code: "2330", side: "buy", lots: 1 }),
        normal,
        1000,
      ),
    { status: 409 },
  );
});

test("a new run records when it started", () => {
  assert.equal(createMorningState(randomUUID(), plan, fixture(), 5000).startedAt, 5000);
});

function indexed(): MorningSource {
  const source = fixture();
  return {
    ...source,
    index: {
      code: "TAIEX",
      name: "加權指數",
      previousClose: 1000,
      source: "fixture",
      bars: Array.from({ length: 3 }, (_, minute) => ({
        t: minute * 60,
        o: 1000 + minute,
        h: 1001 + minute,
        l: 999 + minute,
        c: 1000.5 + minute,
        p: Array.from({ length: 12 }, (_, point) => 1000 + minute + point / 100),
      })),
    },
  };
}

test("the index is revealed exactly like stock bars", () => {
  const source = indexed();
  let state = createMorningState(randomUUID(), plan, source, 0);
  assert.equal(visibleMorningState(state, source).index?.bars.length, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  const one = visibleMorningState(state, source);
  assert.equal(one.index?.bars.length, 1);
  assert.deepEqual(one.index?.bars[0], source.index!.bars[0]);
  assert.equal(one.index?.previousClose, 1000);
  assert.equal(one.index?.name, "加權指數");
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 3000);
  assert.equal(visibleMorningState(state, source).index?.bars.length, 3);
  assert.equal(visibleMorningState(state, source).bars["2330"].length, 3);
});

test("a source without an index reveals none", () => {
  const source = fixture();
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  assert.equal(visibleMorningState(state, source).index, undefined);
});

test("the stored state never contains index bars", () => {
  const source = indexed();
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  assert.equal("index" in state, false);
  assert.equal(JSON.stringify(state).includes("TAIEX"), false);
});

// ── A run made of real trades (a Fubon lesson): matching against the trades, abandon, per-step deltas ──────────────

const CELL = 60_000;
const money = (amount: number) => Math.round(amount * 100) / 100;
/** Trades in every cell from `from` on, at +1 s, +20 s and +45 s, the k-th priced `prices[k]`. */
function everyCell(from: number, prices: readonly number[]): TradeRow[] {
  const rows: TradeRow[] = [];
  for (let cell = from; cell < 90; cell++)
    [1_000, 20_000, 45_000].forEach((offset, k) =>
      rows.push([cell * CELL + offset, prices[k], k + 1, prices[k] - 0.5, prices[k]]),
    );
  return rows;
}
/** The bars a run source carries: from the first traded cell on, quiet cells flat at the previous close. */
function barsFrom(rows: readonly TradeRow[]): Bar[] {
  const bars: Bar[] = [];
  let value = 0;
  let volume = 0;
  for (let cell = 0; cell < 90; cell++) {
    const slice = rows.filter(([ms]) => ms >= cell * CELL && ms < (cell + 1) * CELL);
    const previous = bars.at(-1);
    if (!slice.length) {
      if (previous)
        bars.push({ t: cell * 60, o: previous.c, h: previous.c, l: previous.c, c: previous.c, v: 0, a: previous.a });
      continue;
    }
    for (const [, price, size] of slice) {
      value += price * size;
      volume += size;
    }
    const prices = slice.map((row) => row[1]);
    bars.push({
      t: cell * 60,
      o: prices[0],
      h: Math.max(...prices),
      l: Math.min(...prices),
      c: prices.at(-1)!,
      v: slice.reduce((total, row) => total + row[2], 0),
      a: value / volume,
    });
  }
  return bars;
}
const previousCloses: Record<string, number> = { "2330": 100, "1101": 50, "2603": 30, "2317": 200 };
function runFixture(trades: Record<string, TradeRow[]>, sourceHash = "source-a"): MorningSource {
  const codes = Object.keys(trades);
  return {
    catalog: {
      lessonId: "fubon-20261027-am",
      title: "10/27 早盤",
      date: "2026-10-27",
      start: "09:00",
      end: "10:30",
      maxCursor: 90,
      symbols: codes.map((code) => ({
        code,
        name: code,
        previousClose: previousCloses[code],
        previous5CloseMean: null,
      })),
      context: [],
      strategy: [],
      notices: [],
      videoUrl: null,
      volumeUnit: "lot",
    },
    bars: Object.fromEntries(codes.map((code) => [code, barsFrom(trades[code])])),
    trades,
    sourceHash,
  };
}
/** 2330 trades in every cell; 1101 only once at 09:00:05 (quiet after); 2603 first trades at 09:45:01 (late). */
function dayTrades(): Record<string, TradeRow[]> {
  return {
    "2330": everyCell(0, [100, 101, 100.5]),
    "1101": [[5_000, 50, 2, 49.95, 50]],
    "2603": everyCell(45, [30, 30.5, 30.25]),
  };
}
function taiex(): MorningIndexSeries {
  return {
    code: "TAIEX",
    name: "加權指數",
    previousClose: 23_000,
    source: "fixture",
    bars: Array.from({ length: 90 }, (_, minute) => ({
      t: minute * 60,
      o: 23_000 + minute,
      h: 23_001 + minute,
      l: 22_999 + minute,
      c: 23_000.5 + minute,
      p: Array.from({ length: 12 }, (_, point) => 23_000 + minute + point / 100),
    })),
  };
}
const begin = (source: MorningSource, codes = Object.keys(source.trades!)) =>
  createMorningState(randomUUID(), plan, source, 0, codes);
const advance = (state: MorningStoredState, source: MorningSource) =>
  applyMorningAction(state, action(state, { action: "advance" }), source, state.nextAdvanceAt);
const order = (state: MorningStoredState, source: MorningSource, value: object) =>
  applyMorningAction(state, action(state, { action: "order", ...value }), source, state.nextAdvanceAt);
const advanceTo = (state: MorningStoredState, source: MorningSource, cursor: number) => {
  while (state.cursor < cursor) state = advance(state, source);
  return state;
};
/** Record keys, sorted: keys like "2330" are ordered numerically by JS, so the run's order lives in `state.codes`. */
const keys = (record: object) => Object.keys(record).sort();
const cellRows = (rows: readonly TradeRow[], cell: number) =>
  rows.filter(([ms]) => ms >= cell * CELL && ms < (cell + 1) * CELL);

test("advance never returns trades or bars at or after the cursor", () => {
  const source = { ...runFixture(dayTrades()), index: taiex() };
  const untouched = JSON.stringify(source);
  const codes = ["2330", "1101", "2603"];
  const check = (state: MorningStoredState) => {
    const end = state.cursor * CELL;
    const visible = visibleMorningState(state, source);
    assert.deepEqual(keys(visible.bars), [...codes].sort());
    for (const code of codes) {
      for (const bar of visible.bars[code]) assert.ok(bar.t < state.cursor * 60, `${code} bar ${bar.t}`);
      assert.deepEqual(
        visible.bars[code],
        source.bars[code].filter((bar) => bar.t < state.cursor * 60),
      );
    }
    assert.equal(visible.index!.bars.length, state.cursor);
    for (const bar of visible.index!.bars) assert.ok(bar.t < state.cursor * 60);
    for (const fill of visible.fills) assert.ok(fill.ms! < end);
    const tape = visibleTape(state, source);
    assert.deepEqual(keys(tape), [...codes].sort());
    for (const code of codes) {
      for (const [ms] of tape[code]) assert.ok(ms < end, `${code} trade ${ms}`);
      assert.deepEqual(tape[code], source.trades![code].filter(([ms]) => ms < end).slice(-40));
    }
  };
  let state = begin(source, codes);
  check(state);
  assert.deepEqual(visibleMorningState(state, source).bars, { "2330": [], "1101": [], "2603": [] });
  assert.deepEqual(visibleTape(state, source), { "2330": [], "1101": [], "2603": [] });
  assert.throws(
    () => applyMorningAction(state, action(state, { action: "advance" }), source, state.nextAdvanceAt - 1),
    { status: 429 },
  );
  for (let cursor = 1; cursor <= 90; cursor++) {
    state = advance(state, source);
    assert.equal(state.cursor, cursor, "one cell per advance");
    if (cursor === 10) state = order(state, source, { code: "2330", side: "buy", lots: 1 });
    const cell = cursor - 1;
    const delta = advanceDelta(state, source);
    assert.equal(delta.cell, cell);
    assert.deepEqual(keys(delta.bars), [...codes].sort());
    assert.deepEqual(keys(delta.trades), [...codes].sort());
    for (const code of codes) {
      for (const [ms] of delta.trades[code]) assert.ok(ms >= cell * CELL && ms < cursor * CELL);
      assert.deepEqual(delta.trades[code], cellRows(source.trades![code], cell));
      assert.deepEqual(delta.bars[code], source.bars[code].find((bar) => bar.t === cell * 60) ?? null);
    }
    // A stock with no trade yet has no bar: nothing is revealed for it, and that is not an error.
    if (cell < 45) assert.equal(delta.bars["2603"], null);
    else assert.equal(delta.bars["2603"]!.t, cell * 60);
    assert.deepEqual(delta.index, source.index.bars[cell]);
    assert.equal(delta.book, undefined);
    check(state);
  }
  assert.equal(state.fills.length, 1);
  assert.equal(state.fills[0].ms, 10 * CELL + 1_000);
  assert.equal(JSON.stringify(source), untouched, "the run's cached data is never changed");
});

test("market order waits for a quiet stock and cancels at 10:30 with 之後沒有成交", () => {
  const source = runFixture(dayTrades());
  let state = advance(begin(source), source);
  state = order(state, source, { code: "1101", side: "buy", lots: 1 });
  state = advanceTo(state, source, 89);
  assert.equal(state.orders[0].status, "pending");
  assert.notEqual(state.orders[0].seen, true);
  state = advance(state, source);
  assert.equal(state.cursor, 90);
  assert.equal(state.orders[0].status, "cancelled");
  assert.equal(state.orders[0].reason, "之後沒有成交");
  assert.deepEqual(state.fills, []);
  assert.equal(state.cash, MORNING_STARTING_CASH);
  assert.equal(state.equity, MORNING_STARTING_CASH);
});

test("a market order on a stock that has not traded yet waits for its first trades", () => {
  const source = runFixture(dayTrades());
  let state = advance(begin(source), source);
  state = order(state, source, { code: "2603", side: "buy", lots: 3 });
  state = advanceTo(state, source, 45);
  assert.equal(state.orders[0].status, "pending");
  assert.notEqual(state.orders[0].seen, true);
  state = advance(state, source);
  // 09:45:01 has 1 lot at 30 and 09:45:20 2 lots at 30.5: the 3 lots are complete at the second trade.
  assert.equal(state.orders[0].status, "filled");
  assert.equal(state.fills[0].price, (30 + 61) / 3);
  assert.equal(state.fills[0].ms, 45 * CELL + 20_000);
  assert.deepEqual(state.positions, [{ code: "2603", shares: 3000, averageCost: (30 + 61) / 3 }]);
  assert.equal(state.cash, MORNING_STARTING_CASH - 91_000 - commission(91_000));
});

test("a resting limit that real trades never reach cancels at 10:30 with 教材結束，委託未成交", () => {
  const source = runFixture(dayTrades());
  let state = advance(begin(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 1, limitPrice: 99 });
  state = advance(state, source);
  assert.equal(state.orders[0].seen, true);
  state = advanceTo(state, source, 90);
  assert.equal(state.orders[0].status, "cancelled");
  assert.equal(state.orders[0].reason, "教材結束，委託未成交");
  assert.equal(state.cash, MORNING_STARTING_CASH);
});

test("fill records the real ms", () => {
  const trades = dayTrades();
  // 09:05:20 trades at 99, under the resting limit below.
  trades["2330"] = trades["2330"].map((row) =>
    row[0] === 5 * CELL + 20_000 ? ([row[0], 99, 3, 98.5, 99] as const) : row,
  );
  const source = runFixture(trades);
  let state = advance(begin(source), source);
  // Market, 2 lots: 09:01:01 has 1 lot at 100, 09:01:20 2 lots at 101 of which 1 is needed → 100.5 at 09:01:20.
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advance(state, source);
  assert.deepEqual(state.fills[0], {
    id: state.orders[0].id,
    code: "2330",
    side: "buy",
    shares: 2000,
    price: 100.5,
    fee: commission(201_000),
    tax: 0,
    t: 80,
    ms: 80_000,
  });
  assert.equal(state.orders[0].price, 100.5);
  assert.equal(state.cash, MORNING_STARTING_CASH - 201_000 - commission(201_000));
  // Holdings are valued at the last revealed trade (09:01:45 at 100.5), never at a later one.
  assert.equal(state.equity, money(state.cash + 2000 * 100.5));
  // A limit the first trade after it already beats fills at that trade's price.
  state = order(state, source, { code: "2330", side: "sell", lots: 1, limitPrice: 99.5 });
  state = advance(state, source);
  assert.equal(state.fills[1].price, 100);
  assert.equal(state.fills[1].ms, 2 * CELL + 1_000);
  assert.equal(state.fills[1].t, 121);
  assert.equal(state.fills[1].tax, Math.round(100_000 * DAYTRADE_TAX));
  // A resting limit fills at the limit when a later trade touches it.
  state = order(state, source, { code: "2330", side: "buy", lots: 1, limitPrice: 99.5 });
  state = advance(state, source);
  assert.equal(state.orders[2].status, "pending");
  assert.equal(state.orders[2].seen, true);
  state = advanceTo(state, source, 6);
  assert.equal(state.orders[2].status, "filled");
  assert.equal(state.fills[2].price, 99.5);
  assert.equal(state.fills[2].ms, 5 * CELL + 20_000);
  assert.equal(state.fills[2].t, 320);
  assert.deepEqual(state.positions, [{ code: "2330", shares: 2000, averageCost: 100 }]);
  assert.equal(state.equity, money(state.cash + 2000 * 100.5));
});

test("funds and holdings are checked again at the real fill price", () => {
  const trades = dayTrades();
  // 09:02:01 jumps to 105.
  trades["2330"] = trades["2330"].map((row) =>
    row[0] === 2 * CELL + 1_000 ? ([row[0], 105, 1, 104.5, 105] as const) : row,
  );
  const source = runFixture(trades);
  let state = advanceTo(begin(source), source, 2);
  // Enough for 3 lots at the last revealed 100.5, not at 105.
  state.cash = 302_000;
  state = order(state, source, { code: "2330", side: "buy", lots: 3 });
  state = advance(state, source);
  assert.equal(state.orders[0].status, "rejected");
  assert.equal(state.orders[0].reason, "成交價變動後，模擬資金不足，未成交");
  assert.equal(state.cash, 302_000);
  assert.deepEqual(state.fills, []);
  assert.throws(() => order(state, source, { code: "2330", side: "sell", lots: 1 }), { status: 400 });
});

test("abandon completes without reflection and refuses a second abandon", () => {
  const source = runFixture(dayTrades());
  let state = advanceTo(begin(source), source, 3);
  state = order(state, source, { code: "2330", side: "buy", lots: 1, limitPrice: 95 });
  const before = structuredClone(state);
  const abandon = action(state, { action: "abandon" });
  assert.equal(abandon.action, "abandon");
  state = applyMorningAction(state, abandon, source, state.nextAdvanceAt);
  assert.equal(state.completed, true);
  assert.equal(state.abandoned, true);
  assert.equal(state.reflection, "");
  assert.equal(state.revision, before.revision + 1);
  assert.equal(state.cursor, 3);
  assert.equal(state.orders[0].status, "cancelled");
  assert.ok(state.orders[0].reason);
  assert.equal(state.cash, before.cash);
  assert.deepEqual(state.fills, before.fills);
  const done = { status: 409, message: "這局已經結束" };
  assert.throws(() => applyMorningAction(state, action(state, { action: "abandon" }), source, 9e9), done);
  // Sent again with the revision it was first sent with: still the same answer.
  assert.throws(
    () =>
      applyMorningAction(
        state,
        action(state, { action: "abandon", expectedRevision: before.revision }),
        source,
        9e9,
      ),
    done,
  );
  assert.throws(() => advance(state, source), { status: 409 });
  assert.throws(
    () => applyMorningAction(state, action(state, { action: "finish", reflection: "想補寫復盤" }), source, 9e9),
    { status: 409 },
  );
  // A run finished with a reflection cannot be abandoned afterwards either.
  let finished = advance(begin(source), source);
  finished = applyMorningAction(
    finished,
    action(finished, { action: "finish", reflection: "照計畫觀察。" }),
    source,
    finished.nextAdvanceAt,
  );
  assert.equal(finished.abandoned, undefined);
  assert.throws(() => applyMorningAction(finished, action(finished, { action: "abandon" }), source, 9e9), done);
});

test("sourceHash mismatch → 409", () => {
  const source = runFixture(dayTrades(), "source-a");
  const state = advance(begin(source), source);
  assert.equal(state.sourceHash, "source-a");
  const republished = { ...source, sourceHash: "source-b" };
  const changed = { status: 409, message: "課程版本已變更，請聯絡講師確認這份練習" };
  assert.throws(() => visibleMorningState(state, republished), changed);
  assert.throws(() => advance(state, republished), changed);
  assert.throws(() => advanceDelta(state, republished), changed);
  assert.throws(() => visibleTape(state, republished), changed);
  const unhashed: MorningSource = { ...source };
  delete unhashed.sourceHash;
  assert.throws(() => visibleMorningState(state, unhashed), changed);
  // A run whose stocks the source does not carry is another version too.
  const fewer = runFixture({ "2330": dayTrades()["2330"] }, "source-a");
  assert.throws(() => visibleMorningState(state, fewer), changed);
});

test("visible bars only for chosen codes", () => {
  const source = runFixture({ ...dayTrades(), "2317": everyCell(0, [200, 201, 200.5]) });
  let state = begin(source, ["2603", "2330"]);
  assert.deepEqual(state.codes, ["2603", "2330"]);
  state = advanceTo(state, source, 50);
  const visible = visibleMorningState(state, source);
  assert.deepEqual(keys(visible.bars), ["2330", "2603"]);
  assert.equal(visible.bars["2330"].length, 50);
  assert.equal(visible.bars["2603"].length, 5);
  assert.equal(visible.bars["2603"][0].t, 45 * 60);
  // The source's session average is kept.
  assert.equal(visible.bars["2330"][0].a, source.bars["2330"][0].a);
  assert.ok(Number.isFinite(visible.bars["2330"][0].a));
  assert.deepEqual(keys(advanceDelta(state, source).bars), ["2330", "2603"]);
  assert.deepEqual(keys(advanceDelta(state, source).trades), ["2330", "2603"]);
  assert.deepEqual(keys(visibleTape(state, source)), ["2330", "2603"]);
  assert.throws(() => order(state, source, { code: "2317", side: "buy", lots: 1 }), { status: 400 });
  // Revealed bars are copies: changing them leaves the run's data alone.
  visible.bars["2330"][0].c = 1;
  advanceDelta(state, source).bars["2330"]!.c = 1;
  visibleTape(state, source)["2330"].length = 0;
  assert.equal(source.bars["2330"][0].c, 100.5);
  assert.equal(source.bars["2330"][49].c, 100.5);
  assert.equal(source.trades!["2330"].length, 270);
});

test("start carries 1–80 codes, advance may name a view, and abandon is an action of its own", () => {
  const start = { action: "start", requestId: randomUUID(), plan, codes: ["2330", "2603"] };
  assert.deepEqual(parseMorningAction(start), start);
  const withoutCodes: Record<string, unknown> = { ...start };
  delete withoutCodes.codes;
  for (const bad of [
    withoutCodes,
    { ...start, codes: [] },
    { ...start, codes: Array.from({ length: 81 }, (_, index) => String(1000 + index)) },
    { ...start, codes: ["23"] },
    { ...start, codes: "2330" },
  ])
    assert.throws(() => parseMorningAction(bad), { status: 400 });
  assert.equal(
    parseMorningAction({ ...start, codes: Array.from({ length: 80 }, (_, index) => String(1000 + index)) }).action,
    "start",
  );
  const existing = { requestId: randomUUID(), id: randomUUID(), expectedRevision: 3 };
  assert.deepEqual(parseMorningAction({ action: "advance", ...existing, view: "2330" }), {
    action: "advance",
    ...existing,
    view: "2330",
  });
  for (const view of ["", "x", 2330]) assert.throws(() => parseMorningAction({ action: "advance", ...existing, view }));
  assert.deepEqual(parseMorningAction({ action: "abandon", ...existing }), { action: "abandon", ...existing });
  assert.throws(() => parseMorningAction({ action: "abandon", ...existing, reflection: "不需要" }), { status: 400 });
  // Codes go into the run; a code the lesson does not have, or a repeat, is refused.
  const source = runFixture(dayTrades());
  assert.throws(() => createMorningState(randomUUID(), plan, source, 0, ["2330", "9999"]), { status: 400 });
  assert.throws(() => createMorningState(randomUUID(), plan, source, 0, ["2330", "2330"]), { status: 400 });
  assert.deepEqual(createMorningState(randomUUID(), plan, source, 0, ["1101", "2330"]).codes, ["1101", "2330"]);
  // A source without trades (an old lesson) keeps runs without a hash.
  assert.equal("sourceHash" in createMorningState(randomUUID(), plan, fixture(), 0, ["2330"]), false);
});

// ── 量夠才成交 (lot design 2026-10-30): 1–400 lots, lots counted across cells, an average price, a third reason ──────

test("an order is 1 to 400 lots: 400 is accepted, 401 is not", () => {
  const source = runFixture(dayTrades());
  let state = advance(begin(source), source);
  for (const lots of [0, 401, 1000, 2.5])
    assert.throws(() => order(state, source, { code: "2330", side: "buy", lots }), { status: 400 });
  // 400 lots of 2330 at about 100 is 40 M: refused for the cash, not for the size.
  assert.throws(() => order(state, source, { code: "2330", side: "buy", lots: 400 }), {
    status: 400,
    message: "目前模擬資金不足，無法委託",
  });
  state.cash = 50_000_000;
  state = order(state, source, { code: "2330", side: "buy", lots: 400 });
  assert.equal(state.orders[0].shares, 400_000);
  assert.equal(state.orders[0].status, "pending");
});

test("the ticket's cash check and the classroom's agree to the cent: the fee counts", () => {
  const source = runFixture(dayTrades());
  const state = advance(begin(source), source);
  // The first minute's last 2330 trade is at 100.5: ten lots at market are 1,005,000 before the fee.
  const amount = 10 * 1000 * 100.5;
  for (const [cash, refused] of [
    [amount + commission(amount), false],
    [amount + commission(amount) - 0.01, true],
    [amount, true],
  ] as const) {
    assert.equal(exceedsCash({ side: "buy", amount, availableCash: cash }), refused, String(cash));
    const send = () => order({ ...state, cash }, source, { code: "2330", side: "buy", lots: 10 });
    if (refused) assert.throws(send, { status: 400, message: "目前模擬資金不足，無法委託" });
    else assert.equal(send().orders[0].status, "pending");
  }
});

test("a large order counts real lots cell by cell, keeps them in the saved run, and fills at the average when they are complete", () => {
  const source = runFixture(dayTrades());
  let state = advance(begin(source), source);
  // 2330 trades 1 lot at 100, 2 at 101 and 3 at 100.5 a minute (6 lots, 603.5); 20 lots need cells 1–3 and 2 lots of
  // cell 4 (1 at 100, 1 of the 2 at 101).
  state = order(state, source, { code: "2330", side: "buy", lots: 20 });
  for (const counted of [6, 12, 18]) {
    state = advance(state, source);
    // What is saved is all the next advance has: the run goes through JSON as it does in the database.
    state = JSON.parse(JSON.stringify(state));
    assert.equal(state.orders[0].status, "pending");
    assert.equal(state.orders[0].filledLots, counted);
    assert.equal(state.orders[0].filledValue, (counted / 6) * 603.5);
    assert.equal(state.orders[0].seen, true);
    assert.equal(state.fills.length, 0);
    assert.equal(state.cash, MORNING_STARTING_CASH);
  }
  state = advance(state, source);
  const value = 3 * 603.5 + 100 + 101;
  assert.equal(state.orders[0].status, "filled");
  assert.equal(state.orders[0].price, value / 20);
  assert.equal(state.fills[0].price, value / 20);
  assert.equal(state.fills[0].ms, 4 * CELL + 20_000);
  assert.equal(state.fills[0].t, 4 * 60 + 20);
  const notional = money(20_000 * (value / 20));
  assert.equal(state.cash, money(MORNING_STARTING_CASH - notional - commission(notional)));
  assert.deepEqual(state.positions, [{ code: "2330", shares: 20_000, averageCost: value / 20 }]);
  // A filled order keeps no progress of its own: the fill is the result.
  assert.equal(state.orders[0].filledLots, undefined);
  assert.equal(state.orders[0].filledValue, undefined);
});

test("a marketable limit fills at an average no worse than its limit; a resting one counts the touching trades and fills at its limit", () => {
  const source = runFixture(dayTrades());
  let state = advanceTo(begin(source), source, 2);
  // Buy 5 at 100: the first trade after it (09:02:01, 100) touches, so it takes the average of the touching trades,
  // 1 lot a minute at 100, and fills at 100 at 09:06:01.
  state = order(state, source, { code: "2330", side: "buy", lots: 5, limitPrice: 100 });
  state = advanceTo(state, source, 6);
  assert.equal(state.orders[0].status, "pending");
  assert.equal(state.orders[0].filledLots, 4);
  assert.equal(state.orders[0].atLimit, undefined);
  state = advance(state, source);
  assert.equal(state.orders[0].status, "filled");
  assert.equal(state.fills[0].price, 100);
  assert.equal(state.fills[0].ms, 6 * CELL + 1_000);
  // Sell 6 at 100.5: the first trade after it (09:08:01, 100) does not touch, so it rests at its limit and counts the
  // 101s (2 lots) and the 100.5s (3 lots), 5 a minute; the 6th lot is 09:09:20's 101, and it sells at 100.5.
  state.cash = 50_000_000;
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advance(state, source);
  assert.equal(state.orders[1].status, "filled");
  state = order(state, source, { code: "2330", side: "sell", lots: 6, limitPrice: 100.5 });
  state = advance(state, source);
  assert.equal(state.orders[2].atLimit, true);
  assert.equal(state.orders[2].filledLots, 5);
  state = advance(state, source);
  assert.equal(state.orders[2].status, "filled");
  assert.equal(state.fills[2].price, 100.5);
  assert.equal(state.fills[2].ms, 9 * CELL + 20_000);
});

test("an order that touched its price but never had the lots is cancelled at 10:30 with 成交量不足", () => {
  const source = runFixture(dayTrades());
  let state = advance(begin(source), source);
  state.cash = 50_000_000;
  // Only 1 lot a minute trades at 100 or under: 89 lots by 10:30, not 400.
  state = order(state, source, { code: "2330", side: "buy", lots: 400, limitPrice: 100 });
  state = advanceTo(state, source, 90);
  assert.equal(state.orders[0].status, "cancelled");
  assert.equal(state.orders[0].reason, "成交量不足");
  assert.equal(state.orders[0].filledLots, 89);
  assert.deepEqual(state.fills, []);
  assert.equal(state.cash, 50_000_000);
  // A market order short of lots says the same (5 cells × 6 lots = 30 of 400).
  let market = advanceTo(begin(source), source, 85);
  market.cash = 50_000_000;
  market = order(market, source, { code: "2330", side: "buy", lots: 400 });
  market = advanceTo(market, source, 90);
  assert.equal(market.orders[0].reason, "成交量不足");
  assert.equal(market.orders[0].filledLots, 30);
});

test("funds are checked again at the fill, at the average price actually paid", () => {
  const trades = dayTrades();
  // 09:02 jumps: 105 (1 lot), 106 (2), 107 (3).
  trades["2330"] = trades["2330"].map((row) =>
    row[0] >= 2 * CELL && row[0] < 3 * CELL ? ([row[0], 104 + row[2], row[2], 103.5, 104 + row[2]] as const) : row,
  );
  const source = runFixture(trades);
  let state = advanceTo(begin(source), source, 2);
  // 10 lots at the last revealed 100.5 is 1,005,000; the 6 lots of 09:02 and 4 of 09:03 average
  // (105 + 212 + 321 + 100 + 202 + 100.5) / 10 = 104.05, so 1,040,500 is needed at the fill.
  state.cash = money(1_005_000 + commission(1_005_000) + 1);
  state = order(state, source, { code: "2330", side: "buy", lots: 10 });
  state = advanceTo(state, source, 4);
  assert.equal(state.orders[0].status, "rejected");
  assert.equal(state.orders[0].reason, "成交價變動後，模擬資金不足，未成交");
  assert.deepEqual(state.fills, []);
  // With the cash for the average and not a cent more, the same order fills and spends exactly that.
  const atFill = money(10_000 * (1040.5 / 10));
  let enough = advanceTo(begin(source), source, 2);
  enough.cash = money(atFill + commission(atFill));
  enough = order(enough, source, { code: "2330", side: "buy", lots: 10 });
  enough = advanceTo(enough, source, 4);
  assert.equal(enough.orders[0].status, "filled");
  assert.equal(enough.fills[0].price, 1040.5 / 10);
  assert.equal(enough.cash, 0);
});

test("matching never reads a trade the advance does not reveal: a source cut after the revealed cell gives the same run", () => {
  const trades = dayTrades();
  const full = runFixture(trades);
  const cut = (cursor: number): MorningSource => {
    const kept = Object.fromEntries(
      Object.entries(trades).map(([code, rows]) => [code, rows.filter(([ms]) => ms < cursor * CELL)]),
    );
    const bars = Object.fromEntries(
      Object.entries(full.bars).map(([code, rows]) => [code, rows.filter((bar) => bar.t < cursor * 60)]),
    );
    return { ...full, bars, trades: kept };
  };
  let state = advance(begin(full), full);
  state.cash = 50_000_000;
  const orders: Record<number, object> = {
    1: { code: "2330", side: "buy", lots: 400 },
    80: { code: "2330", side: "sell", lots: 150, limitPrice: 101 },
  };
  for (let cursor = 1; cursor < 90; cursor++) {
    if (orders[cursor]) state = order(state, full, orders[cursor]);
    const next = advance(state, full);
    // The advance from `cursor` reveals cell `cursor`: on a source that ends with that cell it is the same run.
    const blind = applyMorningAction(state, action(state, { action: "advance" }), cut(cursor + 1), state.nextAdvanceAt);
    assert.deepEqual(blind, next, `advance from ${cursor}`);
    state = next;
  }
  assert.equal(state.orders[0].status, "filled");
  assert.equal(state.orders[1].status, "cancelled");
  assert.equal(state.orders[1].reason, "成交量不足");
});

// 自動出場 (2026-11-02): the plan's 停利／停損 sell the whole holding at market once a real trade reaches either.
// The plan the 自動出場 tests use (ticks since 2026-11-09): 停利 最低獲利檔 +3 檔, 停損 10 檔.
const exitPlan: MorningPlan = { ...plan, exit: { takeProfitTicks: 3, stopLossTicks: 10 } };
const beginExit = (source: MorningSource, codes = Object.keys(source.trades!)) =>
  createMorningState(randomUUID(), exitPlan, source, 0, codes);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 2330 with one trade of cell `cell` (at +1 s, +20 s or +45 s) changed to `price` × `lots`. */
function withTrade(cell: number, offset: number, price: number, lots: number): Record<string, TradeRow[]> {
  const trades = dayTrades();
  trades["2330"] = trades["2330"].map((row) =>
    row[0] === cell * CELL + offset ? ([row[0], price, lots, price - 0.5, price] as const) : row,
  );
  return trades;
}

test("a plan's 自動出場 is optional and takes only the listed ticks", () => {
  const start = { action: "start", requestId: randomUUID(), plan: exitPlan, codes: ["2330"] };
  assert.deepEqual(parseMorningAction(start), start);
  for (const exit of [
    { takeProfitTicks: 11, stopLossTicks: 10 },
    { takeProfitTicks: 3, stopLossTicks: 7 },
    { takeProfitTicks: 2.5, stopLossTicks: 10 },
    { takeProfitTicks: 3 },
    { takeProfitTicks: 3, stopLossTicks: 10, trailing: true },
    // The percentages before 2026-11-09 are no longer taken.
    { takeProfitPct: 1.5, stopLossPct: 1 },
  ])
    assert.throws(() => parseMorningAction({ ...start, plan: { ...plan, exit } }), { status: 400 });
});

test("buying at 漲停 arms no 停利, so nothing is sold at once at a loss", () => {
  // 2330's 漲停 from 100 is 110: every trade of 09:02 on is at 110.
  const trades = dayTrades();
  trades["2330"] = trades["2330"].map((row) => (row[0] >= 2 * CELL ? ([row[0], 110, row[2], 109.5, 110] as const) : row));
  const source = runFixture(trades);
  let state = advanceTo(beginExit(source), source, 2);
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advanceTo(state, source, 10);
  assert.equal(state.orders.length, 1);
  assert.deepEqual(state.positions[0].exit, { takeProfit: null, stopLoss: 105, takeProfitTicks: 3, fromMs: 2 * CELL + 1_000 });
});

test("a buy fill arms the plan's exit at the holding's average, on the tick grid, from the fill's trade on", () => {
  const source = runFixture(dayTrades());
  let state = advance(beginExit(source), source);
  // 2 lots at market: 100 × 1 + 101 × 1 → 100.5 at 09:01:20.
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advance(state, source);
  assert.deepEqual(state.positions, [
    { code: "2330", shares: 2000, averageCost: 100.5, exit: { ...exitPrices(100.5, exitPlan.exit!, 100, { shares: 2000, buyFees: 172 }), takeProfitTicks: 3, fromMs: CELL + 20_000 } },
  ]);
  // Fees 172: 最低獲利檔 101, +3 ticks of 0.5 → 102.5; 10 ticks under 100.5 → 100, 99.9 … 99.1.
  assert.deepEqual(state.positions[0].exit, { takeProfit: 102.5, stopLoss: 99.1, takeProfitTicks: 3, fromMs: CELL + 20_000 });
  // 100–101 never reaches either: nothing is sold by itself.
  state = advanceTo(state, source, 30);
  assert.equal(state.orders.length, 1);
  assert.equal(state.positions[0].shares, 2000);
  assert.equal(visibleMorningState(state, source).positions[0].exit?.takeProfit, 102.5);
});

test("a trade at 停利 sells the whole holding at market from that trade on, as the classroom's own order", () => {
  const source = runFixture(withTrade(5, 20_000, 102.5, 3));
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advanceTo(state, source, 6);
  const exit = state.orders[1];
  assert.match(exit.id, UUID);
  assert.notEqual(exit.id, state.orders[0].id);
  assert.deepEqual(
    { side: exit.side, shares: exit.shares, status: exit.status, auto: exit.auto, triggerPrice: exit.triggerPrice, submittedCursor: exit.submittedCursor, price: exit.price },
    { side: "sell", shares: 2000, status: "filled", auto: "takeProfit", triggerPrice: 102.5, submittedCursor: 5, price: 102.5 },
  );
  assert.equal(exit.limitPrice, undefined);
  assert.deepEqual(state.fills[1], {
    id: exit.id,
    code: "2330",
    side: "sell",
    shares: 2000,
    price: 102.5,
    fee: commission(205_000),
    tax: Math.round(205_000 * DAYTRADE_TAX),
    t: 5 * 60 + 20,
    ms: 5 * CELL + 20_000,
  });
  assert.deepEqual(state.positions, []);
  // Bought again, the exit is armed again; the run goes on as before.
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advance(state, source);
  assert.equal(state.positions[0].exit?.fromMs, 6 * CELL + 1_000);
});

test("a trade at or under 停損 sells at market: the average of the lots from that trade on", () => {
  // 09:07:20 trades 1 lot at 99, under 99.1; the market sell takes it and 1 of the 3 lots at 100.5 after.
  const source = runFixture(withTrade(7, 20_000, 99, 1));
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advanceTo(state, source, 8);
  assert.equal(state.orders[1].auto, "stopLoss");
  assert.equal(state.orders[1].triggerPrice, 99);
  assert.equal(state.fills[1].price, 99.75);
  assert.equal(state.fills[1].ms, 7 * CELL + 45_000);
  assert.deepEqual(state.positions, []);
});

test("trades before the buy's fill never fire its exit; the ones after it in the same minute do", () => {
  // 09:03: 105 at +1 s (before the fill), the limit's 99.5 at +20 s (the fill), 100.5 at +45 s (between).
  const trades = withTrade(3, 1_000, 105, 1);
  trades["2330"] = trades["2330"].map((row) =>
    row[0] === 3 * CELL + 20_000 ? ([row[0], 99.5, 1, 99, 99.5] as const) : row,
  );
  const source = runFixture(trades);
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 1, limitPrice: 99.5 });
  state = advanceTo(state, source, 4);
  assert.equal(state.fills[0].price, 99.5);
  // 99.5 (fee 85) → 最低獲利檔 99.9, +3 ticks → 100, 100.5, 101; 10 ticks under → 98.5.
  assert.deepEqual(state.positions[0].exit, { takeProfit: 101, stopLoss: 98.5, takeProfitTicks: 3, fromMs: 3 * CELL + 20_000 });
  assert.equal(state.orders.length, 1);
  // 09:04:20 trades at 101.
  state = advance(state, source);
  assert.equal(state.orders[1].auto, "takeProfit");
  assert.equal(state.fills[1].price, 101);
  assert.equal(state.fills[1].ms, 4 * CELL + 20_000);
});

test("a second buy figures the exit again from the new average; a sell by hand keeps it, and selling all drops it", () => {
  const source = runFixture(dayTrades());
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advance(state, source);
  // 1 at 100 (fee 86): 最低獲利檔 100.5, +3 ticks → 102; 10 ticks under → 99.
  assert.deepEqual(state.positions[0].exit, { takeProfit: 102, stopLoss: 99, takeProfitTicks: 3, fromMs: CELL + 1_000 });
  // 2 more at 100.5: (100 + 201) / 3 = 100.333…, fees 258; 最低獲利檔 101, +3 → 102.5; 10 under 100.5 → 99.1.
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advance(state, source);
  assert.deepEqual(state.positions[0].exit, { takeProfit: 102.5, stopLoss: 99.1, takeProfitTicks: 3, fromMs: 2 * CELL + 20_000 });
  state = order(state, source, { code: "2330", side: "sell", lots: 1 });
  state = advance(state, source);
  assert.equal(state.positions[0].shares, 2000);
  assert.deepEqual(state.positions[0].exit, { takeProfit: 102.5, stopLoss: 99.1, takeProfitTicks: 3, fromMs: 2 * CELL + 20_000 });
  state = order(state, source, { code: "2330", side: "sell", lots: 2 });
  state = advanceTo(state, source, 90);
  assert.deepEqual(state.positions, []);
  assert.equal(state.orders.filter((item) => item.auto).length, 0);
});

test("a learner's waiting sell of the stock gives way when its exit fires", () => {
  const source = runFixture(withTrade(5, 20_000, 102.5, 3));
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advance(state, source);
  state = order(state, source, { code: "2330", side: "sell", lots: 2, limitPrice: 103 });
  state = advanceTo(state, source, 6);
  assert.equal(state.orders[1].status, "cancelled");
  assert.equal(state.orders[1].reason, EXIT_CANCEL);
  assert.equal(state.orders[2].auto, "takeProfit");
  assert.equal(state.orders[2].status, "filled");
  assert.deepEqual(state.positions, []);
});

test("an exit that fires before the learner's waiting sell of the stock would fill goes first and cancels it", () => {
  // Holding 2 at 100.5 (停損 99.1); a limit sell at 101 waits. 09:05: 99 at +1 s fires the 停損, 101 at +20 s would
  // have filled the sell.
  const trades = withTrade(5, 1_000, 99, 1);
  const source = runFixture(trades);
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advanceTo(state, source, 2);
  state = order(state, source, { code: "2330", side: "sell", lots: 2, limitPrice: 101.5 });
  state = advanceTo(state, source, 5);
  // 101.5 was never reached before 09:05; now make 09:05:20 reach it after the 停損.
  const later = runFixture(
    Object.fromEntries(Object.entries(trades).map(([code, rows]) => [
      code,
      code === "2330" ? rows.map((row) => (row[0] === 5 * CELL + 20_000 ? ([row[0], 101.5, 2, 101, 101.5] as const) : row)) : rows,
    ])),
  );
  state = advance(state, later);
  assert.equal(state.orders[1].status, "cancelled");
  assert.equal(state.orders[1].reason, EXIT_CANCEL);
  assert.equal(state.orders[2].auto, "stopLoss");
  assert.equal(state.orders[2].status, "filled");
  assert.equal(state.fills.at(-1)?.id, state.orders[2].id);
});

test("an exit that fires at the trade that would fill the learner's waiting buy of the stock goes first; the buy is cancelled, never blended", () => {
  // Holding 1 at 100 (停損 99); a limit buy at 99 waits. 09:05:01 trades 98.9: it reaches the 停損 and would fill the
  // buy, which would move the average and the exit past the 停損 already reached.
  const trades = withTrade(5, 1_000, 98.9, 1);
  const source = runFixture(trades);
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advanceTo(state, source, 2);
  assert.equal(state.positions[0].exit?.stopLoss, 99);
  state = order(state, source, { code: "2330", side: "buy", lots: 1, limitPrice: 99 });
  state = advanceTo(state, source, 6);
  assert.equal(state.orders[1].status, "cancelled");
  assert.equal(state.orders[1].reason, EXIT_CANCEL);
  assert.equal(state.orders[2].auto, "stopLoss");
  assert.deepEqual(state.positions, []);
});

test("a learner's order that fills before the exit's trade goes first: a buy moves the average and the exit with it", () => {
  // Holding 1 at 100 (停利 102). 09:03:01 trades 5 lots at 100: a limit buy of 2 at 100 fills there; the average
  // stays 100 and the exit is figured again from that trade on. 101 at +20 s is under 102: no exit.
  const source = runFixture(withTrade(3, 1_000, 100, 5));
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advanceTo(state, source, 3);
  state = order(state, source, { code: "2330", side: "buy", lots: 2, limitPrice: 100 });
  state = advance(state, source);
  assert.equal(state.orders[1].status, "filled");
  assert.deepEqual(state.positions[0].exit, { takeProfit: 102, stopLoss: 99, takeProfitTicks: 3, fromMs: 3 * CELL + 1_000 });
  assert.equal(state.orders.length, 2);
});

test("an exit short of lots waits like a market order: the learner may still trade other stocks, not this one, and it ends at 10:30", () => {
  // 2330 trades until 09:06 only; at 09:06:01 1 lot at 99 fires the 停損 of 20 lots, and 6 lots are all there are.
  const trades = withTrade(6, 1_000, 99, 1);
  trades["2330"] = trades["2330"].filter(([ms]) => ms < 7 * CELL);
  const source = runFixture(trades);
  let state = advance(beginExit(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 20 });
  state = advanceTo(state, source, 7);
  // (3 × 603.5 + 100 + 101) / 20 = 100.575: 10 ticks under 101 (the first tick over it) → 99.2.
  assert.equal(state.positions[0].exit?.stopLoss, 99.2);
  const exit = state.orders[1];
  assert.equal(exit.auto, "stopLoss");
  assert.equal(exit.status, "pending");
  assert.equal(exit.filledLots, 6);
  for (const side of ["sell", "buy"])
    assert.throws(() => order(state, source, { code: "2330", side, lots: 1 }), {
      status: 409,
      message: "這檔正在自動出場，請等它成交",
    });
  assert.throws(
    () => applyMorningAction(state, action(state, { action: "cancel", orderId: exit.id }), source, state.nextAdvanceAt),
    { status: 409 },
  );
  state = order(state, source, { code: "1101", side: "buy", lots: 1 });
  assert.equal(state.orders[2].status, "pending");
  state = advanceTo(state, source, 90);
  assert.equal(state.orders[1].status, "cancelled");
  assert.equal(state.orders[1].reason, VOLUME_CANCEL);
  assert.equal(state.positions[0].shares, 20_000);
});

test("a plan without 自動出場 never sells by itself", () => {
  const source = runFixture(withTrade(5, 20_000, 102.5, 3));
  let state = advance(begin(source), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 2 });
  state = advanceTo(state, source, 90);
  assert.equal(state.orders.length, 1);
  assert.equal(state.positions[0].exit, undefined);
});

test("an old lesson's exit fires on a minute's open and fills at that open", () => {
  const source = fixture();
  let state = createMorningState(randomUUID(), exitPlan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  state = applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 1 }), source, 1100);
  // Opens are 100 + minute: bought at 09:01's 101; 101 (fee 86): 最低獲利檔 101.5, +3 ticks → 103, 09:03's open.
  for (let now = 2000; state.cursor < 4; now += 1000)
    state = applyMorningAction(state, action(state, { action: "advance" }), source, now);
  assert.deepEqual(state.positions, []);
  assert.equal(state.orders[1].auto, "takeProfit");
  assert.equal(state.fills[1].price, 103);
  assert.equal(state.fills[1].t, 180);
});

test("with 自動出場 matching still never reads a trade the advance does not reveal", () => {
  const trades = withTrade(40, 20_000, 99, 2);
  const full = runFixture(trades);
  const cut = (cursor: number): MorningSource => ({
    ...full,
    bars: Object.fromEntries(Object.entries(full.bars).map(([code, rows]) => [code, rows.filter((bar) => bar.t < cursor * 60)])),
    trades: Object.fromEntries(Object.entries(trades).map(([code, rows]) => [code, rows.filter(([ms]) => ms < cursor * CELL)])),
  });
  let state = advance(beginExit(full), full);
  for (let cursor = 1; cursor < 90; cursor++) {
    if (cursor === 1 || cursor === 50) state = order(state, full, { code: "2330", side: "buy", lots: 2 });
    const next = advance(state, full);
    const blind = applyMorningAction(state, action(state, { action: "advance" }), cut(cursor + 1), state.nextAdvanceAt);
    assert.deepEqual(blind, next, `advance from ${cursor}`);
    state = next;
  }
  assert.deepEqual(
    state.orders.map((item) => item.auto ?? "learner"),
    ["learner", "stopLoss", "learner"],
  );
});

test("with the default 最低獲利檔 a buy arms 停利 at the first tick that pays both fees and the tax, and sells there", () => {
  // 2026-11-08, 石大哥: 「請改最低的tick(可cover手續費和證交稅)」. 1 lot at 100 (fee 86): 100.5 nets 100,263 > 100,086.
  const source = runFixture(dayTrades());
  let state = advance(createMorningState(randomUUID(), { ...plan, exit: { ...DEFAULT_EXIT } }, source, 0, Object.keys(source.trades!)), source);
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advance(state, source);
  assert.equal(state.fills[0].price, 100);
  // 09:01:20 trades at 101, over 100.5: sold at once, the round trip after fees and tax in the black.
  assert.equal(state.orders[1]?.auto, "takeProfit");
  assert.equal(state.orders[1]?.triggerPrice, 101);
  assert.deepEqual(state.positions, []);
  assert.ok(state.cash > 10_000_000, `cash ${state.cash}`);
});

test("最低獲利檔 is figured from the fees the holding paid: a second buy at another price moves it", () => {
  // 1 lot at 100.5 at 09:02:45 (a limit), fee 86: 停利 101 (100.5 nets 100,263 − 100,586 short; 101 nets 100,762).
  const trades = dayTrades();
  trades["2330"] = trades["2330"].map((row) => (row[0] >= 3 * CELL ? ([row[0], 100.5, row[2], 100, 100.5] as const) : row));
  const source = runFixture(trades);
  let state = advanceTo(createMorningState(randomUUID(), { ...plan, exit: { ...DEFAULT_EXIT } }, source, 0, ["2330"]), source, 3);
  state = order(state, source, { code: "2330", side: "buy", lots: 1 });
  state = advance(state, source);
  assert.equal(state.positions[0].averageCost, 100.5);
  assert.equal(state.positions[0].exit?.takeProfit, exitPrices(100.5, DEFAULT_EXIT, 100, { shares: 1000, buyFees: state.fills[0].fee }).takeProfit);
  assert.equal(state.positions[0].exit?.takeProfit, 101);
});
