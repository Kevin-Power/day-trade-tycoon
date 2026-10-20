// The lesson's real TAIEX on the desk: the minute being replayed shows its real 5-second values so far,
// and the quote numbers use index formatting (thousands separators, two decimals).
import type { MorningIndexBar, MorningIndexSeries } from "./morning.ts";
import { formatPercentChange } from "./market/chart-data.ts";

/** Index points as TWSE prints them: thousands separators, two decimals (same rule as market/week formatIndex,
 *  which this module cannot import under node:test because of its path alias). */
export function formatIndexValue(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The minute `fraction` of the way through its replay: only the 5-second values reached so far. */
export function formingIndexBar(bar: MorningIndexBar, fraction: number): MorningIndexBar {
  if (!(fraction < 1)) return { ...bar };
  const count = Number.isFinite(fraction) ? Math.max(1, Math.floor(fraction * bar.p.length)) : 1;
  const shown = bar.p.slice(0, count);
  return { t: bar.t, o: shown[0], h: Math.max(...shown), l: Math.min(...shown), c: shown.at(-1)!, p: shown };
}

export type IndexSummary = {
  last: number | null;
  change: number | null;
  changeText: string;
  percentText: string;
  tone: "up" | "down" | "flat";
  open: number | null;
  high: number | null;
  low: number | null;
};

/** The index quote from its revealed minutes; empty strings and nulls before the first minute. */
export function indexSummary(bars: readonly MorningIndexBar[], previousClose: number): IndexSummary {
  const last = bars.at(-1)?.c ?? null;
  const change = last === null ? null : Math.round((last - previousClose) * 100) / 100;
  return {
    last,
    change,
    changeText: change === null ? "" : formatIndexValue(Math.abs(change)),
    percentText: last === null ? "" : formatPercentChange(last, previousClose),
    tone: change === null || change === 0 ? "flat" : change > 0 ? "up" : "down",
    open: bars[0]?.o ?? null,
    high: bars.length ? Math.max(...bars.map((bar) => bar.h)) : null,
    low: bars.length ? Math.min(...bars.map((bar) => bar.l)) : null,
  };
}

/** Why the index shows nothing yet: no run, a run before 09:00 is revealed, or a lesson without index data. */
export type IndexAvailability = "no-run" | "waiting" | "none" | "ready";

export function indexAvailability(input: {
  hasRun: boolean;
  series: MorningIndexSeries | undefined;
}): IndexAvailability {
  if (!input.hasRun) return "no-run";
  if (!input.series) return "none";
  return input.series.bars.length ? "ready" : "waiting";
}

/** The 大盤 pane's text for each empty state; only a run without an index says the lesson has none. */
export const INDEX_EMPTY_TEXT: Record<Exclude<IndexAvailability, "ready">, string> = {
  "no-run": "開始練習後顯示大盤",
  waiting: "第一分鐘揭露後顯示大盤",
  none: "本教材沒有大盤資料",
};
