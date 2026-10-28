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

/**
 * Illustrative depth only: no source volume, future bars, network feed or fill authority. With the latest
 * replayed trade, the last price sits on the side that trade took (an uptick lifted the ask, a downtick hit
 * the bid) and the quantities shift from trade to trade; without it, 買1 is the last price.
 */
export function createMorningBook(
  code: string,
  cursor: number,
  last: number,
  previousClose: number,
  trade?: { index: number; side: "ask" | "bid" | null },
): {
  bids: MorningBookLevel[];
  asks: MorningBookLevel[];
} {
  if (cursor < 1 || !Number.isFinite(last) || last <= 0) return { bids: [], asks: [] };
  const center = roundToTick(last);
  const seed = [...code].reduce((sum, character) => sum * 31 + character.charCodeAt(0), 0) >>> 0;
  const lifted = trade?.side === "ask";
  const shift = trade ? trade.index * 13 : 0;
  const levels = (ask: boolean) =>
    Array.from({ length: 5 }, (_, index) => ({
      level: index + 1,
      price: stepTick(center, ask ? (lifted ? index : index + 1) : lifted ? -(index + 1) : -index),
      lots: 3 + ((seed + cursor * 17 + index * 29 + (ask ? 41 : 0) + shift) % 78),
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

/** 左買右賣 (the 10/20 meeting): a left (委買) cell buys at its price, a right (委賣) cell sells at its price. */
export function bookCellOrder(cell: "bid" | "ask"): "buy" | "sell" {
  return cell === "bid" ? "buy" : "sell";
}

/** Whether a trading cell waits: while the ticket is locked, and a sell without the lots in holdings. A display
 *  book (the phone's 行情 page) only hands the price over, so its cells never wait. */
export function bookCellBlocked(input: {
  cell: "bid" | "ask";
  trading: boolean;
  locked: boolean;
  holdingLots: number;
  lots: number;
}): boolean {
  if (!input.trading) return false;
  return input.locked || (input.cell === "ask" && input.holdingLots < input.lots);
}

/** A cell's accessible name, e.g. 「買1 2575，點擊以 2575 限價買進 1 張」 (spec 5.1). */
export function bookCellLabel(input: {
  cell: "bid" | "ask";
  level: number;
  price: string;
  lots: number;
  trading: boolean;
}): string {
  const buy = input.cell === "bid";
  const name = `${buy ? "買" : "賣"}${input.level} ${input.price}`;
  return input.trading
    ? `${name}，點擊以 ${input.price} 限價${buy ? "買進" : "賣出"} ${input.lots} 張`
    : `${name}，點擊帶入下單（${buy ? "買進" : "賣出"}）`;
}
