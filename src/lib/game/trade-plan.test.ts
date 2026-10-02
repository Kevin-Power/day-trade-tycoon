import assert from "node:assert/strict";
import test from "node:test";
import {
  firstPlannedOrderSchema,
  firstTradePlanSnapshotSchema,
  snapshotFirstTradePlan,
  tradePlanSchema,
} from "./trade-plan.ts";
import { localReviewBundleSchema, reviewBundleSchema } from "./review-schema.ts";

const plan = {
  version: 1 as const,
  code: "2317",
  side: "buy" as const,
  lots: 1,
  simTime: 120,
  entryCondition: "  先看走勢，確認自己的理由  ",
  exitCondition: "  原因不成立時退出  ",
  maxLoss: 1000,
};
const order = {
  id: "O1",
  code: "2317",
  side: "buy" as const,
  type: "limit" as const,
  lots: 1,
  price: 100,
  time: 180,
};
const review = {
  rec: { id: "session-1", scenarioId: "wed-open", scenarioName: "第一堂", endedAt: 1,
    pnl: 0, pnlPct: 0, trades: 0, wins: 0, fees: 0, maxDrawdown: 0, grade: "C", title: "第一堂" },
  verdicts: [], fills: [], code: "2317", capital: 1000000, equity: 1000000, sessionLabel: "教室",
};

test("a plan trims notes and snapshots are copied and frozen independently of inputs", () => {
  const input = { ...plan };
  const saved = tradePlanSchema.parse(input);
  assert.equal(saved.entryCondition, "先看走勢，確認自己的理由");
  assert.equal(saved.exitCondition, "原因不成立時退出");
  input.entryCondition = "後來的想法";
  assert.equal(saved.entryCondition, "先看走勢，確認自己的理由");
  assert.ok(Object.isFrozen(saved));
  const accepted = firstPlannedOrderSchema.parse({ ...order, filled: 0, status: "pending" });
  const snapshot = snapshotFirstTradePlan(saved, accepted);
  assert.notEqual(snapshot.plan, saved);
  assert.notEqual(snapshot.order, accepted);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.plan));
  assert.ok(Object.isFrozen(snapshot.order));
  assert.equal("status" in snapshot.order!, false, "matching state is not the original accepted intent");
});

test("plan schema rejects empty or long notes, invalid money, invalid context and wrong field types", () => {
  for (const patch of [
    { entryCondition: "   " }, { exitCondition: "a".repeat(201) },
    { entryCondition: 123 }, { exitCondition: null },
    { maxLoss: 0 }, { maxLoss: -1 }, { maxLoss: Infinity }, { maxLoss: NaN }, { maxLoss: "1000" },
    { version: 2 }, { lots: 0 }, { lots: 1.5 }, { lots: 201 },
    { side: "hold" }, { code: "" }, { simTime: -1 },
  ]) assert.equal(tradePlanSchema.safeParse({ ...plan, ...patch }).success, false, JSON.stringify(patch));
  assert.equal(tradePlanSchema.safeParse({ ...plan, entryCondition: "a".repeat(200) }).success, true);
});

test("accepted order schema rejects invalid identifiers, sides, lots, price and time", () => {
  for (const patch of [
    { id: "" }, { id: "not an id" }, { code: "a".repeat(17) },
    { side: "hold" }, { type: "stop" }, { lots: 1.5 }, { lots: 201 },
    { price: 0 }, { price: Infinity }, { price: "100" }, { time: -1 },
  ]) assert.equal(firstPlannedOrderSchema.safeParse({ ...order, ...patch }).success, false, JSON.stringify(patch));
});

test("review schemas keep an optional first plan without fabricating it in old reviews", () => {
  for (const schema of [localReviewBundleSchema, reviewBundleSchema]) {
    const legacy = schema.parse(review);
    assert.equal("firstTradePlan" in legacy, false);
    for (const firstTradePlan of [
      { plan: null, order: null },
      { plan, order: null },
      { plan: null, order },
      { plan, order },
    ]) {
      const expected = firstTradePlanSnapshotSchema.parse(firstTradePlan);
      const parsed = schema.parse(JSON.parse(JSON.stringify({ ...review, firstTradePlan })));
      assert.deepEqual(parsed.firstTradePlan, expected);
    }
    for (const firstTradePlan of [
      { plan: { ...plan, entryCondition: "a".repeat(201) }, order },
      { plan: { ...plan, maxLoss: "1000" }, order },
      { plan, order: { ...order, time: "180" } },
      { plan },
      null,
    ]) assert.equal(schema.safeParse({ ...review, firstTradePlan }).success, false);
  }
});
