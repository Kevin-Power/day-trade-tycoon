import type { Order } from "./types";

/** A cancelled remainder is no longer waiting, even when some lots already filled. */
export function orderPresentation(order: Pick<Order, "status" | "lots" | "filled">) {
  const working = order.status === "pending" || order.status === "partial";
  const remainder = Math.max(0, order.lots - order.filled);
  const statusLabel =
    order.status === "cancelled"
      ? order.filled > 0
        ? "部分成交，餘量已取消"
        : "已取消，未成交"
      : order.status === "filled"
        ? "全部成交"
        : order.status === "partial"
          ? "部分成交，餘量等待中"
          : "等待成交";
  return {
    statusLabel,
    working,
    waitingLots: working ? remainder : 0,
    cancelledLots: order.status === "cancelled" ? remainder : 0,
  };
}
