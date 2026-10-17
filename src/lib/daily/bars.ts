import type { Bar } from "../game/types.ts";
import type { MarketBarRow } from "../market-days.server.ts";

/** 13:24, the last minute of continuous trading; 13:25–13:29 is the closing call auction. */
export const SESSION_LAST_CONTINUOUS_T = 15840;
/** The 13:30 closing auction bar. */
export const CLOSE_T = 16200;

/**
 * Fubon omits minutes without trades. Continuous-session gaps become flat bars at the previous
 * close with no volume, so time and swing-high rules see one bar per minute. The closing
 * auction is kept as published and the auction minutes are not invented.
 */
export function densifyBars(rows: readonly MarketBarRow[]): Bar[] {
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  const bars: Bar[] = [];
  for (const [t, o, h, l, c, v] of sorted) {
    if (t > SESSION_LAST_CONTINUOUS_T) continue;
    const previous = bars.at(-1);
    if (previous) {
      for (let gap = previous.t + 60; gap < t; gap += 60)
        bars.push({ t: gap, o: previous.c, h: previous.c, l: previous.c, c: previous.c, v: 0 });
    }
    if (previous?.t !== t) bars.push({ t, o, h, l, c, v });
  }
  const close = sorted.find((row) => row[0] === CLOSE_T);
  if (close) {
    const [t, o, h, l, c, v] = close;
    bars.push({ t, o, h, l, c, v });
  }
  return bars;
}
