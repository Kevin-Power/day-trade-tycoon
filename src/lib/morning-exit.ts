// 自動出場 (2026-11-02, 石大哥 via the owner): the plan sets 停利 and 停損 before the run starts; once a buy fills,
// the classroom sells the whole holding at market when a real trade reaches either price. Pure: no I/O, no clock.
import type { MorningExitPlan } from "./morning.ts";
import { clampLimit, roundToTick, stepTick } from "./market/ticks.ts";

export const TAKE_PROFIT_CHOICES = [0.5, 1, 1.5, 2, 3] as const;
export const STOP_LOSS_CHOICES = [0.5, 1, 1.5, 2] as const;
/** The owner's choice: on by default, 停利 +1.5%, 停損 −1%. */
export const DEFAULT_EXIT: MorningExitPlan = { takeProfitPct: 1.5, stopLossPct: 1 };
export type ExitKind = "takeProfit" | "stopLoss";
export const EXIT_NAME = { takeProfit: "停利", stopLoss: "停損" } as const satisfies Record<ExitKind, string>;
/** A learner's waiting sell of a stock gives way when the stock's exit fires. */
export const EXIT_CANCEL = "自動出場時取消這檔的賣出委託";

/** 「停利 +1.5%／停損 -1%」 */
export function exitPlanText(exit: MorningExitPlan): string {
  return `停利 +${exit.takeProfitPct}%／停損 -${exit.stopLossPct}%`;
}

/**
 * A holding's two prices from its average cost: 停利 is the first price on the tick grid at or over the target,
 * 停損 the last one at or under it, both kept inside the day's 漲停／跌停.
 */
export function exitPrices(
  averageCost: number,
  exit: MorningExitPlan,
  previousClose: number,
): { takeProfit: number; stopLoss: number } {
  const up = (averageCost * (100 + exit.takeProfitPct)) / 100;
  const down = (averageCost * (100 - exit.stopLossPct)) / 100;
  let takeProfit = roundToTick(up);
  if (takeProfit < up - 1e-9) takeProfit = stepTick(takeProfit, 1);
  let stopLoss = roundToTick(down);
  if (stopLoss > down + 1e-9) stopLoss = stepTick(stopLoss, -1);
  return { takeProfit: clampLimit(takeProfit, previousClose), stopLoss: clampLimit(stopLoss, previousClose) };
}

/** Which exit a trade at `price` fires, if any. */
export function exitTrigger(exit: { takeProfit: number; stopLoss: number }, price: number): ExitKind | null {
  if (price >= exit.takeProfit) return "takeProfit";
  if (price <= exit.stopLoss) return "stopLoss";
  return null;
}
