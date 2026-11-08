// 自動出場 (2026-11-02, 石大哥 via the owner): the plan sets 停利 and 停損 before the run starts; once a buy fills,
// the classroom sells the whole holding at market when a real trade reaches either price. Pure: no I/O, no clock.
import type { MorningExitPlan, MorningFill, MorningPositionExit } from "./morning.ts";
import { commission, DAYTRADE_TAX, formatPrice, LOT_SHARES, limitDown, limitUp, roundToTick, stepTick } from "./market/ticks.ts";
import { fillPriceText } from "./morning-ledger.ts";

/**
 * 停利 at 最低獲利檔 (2026-11-08, 石大哥: 「請改最低的tick(可cover手續費和證交稅)，這樣更接近教學系統與下單軟體的策略」):
 * the plan's `takeProfitPct` 0 means the first tick whose sale pays the buy fee, its own fee and the day-trade tax
 * and still gains (coverPrice), not a percentage.
 */
export const COVER_TICK = 0;
export const TAKE_PROFIT_CHOICES = [COVER_TICK, 0.5, 1, 1.5, 2, 3] as const;
export const STOP_LOSS_CHOICES = [0.5, 1, 1.5, 2] as const;
/**
 * On by default: 停利 最低獲利檔, 停損 −2% (2026-11-08; +1.5%／−1% before). The owner, for the Tuesday class: 「先抓寬一點，
 * 讓他們知道N字攻擊突破後，有很大的成功率可保本和賺到退傭，停損抓大一點，也是好的，讓他們知道，若停損抓太大，有時他們風險的成本會很高」.
 */
export const DEFAULT_EXIT: MorningExitPlan = { takeProfitPct: COVER_TICK, stopLossPct: 2 };
export type ExitKind = "takeProfit" | "stopLoss";
export const EXIT_NAME = { takeProfit: "停利", stopLoss: "停損" } as const satisfies Record<ExitKind, string>;
/** A learner's waiting order of a stock gives way when the stock's exit fires. */
export const EXIT_CANCEL = "自動出場時取消這檔的委託";

/** 「最低獲利檔」 or 「+1.5%」 */
export function takeProfitText(pct: number): string {
  return pct === COVER_TICK ? "最低獲利檔" : `+${pct}%`;
}

/** 「停利 最低獲利檔／停損 -1%」, 「停利 +1.5%／停損 -1%」 */
export function exitPlanText(exit: MorningExitPlan): string {
  return `停利 ${takeProfitText(exit.takeProfitPct)}／停損 -${exit.stopLossPct}%`;
}

/**
 * 最低獲利檔: the first price on the tick grid, from the average up, at which selling all `shares` (its fee and the
 * day-trade tax as the engine charges them) brings back more than the shares cost plus `buyFees`, the fees their
 * buys paid. Gains are strict, so it is never a break-even sale.
 */
export function coverPrice(averageCost: number, shares: number, buyFees: number): number {
  const paid = averageCost * shares + buyFees;
  let price = roundToTick(averageCost);
  if (price < averageCost - 1e-9) price = stepTick(price, 1);
  for (let step = 0; step < 1000; step++) {
    const notional = Math.round(price * shares * 100) / 100;
    if (notional - commission(notional) - Math.round(notional * DAYTRADE_TAX) - paid > 1e-6) return price;
    price = stepTick(price, 1);
  }
  return price;
}

/**
 * The buy fees a stock's current holding carries: its buys' since it was last flat, each sale taking its share of
 * them along with its shares. In fill order, as the engine records them.
 */
export function holdingBuyFees(fills: readonly MorningFill[], code: string): number {
  let shares = 0;
  let fees = 0;
  for (const fill of fills) {
    if (fill.code !== code) continue;
    if (fill.side === "buy") {
      shares += fill.shares;
      fees += fill.fee;
    } else if (shares > 0) {
      const left = Math.max(0, shares - fill.shares);
      fees = left === 0 ? 0 : (fees * left) / shares;
      shares = left;
    }
  }
  return Math.round(fees * 100) / 100;
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

/**
 * How many ticks `price` is from `averageCost` (2026-11-08, 石大哥 counts exits in ticks: 「台泥 28.05 進，27.75 停損出，
 * 這樣是6個ticks」): steps on the tick grid, across price bands, from `price` toward the cost until it is reached or
 * passed, so an average off the grid counts the ticks to pass it.
 */
export function exitTicks(averageCost: number, price: number): number {
  const way = price > averageCost ? -1 : 1;
  let at = price;
  let ticks = 0;
  while (ticks < 10_000 && (way < 0 ? at > averageCost + 1e-9 : at < averageCost - 1e-9)) {
    at = stepTick(at, way);
    ticks++;
  }
  return ticks;
}

/** 「（+2 檔）」 over the cost, 「（-6 檔）」 under it. */
export function exitTicksText(averageCost: number, price: number): string {
  return `（${price > averageCost ? "+" : "-"}${exitTicks(averageCost, price)} 檔）`;
}

/**
 * A holding's waiting 觸價單: when a trade reaches `price`, the classroom sells the whole holding at market. `ticks`
 * is how far `price` is from the holding's cost (exitTicks).
 */
export type TriggerOrder = {
  code: string;
  kind: ExitKind;
  name: string;
  price: number;
  ticks: number;
  shares: number;
  fromMs: number;
};

/**
 * The 自動出場 as the 觸價單 a real system would show (2026-11-06, 石大哥: 「下單後，直接會設觸價單來停損、停利嗎?」):
 * each holding's 停利觸價單 then 停損觸價單, set when its buy filled. The first one reached sells the whole holding and
 * the other goes with it. A side past 漲停／跌停 has no price (exitPrices), so no 觸價單.
 */
export function triggerOrders(
  positions: readonly { code: string; shares: number; averageCost: number; exit?: MorningPositionExit }[],
): TriggerOrder[] {
  return positions.flatMap(({ code, shares, averageCost, exit }) =>
    exit && shares > 0
      ? (["takeProfit", "stopLoss"] as const).flatMap((kind) => {
          const price = exit[kind];
          return price === null
            ? []
            : [{ code, kind, name: `${EXIT_NAME[kind]}觸價單`, price, ticks: exitTicks(averageCost, price), shares, fromMs: exit.fromMs }];
        })
      : [],
  );
}

/**
 * A holding's two prices from its average cost: 停利 is the first price on the tick grid at or over the target
 * (with 最低獲利檔, coverPrice of the holding's `shares` and paid `buyFees`; without them, one lot and its own fee),
 * 停損 the last one at or under it. One past the day's 漲停／跌停 cannot be reached, so there is none (null): pulled
 * back to the limit it could be the average itself, and sell at once at a loss.
 */
export function exitPrices(
  averageCost: number,
  exit: MorningExitPlan,
  previousClose: number,
  holding?: { shares: number; buyFees: number },
): { takeProfit: number | null; stopLoss: number | null } {
  const down = (averageCost * (100 - exit.stopLossPct)) / 100;
  let takeProfit: number;
  if (exit.takeProfitPct === COVER_TICK) {
    const shares = holding?.shares ?? LOT_SHARES;
    takeProfit = coverPrice(averageCost, shares, holding?.buyFees ?? commission(averageCost * shares));
  } else {
    const up = (averageCost * (100 + exit.takeProfitPct)) / 100;
    takeProfit = roundToTick(up);
    if (takeProfit < up - 1e-9) takeProfit = stepTick(takeProfit, 1);
  }
  let stopLoss = roundToTick(down);
  if (stopLoss > down + 1e-9) stopLoss = stepTick(stopLoss, -1);
  return {
    takeProfit: takeProfit > limitUp(previousClose) ? null : takeProfit,
    stopLoss: stopLoss < limitDown(previousClose) ? null : stopLoss,
  };
}

/** A waiting 觸價單's distance from the cost as said beside its price: 「（+5 檔）」, 「（-3 檔）」. */
export function triggerTicks(trigger: Pick<TriggerOrder, "kind" | "ticks">): string {
  return `（${trigger.kind === "takeProfit" ? "+" : "-"}${trigger.ticks} 檔）`;
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
