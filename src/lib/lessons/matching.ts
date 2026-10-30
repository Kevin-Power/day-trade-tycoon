// A paper order against a lesson day's real trades (③ §5, changed by the 2026-10-30 lot design to 「量夠才成交」).
// Only trades revealed after the order is sent are looked at, one cell at a time. The trades that touch its price
// (every trade for a market order) are counted until their lots reach the order's; then the whole order fills at
// once, never in part. The queue ahead of the order and the books are not looked at. Pure: no I/O, no clock.
import type { TradeRow } from "./trades.ts";

/**
 * What matching needs of a waiting order, and what earlier cells gathered for it (carried from cell to cell).
 * `seen`: a trade after it has been looked at. `filledLots`: lots of the touching trades counted so far, and
 * `filledValue` their value (price × lots counted). `atLimit`: a limit whose first trade after it did not touch,
 * so it fills at its own price.
 */
export type PendingLike = {
  side: "buy" | "sell";
  lots: number;
  limitPrice?: number;
  seen?: boolean;
  filledLots?: number;
  filledValue?: number;
  atLimit?: boolean;
};
export type MatchProgress = { seen: boolean; filledLots: number; filledValue: number; atLimit: boolean };
export type MatchResult = { kind: "fill"; price: number; ms: number } | ({ kind: "wait" } & MatchProgress);

/** The reasons an order still waiting at the end of the lesson is cancelled. */
export const QUIET_CANCEL = "之後沒有成交";
export const END_CANCEL = "教材結束，委託未成交";
export const VOLUME_CANCEL = "成交量不足";

/**
 * One cell's trades (time order) against a waiting order.
 * - Market: every trade counts; the fill is at the average price of the lots taken (the last trade only for the lots
 *   still needed).
 * - Limit buy: only trades at or under the limit count (a sell: at or over). When the very first trade after the
 *   order touches, the order met prices already there: it fills at the average of the lots taken, never worse than
 *   the limit. When that first trade does not touch, the order rests and fills at the limit.
 * The fill's time is the trade that completes the lots. No fill: wait with what was counted (an empty cell leaves
 * it as it was).
 */
export function matchOrder(order: PendingLike, trades: readonly TradeRow[]): MatchResult {
  const { side, lots, limitPrice } = order;
  let seen = order.seen === true;
  let filledLots = order.filledLots ?? 0;
  let filledValue = order.filledValue ?? 0;
  let atLimit = order.atLimit === true;
  for (const [ms, price, size] of trades) {
    const touches = limitPrice === undefined || (side === "buy" ? price <= limitPrice : price >= limitPrice);
    if (!seen && !touches) atLimit = true;
    seen = true;
    if (!touches) continue;
    const taken = Math.min(size, lots - filledLots);
    filledLots += taken;
    filledValue += price * taken;
    if (filledLots >= lots) return { kind: "fill", price: fillPrice(order, filledValue, atLimit), ms };
  }
  return { kind: "wait", seen, filledLots, filledValue, atLimit };
}

function fillPrice({ side, lots, limitPrice }: PendingLike, value: number, atLimit: boolean): number {
  if (limitPrice === undefined) return value / lots;
  if (atLimit) return limitPrice;
  return side === "buy" ? Math.min(value / lots, limitPrice) : Math.max(value / lots, limitPrice);
}

/** Why an order still waiting at 10:30 is cancelled: no trade after it, none touching, or not enough lots. */
export function endReason(order: { seen?: boolean; filledLots?: number }): string {
  if (order.seen !== true) return QUIET_CANCEL;
  return (order.filledLots ?? 0) > 0 ? VOLUME_CANCEL : END_CANCEL;
}

/** How many of the trades (time order) are before `ms`: the ones revealed when the cursor is at `ms`. */
export function tradesBefore(trades: readonly TradeRow[], ms: number): number {
  let low = 0;
  let high = trades.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (trades[middle][0] < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}
