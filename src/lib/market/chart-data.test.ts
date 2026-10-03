import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canvasResolution,
  chartLinePoints,
  chartWindow,
  inChartWindow,
  minuteColumnWidth,
  nearestTimePoint,
  splitPriceLine,
  timeAxisTicks,
} from "./chart-data.ts";

test("range clips all timed layers to the current lesson and never includes future bars", () => {
  const source = [{ t: 0 }, { t: 300 }, { t: 600 }, { t: 660 }, { t: 900 }];
  const window = chartWindow({ startT: 300, endT: 1200, now: 660, range: { start: 0, end: 900 } });
  assert.deepEqual(window, { start: 300, end: 660, dataEnd: 660 });
  assert.deepEqual(inChartWindow(source, window), [{ t: 300 }, { t: 600 }, { t: 660 }]);
  assert.equal(source.length, 5);
  assert.deepEqual(chartWindow({ startT: 300, endT: 1200, now: 300, range: { start: 600 } }), {
    start: 300,
    end: 300,
    dataEnd: 300,
  });
});

test("full-session and wave axes keep future space but filter data at now", () => {
  assert.deepEqual(chartWindow({ startT: 0, endT: 7200, now: 300 }), {
    start: 0,
    end: 7200,
    dataEnd: 300,
  });
  assert.deepEqual(chartWindow({ startT: 0, endT: 7200, now: 1300, wave: true }), {
    start: 0,
    end: 1390,
    dataEnd: 1300,
  });
});

test("windowing keeps original OHLC and volume intact instead of inventing candles", () => {
  const bar = { t: 60, o: 100, h: 102, l: 99, c: 101, v: 25 };
  const past = { ...bar, t: 0, v: 999 };
  const future = { ...bar, t: 120, v: 999 };
  const result = inChartWindow([past, bar, future], { start: 60, dataEnd: 90 });
  assert.equal(result.length, 1);
  assert.equal(result[0], bar);
  assert.deepEqual(bar, { t: 60, o: 100, h: 102, l: 99, c: 101, v: 25 });
});

test("time labels stay apart at phone widths and large font sizes", () => {
  for (const width of [130, 220, 500])
    for (const labelWidth of [36, 72]) {
      const times = timeAxisTicks(0, 1800, width, labelWidth);
      for (let i = 1; i < times.length; i++)
        assert.ok(((times[i]! - times[i - 1]!) / 1800) * width >= labelWidth + 18);
    }
});

test("canvas scales its backing pixels exactly, caps DPR at three, and responds to zoom", () => {
  const high = canvasResolution(311.5, 220.25, 4);
  assert.equal(high.width, 935);
  assert.equal(high.height, 661);
  assert.equal(high.scaleX, high.width / 311.5);
  assert.equal(high.scaleY, high.height / 220.25);
  assert.equal(canvasResolution(300, 200, 1.25).width, 375);
});

test("red and green line runs cross exactly at yesterday's close without changing input", () => {
  const points = [
    { t: 0, p: 99 },
    { t: 10, p: 101 },
    { t: 20, p: 99 },
  ];
  const before = JSON.stringify(points);
  assert.deepEqual(splitPriceLine(points, 100), [
    { above: false, points: [points[0], { t: 5, p: 100 }] },
    { above: true, points: [{ t: 5, p: 100 }, points[1], { t: 15, p: 100 }] },
    { above: false, points: [{ t: 15, p: 100 }, points[2]] },
  ]);
  assert.equal(JSON.stringify(points), before);
  assert.equal(nearestTimePoint(points, 13), points[1]);
  assert.equal(nearestTimePoint([], 13), undefined);
});

test("stock tape uses minute closes plus the actual current quote, while Jiangbo keeps recorded ticks", () => {
  const bars = [0, 60, 120].map((t) => ({ t, o: 100, h: 102, l: 99, c: 100 + t / 60, v: 20 }));
  const ticks = Array.from({ length: 131 }, (_, t) => ({ t, p: 100 + (t % 2) }));
  const before = JSON.stringify({ bars, ticks });
  const current = { t: 130, p: 103 };
  assert.deepEqual(chartLinePoints({ bars, ticks, variant: "stock", current }), [
    { t: 0, p: 100 },
    { t: 60, p: 101 },
    { t: 120, p: 102 },
    current,
  ]);
  assert.deepEqual(chartLinePoints({ bars, ticks, variant: "jiangbo", current }), ticks);
  assert.deepEqual(
    chartLinePoints({ bars, ticks, variant: "candles", current }),
    bars.map((bar) => ({ t: bar.t, p: bar.c })),
  );
  assert.equal(JSON.stringify({ bars, ticks }), before);
});

test("same-minute-start current quotes replace the point without adding duplicate times, and historical ranges have no live tail", () => {
  const bars = [{ t: 60, o: 100, h: 102, l: 99, c: 101, v: 20 }];
  assert.deepEqual(chartLinePoints({ bars, ticks: [], current: { t: 60, p: 102 } }), [
    { t: 60, p: 102 },
  ]);
  assert.deepEqual(chartLinePoints({ bars, ticks: [], variant: "stock" }), [{ t: 60, p: 101 }]);
});

test("volume columns follow the displayed minute interval and cannot overlap adjacent minutes", () => {
  for (const width of [130, 220, 500])
    for (const span of [1, 600, 1800, 16200]) {
      const column = minuteColumnWidth(width, span);
      assert.ok(column > 0 && column <= 12);
      assert.ok(column < (width * 60) / span);
    }
  assert.ok(minuteColumnWidth(130, 16200) < 1);
});
