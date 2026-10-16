import type { MorningState } from "./morning.ts";

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
