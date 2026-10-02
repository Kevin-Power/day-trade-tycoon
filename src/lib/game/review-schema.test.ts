import test from "node:test";
import assert from "node:assert/strict";
import { localReviewBundleSchema, reviewBundleSchema } from "./review-schema.ts";

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

for (const [name, schema] of [
  ["local storage", localReviewBundleSchema],
  ["server input", reviewBundleSchema],
] as const) {
  test(`${name}: retains signed ending positions without changing recorded results`, () => {
    const value = {
      ...bundle,
      openPositionsAtEnd: [
        { code: "2317", lots: 3, last: 105.5 },
        { code: "2330", lots: -2, last: 1000 },
      ],
    };
    const parsed = schema.parse(JSON.parse(JSON.stringify(value)));
    assert.deepEqual(parsed, value, "the validated snapshot must not be stripped");
    assert.deepEqual(parsed.rec, bundle.rec, "historical results remain unchanged");
  });

  test(`${name}: distinguishes an older missing snapshot from explicit zero inventory`, () => {
    const legacy = schema.parse(bundle);
    assert.equal(Object.hasOwn(legacy, "openPositionsAtEnd"), false);
    assert.deepEqual(schema.parse({ ...bundle, openPositionsAtEnd: [] }).openPositionsAtEnd, []);
  });

  test(`${name}: rejects malformed or oversized ending-position snapshots`, () => {
    const position = { code: "2317", lots: 1, last: 100 };
    for (const invalid of [
      { code: "" },
      { code: "x".repeat(17) },
      { lots: 0 },
      { lots: 1.5 },
      { lots: -1.5 },
      { lots: NaN },
      { lots: Infinity },
      { lots: Number.MAX_SAFE_INTEGER + 1 },
      { last: 0 },
      { last: -1 },
      { last: NaN },
      { last: Infinity },
    ]) {
      assert.equal(
        schema.safeParse({ ...bundle, openPositionsAtEnd: [{ ...position, ...invalid }] }).success,
        false,
      );
    }
    const positions = Array.from({ length: 500 }, (_, i) => ({ ...position, code: String(i) }));
    assert.equal(schema.safeParse({ ...bundle, openPositionsAtEnd: positions }).success, true);
    assert.equal(
      schema.safeParse({ ...bundle, openPositionsAtEnd: [...positions, position] }).success,
      false,
    );
    assert.equal(schema.safeParse({ ...bundle, openPositionsAtEnd: null }).success, false);
  });
}
