export type LeaveDeskEngine = {
  positions: Map<string, { lots: number }>;
  orders: Array<{ status: string }>;
};

export type LeaveDeskRisk = {
  openPositions: number;
  openOrders: number;
};

export const LEAVE_DESK_TITLE = "確定回大廳？";
export const LEAVE_DESK_NO_RECORD = "這盤還沒結算，不會寫入戰績。";
export const LEAVE_DESK_NO_FLATTEN =
  "離開後庫存與委託會被捨棄，不會自動平倉。要記分請先「提前結算」。";
export const LEAVE_DESK_CANCEL = "繼續上課";
export const LEAVE_DESK_CONFIRM = "確定離開";

export function leaveDeskRisk(engine: LeaveDeskEngine | null | undefined): LeaveDeskRisk {
  if (!engine) return { openPositions: 0, openOrders: 0 };
  const openPositions = [...engine.positions.values()].filter((p) => p.lots !== 0).length;
  const openOrders = engine.orders.filter((o) => o.status === "pending" || o.status === "partial").length;
  return { openPositions, openOrders };
}

export function leaveDeskNeedsConfirm(risk: LeaveDeskRisk): boolean {
  return risk.openPositions > 0 || risk.openOrders > 0;
}

export function leaveDeskPositionLine(n: number): string | null {
  return n > 0 ? `尚有 ${n} 檔庫存未平。` : null;
}

export function leaveDeskOrderLine(n: number): string | null {
  return n > 0 ? `尚有 ${n} 筆未成交委託。` : null;
}
