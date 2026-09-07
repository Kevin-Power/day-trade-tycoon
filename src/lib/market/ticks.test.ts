import assert from "node:assert/strict";
import test from "node:test";
import {
  commission,
  DAYTRADE_TAX,
  FEE_RATE,
  limitDown,
  limitUp,
  MIN_FEE,
  ROUND_TRIP_RATE,
  roundToTick,
  sellTax,
  stepTick,
  tickSize,
} from "./ticks.ts";

/** Every price the classroom shows has to obey the exchange's own rules. */

test("tickSize follows the TWSE price bands", () => {
  assert.equal(tickSize(9.99), 0.01);
  assert.equal(tickSize(10), 0.05);
  assert.equal(tickSize(49.95), 0.05);
  assert.equal(tickSize(50), 0.1);
  assert.equal(tickSize(99.9), 0.1);
  assert.equal(tickSize(100), 0.5);
  assert.equal(tickSize(499.5), 0.5);
  assert.equal(tickSize(500), 1);
  assert.equal(tickSize(999), 1);
  assert.equal(tickSize(1000), 5);
});

test("limit up never exceeds +10%", () => {
  // 138.00 rounded to the nearest tick gives 152.00, which is +10.14%.
  assert.equal(limitUp(138), 151.5);
  assert.equal(limitUp(45.3), 49.8);
  assert.equal(limitUp(57.5), 63.2);
  assert.equal(limitUp(2400), 2640);
  for (const prev of [9.97, 23.1, 45.3, 57.5, 69.2, 138, 196, 241.5, 943, 2400]) {
    const up = limitUp(prev);
    assert.ok(up <= prev * 1.1 + 1e-9, `limitUp(${prev}) = ${up} breaches +10%`);
    assert.equal(up, roundToTick(up), `limitUp(${prev}) is off-tick`);
  }
});

test("limit down never breaches -10%", () => {
  for (const prev of [9.97, 23.1, 45.3, 57.5, 69.2, 138, 196, 241.5, 943, 2400]) {
    const down = limitDown(prev);
    assert.ok(down >= prev * 0.9 - 1e-9, `limitDown(${prev}) = ${down} breaches -10%`);
    assert.equal(down, roundToTick(down), `limitDown(${prev}) is off-tick`);
  }
});

test("stepTick moves exactly one tick and stays on the grid", () => {
  assert.equal(stepTick(45.3, 1), 45.35);
  assert.equal(stepTick(45.3, -1), 45.25);
  assert.equal(stepTick(2375, 1), 2380);
  assert.equal(stepTick(2375, -1), 2370);
});

test("round-trip cost is two commissions plus the day-trade tax", () => {
  assert.equal(ROUND_TRIP_RATE, FEE_RATE * 2 + DAYTRADE_TAX);
  // Taught in the handbook as "about 0.32%".
  assert.ok(Math.abs(ROUND_TRIP_RATE * 100 - 0.321) < 0.001);
});

test("commission honours the minimum charge", () => {
  // The floor bites below MIN_FEE / FEE_RATE ~= NT$23,392 a lot, i.e. a share
  // price under about 23.4 — the handbook teaches this boundary.
  const floorAt = MIN_FEE / FEE_RATE;
  assert.ok(floorAt > 23_000 && floorAt < 23_500, `floor boundary moved: ${floorAt}`);
  assert.equal(commission(20_000), MIN_FEE, "a 20-dollar lot is charged the floor");
  assert.equal(commission(2_375_000), Math.round(2_375_000 * FEE_RATE));
  // Just above the boundary the rate takes over and exceeds the floor.
  assert.ok(commission(25_500) > MIN_FEE);
  assert.equal(commission(25_500), Math.round(25_500 * FEE_RATE));
});

test("day-trade tax is charged on the sell side only", () => {
  assert.equal(sellTax(2_375_000), Math.round(2_375_000 * DAYTRADE_TAX));
});
