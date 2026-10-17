import test from "node:test";
import assert from "node:assert/strict";
import { CLOSE_T, densifyBars, SESSION_LAST_CONTINUOUS_T } from "./bars.ts";

test("missing continuous minutes are filled flat from the previous close", () => {
  const bars = densifyBars([[0, 10, 11, 9, 10.5, 5, 10], [180, 11, 12, 10, 11.5, 3, 11]]);
  assert.deepEqual(bars.map((bar) => bar.t), [0, 60, 120, 180]);
  assert.deepEqual(bars[1], { t: 60, o: 10.5, h: 10.5, l: 10.5, c: 10.5, v: 0 });
});

test("the closing auction is kept and 13:25–13:29 is not invented", () => {
  assert.equal(SESSION_LAST_CONTINUOUS_T, 15840);
  assert.equal(CLOSE_T, 16200);
  const bars = densifyBars([[15840, 20, 20, 20, 20, 1, 20], [16200, 21, 21, 21, 21, 9, 21]]);
  assert.deepEqual(bars.map((bar) => bar.t), [15840, 16200]);
});

test("a single bar stays a single bar", () => {
  assert.deepEqual(densifyBars([[0, 5, 5, 5, 5, 1, 5]]), [{ t: 0, o: 5, h: 5, l: 5, c: 5, v: 1 }]);
  assert.deepEqual(densifyBars([]), []);
});
