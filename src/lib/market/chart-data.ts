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

export function canvasResolution(width: number, height: number, ratio: number) {
  const dpr = Math.min(3, Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  return {
    width: pixelWidth,
    height: pixelHeight,
    scaleX: pixelWidth / width,
    scaleY: pixelHeight / height,
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
