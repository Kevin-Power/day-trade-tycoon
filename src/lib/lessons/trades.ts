// Real trades of a lesson day's morning (09:00–10:30), and the one-minute bars they must agree with.
import type { Bar } from "../game/types.ts";
import type { MarketBarRow } from "../market-days.server.ts";

/** [ms after 09:00, price, size in lots, best bid at the time | null, best ask at the time | null] */
export type TradeRow = readonly [ms: number, price: number, size: number, bid: number | null, ask: number | null];

export const CELL_MS = 60_000;
export const MORNING_CELLS = 90;
export const MORNING_END_MS = 5_400_000;

const TOLERANCE = 1e-9;
const same = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE; // false for NaN

/** Index of the first trade at or after `ms` (trades are in time order). */
function firstAtOrAfter(trades: readonly TradeRow[], ms: number): number {
  let low = 0;
  let high = trades.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (trades[middle][0] < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

function cellRange(trades: readonly TradeRow[], cell: number): [from: number, to: number] {
  const from = firstAtOrAfter(trades, cell * CELL_MS);
  return [from, firstAtOrAfter(trades, (cell + 1) * CELL_MS)];
}

/** The trades with ms in [cell·60000, (cell+1)·60000). */
export function cellSlice(trades: readonly TradeRow[], cell: number): readonly TradeRow[] {
  const [from, to] = cellRange(trades, cell);
  return trades.slice(from, to);
}

/**
 * The morning's one-minute bars, from the first trade's minute to 10:29, checked against the trades: each minute's
 * open, high, low, close and volume made from its trades must equal the published bar at the same `t`, and a
 * minute has a bar exactly when it has trades. Any difference is `null`. A minute with trades is the published bar
 * (its `a` kept); a quiet one is flat at the previous close with volume 0 and the previous `a`. No trade in the
 * morning is `[]`.
 */
export function morningBars(dayBars: readonly MarketBarRow[], trades: readonly TradeRow[]): Bar[] | null {
  const byT = new Map<number, MarketBarRow>();
  for (const bar of dayBars) {
    if (bar[0] >= MORNING_END_MS / 1000) continue;
    if (byT.has(bar[0])) return null;
    byT.set(bar[0], bar);
  }
  let matched = 0;
  const bars: Bar[] = [];
  for (let cell = 0; cell < MORNING_CELLS; cell += 1) {
    const t = cell * 60;
    const published = byT.get(t);
    const [from, to] = cellRange(trades, cell);
    if (from === to) {
      if (published) return null;
      const previous = bars.at(-1);
      if (previous) {
        const flat: Bar = { t, o: previous.c, h: previous.c, l: previous.c, c: previous.c, v: 0 };
        if (previous.a !== undefined) flat.a = previous.a;
        bars.push(flat);
      }
      continue;
    }
    if (!published) return null;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let index = from; index < to; index += 1) {
      const [, price, size] = trades[index];
      high = Math.max(high, price);
      low = Math.min(low, price);
      volume += size;
    }
    const [, o, h, l, c, v, a] = published;
    if (!same(o, trades[from][1]) || !same(h, high) || !same(l, low) || !same(c, trades[to - 1][1]) || !same(v, volume)) return null;
    matched += 1;
    const bar: Bar = { t, o, h, l, c, v };
    if (typeof a === "number" && Number.isFinite(a)) bar.a = a;
    bars.push(bar);
  }
  // A published bar that is not one of the 90 minutes (off the minute, before 09:00) is a difference too.
  return matched === byT.size ? bars : null;
}
