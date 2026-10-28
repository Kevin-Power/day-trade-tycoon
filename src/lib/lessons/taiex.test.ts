import test from "node:test";
import assert from "node:assert/strict";
import { taiexMorningSeries } from "./taiex.ts";

const PREVIOUS_CLOSE = 20_000;
/** Every 5 seconds from 09:00:00 to 13:30:00; the first point is TWSE's previous-close placeholder. */
function allPoints(value: (second: number) => number = (second) => 20_100 + second / 5): [number, number][] {
  return Array.from({ length: 3241 }, (_, index) => [index * 5, index === 0 ? PREVIOUS_CLOSE : value(index * 5)]);
}

test("90 cells × 12 points, o is the 09:00:05 point", () => {
  const series = taiexMorningSeries(PREVIOUS_CLOSE, allPoints())!;
  assert.equal(series.code, "TAIEX");
  assert.equal(series.name, "加權指數");
  assert.equal(series.source, "證交所 每 5 秒");
  assert.equal(series.previousClose, PREVIOUS_CLOSE);
  assert.equal(series.bars.length, 90);
  assert.ok(series.bars.every((bar, minute) => bar.t === minute * 60 && bar.p.length === 12));
  const first = series.bars[0];
  assert.equal(first.o, 20_101); // the 09:00:05 point, not the 09:00:00 placeholder
  assert.equal(first.c, 20_112); // 09:01:00
  assert.deepEqual(first.p, Array.from({ length: 12 }, (_, index) => 20_101 + index));
  assert.equal(series.bars[1].o, 20_113); // 09:01:05
  assert.equal(series.bars[89].c, 20_100 + 5400 / 5);
});

test("high and low are the extremes of the minute's twelve points", () => {
  const series = taiexMorningSeries(PREVIOUS_CLOSE, allPoints((second) => (second === 100 ? 20_500 : second === 110 ? 19_800 : 20_100)))!;
  const bar = series.bars[1];
  assert.equal(bar.h, 20_500);
  assert.equal(bar.l, 19_800);
  assert.equal(bar.o, 20_100);
  assert.equal(bar.c, 20_100);
  assert.equal(series.bars[0].h, 20_100);
});

test("missing point → null", () => {
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, allPoints().filter(([second]) => second !== 300)), null);
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, allPoints().slice(0, 721)), null); // only until 10:00
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, []), null);
});

test("points after 10:30 are not needed", () => {
  assert.notEqual(taiexMorningSeries(PREVIOUS_CLOSE, allPoints().filter(([second]) => second <= 5400)), null);
  assert.notEqual(taiexMorningSeries(PREVIOUS_CLOSE, allPoints().filter(([second]) => second <= 5400 || second > 6000)), null);
});

test("a repeated, off-grid or unusable point → null", () => {
  const points = allPoints();
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, [...points, [300, 1]]), null);
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, points.map(([second, value]) => [second === 100 ? 101 : second, value])), null);
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, points.map(([second, value]) => [second, second === 100 ? Number.NaN : value])), null);
  assert.equal(taiexMorningSeries(PREVIOUS_CLOSE, points.map(([second, value]) => [second, second === 100 ? 0 : value])), null);
  assert.equal(taiexMorningSeries(Number.NaN, points), null);
  assert.equal(taiexMorningSeries(0, points), null);
});
