// Order rules and reports next to the ticket: what counts as a large order (it needs a second look before it is
// sent), and the run's latest order events — sent, filled, cancelled or turned down, and sends that failed in
// this visit. Reports come from the run's own records; nothing here changes an order.
import type { MorningState } from "./morning.ts";
import { formatPrice } from "./market/ticks.ts";
import { formatTime } from "./utils.ts";

/** A buy is large from this share of the available cash: it needs an explicit confirmation. */
export const LARGE_ORDER_CASH_SHARE = 0.5;

/** Buys only: selling reduces a position, so it is never held back. */
export function isLargeOrder(input: {
  side: "buy" | "sell";
  amount: number | null;
  availableCash: number;
}): boolean {
  const { side, amount, availableCash } = input;
  return (
    side === "buy" &&
    amount !== null &&
    Number.isFinite(amount) &&
    availableCash > 0 &&
    amount >= LARGE_ORDER_CASH_SHARE * availableCash
  );
}

/** A send that failed in this visit (the server refused it or the connection dropped). Kept on screen only. */
export type LocalOrderFailure = {
  id: string;
  cursor: number;
  second: number;
  code: string;
  side: "buy" | "sell";
  lots: number;
  limitPrice?: number;
  message: string;
};

export type OrderReport = {
  key: string;
  /** HH:MM, or null when the run did not record when it happened (a cancel or a turned-down order). */
  time: string | null;
  tone: "sent" | "filled" | "closed" | "failed";
  text: string;
};

const clock = (seconds: number) => formatTime(seconds).slice(0, 5);
const LEARNER_CANCEL = "由學員取消";

/** The run's order events and this visit's failed sends, newest first, at most `limit`. */
export function orderReports(
  state: MorningState | null,
  names: Record<string, string>,
  failures: readonly LocalOrderFailure[],
  limit = 5,
): OrderReport[] {
  const what = (side: "buy" | "sell", code: string, lots: number) =>
    `${side === "buy" ? "買進" : "賣出"} ${names[code] ?? code} ${lots} 張`;
  const how = (limitPrice: number | undefined) =>
    limitPrice === undefined ? "市價" : `限價 ${formatPrice(limitPrice)}`;
  // Server events in the order they happened: each order's send, then its result. Only one order waits at a time.
  const events: { cursor: number; report: OrderReport }[] = [];
  for (const order of state?.orders ?? []) {
    const lots = order.shares / 1000;
    const subject = what(order.side, order.code, lots);
    events.push({
      cursor: order.submittedCursor,
      report: {
        key: `${order.id}:sent`,
        time: clock(order.submittedCursor * 60),
        tone: "sent",
        text: `委託成功 · ${order.entryMode === "lightning" ? "閃電 · " : ""}${subject} ${how(order.limitPrice)}${
          order.limitPrice === undefined ? "（待下一分鐘開盤撮合）" : ""
        }`,
      },
    });
    if (order.status === "filled") {
      const fill = state?.fills.find((item) => item.id === order.id);
      const t = fill?.t ?? order.submittedCursor * 60;
      events.push({
        cursor: t / 60,
        report: {
          key: `${order.id}:filled`,
          time: clock(t),
          tone: "filled",
          text: `成交 · ${subject} @ ${formatPrice(fill?.price ?? order.price ?? 0)}`,
        },
      });
    } else if (order.status === "cancelled" || order.status === "rejected") {
      const label = order.status === "cancelled" && order.reason === LEARNER_CANCEL ? "已撤回" : "未成交";
      events.push({
        cursor: order.submittedCursor,
        report: {
          key: `${order.id}:${order.status}`,
          time: null,
          tone: "closed",
          text: `${label} · ${subject} ${how(order.limitPrice)}${order.reason ? ` · ${order.reason}` : ""}`,
        },
      });
    }
  }
  const failed = failures.map((failure) => ({
    cursor: failure.cursor,
    report: {
      key: `failed:${failure.id}`,
      time: clock(failure.cursor * 60),
      tone: "failed" as const,
      text: `送出失敗 · ${what(failure.side, failure.code, failure.lots)}${
        failure.limitPrice === undefined ? "" : ` 限價 ${formatPrice(failure.limitPrice)}`
      } · ${failure.message}`,
    },
  }));
  // A failed send goes after the run's events of the same or an earlier minute.
  const merged: OrderReport[] = [];
  let next = 0;
  for (const event of events) {
    while (next < failed.length && failed[next].cursor < event.cursor) merged.push(failed[next++].report);
    merged.push(event.report);
  }
  while (next < failed.length) merged.push(failed[next++].report);
  return merged.reverse().slice(0, limit);
}
