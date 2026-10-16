import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candleBodyWidth,
  candlePriceRange,
  candleWindow,
  canvasResolution,
  chartLinePoints,
  chartWindow,
  completedBarsInWindow,
  deviceDashPattern,
  formatPercentChange,
  hairlineDevicePixels,
  inChartWindow,
  jiangboPriceRange,
  minuteColumnWidth,
  nearestTimePoint,
  sessionExtremes,
  showVolumeAndAverage,
  snapColumn,
  snapEdge,
  snapStroke,
  sparklineLayout,
  splitPriceLine,
  timeAxisTicks,
  volumeTone,
} from "./chart-data.ts";
import type { Bar } from "../game/types.ts";

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

const SCALES = [1, 1.25, 1.5, 2, 2.5, 3];
const SAMPLES = [0, 0.3, 17.5, 63.49, 100.5, 311.7, 733.2];
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should be ${expected}`);

test("canvas backing size follows the browser's own device-pixel box when it is known", () => {
  // 733 CSS px at 150% is 1099.5 device px. Rounding says 1100, but the browser paints 1099,
  // and a canvas of any other size is resampled (blurred) when it is drawn.
  const exact = canvasResolution(733, 300, 1.5, { width: 1099, height: 450 });
  assert.equal(exact.width, 1099);
  assert.equal(exact.height, 450);
  assert.equal(exact.scaleX, 1099 / 733);
  assert.equal(exact.scaleY, 450 / 300);
  // Without the box, or with an unusable one, fall back to rounding the CSS size.
  assert.equal(canvasResolution(733, 300, 1.5).width, 1100);
  assert.equal(canvasResolution(733, 300, 1.5, { width: 0, height: 0 }).width, 1100);
  assert.equal(canvasResolution(733, 300, 1.5, { width: Number.NaN, height: 450 }).width, 1100);
  // A box that disagrees with the ratio (some engines report CSS pixels) is not trusted.
  assert.equal(canvasResolution(733, 300, 1.5, { width: 733, height: 300 }).width, 1100);
  assert.equal(canvasResolution(733, 300, 1.5, { width: 733, height: 300 }).height, 450);
  assert.equal(canvasResolution(733, 300, 1.5, { width: 1100, height: 300 }).height, 450);
  // A huge device box (extreme zoom) is still capped at three times the CSS size.
  const capped = canvasResolution(300, 200, 5, { width: 1500, height: 1000 });
  assert.equal(capped.width, 900);
  assert.equal(capped.height, 600);
});

test("hairlines are about one CSS pixel thick but never thinner than one device pixel", () => {
  assert.equal(hairlineDevicePixels(1), 1);
  assert.equal(hairlineDevicePixels(1.25), 1);
  assert.equal(hairlineDevicePixels(1.5), 2);
  assert.equal(hairlineDevicePixels(2), 2);
  assert.equal(hairlineDevicePixels(3), 3);
  assert.equal(hairlineDevicePixels(0.4), 1);
  assert.equal(hairlineDevicePixels(Number.NaN), 1);
});

test("strokes are centred so an odd-width line fills one device column and an even one fills two", () => {
  for (const scale of SCALES)
    for (const value of SAMPLES) {
      const odd = snapStroke(value, scale, 1) * scale;
      near(odd - Math.floor(odd), 0.5);
      const even = snapStroke(value, scale, 2) * scale;
      near(even, Math.round(even));
      // Snapping may move a line by at most one device pixel.
      assert.ok(Math.abs(snapStroke(value, scale, 1) - value) <= 1 / scale + 1e-9);
    }
});

test("filled edges land on whole device pixels", () => {
  for (const scale of SCALES)
    for (const value of SAMPLES) {
      const edge = snapEdge(value, scale) * scale;
      near(edge, Math.round(edge));
    }
});

test("snapping leaves unusable input alone instead of producing NaN", () => {
  assert.ok(Number.isNaN(snapStroke(Number.NaN, 2, 1)));
  assert.equal(snapStroke(12.34, 0, 1), 12.34);
  assert.equal(snapEdge(12.34, Number.NaN), 12.34);
  assert.equal(snapColumn(12.34, 5, 0, 1).width, 5);
});

test("a candle body shares its centre with the wick and has whole-pixel edges", () => {
  for (const scale of SCALES)
    for (const strokePx of [1, 2, 3])
      for (const width of [0.6, 1.4, 3.2, 5, 7, 12])
        for (const center of SAMPLES) {
          const column = snapColumn(center, width, scale, strokePx);
          const left = column.left * scale;
          const right = (column.left + column.width) * scale;
          near(left, Math.round(left));
          near(right, Math.round(right));
          // The wick is a strokePx-wide line at `center`; both sides of it must be equally wide.
          near(column.center, snapStroke(center, scale, strokePx));
          near(column.center - column.left, column.left + column.width - column.center);
          // Same parity as the wick, so the wick sits exactly in the middle of the body.
          const devicePx = Math.round(column.width * scale);
          assert.equal(devicePx % 2, strokePx % 2);
          assert.ok(devicePx >= (strokePx % 2 === 1 ? 1 : 2));
          // Rounded to the nearest valid width; never fatter than a pixel above the request.
          assert.ok(Math.abs(devicePx - width * scale) <= 1 + 1e-9 || devicePx === 2);
        }
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

test("historical OHLC is revealed only when its source minute has completed", () => {
  const source = [0, 60, 120].map((t) => ({ t, o: 100, h: 105, l: 98, c: 102, v: 0 }));
  const before = JSON.stringify(source);
  assert.deepEqual(completedBarsInWindow(source, { start: 0, dataEnd: 59 }, 60), []);
  assert.deepEqual(completedBarsInWindow(source, { start: 0, dataEnd: 60 }, 60), [source[0]]);
  assert.deepEqual(completedBarsInWindow(source, { start: 60, dataEnd: 120 }, 60), [source[1]]);
  assert.deepEqual(completedBarsInWindow(source, { start: 0, dataEnd: 120 }, 0), []);
  assert.equal(JSON.stringify(source), before);
});

test("historical minute close is plotted at completion with no invented current tail", () => {
  const bars = [0, 60].map((t) => ({ t, o: 100, h: 105, l: 98, c: 102 + t / 60, v: 0 }));
  assert.deepEqual(
    chartLinePoints({
      bars,
      ticks: [],
      variant: "stock",
      completedBarSeconds: 60,
      current: { t: 180, p: 999 },
    }),
    [
      { t: 60, p: 102 },
      { t: 120, p: 103 },
    ],
  );
});

test("missing source minutes remain gaps instead of interpolated paths", () => {
  const points = [
    { t: 60, p: 99 },
    { t: 120, p: 98 },
    { t: 240, p: 102 },
  ];
  assert.deepEqual(splitPriceLine(points, 100, 60), [
    { above: false, points: points.slice(0, 2) },
    { above: true, points: [points[2]] },
  ]);
});

test("candle view keeps a fixed 60-minute span that follows the cursor", () => {
  assert.deepEqual(candleWindow(0), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(5), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(60), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(90), { startT: 1800, endT: 5400 });
  assert.deepEqual(candleWindow(Number.NaN), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(-3), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(10, 5), { startT: 300, endT: 600 });
});

test("percent change is signed, two decimals and never negative zero", () => {
  assert.equal(formatPercentChange(2580, 2575), "+0.19%");
  assert.equal(formatPercentChange(2570, 2575), "-0.19%");
  assert.equal(formatPercentChange(2575, 2575), "0.00%");
  assert.equal(formatPercentChange(2575.0001, 2575), "0.00%");
  assert.equal(formatPercentChange(2574.9999, 2575), "0.00%");
  assert.equal(formatPercentChange(2580, 0), "");
  assert.equal(formatPercentChange(Number.NaN, 2575), "");
});

test("session extremes report the first highest high and lowest low", () => {
  const bars = [
    { t: 0, o: 10, h: 11, l: 9, c: 10, v: 0 },
    { t: 60, o: 10, h: 12, l: 9, c: 11, v: 0 },
    { t: 120, o: 11, h: 12, l: 8, c: 9, v: 0 },
  ];
  assert.deepEqual(sessionExtremes(bars), { high: { t: 60, p: 12 }, low: { t: 120, p: 8 } });
  assert.equal(sessionExtremes([]), null);
  assert.equal(sessionExtremes([{ t: 0, o: 1, h: Number.NaN, l: 1, c: 1, v: 0 }]), null);
});

const bar = (t: number, c: number, extra: Partial<Bar> = {}): Bar => ({
  t, o: c, h: c, l: c, c, v: 1, ...extra,
});

test("jiangboPriceRange centres on the previous close with at least ±1%", () => {
  // 10/06 台積電: 昨收 2575, 高 2590, 低 2575 → 半幅 max(16.5, 25.75).
  const range = jiangboPriceRange(2575, 2590, 2575);
  near(range.min, 2549.25);
  near(range.max, 2600.75);
  // A wide day uses 1.1 × the largest deviation instead.
  const wide = jiangboPriceRange(100, 104, 99);
  near(wide.max - 100, 4.4);
  near(100 - wide.min, 4.4);
});

test("jiangboPriceRange never collapses on a flat day", () => {
  const flat = jiangboPriceRange(50, 50, 50);
  near(flat.max - flat.min, 1);
});

test("jiangboPriceRange falls back to the data when the previous close is unusable", () => {
  for (const previous of [0, Number.NaN, -5]) {
    const range = jiangboPriceRange(previous, 110, 90);
    near(range.min, 89);
    near(range.max, 111);
  }
  assert.deepEqual(jiangboPriceRange(Number.NaN, Number.NaN, Number.NaN), { min: 0, max: 1 });
});

test("candlePriceRange pads 8% and keeps at least 1.5% of the previous close", () => {
  const narrow = candlePriceRange(2590, 2575, 2575);
  near(narrow.min, 2563.1875);
  near(narrow.max, 2601.8125);
  const wide = candlePriceRange(2700, 2575, 2575);
  near(wide.min, 2565);
  near(wide.max, 2710);
  // The previous close is always inside the range.
  const above = candlePriceRange(120, 118, 100);
  assert.ok(above.min < 100 && above.max > 120);
});

test("candlePriceRange stays finite without a previous close or on a flat minute", () => {
  const flat = candlePriceRange(80, 80, 80);
  near(flat.max - flat.min, 1.2);
  const missing = candlePriceRange(110, 90, Number.NaN);
  assert.ok(Number.isFinite(missing.min) && Number.isFinite(missing.max) && missing.max > missing.min);
  assert.deepEqual(candlePriceRange(Number.NaN, Number.NaN, 0), { min: 0, max: 1 });
});

test("candleBodyWidth is 70% of a minute column, between 1 and 13 CSS px", () => {
  near(candleBodyWidth(1000, 3600), 1000 / 60 * 0.7);
  assert.equal(candleBodyWidth(2000, 3600), 13);
  assert.equal(candleBodyWidth(10, 3600), 1);
  assert.equal(candleBodyWidth(1000, 0), 13);
});

test("candle bodies keep the wick's pixel parity at every screen scale", () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    const stroke = hairlineDevicePixels(scale);
    for (const [plot, span] of [[1000, 3600], [2000, 3600], [700, 3600], [900, 16200]]) {
      const column = snapColumn(500, candleBodyWidth(plot, span), scale, stroke);
      const device = Math.round(column.width * scale);
      assert.equal(device % 2, stroke % 2, `scale ${scale}, plot ${plot}`);
      assert.ok(device <= Math.round(13 * scale) + 1);
    }
  }
});

test("deviceDashPattern rounds every dash to whole device pixels", () => {
  for (const scale of [1, 1.25, 1.5, 2])
    for (const pattern of [[4, 4], [2, 5], [5, 4], [2, 3]])
      for (const length of deviceDashPattern(pattern, scale)) {
        const device = length * scale;
        near(device, Math.round(device));
        assert.ok(device >= 1);
      }
  assert.deepEqual(deviceDashPattern([0.2], 1), [1]);
});

test("showVolumeAndAverage requires lot volume and a source average on every bar", () => {
  const sourced = [bar(0, 10, { a: 10.1, v: 3 }), bar(60, 11, { a: 10.4, v: 0 })];
  assert.equal(showVolumeAndAverage("lot", sourced), true);
  assert.equal(showVolumeAndAverage(undefined, sourced), false);
  assert.equal(showVolumeAndAverage("share", sourced), false);
  assert.equal(showVolumeAndAverage("lot", []), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: 10, v: 1 }), bar(60, 10)]), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: Number.NaN })]), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: 10, v: 1.5 })]), false);
  assert.equal(showVolumeAndAverage("lot", [bar(0, 10, { a: 10, v: -1 })]), false);
});

test("volumeTone compares a minute's close with the minute before", () => {
  assert.equal(volumeTone(101, 100), "up");
  assert.equal(volumeTone(99, 100), "down");
  assert.equal(volumeTone(100, 100), "flat");
  assert.equal(volumeTone(100, Number.NaN), "flat");
});

test("sparklineLayout centres the previous close and maps the whole session", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 100.5, { h: 101, l: 99 })],
    previous: 100,
    startT: 0,
    endT: 5400,
    width: 263,
    height: 56,
  });
  near(layout.previousY, 28);
  assert.equal(layout.runs.length, 1);
  assert.equal(layout.runs[0]!.points.length, 1);
  near(layout.last!.x, 3 + (60 / 5400) * 257);
  assert.equal(layout.last!.above, true);
  const end = sparklineLayout({
    bars: [bar(5340, 100)], previous: 100, startT: 0, endT: 5400, width: 263, height: 56,
  });
  near(end.last!.x, 260);
});

test("sparklineLayout breaks the line at missing minutes", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 101), bar(60, 102), bar(300, 103)],
    previous: 100,
    startT: 0,
    endT: 5400,
    width: 263,
    height: 56,
  });
  assert.deepEqual(layout.runs.map((run) => run.points.length), [2, 1]);
});

test("sparklineLayout keeps finite coordinates without a previous close", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 101), bar(60, 99)], previous: 0, startT: 0, endT: 5400, width: 263, height: 56,
  });
  for (const run of layout.runs)
    for (const point of run.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.equal(Number.isFinite(layout.previousY), false);
});
