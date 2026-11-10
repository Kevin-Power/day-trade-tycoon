import test from "node:test";
import assert from "node:assert/strict";
import type { MorningExitPlan } from "./morning.ts";
import {
  coverPrice,
  DEFAULT_EXIT,
  exitNote,
  exitPercentText,
  exitPlanOf,
  exitPlanText,
  exitStampParts,
  exitPrices,
  exitTicks,
  exitTrigger,
  holdingBuyFees,
  holdingLevels,
  stopLossExampleText,
  takeProfitExampleText,
  triggerOrders,
  STOP_LOSS_TICK_CHOICES,
  TAKE_PROFIT_TICK_CHOICES,
  takeProfitText,
} from "./morning-exit.ts";

const TICK_EXIT = { takeProfitTicks: 2, stopLossTicks: 6 };

test("停利 is 最低獲利檔 plus the ticks a learner adds, 停損 a number of ticks; by default 最低獲利檔 and 10 檔 (2026-11-09)", () => {
  // The owner: 「停利上是可用"標準tick(保證可cover手續、證交稅)+幾個tick…停損也用tick來計算」; 「好，停損預設 10 檔」.
  assert.deepEqual(DEFAULT_EXIT, { takeProfitTicks: 0, stopLossTicks: 10 });
  assert.deepEqual(TAKE_PROFIT_TICK_CHOICES, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(STOP_LOSS_TICK_CHOICES, [3, 4, 5, 6, 8, 10, 12, 15, 20]);
  assert.equal(takeProfitText(0), "最低獲利檔");
  assert.equal(takeProfitText(2), "最低獲利檔 +2 檔");
  assert.equal(exitPlanText(DEFAULT_EXIT), "停利 最低獲利檔／停損 -10 檔");
  assert.equal(exitPlanText(TICK_EXIT), "停利 最低獲利檔 +2 檔／停損 -6 檔");
});

test("a plan saved with the old percentages counts as the default", () => {
  const old = { takeProfitPct: 1.5, stopLossPct: 1 } as unknown as MorningExitPlan;
  assert.deepEqual(exitPlanOf(old), DEFAULT_EXIT);
  assert.deepEqual(exitPlanOf(TICK_EXIT), TICK_EXIT);
  assert.deepEqual(exitPlanOf({ takeProfitTicks: 2.5, stopLossTicks: 6 }), DEFAULT_EXIT);
  assert.deepEqual(exitPlanOf({ takeProfitTicks: 2, stopLossTicks: 7 }), DEFAULT_EXIT);
  assert.equal(exitPlanText(old), "停利 最低獲利檔／停損 -10 檔");
  assert.deepEqual(exitPrices(216.5, old, 210, { shares: 1000, buyFees: 185 }), { takeProfit: 217.5, stopLoss: 211.5 });
});

test("停利 is 最低獲利檔 moved up the added ticks; 停損 the plan's ticks under the cost, across price bands", () => {
  // 鴻海 1 lot at 216.5, fee 185: 最低獲利檔 217.5; +2 ticks of 0.5 → 218.5; 6 ticks under → 213.5; 10 → 211.5.
  assert.deepEqual(exitPrices(216.5, TICK_EXIT, 210, { shares: 1000, buyFees: 185 }), { takeProfit: 218.5, stopLoss: 213.5 });
  assert.deepEqual(exitPrices(216.5, DEFAULT_EXIT, 210, { shares: 1000, buyFees: 185 }), { takeProfit: 217.5, stopLoss: 211.5 });
  // 1 lot at 99.5, fee 85: 最低獲利檔 99.9; +2 crosses 100 → 100, 100.5. 6 under 100.5: 100, 99.9 … 99.5.
  assert.equal(exitPrices(99.5, TICK_EXIT, 99.5, { shares: 1000, buyFees: 85 }).takeProfit, 100.5);
  assert.equal(exitPrices(100.5, TICK_EXIT, 100).stopLoss, 99.5);
  // An average off the grid counts from the first tick over it, so the 停損 is exactly its ticks away (exitTicks).
  assert.equal(exitPrices(301 / 3, DEFAULT_EXIT, 100).stopLoss, 99.1);
  assert.equal(exitTicks(301 / 3, 99.1), 10);
});

test("a 停利 past 漲停, or a 停損 past 跌停, cannot be reached: there is none, never one at the limit", () => {
  // Bought at 漲停 110 (from 100): no 停利 over it; 10 ticks of 0.5 under → 105.
  assert.deepEqual(exitPrices(110, DEFAULT_EXIT, 100, { shares: 1000, buyFees: 94 }), { takeProfit: null, stopLoss: 105 });
  // 109.5: 最低獲利檔 is 漲停 110 itself; two more ticks are past it.
  assert.equal(exitPrices(109.5, TICK_EXIT, 100).takeProfit, null);
  // Bought at 跌停 90 (fee 77): 10 under is past 跌停; 最低獲利檔 90.3.
  assert.deepEqual(exitPrices(90, DEFAULT_EXIT, 100), { takeProfit: 90.3, stopLoss: null });
  assert.equal(exitTrigger({ takeProfit: null, stopLoss: 105 }, 110), null);
  assert.equal(exitTrigger({ takeProfit: 90.3, stopLoss: null }, 90), null);
});

test("a trade at or over 停利, or at or under 停損, fires; one between does not", () => {
  const exit = { takeProfit: 867, stopLoss: 845 };
  assert.equal(exitTrigger(exit, 867), "takeProfit");
  assert.equal(exitTrigger(exit, 870), "takeProfit");
  assert.equal(exitTrigger(exit, 845), "stopLoss");
  assert.equal(exitTrigger(exit, 840), "stopLoss");
  assert.equal(exitTrigger(exit, 866), null);
  assert.equal(exitTrigger(exit, 846), null);
});

test("a holding's chart levels: 成本 as a solid line, then its 停利 and 停損 (2026-11-04, the owner)", () => {
  assert.deepEqual(holdingLevels({ averageCost: 1462.5, exit: { takeProfit: 1485, stopLoss: 1445, fromMs: 0 } }), [
    { price: 1462.5, label: "成本", tone: "accent", solid: true, priceText: "1462.50" },
    { price: 1485, label: "停利觸價", tone: "up" },
    { price: 1445, label: "停損觸價", tone: "down" },
  ]);
  // Past the day's limit an exit has no price, and a run without 自動出場 has none at all.
  assert.deepEqual(holdingLevels({ averageCost: 100, exit: { takeProfit: null, stopLoss: 99, fromMs: 0 } }), [
    { price: 100, label: "成本", tone: "accent", solid: true, priceText: "100.0" },
    { price: 99, label: "停損觸價", tone: "down" },
  ]);
  assert.deepEqual(holdingLevels({ averageCost: 100 }), [{ price: 100, label: "成本", tone: "accent", solid: true, priceText: "100.0" }]);
  assert.deepEqual(holdingLevels(undefined), []);
});

test("a holding's 觸價單: 停利 then 停損, each selling the whole holding, armed from its buy fill (2026-11-06, 石大哥)", () => {
  const exit = { takeProfit: 1490, stopLoss: 1450, fromMs: 60_734, takeProfitTicks: 4 };
  // Bought at 1465 with 停利 最低獲利檔 +4 檔: 1490 is +1.7%; 1450 is 3 ticks of 5 元 under, −1.0% (2026-11-09: the owner
  // wants the ticks with what they mean in %).
  assert.deepEqual(triggerOrders([{ code: "2330", shares: 2000, averageCost: 1465, exit }]), [
    { code: "2330", kind: "takeProfit", name: "停利觸價單", price: 1490, note: "（最低獲利檔 +4 檔，約 +1.7%）", shares: 2000, fromMs: 60_734 },
    { code: "2330", kind: "stopLoss", name: "停損觸價單", price: 1450, note: "（-3 檔，約 -1.0%）", shares: 2000, fromMs: 60_734 },
  ]);
  // A holding armed before 2026-11-09 has no 停利 ticks: its distance from the cost is said instead.
  const { takeProfitTicks: _old, ...armedBefore } = exit;
  assert.equal(triggerOrders([{ code: "2330", shares: 2000, averageCost: 1465, exit: armedBefore }])[0].note, "（+5 檔，約 +1.7%）");
  // A side past 漲停／跌停 has no price, so no 觸價單; no 自動出場, or nothing held, none at all.
  assert.deepEqual(
    triggerOrders([{ code: "2330", shares: 1000, averageCost: 100, exit: { takeProfit: null, stopLoss: 99, fromMs: 0 } }]).map((order) => order.kind),
    ["stopLoss"],
  );
  assert.deepEqual(triggerOrders([{ code: "2330", shares: 1000, averageCost: 100 }]), []);
  assert.deepEqual(triggerOrders([{ code: "2330", shares: 0, averageCost: 1465, exit }]), []);
});

test("the 行情 stamp names a holding's waiting 觸價單, or the one firing (2026-11-08: the owner, 手機一個畫面就看到系統在哪裡賣)", () => {
  const exit = { takeProfit: 1485, stopLoss: 1448, fromMs: 0 };
  assert.deepEqual(exitStampParts(exit, null), [
    { kind: "takeProfit", text: "停利 1485" },
    { kind: "stopLoss", text: "停損 1448" },
  ]);
  // Bought at 漲停: no 停利 can be reached, only the 停損 waits.
  assert.deepEqual(exitStampParts({ takeProfit: null, stopLoss: 108.5, fromMs: 0 }, null), [{ kind: "stopLoss", text: "停損 108.5" }]);
  // The 停利 fired: its market sell is waiting for volume.
  assert.deepEqual(exitStampParts(exit, "takeProfit"), [{ kind: "takeProfit", text: "停利觸發 · 市價賣出中" }]);
  assert.deepEqual(exitStampParts(undefined, null), []);
});

test("最低獲利檔 is the first tick whose sale pays the buy fee, its own fee and the day-trade tax, and still gains", () => {
  // 2026-11-08, 石大哥: 鴻海 bought at 216.5 sold at 220 (+1.5%); 「請改最低的tick(可cover手續費和證交稅)」.
  // 216,500 + fee 185 = 216,685 paid. 217: 217,000 − 186 − 326 = 216,488, short. 217.5: 217,500 − 186 − 326 = 216,988.
  assert.equal(coverPrice(216.5, 1000, 185), 217.5);
  // The 20 元 minimum fee: 10,000 + 20 paid; 10.05 nets 10,015, 10.1 nets 10,065.
  assert.equal(coverPrice(10, 1000, 20), 10.1);
  // Two lots of 2330 at 1460 (fee 2,497): 1460 nets less than paid, 1465 (the next 5 元 tick) nets 2,923,100.
  assert.equal(coverPrice(1460, 2000, 2497), 1465);
  // An average off the grid starts from the first tick over it: 100.333… × 3 lots, fees 258 → 101.
  assert.equal(coverPrice(301 / 3, 3000, 258), 101);
});

test("with 最低獲利檔 the holding's shares and paid buy fees set 停利; without them, one lot and its own fee", () => {
  assert.deepEqual(exitPrices(216.5, DEFAULT_EXIT, 210, { shares: 1000, buyFees: 185 }), { takeProfit: 217.5, stopLoss: 211.5 });
  // Without them: one lot's own fee, 185 again.
  assert.deepEqual(exitPrices(216.5, DEFAULT_EXIT, 210), { takeProfit: 217.5, stopLoss: 211.5 });
  // Past 漲停 it cannot be reached: none.
  assert.equal(exitPrices(110, DEFAULT_EXIT, 100, { shares: 1000, buyFees: 94 }).takeProfit, null);
});

test("a holding's buy fees are its buys' since it was last flat, less the share a sale took", () => {
  const fill = (side: "buy" | "sell", shares: number, fee: number, code = "2317") => ({ id: "x", code, side, shares, price: 1, fee, tax: 0, t: 0 });
  assert.equal(holdingBuyFees([fill("buy", 1000, 185)], "2317"), 185);
  assert.equal(holdingBuyFees([fill("buy", 1000, 86), fill("buy", 2000, 172), fill("buy", 1000, 50, "2330")], "2317"), 258);
  // Half sold: half the fees stay with the shares left.
  assert.equal(holdingBuyFees([fill("buy", 2000, 172), fill("sell", 1000, 86)], "2317"), 86);
  // Sold out and bought again: only the new buy counts.
  assert.equal(holdingBuyFees([fill("buy", 1000, 185), fill("sell", 1000, 186), fill("buy", 1000, 90)], "2317"), 90);
  assert.equal(holdingBuyFees([], "2317"), 0);
});

test("a 觸價單 says how many ticks it is from the cost, across price bands (2026-11-08, 石大哥: 「這樣是6個ticks」)", () => {
  // 石大哥's 11/3 run: 台泥 28.05 → 停損 27.75 is 6 ticks of 0.05; 景碩 891 → 882 is 9 ticks of 1 元 — both −1%.
  assert.equal(exitTicks(28.05, 27.75), 6);
  assert.equal(exitTicks(891, 882), 9);
  // 鴻海 216.5 → 最低獲利檔 217.5: 2 ticks of 0.5.
  assert.equal(exitTicks(216.5, 217.5), 2);
  // Across the 100 band: 99.5 → 101 is 5 ticks of 0.1 to 100, then 2 of 0.5.
  assert.equal(exitTicks(99.5, 101), 7);
  // An average off the grid counts the ticks to pass it: 100.333… → 101 is 101, 100.5 → 2.
  assert.equal(exitTicks(301 / 3, 101), 2);
});

test("beside its price a 觸價單 says its ticks and about what % they are (2026-11-09, the owner: 「ticks旁邊備注幾%」)", () => {
  // From the cost, one decimal: 台泥 28.05 → 27.55 is −1.78%, 鴻海 216.5 → 217.5 is +0.46%.
  assert.equal(exitPercentText(28.05, 27.55), "約 -1.8%");
  assert.equal(exitPercentText(216.5, 217.5), "約 +0.5%");
  // 停利 by the plan's ticks over 最低獲利檔; 停損 by its ticks under the cost.
  assert.equal(exitNote("takeProfit", 216.5, 217.5, 0), "（最低獲利檔，約 +0.5%）");
  assert.equal(exitNote("takeProfit", 216.5, 218.5, 2), "（最低獲利檔 +2 檔，約 +0.9%）");
  assert.equal(exitNote("stopLoss", 28.05, 27.55), "（-10 檔，約 -1.8%）");
  // Without the plan's ticks (armed before 2026-11-09), the 停利's own ticks from the cost.
  assert.equal(exitNote("takeProfit", 1465, 1490), "（+5 檔，約 +1.7%）");
});

test("the plan card says about what % the chosen ticks are at a few prices (2026-11-09, the owner: 「例:6ticks=3%」)", () => {
  // 26.55 (0.05 a tick) → 26.05; 224.5 (0.5) → 219.5; 1055 (5) → 1005.
  assert.equal(stopLossExampleText(10), "停損 10 檔約等於：26.55 元 -1.9%、224.5 元 -2.2%、1055 元 -4.7%（價位不同，每檔大小不同）。");
  assert.equal(stopLossExampleText(3), "停損 3 檔約等於：26.55 元 -0.6%、224.5 元 -0.7%、1055 元 -1.4%（價位不同，每檔大小不同）。");
  // 224.5 × 1 lot, fee 192: 最低獲利檔 225.5; +2 ticks → 226.5.
  assert.equal(takeProfitExampleText(0), "例：224.5 元買 1 張，停利 225.5（約 +0.4%）。");
  assert.equal(takeProfitExampleText(2), "例：224.5 元買 1 張，停利 226.5（約 +0.9%）。");
});
