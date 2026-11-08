// 自動出場 (2026-11-02, 石大哥 via the owner): the plan sets 停利 and 停損 before the run starts; once a buy fills,
// the classroom sells the whole holding at market when a real trade reaches either price. Pure: no I/O, no clock.
import type { MorningExitPlan, MorningPositionExit } from "./morning.ts";
import { formatPrice, limitDown, limitUp, roundToTick, stepTick } from "./market/ticks.ts";
import { fillPriceText } from "./morning-ledger.ts";

export const TAKE_PROFIT_CHOICES = [0.5, 1, 1.5, 2, 3] as const;
export const STOP_LOSS_CHOICES = [0.5, 1, 1.5, 2] as const;
/** The owner's choice: on by default, 停利 +1.5%, 停損 −1%. */
export const DEFAULT_EXIT: MorningExitPlan = { takeProfitPct: 1.5, stopLossPct: 1 };
export type ExitKind = "takeProfit" | "stopLoss";
export const EXIT_NAME = { takeProfit: "停利", stopLoss: "停損" } as const satisfies Record<ExitKind, string>;
/** A learner's waiting order of a stock gives way when the stock's exit fires. */
export const EXIT_CANCEL = "自動出場時取消這檔的委託";

/** 「停利 +1.5%／停損 -1%」 */
export function exitPlanText(exit: MorningExitPlan): string {
  return `停利 +${exit.takeProfitPct}%／停損 -${exit.stopLossPct}%`;
}

/** A level drawn across a stock's chart: dashed in its tone, or solid. */
export type ChartLevel = { price: number; label: string; tone?: "up" | "down" | "accent"; solid?: boolean; priceText?: string };

/**
 * A held stock's levels on its chart (2026-11-04, the owner: 「買的庫存點位也要在江波圖上顯示」): 成本, the average
 * cost, as a solid accent line with its price as 庫存 says it (1462.50, not the tick-rounded 1463), then the 自動出場
 * 停利 (up colour) and 停損 (down colour) as dashed ones.
 */
export function holdingLevels(position: { averageCost: number; exit?: MorningPositionExit } | undefined): ChartLevel[] {
  if (!position) return [];
  const exit = position.exit;
  return [
    { price: position.averageCost, label: "成本", tone: "accent", solid: true, priceText: fillPriceText(position.averageCost) },
    ...(exit?.takeProfit == null ? [] : [{ price: exit.takeProfit, label: "停利觸價", tone: "up" as const }]),
    ...(exit?.stopLoss == null ? [] : [{ price: exit.stopLoss, label: "停損觸價", tone: "down" as const }]),
  ];
}

/** A holding's waiting 觸價單: when a trade reaches `price`, the classroom sells the whole holding at market. */
export type TriggerOrder = { code: string; kind: ExitKind; name: string; price: number; shares: number; fromMs: number };

/**
 * The 自動出場 as the 觸價單 a real system would show (2026-11-06, 石大哥: 「下單後，直接會設觸價單來停損、停利嗎?」):
 * each holding's 停利觸價單 then 停損觸價單, set when its buy filled. The first one reached sells the whole holding and
 * the other goes with it. A side past 漲停／跌停 has no price (exitPrices), so no 觸價單.
 */
export function triggerOrders(
  positions: readonly { code: string; shares: number; exit?: MorningPositionExit }[],
): TriggerOrder[] {
  return positions.flatMap(({ code, shares, exit }) =>
    exit && shares > 0
      ? (["takeProfit", "stopLoss"] as const).flatMap((kind) => {
          const price = exit[kind];
          return price === null ? [] : [{ code, kind, name: `${EXIT_NAME[kind]}觸價單`, price, shares, fromMs: exit.fromMs }];
        })
      : [],
  );
}

/**
 * A holding's two prices from its average cost: 停利 is the first price on the tick grid at or over the target,
 * 停損 the last one at or under it. One past the day's 漲停／跌停 cannot be reached, so there is none (null): pulled
 * back to the limit it could be the average itself, and sell at once at a loss.
 */
export function exitPrices(
  averageCost: number,
  exit: MorningExitPlan,
  previousClose: number,
): { takeProfit: number | null; stopLoss: number | null } {
  const up = (averageCost * (100 + exit.takeProfitPct)) / 100;
  const down = (averageCost * (100 - exit.stopLossPct)) / 100;
  let takeProfit = roundToTick(up);
  if (takeProfit < up - 1e-9) takeProfit = stepTick(takeProfit, 1);
  let stopLoss = roundToTick(down);
  if (stopLoss > down + 1e-9) stopLoss = stepTick(stopLoss, -1);
  return {
    takeProfit: takeProfit > limitUp(previousClose) ? null : takeProfit,
    stopLoss: stopLoss < limitDown(previousClose) ? null : stopLoss,
  };
}

/** Which exit a trade at `price` fires, if any. */
export function exitTrigger(
  exit: { takeProfit: number | null; stopLoss: number | null },
  price: number,
): ExitKind | null {
  if (exit.takeProfit !== null && price >= exit.takeProfit) return "takeProfit";
  if (exit.stopLoss !== null && price <= exit.stopLoss) return "stopLoss";
  return null;
}

/**
 * The 行情 stamp's line under a holding's 成本 (2026-11-08, the owner: the phone's one screen should say where the
 * system sells): the waiting 觸價單 as 「停利 1485」「停損 1448」, or, while one has fired and its market sell waits
 * for volume, 「停利觸發 · 市價賣出中」. Nothing without an exit.
 */
export function exitStampParts(
  exit: MorningPositionExit | undefined,
  firing: ExitKind | null | undefined,
): { kind: ExitKind; text: string }[] {
  if (firing) return [{ kind: firing, text: `${EXIT_NAME[firing]}觸發 · 市價賣出中` }];
  if (!exit) return [];
  return [
    ...(exit.takeProfit == null ? [] : [{ kind: "takeProfit" as const, text: `停利 ${formatPrice(exit.takeProfit)}` }]),
    ...(exit.stopLoss == null ? [] : [{ kind: "stopLoss" as const, text: `停損 ${formatPrice(exit.stopLoss)}` }]),
  ];
}
