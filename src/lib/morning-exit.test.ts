import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXIT,
  exitPlanText,
  exitPrices,
  exitTrigger,
  STOP_LOSS_CHOICES,
  TAKE_PROFIT_CHOICES,
} from "./morning-exit.ts";

test("the owner's default is 停利 +1.5% and 停損 −1%, both among the choices", () => {
  assert.deepEqual(DEFAULT_EXIT, { takeProfitPct: 1.5, stopLossPct: 1 });
  assert.deepEqual(TAKE_PROFIT_CHOICES, [0.5, 1, 1.5, 2, 3]);
  assert.deepEqual(STOP_LOSS_CHOICES, [0.5, 1, 1.5, 2]);
  assert.equal(exitPlanText(DEFAULT_EXIT), "停利 +1.5%／停損 -1%");
});

test("停利 is the first tick at or over the target, 停損 the last tick at or under it", () => {
  // 中砂 at 854 (tick 1): 866.81 → 867, 845.46 → 845.
  assert.deepEqual(exitPrices(854, DEFAULT_EXIT, 867), { takeProfit: 867, stopLoss: 845 });
  // 100.5: 102.0075 on the 0.5 grid → 102.5; 99.495 is under 100, on the 0.1 grid → 99.4.
  assert.deepEqual(exitPrices(100.5, DEFAULT_EXIT, 100), { takeProfit: 102.5, stopLoss: 99.4 });
  // A target already on the grid stays: 200 × 1.015 = 203, 200 × 0.99 = 198.
  assert.deepEqual(exitPrices(200, DEFAULT_EXIT, 200), { takeProfit: 203, stopLoss: 198 });
  // Across the 1000 band (tick 5 above): 990 × 1.015 = 1004.85 → 1005.
  assert.equal(exitPrices(990, DEFAULT_EXIT, 990).takeProfit, 1005);
});

test("each exit follows its own price band's tick", () => {
  // 10.01 × 1.005 = 10.06005 on a 0.05 grid → 10.1; × 0.995 = 9.95995 on a 0.01 grid → 9.95.
  assert.deepEqual(exitPrices(10.01, { takeProfitPct: 0.5, stopLossPct: 0.5 }, 10), { takeProfit: 10.1, stopLoss: 9.95 });
});

test("a 停利 past 漲停, or a 停損 past 跌停, cannot be reached: there is none, never one at the limit", () => {
  // Bought at 漲停 110 (from 100): 停利 111.65 is past it. Pulled down to 110 it would sell at once, at a loss.
  assert.deepEqual(exitPrices(110, DEFAULT_EXIT, 100), { takeProfit: null, stopLoss: 108.5 });
  // 109 × 1.015 = 110.635: past 漲停 too; 109.5 × 1.005 = 110.0475 as well.
  assert.equal(exitPrices(109, DEFAULT_EXIT, 100).takeProfit, null);
  assert.equal(exitPrices(109.5, { takeProfitPct: 0.5, stopLossPct: 1 }, 100).takeProfit, null);
  // Exactly at 漲停 is reachable: 108 × 1.015 = 109.62 → 110.
  assert.equal(exitPrices(108, DEFAULT_EXIT, 100).takeProfit, 110);
  // Bought at 跌停 90: 停損 89.1 is past it; 停利 91.35 on the 0.1 grid → 91.4.
  assert.deepEqual(exitPrices(90, DEFAULT_EXIT, 100), { takeProfit: 91.4, stopLoss: null });
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
