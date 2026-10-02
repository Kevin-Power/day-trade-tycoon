import type { TimeInForce } from "@/lib/broker/types";

/** Classroom-facing. Clicking 實盤 must never sound like a broker send. */
export const LIVE_UNWIRED_REASON =
  "實盤尚未接上券商 API。點了不會送到券商，教室下單仍走模擬撮合。";

/** Operator-facing when BROKER_BASE_URL exists but the hop is still a stub. */
export const LIVE_ADAPTER_UNWIRED_REASON = "實盤 adapter 尚未接上券商端點";

export const SIM_ROD_ONLY_REASON =
  "模擬盤僅支援 ROD、IOC、FOK 委託效期。";

export const SIM_TIF_HINT = "ROD 留單 · IOC 餘量取消 · FOK 全成或全取消";

export const CANCEL_FAILED_REASON = "無法刪單（已成交或已取消）";
export const CANCEL_OK_REASON = "已刪單";

export function simAllowsTif(tif: TimeInForce): boolean {
  return tif === "ROD" || tif === "IOC" || tif === "FOK";
}

export function rejectUnsupportedTif(tif: TimeInForce): string | null {
  return simAllowsTif(tif) ? null : SIM_ROD_ONLY_REASON;
}
