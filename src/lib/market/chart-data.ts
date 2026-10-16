import type { Bar, TickPt } from "../game/types.ts";

export type ChartRange = { start: number; end?: number };

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
  const dpr = Math.min(3, requested);
  // Only trust the box when it agrees with the ratio to within one device pixel (snapping), and
  // stays inside the three-times cap; some engines report CSS pixels here.
  const exact =
    deviceBox &&
    deviceBox.width >= 1 &&
    deviceBox.height >= 1 &&
    deviceBox.width <= width * 3 &&
    deviceBox.height <= height * 3 &&
    Math.abs(deviceBox.width - width * requested) <= 1 &&
    Math.abs(deviceBox.height - height * requested) <= 1;
  const pixelWidth = Math.max(1, exact ? deviceBox.width : Math.round(width * dpr));
  const pixelHeight = Math.max(1, exact ? deviceBox.height : Math.round(height * dpr));
  return {
    width: pixelWidth,
    height: pixelHeight,
    scaleX: pixelWidth / width,
    scaleY: pixelHeight / height,
  };
}

const usableScale = (scale: number) => Number.isFinite(scale) && scale > 0;

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

type PriceRange = { min: number; max: number };
const positive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * Intraday (分時) price range for the trading desk: symmetric about the previous close, so the
 * percent axis reads −x% / 0 / +x%, and never narrower than ±minFraction of that close.
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
 * Watchlist sparkline geometry in CSS pixels. Uses the same symmetric range as the big intraday
 * chart and the whole lesson as its time axis, so both charts have the same shape. Closes sit at
 * the end of their minute; a missing minute breaks the line.
 */
export function sparklineLayout(input: {
  bars: readonly Bar[];
  previous: number;
  startT: number;
  endT: number;
  width: number;
  height: number;
  intervalSeconds?: number;
}): {
  previousY: number;
  runs: { above: boolean; points: SparkPoint[] }[];
  last: (SparkPoint & { above: boolean }) | null;
} {
  const interval = input.intervalSeconds ?? 60;
  const padX = 3;
  const padY = 4;
  const bars = input.bars.filter((bar) => [bar.t, bar.h, bar.l, bar.c].every(Number.isFinite));
  const range = jiangboPriceRange(
    input.previous,
    bars.length ? Math.max(...bars.map((bar) => bar.h)) : Number.NaN,
    bars.length ? Math.min(...bars.map((bar) => bar.l)) : Number.NaN,
  );
  const span = Math.max(range.max - range.min, Number.EPSILON);
  const plotHeight = Math.max(1, input.height - padY * 2);
  const plotWidth = Math.max(1, input.width - padX * 2);
  const yOf = (price: number) => padY + ((range.max - price) / span) * plotHeight;
  const timeSpan = Math.max(interval, input.endT - input.startT);
  const xOf = (time: number) => padX + ((time - input.startT) / timeSpan) * plotWidth;
  const points = bars.map((bar) => ({ t: bar.t + interval, p: bar.c }));
  const runs = splitPriceLine(points, input.previous, interval).map((run) => ({
    above: run.above,
    points: run.points.map((point) => ({ x: xOf(point.t), y: yOf(point.p) })),
  }));
  const tail = points.at(-1);
  return {
    previousY: positive(input.previous) ? yOf(input.previous) : Number.NaN,
    runs,
    last: tail ? { x: xOf(tail.t), y: yOf(tail.p), above: tail.p >= input.previous } : null,
  };
}
