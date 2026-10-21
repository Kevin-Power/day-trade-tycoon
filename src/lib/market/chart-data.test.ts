import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bandPriceRange,
  candleBodyWidth,
  candlePriceRange,
  candleWindow,
  canvasResolution,
  chartLabelText,
  chartLinePoints,
  chartWindow,
  clearsPriceTag,
  completedBarsInWindow,
  deviceDashPattern,
  emaReadout,
  emaSeries,
  formatPercentChange,
  hairlineDevicePixels,
  inChartWindow,
  jiangboGridPrices,
  jiangboGridRows,
  jiangboPriceRange,
  minuteColumnWidth,
  nearestTimePoint,
  resolveChartLabels,
  sessionExtremes,
  showVolumeAndAverage,
  snapColumn,
  snapEdge,
  snapStroke,
  sparklineLayout,
  splitPriceLine,
  terminalReadout,
  timeAxisTicks,
  volumeTone,
  wrapReadout,
  type ChartLabel,
  levelChartLabels,
  limitChartLabels,
  lineRuns,
  type ReadoutField,
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

test("canvas scales its backing pixels exactly, caps DPR at four, and responds to zoom", () => {
  // Ratios up to four (3.5x Android flagships) are used as they are.
  const high = canvasResolution(311.5, 220.25, 4);
  assert.equal(high.width, 1246);
  assert.equal(high.height, 881);
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
  // A huge device box (extreme zoom) is still capped at four times the CSS size.
  const capped = canvasResolution(300, 200, 5, { width: 1500, height: 1000 });
  assert.equal(capped.width, 1200);
  assert.equal(capped.height, 800);
});

test("a 3x phone box one pixel above height x 3 is still the browser's own box", () => {
  // Fable audit P1: 358.797 CSS px at 3x is 1076.39; the browser paints 1077 rows. Rejecting the
  // box drew a 1076-row canvas that the browser stretched, smearing every grid line.
  const phone = canvasResolution(390, 358.797, 3, { width: 1170, height: 1077 });
  assert.equal(phone.width, 1170);
  assert.equal(phone.height, 1077);
});

test("phones above 3x get their full resolution instead of a stretched 3x canvas", () => {
  // Fable audit P2: a 412 x 410.29 CSS px chart at 3.5x is 1442 x 1436 device px.
  const flagship = canvasResolution(412, 410.2857, 3.5, { width: 1442, height: 1436 });
  assert.equal(flagship.width, 1442);
  assert.equal(flagship.height, 1436);
  assert.equal(canvasResolution(114.6, 40, 3.5).width, 401);
});

test("a backing store never exceeds 16 million pixels, whatever the ratio", () => {
  const huge = canvasResolution(2000, 1500, 4, { width: 8000, height: 6000 });
  assert.ok(huge.width * huge.height <= 16_000_000, `${huge.width} x ${huge.height}`);
  assert.ok(huge.width * huge.height > 15_000_000, `${huge.width} x ${huge.height}`);
  assert.equal(huge.scaleX, huge.width / 2000);
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

const minute = bar(1560, 2580, { o: 2580, h: 2580, l: 2575, v: 12, a: 2581.234 });

test("terminalReadout lists time, price and change for the intraday chart", () => {
  assert.deepEqual(
    terminalReadout({ bar: minute, previousClose: 2575, candles: false, intervalSeconds: 60, withVolume: false }),
    [
      { text: "09:26–09:27", tone: "muted" },
      { text: "價 2580", tone: "fg" },
      { text: "▲5 +0.19%", tone: "up" },
    ],
  );
});

test("terminalReadout lists OHLC for candles and adds source average and lots when allowed", () => {
  const fields = terminalReadout({
    bar: minute, previousClose: 2575, candles: true, intervalSeconds: 60, withVolume: true,
  });
  assert.deepEqual(fields.map((field) => field.text), [
    "09:26–09:27", "開 2580", "高 2580", "低 2575", "收 2580", "▲5 +0.19%", "均 2581.23", "量 12 張",
  ]);
  assert.equal(fields.at(-2)!.tone, "average");
});

test("terminalReadout marks falling and unchanged minutes", () => {
  const down = terminalReadout({
    bar: bar(0, 2570), previousClose: 2575, candles: false, intervalSeconds: 60, withVolume: false,
  });
  assert.deepEqual(down.at(-1), { text: "▼5 -0.19%", tone: "down" });
  const flat = terminalReadout({
    bar: bar(0, 2575), previousClose: 2575, candles: false, intervalSeconds: 60, withVolume: false,
  });
  assert.deepEqual(flat.at(-1), { text: "0 0.00%", tone: "muted" });
});

const measure = (text: string) => text.length * 10;
const bounds = { left: 56, right: 600, top: 20, bottom: 400 };
const label = (key: string, text: string, price: number, x: number, y: number, anchor: ChartLabel["anchor"] = "start"): ChartLabel => ({
  key, text, price, priceText: String(price), color: "#fff", x, y, anchor,
});

test("labels at the same price and place merge into one", () => {
  const placed = resolveChartLabels(
    [label("prev", "昨", 2575, 60, 300), label("open", "開", 2575, 60, 300), label("low", "低", 2575, 70, 312, "center")],
    bounds, measure, 16,
  );
  assert.equal(placed.length, 1);
  assert.deepEqual(placed[0]!.keys, ["prev", "open", "low"]);
  assert.equal(chartLabelText(placed[0]!), "昨・開・低 2575");
  assert.equal(placed[0]!.width, measure("昨・開・低 2575") + 8);
});

test("labels at the same price far apart stay separate", () => {
  const placed = resolveChartLabels(
    [label("prev", "昨", 2575, 60, 300), label("low", "低", 2575, 500, 312, "center")],
    bounds, measure, 16,
  );
  assert.equal(placed.length, 2);
});

test("nearby labels at different prices are moved apart", () => {
  const placed = resolveChartLabels(
    [label("high", "高", 2590, 300, 100, "center"), label("swing", "前高", 2585, 310, 106, "center")],
    bounds, measure, 16,
  );
  const [a, b] = placed;
  assert.ok(Math.abs(b!.y - a!.y) >= 16);
});

test("a label pushed past the bottom moves above instead", () => {
  const placed = resolveChartLabels(
    [label("a", "低", 1, 300, 392, "center"), label("b", "開", 2, 300, 395, "center")],
    bounds, measure, 16,
  );
  const moved = placed.find((item) => item.keys[0] === "b")!;
  near(moved.y, 376);
});

test("end-anchored labels are kept inside the plot", () => {
  const [inside] = resolveChartLabels([label("swing", "前高", 2590, 650, 200, "end")], bounds, measure, 16);
  near(inside!.left + inside!.width, 600);
});

test("a crowded tiny plot still finishes with every label inside it", () => {
  const crowded = Array.from({ length: 8 }, (_, i) => label(`k${i}`, "高", 100 + i, 300, 50, "center"));
  const tiny = { left: 0, right: 600, top: 0, bottom: 60 };
  const placed = resolveChartLabels(crowded, tiny, measure, 16);
  assert.equal(placed.length, 8);
  for (const item of placed) assert.ok(item.y >= 8 && item.y <= 52, `y ${item.y}`);
});

const overlap = (a: { left: number; width: number; y: number }, b: { left: number; width: number; y: number }, lineHeight: number) =>
  a.left < b.left + b.width && b.left < a.left + a.width && Math.abs(a.y - b.y) < lineHeight;

test("with a shift limit, a label that cannot sit near its price is left out instead of overlapping", () => {
  const crowded = Array.from({ length: 8 }, (_, i) => label(`k${i}`, "高", 100 + i, 300, 50, "center"));
  const tiny = { left: 0, right: 600, top: 0, bottom: 60 };
  const placed = resolveChartLabels(crowded, tiny, measure, 16, { maxShiftLines: 1 });
  assert.ok(placed.length >= 2 && placed.length < 8, `placed ${placed.length}`);
  assert.equal(placed[0]!.keys[0], "k0");
  for (const [index, item] of placed.entries()) {
    assert.ok(Math.abs(item.y - 50) <= 16, `${item.keys[0]} moved to ${item.y}`);
    for (const other of placed.slice(index + 1)) assert.equal(overlap(item, other, 16), false, `${item.keys[0]} / ${other.keys[0]}`);
  }
});

test("a phone large-text question chart keeps the level and never moves 昨 onto another price", () => {
  // 375 大字, 友達 2026-10-16 (artifacts/.../375-large-question.png): an 80 px plot from 34.75 to 36.90,
  // where 昨 34.90 used to be pushed up onto 高 36.75. Labels are listed by importance.
  const yOf = (price: number) => 270 + ((36.9 - price) / 2.15) * 80;
  const xOf = (minute: number) => 60 + ((minute + 0.5) / 60) * 206;
  const plot = { left: 62, right: 264, top: 270, bottom: 350 };
  // A 16 px monospace font: CJK characters are 16 px wide, the rest 9.6 px.
  const wide = (text: string) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) >= 0x3000 ? 16 : 9.6), 0);
  const labels = [
    label("swing-0", "前高", 36.75, 262, yOf(36.75) + 11, "end"),
    label("prev", "昨", 34.9, 64, yOf(34.9)),
    label("high", "高", 36.75, xOf(7), yOf(36.75) - 20, "center"),
    label("low", "低", 35.55, xOf(15), yOf(35.55) + 20, "center"),
    label("open", "開", 35.65, 64, yOf(35.65)),
  ];
  const placed = resolveChartLabels(labels, plot, wide, 20, { maxShiftLines: 1 });
  for (const [index, item] of placed.entries()) {
    const own = labels.find((value) => value.key === item.keys[0])!;
    const wanted = Math.min(plot.bottom - 10, Math.max(plot.top + 10, own.y));
    assert.ok(Math.abs(item.y - wanted) <= 20, `${own.text} moved from ${wanted} to ${item.y}`);
    for (const other of placed.slice(index + 1)) assert.equal(overlap(item, other, 20), false, `${item.keys} / ${other.keys}`);
  }
  assert.equal(placed[0]!.keys[0], "swing-0");
});

test("labels with non-finite positions are skipped", () => {
  assert.equal(resolveChartLabels([label("x", "昨", Number.NaN, 60, 100)], bounds, measure, 16).length, 0);
});

const readout = (...texts: string[]) => texts.map((text) => ({ text, tone: "fg" as const }));

test("wrapReadout keeps every field on one line when it fits", () => {
  const fields = readout("09:26–09:27", "價 2580", "▲5 +0.19%");
  assert.deepEqual(wrapReadout(fields, measure, 1000, 14), [fields]);
});

test("wrapReadout moves fields that do not fit onto the next line, in order, dropping none", () => {
  const fields = readout("09:26–09:27", "開 2580", "高 2580", "低 2575", "收 2580", "▲5 +0.19%");
  // 11 + 7 chars = 110 + 14 + 70 = 194 fits in 200; adding the next 7-char field does not.
  const lines = wrapReadout(fields, measure, 200, 14);
  assert.deepEqual(lines.map((line) => line.map((field) => field.text)), [
    ["09:26–09:27", "開 2580"],
    ["高 2580", "低 2575"],
    ["收 2580", "▲5 +0.19%"],
  ]);
  assert.deepEqual(lines.flat(), fields);
});

test("wrapReadout gives a field wider than the strip its own line instead of dropping it", () => {
  const fields = readout("09:26–09:27", "價 2580");
  assert.deepEqual(wrapReadout(fields, measure, 50, 14).map((line) => line.length), [1, 1]);
  assert.deepEqual(wrapReadout([], measure, 50, 14), []);
});

test("a labelled level sits just above its line at the right edge", () => {
  const labels = levelChartLabels([{ price: 100, label: "昨高" }], {
    x: 300, top: 10, lineHeight: 16, color: "#e7b549", yOf: (price) => 200 - price, priceText: String,
  });
  assert.deepEqual(labels, [{ key: "level-0", text: "昨高", price: 100, priceText: "100", color: "#e7b549", x: 300, anchor: "end", y: 91 }]);
});

test("a level label too close to the top goes below its line", () => {
  const [label] = levelChartLabels([{ price: 185, label: "昨高" }], {
    x: 300, top: 10, lineHeight: 16, color: "#e7b549", yOf: (price) => 200 - price, priceText: String,
  });
  assert.equal(label!.y, 24);
});

test("a right-axis percent label under the last-price tag is skipped, one clear of it is drawn", () => {
  // Tag centred at y=100, 20px tall; labels are 12px tall, so they collide within 16px.
  assert.equal(clearsPriceTag(100, 100, 20, 12), false);
  assert.equal(clearsPriceTag(90, 100, 20, 12), false);
  assert.equal(clearsPriceTag(115, 100, 20, 12), false);
  assert.equal(clearsPriceTag(84, 100, 20, 12), true);
  assert.equal(clearsPriceTag(116, 100, 20, 12), true);
});

test("emaSeries seeds with the first close and smooths with 2/(N+1)", () => {
  assert.deepEqual(emaSeries([10, 11, 12], 3), [10, 10.5, 11.25]);
  const eleven = emaSeries([12, 18], 11);
  assert.equal(eleven.length, 2);
  near(eleven[0]!, 12);
  near(eleven[1]!, 13);
  assert.deepEqual(emaSeries([10, 20], 1), [10, 20]);
});

test("emaSeries returns nothing for no closes or an invalid period", () => {
  assert.deepEqual(emaSeries([], 11), []);
  assert.deepEqual(emaSeries([10, 11], 0), []);
  assert.deepEqual(emaSeries([10, 11], 2.5), []);
  assert.deepEqual(emaSeries([7], 11), [7]);
});

test("bandPriceRange spans the previous close ±band", () => {
  const range = bandPriceRange(254, 0.1)!;
  near(range.min, 228.6);
  near(range.max, 279.4);
  assert.equal(bandPriceRange(0, 0.1), null);
  assert.equal(bandPriceRange(254, 0), null);
  assert.equal(bandPriceRange(254, 1), null);
  assert.equal(bandPriceRange(Number.NaN, 0.1), null);
});

test("jiangboGridRows uses 2% steps only when each row is 2.2 lines tall", () => {
  assert.equal(jiangboGridRows(404, 12), 10);
  assert.equal(jiangboGridRows(264, 12), 10);
  assert.equal(jiangboGridRows(263, 12), 4);
  assert.equal(jiangboGridRows(352, 16), 10);
  assert.equal(jiangboGridRows(351, 16), 4);
});

test("jiangboGridPrices lists the grid from the top", () => {
  const prices = jiangboGridPrices(254, 0.1, 10);
  assert.equal(prices.length, 11);
  near(prices[0]!, 279.4);
  near(prices[5]!, 254);
  near(prices[10]!, 228.6);
  const coarse = jiangboGridPrices(950, 0.1, 4);
  assert.equal(coarse.length, 5);
  [1045, 997.5, 950, 902.5, 855].forEach((price, index) => near(coarse[index]!, price));
});

test("limitChartLabels marks 漲停 below its line and 跌停 above its line", () => {
  const place = {
    x: 52,
    lineHeight: 16,
    up: "#f00",
    down: "#0f0",
    yOf: (price: number) => 1000 - price,
    priceText: (price: number) => `P${price}`,
  };
  assert.deepEqual(
    limitChartLabels(254, place).map((label) => [
      label.key, label.text, label.price, label.priceText, label.color, label.x, label.anchor, label.y,
    ]),
    [
      ["limit-up", "漲停", 279, "P279", "#f00", 52, "start", 1000 - 279 + 10],
      ["limit-down", "跌停", 229, "P229", "#0f0", 52, "start", 1000 - 229 - 10],
    ],
  );
  assert.deepEqual(limitChartLabels(0, place), []);
});

test("lineRuns breaks where minutes are missing", () => {
  assert.deepEqual(lineRuns([{ t: 0 }, { t: 60 }, { t: 300 }], 60), [[{ t: 0 }, { t: 60 }], [{ t: 300 }]]);
  assert.deepEqual(lineRuns([], 60), []);
  assert.deepEqual(lineRuns([{ t: 0 }], 60), [[{ t: 0 }]]);
});

test("emaReadout labels each EMA with two decimals", () => {
  assert.deepEqual(emaReadout([{ period: 11, value: 256.383 }, { period: 24, value: 257.0906 }]), [
    { text: "EMA11 256.38", tone: "emaFast", legend: true },
    { text: "EMA24 257.09", tone: "emaSlow", legend: true },
  ]);
  assert.deepEqual(emaReadout([{ period: 11, value: Number.NaN }, { period: 24, value: 1 }]), [
    { text: "EMA24 1.00", tone: "emaSlow", legend: true },
  ]);
});

const legendMeasure = (text: string) => text.length * 10;
const legendTexts = (lines: ReadoutField[][]) => lines.map((line) => line.map((field) => field.text));
const legendFields: ReadoutField[] = [
  { text: "09:49–09:50", tone: "muted" },
  { text: "價 256.0", tone: "fg" },
  ...emaReadout([{ period: 11, value: 256.38 }, { period: 24, value: 257.09 }]),
];

test("wrapReadout counts the swatch before each EMA value", () => {
  const fields: ReadoutField[] = [
    { text: "0123456789", tone: "fg" },
    ...emaReadout([{ period: 11, value: 256.38 }]),
  ];
  assert.deepEqual(legendTexts(wrapReadout(fields, legendMeasure, 240, 14)), [["0123456789"], ["EMA11 256.38"]]);
});

test("wrapReadout keeps the EMA legend together on the next line", () => {
  assert.deepEqual(legendTexts(wrapReadout(legendFields, legendMeasure, 400, 14)), [
    ["09:49–09:50", "價 256.0"],
    ["EMA11 256.38", "EMA24 257.09"],
  ]);
  assert.deepEqual(legendTexts(wrapReadout(legendFields, legendMeasure, 500, 14)), [
    ["09:49–09:50", "價 256.0", "EMA11 256.38", "EMA24 257.09"],
  ]);
  assert.deepEqual(legendTexts(wrapReadout(legendFields, legendMeasure, 200, 14)), [
    ["09:49–09:50", "價 256.0"],
    ["EMA11 256.38"],
    ["EMA24 257.09"],
  ]);
});

test("sparklineLayout with a band uses the fixed ±band scale and its padding", () => {
  const layout = sparklineLayout({
    bars: [bar(0, 110, { h: 110, l: 100 }), bar(60, 99)],
    previous: 100,
    startT: 0,
    endT: 5400,
    width: 100,
    height: 24,
    band: 0.1,
    pad: { x: 2, y: 2 },
  });
  near(layout.previousY, 12);
  near(layout.runs[0]!.points[0]!.y, 2);
  near(layout.last!.y, 13);
  near(layout.last!.x, 2 + (120 / 5400) * 96);
});
