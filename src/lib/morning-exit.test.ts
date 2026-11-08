import test from "node:test";
import assert from "node:assert/strict";
import {
  COVER_TICK,
  coverPrice,
  DEFAULT_EXIT,
  exitPlanText,
  exitStampParts,
  exitPrices,
  exitTicks,
  exitTicksText,
  exitTrigger,
  holdingBuyFees,
  holdingLevels,
  triggerOrders,
  STOP_LOSS_CHOICES,
  TAKE_PROFIT_CHOICES,
  takeProfitText,
} from "./morning-exit.ts";

const PCT_EXIT = { takeProfitPct: 1.5, stopLossPct: 1 };

test("the default is 停利 最低獲利檔 and 停損 −2% (2026-11-08, 石大哥 and the owner); the percentages stay among the choices", () => {
  // The owner: 「先抓寬一點，讓他們知道N字攻擊突破後，有很大的成功率可保本和賺到退傭，停損抓大一點…」
  assert.deepEqual(DEFAULT_EXIT, { takeProfitPct: COVER_TICK, stopLossPct: 2 });
  assert.equal(COVER_TICK, 0);
  assert.deepEqual(TAKE_PROFIT_CHOICES, [0, 0.5, 1, 1.5, 2, 3]);
  assert.deepEqual(STOP_LOSS_CHOICES, [0.5, 1, 1.5, 2]);
  assert.equal(takeProfitText(COVER_TICK), "最低獲利檔");
  assert.equal(takeProfitText(1.5), "+1.5%");
  assert.equal(exitPlanText(DEFAULT_EXIT), "停利 最低獲利檔／停損 -2%");
  assert.equal(exitPlanText(PCT_EXIT), "停利 +1.5%／停損 -1%");
});

test("停利 is the first tick at or over the target, 停損 the last tick at or under it", () => {
  // 中砂 at 854 (tick 1): 866.81 → 867, 845.46 → 845.
  assert.deepEqual(exitPrices(854, PCT_EXIT, 867), { takeProfit: 867, stopLoss: 845 });
  // 100.5: 102.0075 on the 0.5 grid → 102.5; 99.495 is under 100, on the 0.1 grid → 99.4.
  assert.deepEqual(exitPrices(100.5, PCT_EXIT, 100), { takeProfit: 102.5, stopLoss: 99.4 });
  // A target already on the grid stays: 200 × 1.015 = 203, 200 × 0.99 = 198.
  assert.deepEqual(exitPrices(200, PCT_EXIT, 200), { takeProfit: 203, stopLoss: 198 });
  // Across the 1000 band (tick 5 above): 990 × 1.015 = 1004.85 → 1005.
  assert.equal(exitPrices(990, PCT_EXIT, 990).takeProfit, 1005);
});

test("each exit follows its own price band's tick", () => {
  // 10.01 × 1.005 = 10.06005 on a 0.05 grid → 10.1; × 0.995 = 9.95995 on a 0.01 grid → 9.95.
  assert.deepEqual(exitPrices(10.01, { takeProfitPct: 0.5, stopLossPct: 0.5 }, 10), { takeProfit: 10.1, stopLoss: 9.95 });
});

test("a 停利 past 漲停, or a 停損 past 跌停, cannot be reached: there is none, never one at the limit", () => {
  // Bought at 漲停 110 (from 100): 停利 111.65 is past it. Pulled down to 110 it would sell at once, at a loss.
  assert.deepEqual(exitPrices(110, PCT_EXIT, 100), { takeProfit: null, stopLoss: 108.5 });
  // 109 × 1.015 = 110.635: past 漲停 too; 109.5 × 1.005 = 110.0475 as well.
  assert.equal(exitPrices(109, PCT_EXIT, 100).takeProfit, null);
  assert.equal(exitPrices(109.5, { takeProfitPct: 0.5, stopLossPct: 1 }, 100).takeProfit, null);
  // Exactly at 漲停 is reachable: 108 × 1.015 = 109.62 → 110.
  assert.equal(exitPrices(108, PCT_EXIT, 100).takeProfit, 110);
  // Bought at 跌停 90: 停損 89.1 is past it; 停利 91.35 on the 0.1 grid → 91.4.
  assert.deepEqual(exitPrices(90, PCT_EXIT, 100), { takeProfit: 91.4, stopLoss: null });
  assert.equal(exitTrigger({ takeProfit: null, stopLoss: 108.5 }, 110), null);
  assert.equal(exitTrigger({ takeProfit: 91.4, stopLoss: null }, 90), null);
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
  const exit = { takeProfit: 1490, stopLoss: 1450, fromMs: 60_734 };
  // Bought at 1465: 1490 is 5 ticks of 5 元 over it, 1450 is 3 under (2026-11-08: 石大哥 counts in ticks).
  assert.deepEqual(triggerOrders([{ code: "2330", shares: 2000, averageCost: 1465, exit }]), [
    { code: "2330", kind: "takeProfit", name: "停利觸價單", price: 1490, ticks: 5, shares: 2000, fromMs: 60_734 },
    { code: "2330", kind: "stopLoss", name: "停損觸價單", price: 1450, ticks: 3, shares: 2000, fromMs: 60_734 },
  ]);
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
  assert.deepEqual(exitPrices(216.5, DEFAULT_EXIT, 210, { shares: 1000, buyFees: 185 }), { takeProfit: 217.5, stopLoss: 212 });
  // −2%: 212.17 → 212 on the 0.5 grid.
  assert.deepEqual(exitPrices(216.5, DEFAULT_EXIT, 210), { takeProfit: 217.5, stopLoss: 212 });
  // Past 漲停 it cannot be reached: none, as with the percentages.
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
  assert.equal(exitTicksText(28.05, 27.75), "（-6 檔）");
  assert.equal(exitTicksText(216.5, 217.5), "（+2 檔）");
});
