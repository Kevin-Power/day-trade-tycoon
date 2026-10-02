import type { OrderType, Side } from "../game/types.ts";
import { commission, DAYTRADE_TAX, LOT_SHARES, roundToTick } from "./ticks.ts";

export type ExecutionInput = {
  side: Side;
  type: OrderType;
  lots: number;
  price?: number;
  tif?: "ROD" | "IOC" | "FOK";
};
export type ExecutionLevel = { price: number; lots: number };
export type ExecutionEstimate = {
  filledLots: number;
  remainingLots: number;
  averagePrice: number | null;
  notional: number;
  fee: number;
  tax: number;
  levels: ExecutionLevel[];
};

export function executionInputReason(input: ExecutionInput): string | null {
  if (input.side !== "buy" && input.side !== "sell") return "買賣方向不正確";
  if (input.type !== "limit" && input.type !== "market") return "委託方式不正確";
  if (!Number.isInteger(input.lots) || input.lots < 1 || input.lots > 200) return "張數需為 1–200 的整數";
  if (input.tif !== undefined && !["ROD", "IOC", "FOK"].includes(input.tif)) return "委託效期不正確";
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price <= 0)) return "價格需為大於 0 的有限數值";
  if (input.type === "limit" && (input.price === undefined || roundToTick(input.price) <= 0 || Math.abs(roundToTick(input.price) - input.price) > 1e-8)) {
    return "限價需符合商品升降單位";
  }
  return null;
}

/** The same visible-depth and per-fill cost model is used by preview and matching. */
export function estimateExecution(
  quote: { bids: readonly ExecutionLevel[]; asks: readonly ExecutionLevel[] },
  input: ExecutionInput,
): ExecutionEstimate {
  const empty = (): ExecutionEstimate => ({ filledLots: 0, remainingLots: input.lots, averagePrice: null, notional: 0, fee: 0, tax: 0, levels: [] });
  if (executionInputReason(input)) return empty();
  const levels = (input.side === "buy" ? quote.asks : quote.bids)
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isInteger(level.lots) && level.lots > 0)
    .filter((level) => input.type === "market" || (input.side === "buy" ? level.price <= input.price! + 1e-9 : level.price >= input.price! - 1e-9))
    .slice().sort((a, b) => input.side === "buy" ? a.price - b.price : b.price - a.price);
  const result = empty();
  for (const level of levels) {
    if (result.remainingLots === 0) break;
    const lots = Math.min(result.remainingLots, level.lots);
    const notional = level.price * lots * LOT_SHARES;
    if (!Number.isFinite(notional)) continue;
    result.levels.push({ price: level.price, lots });
    result.filledLots += lots;
    result.remainingLots -= lots;
    result.notional += notional;
    result.fee += commission(notional);
    result.tax += input.side === "sell" ? Math.round(notional * DAYTRADE_TAX) : 0;
  }
  if (input.tif === "FOK" && result.remainingLots > 0) return empty();
  result.averagePrice = result.filledLots ? result.notional / (result.filledLots * LOT_SHARES) : null;
  return result;
}
