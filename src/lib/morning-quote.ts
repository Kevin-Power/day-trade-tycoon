import type { Bar } from "./game/types.ts";
import type { MorningBookLevel } from "./morning-book.ts";
import { formatPercentChange } from "./market/chart-data.ts";
import { formatPrice } from "./market/ticks.ts";

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

export type QuoteDetailRow = { label: string; value: string; tone: QuoteTone; simulated?: boolean };

/**
 * 報價明細 in broker order: trade, change, open/high/low, previous close, [average], amplitude and time. 振幅 is
 * (high − low) ÷ previous close; 均價 appears only when every revealed minute carries the source's average (no
 * estimate); volume fields wait for verified volume. While a minute replays, 成交 is a simulated trade.
 */
export function quoteDetailRows(input: {
  bars: readonly Bar[];
  previousClose: number;
  time: string;
  simulated: boolean;
}): QuoteDetailRow[] {
  const { bars, previousClose } = input;
  const quote = quoteSummary(bars, previousClose);
  const price = (value: number | null) => (value === null ? "—" : formatPrice(value));
  const tone = (value: number | null): QuoteTone =>
    value === null || value === previousClose ? "flat" : value > previousClose ? "up" : "down";
  const arrow = quote.tone === "up" ? "▲" : quote.tone === "down" ? "▼" : "";
  const average = bars.length && bars.every((bar) => typeof bar.a === "number") ? bars.at(-1)!.a! : null;
  const amplitude =
    quote.high !== null && quote.low !== null && previousClose > 0
      ? `${(((quote.high - quote.low) / previousClose) * 100).toFixed(2)}%`
      : "—";
  return [
    { label: "成交", value: price(quote.last), tone: quote.tone, ...(input.simulated && quote.last !== null ? { simulated: true } : {}) },
    { label: "漲跌", value: quote.last === null ? "—" : `${arrow}${quote.changeText}`, tone: quote.tone },
    { label: "漲跌幅", value: quote.percentText || "—", tone: quote.tone },
    { label: "開盤", value: price(quote.open), tone: tone(quote.open) },
    { label: "最高", value: price(quote.high), tone: tone(quote.high) },
    { label: "最低", value: price(quote.low), tone: tone(quote.low) },
    { label: "昨收", value: formatPrice(previousClose), tone: "flat" },
    ...(average === null ? [] : [{ label: "均價", value: formatPrice(average), tone: tone(average) }]),
    { label: "振幅", value: amplitude, tone: "flat" },
    { label: "時間", value: input.time, tone: "flat" },
  ];
}
