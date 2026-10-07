import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyMorningAction, createMorningState, parseMorningAction, visibleMorningState,
  MORNING_STARTING_CASH, type MorningSource, type MorningStoredState } from "./morning-engine.ts";
import type { MorningAction, MorningPlan } from "./morning.ts";
import { commission, DAYTRADE_TAX } from "./market/ticks.ts";

const plan: MorningPlan = { bias: "observe", focusCode: "2330", reason: "先觀察市場", entry: "等自己的條件成立", stop: "理由不成立就離場" };
function fixture(): MorningSource {
  return {
    catalog: { lessonId: "test-immutable-v1", title: "fixture", date: "2026-10-06", start: "09:00", end: "10:30", maxCursor: 90,
      symbols: [{ code: "2330", name: "fixture", previousClose: 99, previous5CloseMean: 98 }], context: [], strategy: [], notices: [], videoUrl: null },
    bars: { "2330": Array.from({ length: 90 }, (_, minute) => ({ t: minute * 60, o: 100 + minute, h: 200 + minute, l: 90 + minute, c: 101 + minute, v: 1 })) },
  };
}
function action(state: MorningStoredState, value: object): Exclude<MorningAction, { action: "start" }> {
  return parseMorningAction({ id: state.id, expectedRevision: state.revision, requestId: randomUUID(), ...value }) as Exclude<MorningAction, { action: "start" }>;
}

test("exercise selection is optional for legacy plans and restricted to the six reviewed lessons", () => {
  const source = fixture();
  const start = { action: "start", requestId: randomUUID(), plan };
  assert.deepEqual(parseMorningAction(start), start);
  for (const exerciseId of ["first-order", "position", "exit", "n-breakout", "patience", "review"] as const) {
    const parsed = parseMorningAction({ ...start, plan: { ...plan, exerciseId } });
    assert.equal(parsed.action, "start");
    if (parsed.action !== "start") throw new Error("Expected a start action");
    const state = createMorningState(randomUUID(), parsed.plan, source, 0);
    assert.equal(state.plan.exerciseId, exerciseId);
    assert.equal(visibleMorningState(state, source).plan.exerciseId, exerciseId);
  }
  for (const exerciseId of ["", "tycoon", "future-course", 1, null])
    assert.throws(() => parseMorningAction({ ...start, plan: { ...plan, exerciseId } }), { status: 400 });
});
test("replay exposes only completed minutes and rejects client progress or policy overrides", () => {
  const source = fixture();
  const state = createMorningState(randomUUID(), plan, source, 1000);
  assert.equal(state.cash, MORNING_STARTING_CASH);
  assert.deepEqual(visibleMorningState(state, source).bars["2330"], []);
  assert.equal(Object.hasOwn(state, "bars"), false);
  for (const extra of [{ cursor: 90 }, { now: 999999 }, { speed: 100 }, { userId: "owner" }, { bars: source.bars }])
    assert.throws(() => parseMorningAction({ ...action(state, { action: "advance" }), ...extra }));
  assert.throws(() => applyMorningAction(state, action(state, { action: "advance" }), source, 1999), { status: 429 });
  const first = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  assert.equal(first.cursor, 1); assert.equal(first.revision, 1); assert.equal(first.nextAdvanceAt, 3000);
  assert.deepEqual(visibleMorningState(first, source).bars["2330"], [source.bars["2330"][0]]);
  assert.equal(state.cursor, 0);
  assert.throws(() => applyMorningAction(first, action(first, { action: "advance", expectedRevision: 0 }), source, 3000), { status: 409 });
  const altered = structuredClone(source); altered.bars["2330"][89].c = 123;
  assert.deepEqual(visibleMorningState(first, altered), visibleMorningState(first, source));
});

test("long-only orders wait for the next OPEN and apply stated paper costs without intraminute inference", () => {
  const source = fixture();
  let state = createMorningState(randomUUID(), plan, source, 0);
  assert.throws(() => applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 1 }), source, 1));
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  for (const lots of [0, 1.5, 4, -1]) assert.throws(() => action(state, { action: "order", code: "2330", side: "buy", lots }));
  assert.throws(() => applyMorningAction(state, action(state, { action: "order", code: "2330", side: "sell", lots: 1 }), source, 1100), { status: 400 });
  state = applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 2 }), source, 1100);
  assert.equal(state.orders[0].status, "pending"); assert.equal(state.orders[0].price, undefined); assert.deepEqual(state.fills, []);
  assert.throws(() => applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 1 }), source, 1200), { status: 409 });
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  const buyNotional = 101 * 2000;
  assert.equal(state.orders[0].price, 101);
  assert.equal(state.fills[0].t, 60);
  assert.equal(state.cash, MORNING_STARTING_CASH - buyNotional - commission(buyNotional));
  assert.equal(state.equity, state.cash + 102 * 2000);
  assert.deepEqual(state.positions, [{ code: "2330", shares: 2000, averageCost: 101 }]);
  state = applyMorningAction(state, action(state, { action: "order", code: "2330", side: "sell", lots: 1 }), source, 2100);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 3000);
  assert.equal(state.fills[1].price, 102);
  assert.equal(state.fills[1].tax, Math.round(102000 * DAYTRADE_TAX));
  assert.equal(state.positions[0].shares, 1000);
  state = applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 1 }), source, 3100);
  const beforeFinish = structuredClone(state);
  state = applyMorningAction(state, action(state, { action: "finish", reflection: "觀察與原先判斷不同，保留持倉做復盤。" }), source, 3200);
  assert.equal(state.completed, true); assert.equal(state.cursor, 3);
  assert.equal(state.orders.at(-1)?.status, "cancelled");
  assert.deepEqual(state.positions, beforeFinish.positions); assert.deepEqual(state.fills, beforeFinish.fills);
  assert.equal(state.cash, beforeFinish.cash); assert.equal(state.equity, beforeFinish.equity);
  assert.throws(() => applyMorningAction(state, action(state, { action: "advance" }), source, 4000), { status: 409 });
});

test("price gaps reject unaffordable fills, cancellation preserves money, and minute 90 requires reflection", () => {
  const source = fixture();
  source.bars["2330"][1] = { t: 60, o: 5000, h: 5001, l: 4900, c: 4950, v: 0 };
  let state = createMorningState(randomUUID(), plan, source, 0);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 1000);
  state = applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 3 }), source, 1100);
  state = applyMorningAction(state, action(state, { action: "advance" }), source, 2000);
  assert.equal(state.orders[0].status, "rejected"); assert.equal(state.cash, MORNING_STARTING_CASH);
  assert.deepEqual(state.fills, []); assert.deepEqual(state.positions, []);
  const normal = fixture();
  state = applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 1 }), normal, 2200);
  state = applyMorningAction(state, action(state, { action: "cancel", orderId: state.orders.at(-1)!.id }), normal, 2300);
  assert.equal(state.orders.at(-1)?.status, "cancelled");
  assert.equal(state.cash, MORNING_STARTING_CASH);
  for (let cursor = 3; cursor <= 90; cursor++) state = applyMorningAction(state, action(state, { action: "advance" }), normal, cursor * 1000);
  assert.equal(state.cursor, 90); assert.equal(state.completed, false);
  assert.equal(visibleMorningState(state, normal).bars["2330"].at(-1)?.t, 89 * 60);
  assert.throws(() => applyMorningAction(state, action(state, { action: "advance" }), normal, 91000));
  assert.throws(() => applyMorningAction(state, action(state, { action: "order", code: "2330", side: "buy", lots: 1 }), normal, 91000));
  assert.throws(() => action(state, { action: "finish", reflection: " " }));
  state = applyMorningAction(state, action(state, { action: "finish", reflection: "已看完90分鐘，按計畫觀察。" }), normal, 91000);
  assert.equal(state.completed, true);
  const capped = createMorningState(randomUUID(), plan, normal, 0);
  capped.cursor = 1;
  capped.orders = Array.from({ length: 200 }, () => ({ id: randomUUID(), code: "2330", side: "buy", shares: 1000, status: "cancelled", submittedCursor: 1 }));
  assert.throws(() => applyMorningAction(capped, action(capped, { action: "order", code: "2330", side: "buy", lots: 1 }), normal, 1000), { status: 409 });
});
