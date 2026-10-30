import type { MorningFill, MorningOrder, MorningState } from "./morning.ts";
import { formatPrice } from "./market/ticks.ts";
import { formatTime } from "./utils.ts";

export type LedgerSummary = { positions: number; orders: number; pending: number; fills: number };

/** Counts for the ledger tabs; `pending` is highlighted while the ledger is collapsed. */
export function ledgerSummary(
  session: Pick<MorningState, "positions" | "orders" | "fills">,
): LedgerSummary {
  return {
    positions: session.positions.length,
    orders: session.orders.length,
    pending: session.orders.filter((order) => order.status === "pending").length,
    fills: session.fills.length,
  };
}

/**
 * When a fill happened, as the 成交紀錄 shows it: to the second (HH:MM:SS) from the real trade's `ms`; a run made
 * before the trades were kept has no `ms`, and shows the minute of its bar (HH:MM) from `t`, as it always did.
 */
export function fillClock(fill: Pick<MorningFill, "t" | "ms">): string {
  if (typeof fill.ms === "number" && Number.isFinite(fill.ms) && fill.ms >= 0)
    return formatTime(Math.floor(fill.ms / 1000));
  return formatTime(fill.t).slice(0, 5);
}

/**
 * A fill's price as the desk shows it. A fill of one trade is that trade's price, written as the tick grid writes it;
 * an order filled from several trades (量夠才成交) is their average, which can be off the grid: two decimals then,
 * so a 1,000+ stock's 1462.5 is not shown as 1463.
 */
export function fillPriceText(price: number): string {
  const plain = formatPrice(price);
  return !Number.isFinite(price) || Math.abs(Number(plain) - price) < 1e-9 ? plain : price.toFixed(2);
}

/** A waiting order's progress toward its lots: 「已累計 120／400 張」. */
export function lotProgress(order: Pick<MorningOrder, "shares" | "filledLots">): string {
  const lots = order.shares / 1000;
  return `已累計 ${Math.min(order.filledLots ?? 0, lots)}／${lots} 張`;
}
