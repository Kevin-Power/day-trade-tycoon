import { z } from "zod";

// Normalized internal contracts, NOT either broker's wire format. No secrets belong here.
const ref = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.positive();
export const scopeSchema = z
  .object({
    broker: z.enum(["fubon", "ibfs"]),
    environment: z.enum(["sandbox", "live"]),
    accountRef: ref,
    tradingDate: z.iso.date(),
  })
  .strict();
export type BrokerScope = z.infer<typeof scopeSchema>;

// Phase 1 deliberately accepts regular-board cash-stock LIMIT orders only.
// Product eligibility, price bands/ticks, cash/stock reservations and session rules
// must still be checked by an authenticated server before dispatch is implemented.
export const intentSchema = z
  .object({
    scope: scopeSchema,
    ownerRef: ref,
    idempotencyKey: ref,
    exchange: z.enum(["TWSE", "TPEX"]),
    symbol: z.string().regex(/^\d{4}$/),
    side: z.enum(["buy", "sell"]),
    shares: positive.max(1_000_000).refine((n) => n % 1000 === 0, "BOARD_LOT_REQUIRED"),
    // Integer TWD * 10,000; avoids binary floating point in the canonical intent.
    limitPrice4: positive.max(1_000_000_000),
    tif: z.literal("ROD"),
    expiresAtMs: positive,
  })
  .strict();
export type DurableIntent = z.infer<typeof intentSchema>;

export const eventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack"), brokerOrderId: ref }).strict(),
  z
    .object({
      kind: z.literal("fill"),
      brokerOrderId: ref,
      executionId: ref,
      shares: positive,
      price4: positive,
    })
    .strict(),
  z
    .object({ kind: z.literal("canceled"), brokerOrderId: ref, cumulativeFilledShares: integer })
    .strict(),
  z.object({ kind: z.literal("rejected"), reasonCode: ref }).strict(),
  z.object({ kind: z.literal("cancel_rejected"), brokerOrderId: ref, reasonCode: ref }).strict(),
  z.object({ kind: z.literal("uncertain"), reasonCode: ref }).strict(),
  z
    .object({
      kind: z.literal("reconciled"),
      brokerOrderId: ref,
      disposition: z.enum(["working", "canceled", "filled", "rejected"]),
      cumulativeFilledShares: integer,
      evidenceRef: ref,
    })
    .strict(),
]);
export type BrokerEvent = z.infer<typeof eventSchema>;

export type OrderState = {
  status:
    | "pending"
    | "sending"
    | "working"
    | "partially_filled"
    | "cancel_pending"
    | "canceled"
    | "filled"
    | "rejected"
    | "unknown"
    | "expired";
  filledShares: number;
  brokerOrderId: string | null;
  closedAs: "canceled" | "rejected" | null;
  cancelPending: boolean;
  needsReconciliation: boolean;
  lastIssue: string | null;
};

export function initialOrderState(): OrderState {
  return {
    status: "pending",
    filledShares: 0,
    brokerOrderId: null,
    closedAs: null,
    cancelPending: false,
    needsReconciliation: false,
    lastIssue: null,
  };
}

export function uncertain(state: OrderState, reason: string): OrderState {
  return { ...state, status: "unknown", needsReconciliation: true, lastIssue: reason };
}

export function scopeKey(scope: BrokerScope): string {
  return JSON.stringify([scope.broker, scope.environment, scope.accountRef, scope.tradingDate]);
}

export function accountKey(scope: BrokerScope): string {
  return JSON.stringify([scope.broker, scope.environment, scope.accountRef]);
}

function statusOf(state: OrderState, shares: number): OrderState["status"] {
  if (state.needsReconciliation) return "unknown";
  if (state.filledShares === shares) return "filled";
  if (state.closedAs) return state.closedAs;
  if (state.cancelPending) return "cancel_pending";
  if (state.filledShares) return "partially_filled";
  if (state.brokerOrderId) return "working";
  return state.status;
}

/** Apply only after durable event deduplication; a late fill can follow a cancel. */
export function reduceBrokerEvent(
  state: OrderState,
  event: BrokerEvent,
  shares: number,
): OrderState {
  let next = { ...state };
  if ("brokerOrderId" in event) {
    if (state.brokerOrderId && state.brokerOrderId !== event.brokerOrderId)
      return uncertain(state, "BROKER_ORDER_ID_CONFLICT");
    next.brokerOrderId = event.brokerOrderId;
  }
  if (event.kind === "uncertain") return uncertain(next, event.reasonCode);
  if (state.status === "pending" || state.status === "expired")
    return uncertain(next, "REPORT_WITHOUT_DISPATCH");

  switch (event.kind) {
    case "ack":
      // Late acceptance must not reopen a canceled/filled order or clear uncertainty.
      break;
    case "fill":
      if (next.closedAs === "rejected" || event.shares > shares - next.filledShares)
        return uncertain(next, "FILL_QUANTITY_CONFLICT");
      next.filledShares += event.shares;
      break;
    case "canceled":
      if (next.closedAs === "rejected") return uncertain(next, "CANCEL_AFTER_REJECTION");
      next.closedAs = "canceled";
      next.cancelPending = false;
      if (event.cumulativeFilledShares !== next.filledShares)
        next = uncertain(next, "CANCEL_FILL_RECONCILIATION_REQUIRED");
      break;
    case "rejected":
      if (next.filledShares || next.brokerOrderId || next.closedAs === "canceled")
        return uncertain(next, "REJECTION_CONFLICT");
      next.closedAs = "rejected";
      next.lastIssue = event.reasonCode;
      break;
    case "cancel_rejected":
      next.cancelPending = false;
      next.lastIssue = event.reasonCode;
      break;
    case "reconciled":
      // A query's aggregate never manufactures missing executions or money movements.
      if (
        event.cumulativeFilledShares !== next.filledShares ||
        (event.disposition === "filled" && next.filledShares !== shares) ||
        (event.disposition === "working" && next.filledShares === shares) ||
        (event.disposition === "rejected" && next.filledShares !== 0)
      )
        return uncertain(next, "RECONCILIATION_MISMATCH");
      // Reopening a locally terminal order is a conflict requiring manual investigation.
      if (next.closedAs && event.disposition !== next.closedAs && event.disposition !== "filled")
        return uncertain(next, "TERMINAL_STATE_CONFLICT");
      next.closedAs =
        event.disposition === "canceled" || event.disposition === "rejected"
          ? event.disposition
          : null;
      next.needsReconciliation = false;
      next.cancelPending = false;
      next.lastIssue = null;
      break;
  }
  return { ...next, status: statusOf(next, shares) };
}
