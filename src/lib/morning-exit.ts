// 自動出場 (2026-11-02, 石大哥 via the owner): the plan sets 停利 and 停損 before the run starts; once a buy fills,
// the classroom sells the whole holding at market when a real trade reaches either price. Pure: no I/O, no clock.
import type { MorningExitPlan, MorningFill, MorningPositionExit } from "./morning.ts";
import { commission, DAYTRADE_TAX, formatPrice, LOT_SHARES, limitDown, limitUp, roundToTick, stepTick } from "./market/ticks.ts";
import { fillPriceText } from "./morning-ledger.ts";

/**
 * 停利 and 停損 in ticks (2026-11-09, the owner: 「停利上是可用"標準tick(保證可cover手續、證交稅)+幾個tick(行情好，使用者可多加
 * 幾個tick)，停損也用tick來計算只是ticks旁邊備注幾%」): 停利 is 最低獲利檔 (2026-11-08, 石大哥: 「請改最低的tick(可cover手續費和
 * 證交稅)」, coverPrice) moved up `takeProfitTicks`; 停損 is `stopLossTicks` under the cost. A tick's size depends on the
 * price band, so one percentage is a different number of ticks on every stock.
 */
export const TAKE_PROFIT_TICK_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const STOP_LOSS_TICK_CHOICES = [3, 4, 5, 6, 8, 10, 12, 15, 20] as const;
/** On by default: 停利 最低獲利檔, 停損 10 檔 (the owner, 2026-11-09: 「好，停損預設 10 檔」; −2% the day before). */
export const DEFAULT_EXIT: MorningExitPlan = { takeProfitTicks: 0, stopLossTicks: 10 };
export type ExitKind = "takeProfit" | "stopLoss";
export const EXIT_NAME = { takeProfit: "停利", stopLoss: "停損" } as const satisfies Record<ExitKind, string>;
/** A learner's waiting order of a stock gives way when the stock's exit fires. */
export const EXIT_CANCEL = "自動出場時取消這檔的委託";

/**
 * The plan's exit as the ticks it takes: a plan saved with the percentages before 2026-11-09 (or anything off the
 * choices) counts as the default.
 */
export function exitPlanOf(exit: MorningExitPlan): MorningExitPlan {
  const { takeProfitTicks, stopLossTicks } = exit ?? {};
  return (TAKE_PROFIT_TICK_CHOICES as readonly unknown[]).includes(takeProfitTicks) &&
    (STOP_LOSS_TICK_CHOICES as readonly unknown[]).includes(stopLossTicks)
    ? { takeProfitTicks, stopLossTicks }
    : { ...DEFAULT_EXIT };
}

/** 「最低獲利檔」 or 「最低獲利檔 +2 檔」 */
export function takeProfitText(ticks: number): string {
  return ticks === 0 ? "最低獲利檔" : `最低獲利檔 +${ticks} 檔`;
}

/** 「停利 最低獲利檔／停損 -10 檔」, 「停利 最低獲利檔 +2 檔／停損 -6 檔」 */
export function exitPlanText(exit: MorningExitPlan): string {
  const plan = exitPlanOf(exit);
  return `停利 ${takeProfitText(plan.takeProfitTicks)}／停損 -${plan.stopLossTicks} 檔`;
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

/** About how far `price` is from the cost, one decimal: 「約 -1.8%」, 「約 +0.5%」. */
export function exitPercentText(averageCost: number, price: number): string {
  const pct = ((price - averageCost) / averageCost) * 100;
  return `約 ${price > averageCost ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`;
}

/**
 * What a 觸價單 says beside its price (2026-11-09, the owner: 「ticks旁邊備注幾%(例:6ticks=3%，讓使用者比較了解參數的
 * 實際效應)」): 停利 by the plan's ticks over 最低獲利檔, 「（最低獲利檔 +2 檔，約 +0.9%）」; 停損 by its ticks under the cost,
 * 「（-10 檔，約 -1.8%）」. A 停利 armed without the plan's ticks (before 2026-11-09) says its own ticks from the cost.
 */
export function exitNote(kind: ExitKind, averageCost: number, price: number, takeProfitTicks?: number): string {
  const ticks =
    kind === "takeProfit" && takeProfitTicks !== undefined
      ? takeProfitText(takeProfitTicks)
      : `${price > averageCost ? "+" : "-"}${exitTicks(averageCost, price)} 檔`;
  return `（${ticks}，${exitPercentText(averageCost, price)}）`;
}

/** Prices in three bands (0.05, 0.5 and 5 元 a tick) the plan card turns the chosen ticks into percentages at. */
const EXAMPLE_PRICES = [26.55, 224.5, 1055] as const;
const EXAMPLE_BUY = 224.5;

/** 「停損 10 檔約等於：26.55 元 -1.9%、224.5 元 -2.2%、1055 元 -4.7%（價位不同，每檔大小不同）。」 */
export function stopLossExampleText(ticks: number): string {
  const parts = EXAMPLE_PRICES.map((price) => `${formatPrice(price)} 元 ${exitPercentText(price, stepTick(price, -ticks)).slice(2)}`);
  return `停損 ${ticks} 檔約等於：${parts.join("、")}（價位不同，每檔大小不同）。`;
}

/** 「例：224.5 元買 1 張，停利 226.5（約 +0.9%）。」: 最低獲利檔 of one lot and its fee, moved up `ticks`. */
export function takeProfitExampleText(ticks: number): string {
  const price = exitPrices(EXAMPLE_BUY, { takeProfitTicks: ticks, stopLossTicks: DEFAULT_EXIT.stopLossTicks }, EXAMPLE_BUY).takeProfit!;
  return `例：${formatPrice(EXAMPLE_BUY)} 元買 1 張，停利 ${formatPrice(price)}（${exitPercentText(EXAMPLE_BUY, price)}）。`;
}

/**
 * A holding's waiting 觸價單: when a trade reaches `price`, the classroom sells the whole holding at market. `note`
 * is what is said beside its price (exitNote).
 */
export type TriggerOrder = {
  code: string;
  kind: ExitKind;
  name: string;
  price: number;
  note: string;
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
            : [
                {
                  code,
                  kind,
                  name: `${EXIT_NAME[kind]}觸價單`,
                  price,
                  note: exitNote(kind, averageCost, price, exit.takeProfitTicks),
                  shares,
                  fromMs: exit.fromMs,
                },
              ];
        })
      : [],
  );
}

/**
 * A holding's two prices from its average cost: 停利 is 最低獲利檔 (coverPrice of the holding's `shares` and paid
 * `buyFees`; without them, one lot and its own fee) moved up the plan's ticks; 停損 is the plan's ticks under the
 * first tick at or over the cost, so it is exactly that many ticks away (exitTicks). Both step across price bands.
 * One past the day's 漲停／跌停 cannot be reached, so there is none (null): pulled back to the limit it could be the
 * average itself, and sell at once at a loss.
 */
export function exitPrices(
  averageCost: number,
  exit: MorningExitPlan,
  previousClose: number,
  holding?: { shares: number; buyFees: number },
): { takeProfit: number | null; stopLoss: number | null } {
  const plan = exitPlanOf(exit);
  const shares = holding?.shares ?? LOT_SHARES;
  const cover = coverPrice(averageCost, shares, holding?.buyFees ?? commission(averageCost * shares));
  const takeProfit = plan.takeProfitTicks === 0 ? cover : stepTick(cover, plan.takeProfitTicks);
  let from = roundToTick(averageCost);
  if (from < averageCost - 1e-9) from = stepTick(from, 1);
  const stopLoss = stepTick(from, -plan.stopLossTicks);
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
