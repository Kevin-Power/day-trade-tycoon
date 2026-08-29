import type { Fill, Order, OrderType, Side } from "@/lib/game/types";

export type Venue = "sim" | "live";
export type TimeInForce = "ROD" | "IOC" | "FOK";
export type AccountKind = "daytrade";

export type OrderIntent = {
  venue: Venue;
  accountId: string;
  kind: AccountKind;
  code: string;
  side: Side;
  type: OrderType;
  tif: TimeInForce;
  lots: number;
  price?: number;
};

export type BrokerAck =
  | { ok: true; order: Order; fills: Fill[] }
  | { ok: false; reason: string };

export type BrokerPort = {
  venue: Venue;
  label: string;
  accountId: string;
  ready: boolean;
  place(intent: OrderIntent): BrokerAck;
  cancel(orderId: string): boolean;
  flatten(code: string): BrokerAck;
};
