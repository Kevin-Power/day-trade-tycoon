// A paper order against a lesson day's real trades (③ §5). Only trades revealed after the order is sent are looked
// at, one cell at a time. A trade that touches the price fills the whole order, whatever its size and the queue
// ahead of it (decision K; the manual says so). Pure: no I/O, no clock.
import type { TradeRow } from "./trades.ts";

/** What matching needs of an order: `seen` is true once a trade after it has been looked at without filling it. */
export type PendingLike = { side: "buy" | "sell"; limitPrice?: number; seen?: boolean };
export type MatchResult = { kind: "fill"; price: number; ms: number } | { kind: "wait"; seen: boolean };

/**
 * One cell's trades (time order) against a waiting order.
 * - Market: the first trade, at its price.
 * - Limit buy: the very first trade after the order at or under the limit fills at that trade's price (the order
 *   met a price already there); after that, any trade at or under the limit fills at the limit.
 * - Limit sell: the same with at or over.
 * No fill: wait, `seen` once any trade has been looked at (an empty cell leaves it as it was).
 */
export function matchOrder(order: PendingLike, trades: readonly TradeRow[]): MatchResult {
  const { side, limitPrice } = order;
  for (let index = 0; index < trades.length; index += 1) {
    const [ms, price] = trades[index];
    if (limitPrice === undefined) return { kind: "fill", price, ms };
    if (side === "buy" ? price <= limitPrice : price >= limitPrice) {
      const first = order.seen !== true && index === 0;
      return { kind: "fill", price: first ? price : limitPrice, ms };
    }
  }
  return { kind: "wait", seen: order.seen === true || trades.length > 0 };
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
