import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampLimit,
  commission,
  estimateRoundTripCost,
  limitDown,
  limitUp,
  roundToTick,
  sellTax,
  stepTick,
  tickSize,
} from "./ticks.ts";

// Independent enumeration of the Article 62 stock grid through NT$1,500.
const legalCents: number[] = [];
for (let cents = 1; cents <= 150000; cents++) {
  const tick =
    cents < 1000
      ? 1
      : cents < 5000
        ? 5
        : cents < 10000
          ? 10
          : cents < 50000
            ? 50
            : cents < 100000
              ? 100
              : 500;
  if (cents % tick === 0) legalCents.push(cents);
}

describe("stock price ticks", () => {
  it("uses each Article 62 price band's tick", () => {
    for (const [price, expected] of [
      [0.01, 0.01],
      [9.99, 0.01],
      [10, 0.05],
      [49.95, 0.05],
      [50, 0.1],
      [99.9, 0.1],
      [100, 0.5],
      [499.5, 0.5],
      [500, 1],
      [999, 1],
      [1000, 5],
    ])
      assert.equal(tickSize(price), expected, `tick at ${price}`);
  });

  it("rounds legacy off-tick prices to the nearest legal tick, with ties upward", () => {
    for (const [price, expected] of [
      [9.994, 9.99],
      [9.995, 10],
      [10.025, 10.05],
      [49.975, 50],
      [99.95, 100],
      [233.37, 233.5],
      [499.75, 500],
      [999.5, 1000],
    ])
      assert.equal(roundToTick(price), expected, `round ${price}`);
    assert.equal(stepTick(49.98, 0), 50);
    assert.equal(stepTick(49.98, -1), 49.95);
    assert.equal(stepTick(49.98, 1), 50.1);
  });

  it("moves downward one tick without skipping the preceding price band", () => {
    for (const [edge, previous] of [
      [10, 9.99],
      [50, 49.95],
      [100, 99.9],
      [500, 499.5],
      [1000, 999],
    ]) {
      assert.equal(stepTick(edge, -1), previous);
      assert.equal(stepTick(previous, 1), edge);
    }
  });

  it("counts every legal tick when crossing one or several price bands", () => {
    for (const [price, count, expected] of [
      [10, -2, 9.98],
      [9.99, 2, 10.05],
      [50, -2, 49.9],
      [49.95, 2, 50.1],
      [100, -2, 99.8],
      [99.9, 2, 100.5],
      [500, -2, 499],
      [499.5, 2, 501],
      [1000, -2, 998],
      [999, 2, 1005],
      [10, 1300, 100],
      [100, -1300, 10],
      [9.99, 2602, 1005],
      [1005, -2602, 9.99],
      [1000, 1000000, 5001000],
    ])
      assert.equal(stepTick(price, count), expected, `${price} by ${count} ticks`);
  });

  it("agrees with independently enumerated adjacent and multiple legal prices", () => {
    for (let i = 0; i < legalCents.length; i++) {
      const price = legalCents[i] / 100;
      assert.equal(roundToTick(price), price);
      for (const count of [-1300, -2, -1, 0, 1, 2, 1300]) {
        const next = i + count;
        if (next >= 0 && next < legalCents.length) {
          assert.equal(
            stepTick(price, count),
            legalCents[next] / 100,
            `${price} by ${count} ticks`,
          );
        }
      }
    }
  });

  it("returns the invalid-price sentinel below the minimum or for invalid input", () => {
    assert.equal(stepTick(0.01, -1), 0);
    assert.equal(stepTick(0.01, -1000000), 0);
    for (const price of [NaN, Infinity, -Infinity, 0, -1, Number.MAX_VALUE]) {
      assert.equal(roundToTick(price), 0);
      assert.equal(stepTick(price, 1), 0);
      assert.equal(limitUp(price), 0);
      assert.equal(limitDown(price), 0);
      assert.equal(clampLimit(price, 100), 0);
      assert.equal(clampLimit(100, price), 0);
    }
    for (const count of [
      NaN,
      Infinity,
      -Infinity,
      0.5,
      -0.5,
      Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
    ]) {
      assert.equal(stepTick(100, count), 0);
    }
    assert.equal(limitUp(0.001), 0);
    assert.equal(limitDown(0.001), 0);
  });
});

describe("ordinary classroom stock price limits", () => {
  it("rounds the upper limit down and lower limit up, including band transitions", () => {
    for (const [reference, up, down] of [
      [0.01, 0.01, 0.01],
      [0.1, 0.11, 0.09],
      [9.1, 10, 8.19],
      [10, 11, 9],
      [26.47, 29.1, 23.85],
      [49.95, 54.9, 45],
      [50, 55, 45],
      [99.9, 109.5, 90],
      [100, 110, 90],
      [499.5, 549, 450],
      [500, 550, 450],
      [999, 1095, 900],
      [1000, 1100, 900],
    ]) {
      assert.equal(limitUp(reference), up, `upper limit from ${reference}`);
      assert.equal(limitDown(reference), down, `lower limit from ${reference}`);
    }
  });

  it("uses the outermost legal prices within 10% for every enumerated reference", () => {
    const grid = new Set(legalCents);
    // Reserve grid headroom above each reference so the upper neighbour is available.
    for (const cents of legalCents.filter((value) => value <= 120000)) {
      const price = cents / 100;
      const upper = Math.round(limitUp(price) * 100);
      const lower = Math.round(limitDown(price) * 100);
      assert.ok(grid.has(upper), `legal upper limit from ${price}`);
      assert.ok(grid.has(lower), `legal lower limit from ${price}`);
      // Cross multiplication avoids a floating 0.9/1.1 comparison or loose tolerances.
      assert.ok(upper * 10 <= cents * 11, `upper limit exceeds 10% from ${price}`);
      assert.ok(lower * 10 >= cents * 9, `lower limit exceeds 10% from ${price}`);
      const upperIndex = legalCents.indexOf(upper);
      const lowerIndex = legalCents.indexOf(lower);
      assert.ok(legalCents[upperIndex + 1] * 10 > cents * 11);
      if (lowerIndex > 0) assert.ok(legalCents[lowerIndex - 1] * 10 < cents * 9);
    }
  });

  it("clamps to the legal interval and rounds an in-range legacy price", () => {
    assert.equal(clampLimit(100, 49.95), 54.9);
    assert.equal(clampLimit(1, 49.95), 45);
    assert.equal(clampLimit(50.08, 49.95), 50.1);
    assert.equal(
      clampLimit(0.015, 0.015),
      0,
      "no legal price exists in this off-tick reference interval",
    );
  });
});

describe("estimateRoundTripCost", () => {
  it("adds both commissions and the day-trade tax at one reference notional", () => {
    // 2580 × 1,000 shares: fee 2,206 on each side, tax 3,870.
    assert.equal(estimateRoundTripCost(2_580_000), 2206 * 2 + 3870);
  });
  it("applies the NT$20 minimum fee on each side", () => {
    assert.equal(estimateRoundTripCost(10_000), 20 + 20 + 15);
  });
  it("returns 0 for missing or non-positive notionals", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      assert.equal(estimateRoundTripCost(value), 0);
  });
  it("uses exactly the engine's commission and sell tax", () => {
    for (const notional of [9_990, 100_000, 518_000, 4_955_000])
      assert.equal(estimateRoundTripCost(notional), commission(notional) * 2 + sellTax(notional));
  });
});
