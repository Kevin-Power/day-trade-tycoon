import type { MorningFill, MorningState } from "./morning.ts";
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
