import test from "node:test";
import assert from "node:assert/strict";
import { reviewBundleSchema } from "./review-schema.ts";

const bundle = {
  rec: {
    id: "session-1",
    scenarioId: "wed-open",
    scenarioName: "第一课",
    endedAt: 1,
    pnl: 0,
    pnlPct: 0,
    trades: 0,
    wins: 0,
    fees: 0,
    maxDrawdown: 0,
    grade: "C",
    title: "第一课",
  },
  verdicts: [],
  fills: [],
  code: "2317",
  capital: 1000000,
  equity: 1000000,
  sessionLabel: "教室",
};
test("valid empty practice can round-trip without fabricating trades", () => {
  assert.deepEqual(reviewBundleSchema.parse(JSON.parse(JSON.stringify(bundle))), bundle);
});
test("reject nonfinite amounts and inconsistent capital/P&L", () => {
  assert.equal(reviewBundleSchema.safeParse({ ...bundle, equity: Infinity }).success, false);
  assert.equal(reviewBundleSchema.safeParse({ ...bundle, equity: 1200000 }).success, false);
});
test("reject duplicate fills so one source trade cannot be replayed twice", () => {
  const fill = {
    id: "f1",
    orderId: "o1",
    code: "2317",
    side: "buy",
    lots: 1,
    price: 100,
    fee: 0,
    tax: 0,
    time: 0,
    vwapAt: 100,
  };
  assert.equal(reviewBundleSchema.safeParse({ ...bundle, fills: [fill, fill] }).success, false);
});
