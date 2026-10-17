import type { Bar } from "./game/types.ts";
import type { MorningBookLevel } from "./morning-book.ts";
import { formatPercentChange } from "./market/chart-data.ts";

export type QuoteTone = "up" | "down" | "flat";

export type QuoteSummary = {
  last: number | null;
  change: number | null;
  /** Unsigned, grouped; the arrow (▲/▼) carries the direction. */
  changeText: string;
  percentText: string;
  tone: QuoteTone;
  open: number | null;
  high: number | null;
  low: number | null;
};

const toneOf = (value: number | null): QuoteTone =>
  value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";

/** Quote line for one stock from its revealed bars only; nothing before the first minute. */
export function quoteSummary(bars: readonly Bar[], previousClose: number): QuoteSummary {
  const last = bars.at(-1)?.c ?? null;
  const change = last === null ? null : Math.round((last - previousClose) * 10000) / 10000;
  return {
    last,
    change,
    changeText:
      change === null ? "" : Math.abs(change).toLocaleString("zh-TW", { maximumFractionDigits: 2 }),
    percentText: last === null ? "" : formatPercentChange(last, previousClose),
    tone: toneOf(change),
    open: bars[0]?.o ?? null,
    high: bars.length ? Math.max(...bars.map((bar) => bar.h)) : null,
    low: bars.length ? Math.min(...bars.map((bar) => bar.l)) : null,
  };
}

/** Best bid and ask of the illustrative teaching book (the ladder's 買1 and 賣1). */
export function bestQuotes(book: {
  bids: readonly MorningBookLevel[];
  asks: readonly MorningBookLevel[];
}): { bid: number | null; ask: number | null } {
  return { bid: book.bids[0]?.price ?? null, ask: book.asks[0]?.price ?? null };
}

/** Reference P&L of a position at the last revealed close, before fees and tax. */
export function positionMark(
  position: { shares: number; averageCost: number },
  lastClose: number | undefined,
): { value: number | null; tone: QuoteTone } {
  if (lastClose === undefined || !Number.isFinite(lastClose)) return { value: null, tone: "flat" };
  const value = Math.round((lastClose - position.averageCost) * position.shares);
  return { value: value === 0 ? 0 : value, tone: toneOf(value) };
}
