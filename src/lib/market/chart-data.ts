import type { Bar, TickPt } from "../game/types.ts";
import { formatPrice, limitDown, limitUp } from "./ticks.ts";

export type ChartRange = { start: number; end?: number };

/** The desk's 江波 view and its watch-list minis span the previous close ±10%. */
export const JIANGBO_BAND = 0.1;
/** EMA periods drawn on the desk charts (the course's 快樂小馬 line is EMA11). */
export const DESK_EMA_PERIODS = [11, 24] as const;

export function chartWindow(input: {
  startT: number;
  endT: number;
  now: number;
  range?: ChartRange;
  wave?: boolean;
}) {
  const sessionStart = Number.isFinite(input.startT) ? input.startT : 0;
  const sessionEnd = Math.max(
    sessionStart,
    Number.isFinite(input.endT) ? input.endT : sessionStart,
  );
  const now = Math.min(
    sessionEnd,
    Math.max(sessionStart, Number.isFinite(input.now) ? input.now : sessionStart),
  );
  const requestedStart =
    input.range && Number.isFinite(input.range.start) ? input.range.start : sessionStart;
  const start = Math.min(now, Math.max(sessionStart, requestedStart));
  const requestedEnd = input.range
    ? input.range.end !== undefined && Number.isFinite(input.range.end)
      ? input.range.end
      : now
    : input.wave
      ? Math.min(
          sessionEnd,
          Math.max(now + 90, sessionStart + Math.min(sessionEnd - sessionStart, 1200)),
        )
      : sessionEnd;
  const end = Math.max(
    start,
    Math.min(sessionEnd, input.range ? Math.min(now, requestedEnd) : requestedEnd),
  );
  return { start, end, dataEnd: Math.min(now, end) };
}

/** Filter every visual layer by the same interval without altering source bars. */
export function inChartWindow<T extends { t: number }>(
  data: readonly T[],
  window: { start: number; dataEnd: number },
): T[] {
  return data.filter(
    (point) => Number.isFinite(point.t) && point.t >= window.start && point.t <= window.dataEnd,
  );
}

/** Keep completed source intervals intact; never expose a not-yet-closed bar. */
export function completedBarsInWindow(
  bars: readonly Bar[],
  window: { start: number; dataEnd: number },
  seconds: number,
): Bar[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  return inChartWindow(bars, window).filter((bar) => bar.t + seconds <= window.dataEnd);
}

/** A bar the desk can draw: its time, prices and volume are all finite numbers. */
export function isDrawableBar(bar: Bar): boolean {
  return [bar.t, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite);
}

/**
 * The minutes that feed the desk's EMAs: every drawable one completed by `dataEnd`, counted from the
 * session start rather than the visible window, and never a later one.
 */
export function emaSourceBars(bars: readonly Bar[], dataEnd: number, intervalSeconds?: number): Bar[] {
  return bars.filter(
    (bar) => isDrawableBar(bar) && (intervalSeconds ? bar.t + intervalSeconds : bar.t) <= dataEnd,
  );
}

export function timeAxisTicks(
  start: number,
  end: number,
  width: number,
  labelWidth: number,
): number[] {
  const span = Math.max(1, end - start);
  const minimum = (span * (labelWidth + 18)) / Math.max(1, width);
  const step =
    [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800].find((value) => value >= minimum) ??
    Math.ceil(minimum / 3600) * 3600;
  const result: number[] = [];
  for (let time = Math.ceil(start / step) * step; time <= end; time += step) result.push(time);
  return result.length ? result : [start];
}

const MAX_CANVAS_RATIO = 4;
const MAX_BACKING_PIXELS = 16_000_000;

/**
 * Backing-store size for a canvas shown at `width` x `height` CSS pixels. `deviceBox` is the exact
 * number of device pixels the browser gives the canvas (ResizeObserver's devicePixelContentBoxSize);
 * matching it keeps the canvas from being resampled when CSS size times ratio is fractional.
 */
export function canvasResolution(
  width: number,
  height: number,
  ratio: number,
  deviceBox?: { width: number; height: number },
) {
  const requested = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  // Four times covers every phone (3.5x Android flagships); the area cap bounds memory on any screen.
  const areaCap = Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, width * height));
  const dpr = Math.min(MAX_CANVAS_RATIO, requested, areaCap);
  // Only trust the box when the ratio is used as it is and the box agrees with it to within one
  // device pixel (snapping, which can round either way); some engines report CSS pixels here.
  const exact =
    dpr === requested &&
    deviceBox &&
    deviceBox.width >= 1 &&
    deviceBox.height >= 1 &&
    Math.abs(deviceBox.width - width * requested) <= 1 &&
    Math.abs(deviceBox.height - height * requested) <= 1;
  // Under the area cap, round down so the backing store stays inside it.
  const toPixels = dpr < Math.min(MAX_CANVAS_RATIO, requested) ? Math.floor : Math.round;
  const pixelWidth = Math.max(1, exact ? deviceBox.width : toPixels(width * dpr));
  const pixelHeight = Math.max(1, exact ? deviceBox.height : toPixels(height * dpr));
  return {
    width: pixelWidth,
    height: pixelHeight,
    scaleX: pixelWidth / width,
    scaleY: pixelHeight / height,
  };
}

const usableScale = (scale: number) => Number.isFinite(scale) && scale > 0;

/**
 * Device pixels in the 江波圖 mini's price line: about 1.25 CSS px, never a blurred fraction of a pixel, and at
 * least 2 so a sloping stretch still covers a whole pixel in every column (a 1px slope is all half-tones).
 */
export function sparkStrokePx(scale: number): number {
  return usableScale(scale) ? Math.max(2, Math.round(1.25 * scale)) : 2;
}

/** Device pixels in a line that is about one CSS pixel thick, never thinner than one. */
export function hairlineDevicePixels(scale: number): number {
  return usableScale(scale) ? Math.max(1, Math.round(scale)) : 1;
}

/**
 * CSS coordinate for the centre of a stroke `devicePx` device pixels wide, so the stroke covers
 * whole device pixels instead of being blended across two. `scale` is device pixels per CSS pixel.
 */
export function snapStroke(value: number, scale: number, devicePx = 1): number {
  if (!Number.isFinite(value) || !usableScale(scale)) return value;
  const device = value * scale;
  return (devicePx % 2 === 1 ? Math.floor(device) + 0.5 : Math.round(device)) / scale;
}

/** CSS coordinate of a filled edge, moved onto the nearest whole device pixel. */
export function snapEdge(value: number, scale: number): number {
  if (!Number.isFinite(value) || !usableScale(scale)) return value;
  return Math.round(value * scale) / scale;
}

/**
 * A candle body (or volume column) centred on its wick. The wick is a `strokePx`-wide stroke; the
 * body gets the nearest width of the same parity so the wick sits exactly in the middle, and both
 * edges land on whole device pixels. Ties go to the narrower width so neighbours do not touch.
 */
export function snapColumn(center: number, width: number, scale: number, strokePx = 1) {
  if (!Number.isFinite(center) || !Number.isFinite(width) || !usableScale(scale))
    return { center, left: center - width / 2, width };
  const parity = strokePx % 2;
  const devicePx = Math.max(
    parity === 1 ? 1 : 2,
    2 * Math.ceil((width * scale - parity) / 2 - 0.5) + parity,
  );
  const middle = snapStroke(center, scale, strokePx) * scale;
  return {
    center: middle / scale,
    left: (middle - devicePx / 2) / scale,
    width: devicePx / scale,
  };
}

/** Minute closes for ordinary tape; only Jiangbo exposes every recorded tick. */
export function chartLinePoints(input: {
  bars: readonly Bar[];
  ticks: readonly TickPt[];
  variant?: "stock" | "index" | "jiangbo" | "candles";
  current?: TickPt;
  /** Completed source bars: the close belongs to the END of its interval. */
  completedBarSeconds?: number;
}): TickPt[] {
  if (input.variant === "jiangbo" && input.ticks.length)
    return input.ticks.map((tick) => ({ ...tick }));
  const points = input.bars.map((bar) => ({
    t: bar.t + (input.completedBarSeconds ?? 0),
    p: bar.c,
  }));
  // An observed current quote can differ from the forming minute's close after a fill.
  // Add only this supplied observation, never intermediate or future values.
  if (
    !input.completedBarSeconds &&
    (input.variant === undefined || input.variant === "stock") &&
    input.current
  ) {
    const last = points.at(-1);
    if (!last || last.t < input.current.t) points.push({ ...input.current });
    else if (last.t === input.current.t) points[points.length - 1] = { ...input.current };
  }
  return points;
}

/**
 * Chart gutters in CSS px: prices on the left (with the 江波 view's 「昨 2575」), and on the right the
 * last-price tag and the change from the previous close. 「昨」 widens only the left one.
 */
export function chartGutters(widths: { price: number; prevAxis?: number; percent?: number }): {
  left: number;
  right: number;
} {
  return {
    left: Math.ceil(Math.max(widths.price, widths.prevAxis ?? 0) + 12),
    right: Math.ceil(Math.max(widths.price, widths.percent ?? 0) + 14),
  };
}

export function minuteColumnWidth(plotWidth: number, timeSpan: number): number {
  return Math.min(12, ((plotWidth * 60) / Math.max(1, timeSpan)) * 0.64);
}

export function splitPriceLine(
  points: readonly TickPt[],
  previous: number,
  maxGap = Infinity,
): { above: boolean; points: TickPt[] }[] {
  const runs: { above: boolean; points: TickPt[] }[] = [];
  if (!points.length) return runs;
  let run = { above: points[0]!.p >= previous, points: [points[0]!] };
  runs.push(run);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const above = b.p >= previous;
    if (b.t - a.t > maxGap) {
      run = { above, points: [b] };
      runs.push(run);
      continue;
    }
    if (above !== run.above) {
      const fraction = (previous - a.p) / (b.p - a.p);
      const crossing = { t: a.t + (b.t - a.t) * fraction, p: previous };
      run.points.push(crossing);
      run = { above, points: [crossing] };
      runs.push(run);
    }
    run.points.push(b);
  }
  return runs;
}

/** Splits time-ordered points into runs wherever two neighbours are more than `maxGap` apart. */
export function lineRuns<T extends { t: number }>(points: readonly T[], maxGap: number): T[][] {
  const runs: T[][] = [];
  for (const point of points) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && point.t - last.t <= maxGap) run.push(point);
    else runs.push([point]);
  }
  return runs;
}

/** Exponential moving average: the first value seeds it, then each value moves it by α = 2 / (period + 1). */
export function emaSeries(values: readonly number[], period: number): number[] {
  if (!Number.isInteger(period) || period < 1) return [];
  const alpha = 2 / (period + 1);
  const result: number[] = [];
  let average: number | undefined;
  for (const value of values) {
    average = average === undefined ? value : average + alpha * (value - average);
    result.push(average);
  }
  return result;
}

export function nearestTimePoint<T extends { t: number }>(
  points: readonly T[],
  time: number,
): T | undefined {
  let nearest: T | undefined;
  for (const point of points)
    if (!nearest || Math.abs(point.t - time) < Math.abs(nearest.t - time)) nearest = point;
  return nearest;
}

/** Fixed-width candle view: the latest `minutes` minutes, with empty space ahead early on. */
export function candleWindow(cursor: number, minutes = 60): { startT: number; endT: number } {
  const span = Math.max(1, Math.round(minutes)) * 60;
  const now = Number.isFinite(cursor) ? Math.max(0, cursor) * 60 : 0;
  const startT = Math.max(0, now - span);
  return { startT, endT: startT + span };
}

/** Signed change against the previous close, e.g. "+0.19%"; never shows "-0.00%". */
export function formatPercentChange(price: number, previous: number): string {
  if (!Number.isFinite(price) || !Number.isFinite(previous) || previous <= 0) return "";
  const rounded = Math.round((price / previous - 1) * 10000) / 100;
  if (rounded === 0) return "0.00%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

/**
 * Whether a right-gutter label centred at `labelY` stays clear of the last-price tag centred at
 * `tagY`; a label the tag would half-cover is skipped instead of drawn underneath it.
 */
export function clearsPriceTag(
  labelY: number,
  tagY: number,
  tagHeight: number,
  labelHeight: number,
): boolean {
  return Math.abs(labelY - tagY) >= (tagHeight + labelHeight) / 2;
}

/** Highest high and lowest low among the given bars; the first occurrence wins. */
export function sessionExtremes(bars: readonly Bar[]): { high: TickPt; low: TickPt } | null {
  let high: TickPt | null = null;
  let low: TickPt | null = null;
  for (const bar of bars) {
    if (![bar.t, bar.h, bar.l].every(Number.isFinite)) continue;
    if (!high || bar.h > high.p) high = { t: bar.t, p: bar.h };
    if (!low || bar.l < low.p) low = { t: bar.t, p: bar.l };
  }
  return high && low ? { high, low } : null;
}

export type PriceRange = { min: number; max: number };
const positive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * Line-chart price range for the desk when no fixed 江波 band is given: symmetric about the previous
 * close, so the percent axis reads −x% / 0 / +x%, and never narrower than ±minFraction of that close.
 */
export function jiangboPriceRange(
  previous: number,
  high: number,
  low: number,
  minFraction = 0.01,
): PriceRange {
  const prices = [high, low].filter(positive);
  if (!positive(previous)) {
    if (!prices.length) return { min: 0, max: 1 };
    const top = Math.max(...prices);
    const bottom = Math.min(...prices);
    const middle = (top + bottom) / 2;
    const half = Math.max(((top - bottom) / 2) * 1.1, middle * minFraction);
    return { min: middle - half, max: middle + half };
  }
  const reach = Math.max(0, ...prices.map((price) => Math.abs(price - previous)));
  const half = Math.max(reach * 1.1, previous * minFraction);
  return { min: previous - half, max: previous + half };
}

/** The 江波 price axis: the previous close ± `band` (0.1 = ±10%); null without a usable close or band. */
export function bandPriceRange(previous: number, band: number): PriceRange | null {
  if (!positive(previous) || !(band > 0 && band < 1)) return null;
  return { min: previous * (1 - band), max: previous * (1 + band) };
}

/** The 自選 江波圖's scale: 放大 (each row zoomed to its own moves, the default) or the fixed ±10%. */
export type MiniScale = "zoom" | "fixed";
/** 放大 steps: few enough that a row's scale changes rarely, not every minute. */
export const MINI_ZOOM_STEPS = [0.01, 0.02, 0.03, 0.05, JIANGBO_BAND] as const;

/** The device's stored choice; anything but ±10% opens on 放大. */
export function parseMiniScale(stored: string | null): MiniScale {
  return stored === "fixed" ? "fixed" : "zoom";
}

/**
 * 放大: the smallest step that holds every close drawn so far (the mini draws closes, so a minute's high or
 * low beyond it does not count). Only revealed minutes are passed in, so the scale never gives away the rest
 * of the day. Without a usable previous close, or beyond ±10%, it is the 江波 band.
 */
export function miniZoomBand(previous: number, bars: readonly Pick<Bar, "c">[]): number {
  if (!positive(previous)) return JIANGBO_BAND;
  const reach = Math.max(0, ...bars.map((bar) => bar.c).filter(Number.isFinite).map((c) => Math.abs(c / previous - 1)));
  // A hair of tolerance: 102 / 100 - 1 is 0.020000000000000018, which is still ±2%.
  return MINI_ZOOM_STEPS.find((step) => reach <= step + 1e-9) ?? JIANGBO_BAND;
}

/** The mini's tooltip: which scale it is drawn on. */
export function miniScaleLabel(band: number): string {
  return `刻度：昨收 ±${Math.round(band * 100)}%`;
}

/** 江波 grid: 2% steps (10 rows) when each row is at least 2.2 text lines tall, otherwise 5% steps (4 rows). */
export function jiangboGridRows(plotHeight: number, fontSize: number): 10 | 4 {
  return plotHeight >= fontSize * 22 ? 10 : 4;
}

/** Prices of the 江波 grid lines from the top (previous close × (1 + band)) down: `rows + 1` of them. */
export function jiangboGridPrices(previous: number, band: number, rows: number): number[] {
  const range = bandPriceRange(previous, band);
  if (!range || !(rows >= 1)) return [];
  const span = range.max - range.min;
  return Array.from({ length: rows + 1 }, (_, index) => range.max - (span * index) / rows);
}

/**
 * Candle price range for the trading desk: the visible high and low (and the previous close),
 * padded by `padding` on each side, and never narrower than `minFraction` of the previous close.
 */
export function candlePriceRange(
  high: number,
  low: number,
  previous: number,
  minFraction = 0.015,
  padding = 0.08,
): PriceRange {
  const prices = [high, low, previous].filter(positive);
  if (!prices.length) return { min: 0, max: 1 };
  const top = Math.max(...prices);
  const bottom = Math.min(...prices);
  const middle = (top + bottom) / 2;
  const base = positive(previous) ? previous : middle;
  const span = Math.max((top - bottom) * (1 + 2 * padding), base * minFraction);
  return { min: middle - span / 2, max: middle + span / 2 };
}

/** Desk candle body: 70% of a minute column, 1–13 CSS px. snapColumn then fixes pixel parity. */
export function candleBodyWidth(plotWidth: number, timeSpan: number): number {
  const column = (plotWidth * 60) / Math.max(1, timeSpan);
  return Math.max(1, Math.min(13, column * 0.7));
}

/** Dash lengths rounded to whole device pixels, so each dash starts and ends on a pixel edge. */
export function deviceDashPattern(pattern: readonly number[], scale: number): number[] {
  const usable = usableScale(scale) ? scale : 1;
  return pattern.map((length) => Math.max(1, Math.round(length * usable)) / usable);
}

/**
 * Volume bars and the average line need a documented unit and the source's own session average;
 * a lesson without them (e.g. Yahoo minutes) shows neither, rather than a guess.
 */
export function showVolumeAndAverage(volumeUnit: string | undefined, bars: readonly Bar[]): boolean {
  return (
    volumeUnit === "lot" &&
    bars.length > 0 &&
    bars.every(
      (bar) =>
        typeof bar.a === "number" &&
        Number.isFinite(bar.a) &&
        bar.a > 0 &&
        Number.isInteger(bar.v) &&
        bar.v >= 0,
    )
  );
}

/** Colour of a volume bar: this minute's close against the minute before (or the previous close). */
export function volumeTone(close: number, previousClose: number): "up" | "down" | "flat" {
  if (!Number.isFinite(close) || !Number.isFinite(previousClose) || close === previousClose)
    return "flat";
  return close > previousClose ? "up" : "down";
}

export type SparkPoint = { x: number; y: number };

/**
 * Watchlist sparkline geometry in CSS pixels, with the whole lesson as its time axis. With `band` the
 * scale is fixed at the previous close ±band (the watch table's 江波圖); without it, the same symmetric
 * range as the big intraday chart. Closes sit at the end of their minute; a missing minute breaks the line.
 */
export function sparklineLayout(input: {
  bars: readonly Pick<Bar, "t" | "h" | "l" | "c">[];
  previous: number;
  startT: number;
  endT: number;
  width: number;
  height: number;
  intervalSeconds?: number;
  band?: number;
  pad?: { x: number; y: number };
  /**
   * The canvas's device pixels per CSS pixel (vertically) and the price line's width in device pixels: each
   * point then sits where that stroke covers whole device pixels, so flat stretches are crisp, not blurred.
   */
  device?: { scale: number; strokePx: number };
}): {
  previousY: number;
  runs: { above: boolean; points: SparkPoint[] }[];
  last: (SparkPoint & { above: boolean }) | null;
} {
  const interval = input.intervalSeconds ?? 60;
  const padX = input.pad?.x ?? 3;
  const padY = input.pad?.y ?? 4;
  const bars = input.bars.filter((bar) => [bar.t, bar.h, bar.l, bar.c].every(Number.isFinite));
  const range =
    (input.band === undefined ? null : bandPriceRange(input.previous, input.band)) ??
    jiangboPriceRange(
      input.previous,
      bars.length ? Math.max(...bars.map((bar) => bar.h)) : Number.NaN,
      bars.length ? Math.min(...bars.map((bar) => bar.l)) : Number.NaN,
    );
  const span = Math.max(range.max - range.min, Number.EPSILON);
  const plotHeight = Math.max(1, input.height - padY * 2);
  const plotWidth = Math.max(1, input.width - padX * 2);
  const yOf = (price: number) => padY + ((range.max - price) / span) * plotHeight;
  const lineY = (price: number) =>
    input.device ? snapStroke(yOf(price), input.device.scale, input.device.strokePx) : yOf(price);
  const timeSpan = Math.max(interval, input.endT - input.startT);
  const xOf = (time: number) => padX + ((time - input.startT) / timeSpan) * plotWidth;
  const points = bars.map((bar) => ({ t: bar.t + interval, p: bar.c }));
  const runs = splitPriceLine(points, input.previous, interval).map((run) => ({
    above: run.above,
    points: run.points.map((point) => ({ x: xOf(point.t), y: lineY(point.p) })),
  }));
  const tail = points.at(-1);
  return {
    previousY: positive(input.previous) ? yOf(input.previous) : Number.NaN,
    runs,
    last: tail ? { x: xOf(tail.t), y: lineY(tail.p), above: tail.p >= input.previous } : null,
  };
}

/** "HH:MM" for seconds after 09:00, matching formatTime(...).slice(0, 5) in src/lib/utils. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = 9 + Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export type ReadoutTone = "muted" | "fg" | "up" | "down" | "average" | "emaFast" | "emaSlow";
/** `legend` fields are drawn after a short swatch of their colour and wrap together as one unit. */
export type ReadoutField = { text: string; tone: ReadoutTone; legend?: boolean };
/** Width a legend field's colour swatch takes before its text: a 10px swatch and a 4px space. */
export const LEGEND_SWATCH = 14;

/**
 * Fields of the desk chart's readout strip for one completed minute: its interval, its price (or
 * OHLC for candles), the change from the previous close and, only when the source supports them,
 * the source session average and volume in lots.
 */
export function terminalReadout(input: {
  bar: Bar;
  previousClose: number;
  candles: boolean;
  intervalSeconds: number;
  withVolume: boolean;
}): ReadoutField[] {
  const { bar, previousClose } = input;
  const fields: ReadoutField[] = [
    { text: `${clock(bar.t)}–${clock(bar.t + input.intervalSeconds)}`, tone: "muted" },
  ];
  if (input.candles)
    fields.push(
      { text: `開 ${formatPrice(bar.o)}`, tone: "fg" },
      { text: `高 ${formatPrice(bar.h)}`, tone: "fg" },
      { text: `低 ${formatPrice(bar.l)}`, tone: "fg" },
      { text: `收 ${formatPrice(bar.c)}`, tone: "fg" },
    );
  else fields.push({ text: `價 ${formatPrice(bar.c)}`, tone: "fg" });
  if (positive(previousClose)) {
    const change = bar.c - previousClose;
    const size = Math.abs(change).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
    fields.push({
      text: `${change > 0 ? "▲" : change < 0 ? "▼" : ""}${size} ${formatPercentChange(bar.c, previousClose)}`,
      tone: change > 0 ? "up" : change < 0 ? "down" : "muted",
    });
  }
  if (input.withVolume) {
    if (typeof bar.a === "number" && Number.isFinite(bar.a))
      fields.push({ text: `均 ${bar.a.toFixed(2)}`, tone: "average" });
    fields.push({ text: `量 ${bar.v.toLocaleString("zh-TW")} 張`, tone: "fg" });
  }
  return fields;
}

/** Readout fields for the EMA lines, e.g. 「EMA11 256.38」: the first is the fast line, the second the slow one. */
export function emaReadout(values: readonly { period: number; value: number }[]): ReadoutField[] {
  const tones: ReadoutTone[] = ["emaFast", "emaSlow"];
  return values.flatMap((item, index) => {
    const tone = tones[index];
    return tone && Number.isFinite(item.value)
      ? [{ text: `EMA${item.period} ${item.value.toFixed(2)}`, tone, legend: true }]
      : [];
  });
}

/**
 * Splits the readout strip into as many lines as `maxWidth` needs. Fields keep their order and
 * none is dropped; a field wider than the strip gets a line of its own. Consecutive legend fields
 * (each with its swatch) move to the next line together, unless together they are wider than the strip.
 */
export function wrapReadout(
  fields: readonly ReadoutField[],
  measure: (text: string) => number,
  maxWidth: number,
  gap: number,
): ReadoutField[][] {
  const lines: ReadoutField[][] = [];
  let line: ReadoutField[] = [];
  let width = 0;
  const sizeOf = (field: ReadoutField) => measure(field.text) + (field.legend ? LEGEND_SWATCH : 0);
  const place = (field: ReadoutField) => {
    const size = sizeOf(field);
    const next = line.length ? width + gap + size : size;
    if (line.length && next > maxWidth) {
      lines.push(line);
      line = [field];
      width = size;
    } else {
      line.push(field);
      width = next;
    }
  };
  for (let index = 0; index < fields.length; ) {
    if (!fields[index]!.legend) {
      place(fields[index]!);
      index++;
      continue;
    }
    let end = index;
    while (end < fields.length && fields[end]!.legend) end++;
    const unit = fields.slice(index, end);
    const unitWidth = unit.reduce((sum, field, at) => sum + sizeOf(field) + (at ? gap : 0), 0);
    if (unitWidth <= maxWidth && line.length && width + gap + unitWidth > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    unit.forEach(place);
    index = end;
  }
  if (line.length) lines.push(line);
  return lines;
}

export type ChartLabel = {
  key: string;
  /** Short name, e.g. 昨, 開, 高, 低, 前高, 均. */
  text: string;
  price: number;
  priceText: string;
  color: string;
  /** Anchor in CSS px; `anchor` says whether it is the label's left edge, centre or right edge. */
  x: number;
  anchor: "start" | "center" | "end";
  /** Preferred vertical centre in CSS px. */
  y: number;
};
export type PlacedChartLabel = {
  keys: string[];
  price: number;
  parts: { text: string; color: string }[];
  priceText: string;
  left: number;
  width: number;
  y: number;
};
export const LABEL_PADDING = 4;

/** Labels for extra horizontal levels (e.g. 昨高): at the right edge, just above the line, or below it near the top. */
export function levelChartLabels(
  levels: readonly { price: number; label: string }[],
  place: { x: number; top: number; lineHeight: number; color: string; yOf: (price: number) => number; priceText: (price: number) => string },
): ChartLabel[] {
  return levels.map((level, index) => {
    const y = place.yOf(level.price);
    const above = y - place.top >= place.lineHeight;
    return {
      key: `level-${index}`,
      text: level.label,
      price: level.price,
      priceText: place.priceText(level.price),
      color: place.color,
      x: place.x,
      anchor: "end",
      y: above ? y - place.lineHeight / 2 - 1 : y + place.lineHeight / 2 + 1,
    };
  });
}

/** 漲停／跌停 labels of the 江波 view, just inside their lines: 漲停 below its line, 跌停 above. */
export function limitChartLabels(
  previous: number,
  place: {
    x: number;
    lineHeight: number;
    up: string;
    down: string;
    yOf: (price: number) => number;
    priceText: (price: number) => string;
  },
): ChartLabel[] {
  const up = limitUp(previous);
  const down = limitDown(previous);
  if (!positive(up) || !positive(down)) return [];
  return [
    { key: "limit-up", text: "漲停", price: up, priceText: place.priceText(up), color: place.up, x: place.x, anchor: "start", y: place.yOf(up) + place.lineHeight / 2 + 2 },
    { key: "limit-down", text: "跌停", price: down, priceText: place.priceText(down), color: place.down, x: place.x, anchor: "start", y: place.yOf(down) - place.lineHeight / 2 - 2 },
  ];
}

/**
 * Splits placed labels into those drawn under the price and EMA lines (漲停／跌停 on their own, so a
 * price at the limit stays visible) and those drawn over them (every other label, including one that
 * merged with 漲停／跌停).
 */
export function chartLabelLayers(placed: readonly PlacedChartLabel[]): {
  under: PlacedChartLabel[];
  over: PlacedChartLabel[];
} {
  const under = (label: PlacedChartLabel) =>
    label.keys.every((key) => key === "limit-up" || key === "limit-down");
  return { under: placed.filter(under), over: placed.filter((label) => !under(label)) };
}

export function chartLabelText(label: Pick<PlacedChartLabel, "parts" | "priceText">): string {
  return `${label.parts.map((part) => part.text).join("・")} ${label.priceText}`;
}

/**
 * Places the desk chart's in-plot labels so none overlaps another. Labels at the same price that
 * would touch merge into one ("昨・開・低 2575"); others that would overlap move down by one line,
 * or up when there is no room below. Every label stays inside `bounds`.
 *
 * With `maxShiftLines` (cramped charts, e.g. the daily question on a phone or in 大字), labels are
 * placed in the order given, most important first, each at most that many lines from its own
 * price; one that cannot be placed there without overlapping is left out rather than drawn on
 * another label or beside another price's line.
 */
export function resolveChartLabels(
  labels: readonly ChartLabel[],
  bounds: { left: number; right: number; top: number; bottom: number },
  measure: (text: string) => number,
  lineHeight: number,
  options: { maxShiftLines?: number } = {},
): PlacedChartLabel[] {
  const widthOf = (label: Pick<PlacedChartLabel, "parts" | "priceText">) =>
    measure(chartLabelText(label)) + LABEL_PADDING * 2;
  const clampLeft = (left: number, width: number) =>
    Math.max(bounds.left, Math.min(bounds.right - width, left));
  const placed: PlacedChartLabel[] = [];
  for (const label of labels) {
    if (![label.price, label.x, label.y].every(Number.isFinite)) continue;
    const single: PlacedChartLabel = {
      keys: [label.key],
      price: label.price,
      parts: [{ text: label.text, color: label.color }],
      priceText: label.priceText,
      left: 0,
      width: 0,
      y: label.y,
    };
    single.width = widthOf(single);
    const preferred =
      label.anchor === "start"
        ? label.x
        : label.anchor === "center"
          ? label.x - single.width / 2
          : label.x - single.width;
    single.left = clampLeft(preferred, single.width);
    const twin = placed.find(
      (other) =>
        other.price === label.price &&
        single.left < other.left + other.width + lineHeight &&
        other.left < single.left + single.width + lineHeight,
    );
    if (twin) {
      twin.keys.push(label.key);
      twin.parts.push(single.parts[0]!);
      twin.width = widthOf(twin);
      twin.left = clampLeft(twin.left, twin.width);
    } else placed.push(single);
  }
  const half = lineHeight / 2;
  const clampY = (y: number) => Math.min(bounds.bottom - half, Math.max(bounds.top + half, y));
  const settled: PlacedChartLabel[] = [];
  const limit = options.maxShiftLines;
  if (limit !== undefined) {
    for (const label of placed) {
      const wanted = clampY(label.y);
      const offsets = [0, ...Array.from({ length: Math.max(0, Math.floor(limit)) }, (_, i) => [i + 1, -(i + 1)]).flat()];
      const y = offsets
        .map((offset) => wanted + offset * lineHeight)
        .find(
          (slot) =>
            slot === clampY(slot) &&
            !settled.some(
              (other) =>
                label.left < other.left + other.width &&
                other.left < label.left + label.width &&
                Math.abs(other.y - slot) < lineHeight,
            ),
        );
      if (y === undefined) continue;
      label.y = y;
      settled.push(label);
    }
    return settled;
  }
  for (const label of [...placed].sort((a, b) => a.y - b.y)) {
    const overlapping = (y: number) =>
      settled.find(
        (other) =>
          label.left < other.left + other.width &&
          other.left < label.left + label.width &&
          Math.abs(other.y - y) < lineHeight,
      );
    let y = clampY(label.y);
    let hit = overlapping(y);
    for (let guard = 0; hit && guard <= settled.length; guard++) {
      y = hit.y + lineHeight;
      hit = overlapping(y);
    }
    if (y > bounds.bottom - half) {
      y = clampY(label.y);
      hit = overlapping(y);
      for (let guard = 0; hit && guard <= settled.length; guard++) {
        y = hit.y - lineHeight;
        hit = overlapping(y);
      }
    }
    label.y = clampY(y);
    settled.push(label);
  }
  return settled;
}
