import type { DayMarket } from "@/lib/market/engine";
import type { BrokerAck, BrokerPort, OrderIntent, Venue } from "@/lib/broker/types";
import { LIVE_UNWIRED_REASON, rejectUnsupportedTif } from "@/lib/broker/copy";

export type { BrokerAck, BrokerPort, OrderIntent, TimeInForce, Venue } from "@/lib/broker/types";
export {
  CANCEL_FAILED_REASON,
  CANCEL_OK_REASON,
  LIVE_ADAPTER_UNWIRED_REASON,
  LIVE_UNWIRED_REASON,
  SIM_ROD_ONLY_REASON,
  SIM_TIF_HINT,
  rejectUnsupportedTif,
  simAllowsTif,
} from "@/lib/broker/copy";

export const SIM_ACCOUNT = "CLASSROOM-SIM";
export const LIVE_ACCOUNT = "BROKER-LIVE";

export function venueLabel(v: Venue): string {
  return v === "live" ? "實盤" : "模擬盤";
}

export function getBroker(venue: Venue, engine: DayMarket | null): BrokerPort {
  return venue === "live" ? liveBroker() : simBroker(engine);
}

function simBroker(engine: DayMarket | null): BrokerPort {
  return {
    venue: "sim",
    label: "模擬盤",
    accountId: SIM_ACCOUNT,
    ready: Boolean(engine),
    place(intent: OrderIntent): BrokerAck {
      if (!engine) return { ok: false, reason: "盤室尚未開啟" };
      const tifReason = rejectUnsupportedTif(intent.tif);
      if (tifReason) return { ok: false, reason: tifReason };
      return engine.place({
        code: intent.code,
        side: intent.side,
        type: intent.type,
        lots: intent.lots,
        price: intent.price,
      });
    },
    cancel(orderId: string) {
      return engine?.cancel(orderId) ?? false;
    },
    flatten(code: string): BrokerAck {
      if (!engine) return { ok: false, reason: "盤室尚未開啟" };
      return engine.flatten(code);
    },
  };
}

function liveBroker(): BrokerPort {
  const blocked: BrokerAck = {
    ok: false,
    reason: LIVE_UNWIRED_REASON,
  };
  return {
    venue: "live",
    label: "實盤",
    accountId: LIVE_ACCOUNT,
    ready: false,
    place() {
      return blocked;
    },
    cancel() {
      return false;
    },
    flatten() {
      return blocked;
    },
  };
}
