import { limitDown, limitUp, roundToTick, stepTick } from "./market/ticks.ts";

export type MorningBookLevel = { level: number; price: number; lots: number };

export function validMorningLimit(price: number, previousClose: number): boolean {
  return (
    Number.isFinite(price) &&
    price > 0 &&
    Math.abs(roundToTick(price) - price) < 1e-8 &&
    price >= limitDown(previousClose) &&
    price <= limitUp(previousClose)
  );
}

/** Illustrative depth only: no source volume, future bars, network feed or fill authority. */
export function createMorningBook(
  code: string,
  cursor: number,
  last: number,
  previousClose: number,
): {
  bids: MorningBookLevel[];
  asks: MorningBookLevel[];
} {
  if (cursor < 1 || !Number.isFinite(last) || last <= 0) return { bids: [], asks: [] };
  const center = roundToTick(last);
  const seed = [...code].reduce((sum, character) => sum * 31 + character.charCodeAt(0), 0) >>> 0;
  const levels = (ask: boolean) =>
    Array.from({ length: 5 }, (_, index) => ({
      level: index + 1,
      price: stepTick(center, ask ? index + 1 : -index),
      lots: 3 + ((seed + cursor * 17 + index * 29 + (ask ? 41 : 0)) % 78),
    })).filter((level) => validMorningLimit(level.price, previousClose));
  return { bids: levels(false), asks: levels(true) };
}

/** Share of illustrative bid lots among all shown lots; 0.5 when nothing is shown. Teaching data only. */
export function bookPressure(book: {
  bids: readonly MorningBookLevel[];
  asks: readonly MorningBookLevel[];
}): { bidLots: number; askLots: number; bidShare: number } {
  const bidLots = book.bids.reduce((sum, level) => sum + level.lots, 0);
  const askLots = book.asks.reduce((sum, level) => sum + level.lots, 0);
  const total = bidLots + askLots;
  return { bidLots, askLots, bidShare: total > 0 ? bidLots / total : 0.5 };
}
