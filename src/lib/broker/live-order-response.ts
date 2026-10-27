import { LIVE_ADAPTER_UNWIRED_REASON, LIVE_UNWIRED_REASON } from "./copy.ts";

/** A URL or credentials cannot enable an unimplemented live integration. */
export function liveOrderUnavailable(configured: boolean) {
  return {
    ok: false,
    venue: "live",
    code: "LIVE_LOCKED",
    retryable: false,
    reason: configured ? LIVE_ADAPTER_UNWIRED_REASON : LIVE_UNWIRED_REASON,
  } as const;
}
