import test from "node:test";
import assert from "node:assert/strict";
import { clampLots, LOT_PICKS, MAX_LOTS, MIN_LOTS, parseLots } from "./morning-lots.ts";

test("an order is 1 to 400 lots", () => {
  assert.equal(MIN_LOTS, 1);
  assert.equal(MAX_LOTS, 400);
});

test("the quick picks are XQ's four rows, in order", () => {
  assert.deepEqual(LOT_PICKS, [
    [1, 2, 3, 4, 5, 6, 7],
    [10, 20, 30, 40, 50, 60, 70],
    [15, 25, 35, 45, 55, 65, 75],
    [100, 150, 200, 250, 300, 350, 400],
  ]);
  for (const value of LOT_PICKS.flat()) assert.equal(clampLots(value), value, `${value} is an order size`);
});

test("a count is kept within 1 to 400", () => {
  assert.equal(clampLots(0), 1);
  assert.equal(clampLots(-5), 1);
  assert.equal(clampLots(1), 1);
  assert.equal(clampLots(400), 400);
  assert.equal(clampLots(401), 400);
  assert.equal(clampLots(99_999), 400);
  assert.equal(clampLots(12.9), 12);
  assert.equal(clampLots(Number.NaN), 1);
  assert.equal(clampLots(Number.POSITIVE_INFINITY), 1);
});

test("typed lots: whole numbers, half or full width, clamped; anything else is not a count", () => {
  assert.equal(parseLots("120"), 120);
  assert.equal(parseLots(" 7 "), 7);
  assert.equal(parseLots("０"), 1);
  assert.equal(parseLots("0"), 1);
  assert.equal(parseLots("401"), 400);
  assert.equal(parseLots("5000"), 400);
  assert.equal(parseLots("２５０"), 250);
  assert.equal(parseLots("007"), 7);
  for (const text of ["", "  ", "-3", "2.5", "1e3", "abc", "12張", "+5"]) assert.equal(parseLots(text), null, JSON.stringify(text));
});
