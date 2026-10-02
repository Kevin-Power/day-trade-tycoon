import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFills, evaluatePass } from "./pass-rules.ts";
import type { Fill } from "./types.ts";

function fill(side: "buy" | "sell", price: number, time: number, lots = 1, fee = 0): Fill {
  return {
    id: `${side}-${time}`,
    orderId: `O${time}`,
    code: "2317",
    side,
    price,
    time,
    lots,
    fee,
    tax: 0,
    vwapAt: price,
  };
}
test("gross-winning trade consumed by fees is not counted as a winning day trade", () => {
  assert.equal(
    analyzeFills([fill("buy", 100, 0, 1, 100), fill("sell", 100.1, 60, 1, 100)]).winningTrades,
    0,
  );
  assert.equal(
    analyzeFills([fill("buy", 100, 0, 1, 100), fill("sell", 101, 60, 1, 100)]).winningTrades,
    1,
  );
});
test("partial close keeps cost basis and original holding start", () => {
  const result = analyzeFills([
    fill("buy", 100, 0, 2),
    fill("sell", 120, 60),
    fill("buy", 105, 90),
    fill("sell", 106, 1200, 2),
  ]);
  assert.equal(result.averageDownAt, undefined);
  assert.equal(result.maxHoldMinutes, 20);
});
test("adding to losing short and long positions is detected", () => {
  assert.equal(analyzeFills([fill("buy", 100, 0), fill("buy", 99, 60)]).averageDownAt, 60);
  assert.equal(analyzeFills([fill("sell", 100, 0), fill("sell", 101, 60)]).averageDownAt, 60);
});
test("automatic close cannot satisfy voluntary flatten rule", () => {
  const result = evaluatePass({
    lessonId: "mon",
    pnl: 0,
    fees: 0,
    maxDrawdown: 0,
    endT: 16200,
    positionsOpen: 0,
    fills: [],
    forcedClose: true,
  });
  assert.equal(result.verdicts.find((v) => v.rule.code === "flatten_before_close")?.passed, false);
});

test("newest-first engine fills in the same second are analyzed in execution sequence", () => {
  const older = { ...fill("buy", 100, 0, 2, 100), id: "F2" };
  const newer = { ...fill("sell", 101, 0, 1, 100), id: "F4" };
  assert.deepEqual(analyzeFills([newer, older]), analyzeFills([older, newer]));
  assert.equal(analyzeFills([newer, older]).winningTrades, 1);
});
test("third lesson needs complete low+10min coverage and actual risk reduction", () => {
  const base = {
    lessonId: "tue-dump",
    pnl: 0,
    fees: 0,
    maxDrawdown: 0,
    positionsOpen: 0,
    fills: [fill("buy", 100, 60, 2), fill("sell", 99, 7500)],
  };
  const low = (endT: number) =>
    evaluatePass({ ...base, endT }).verdicts.find((v) => v.rule.code === "risk_down_after_low");
  assert.equal(low(7200)?.passed, false);
  assert.equal(low(7800)?.passed, true);
});
test("free practice or unknown rubric never claims a course pass", () => {
  assert.equal(
    evaluatePass({
      lessonId: "live-x",
      pnl: 100,
      fees: 0,
      maxDrawdown: 0,
      endT: 100,
      positionsOpen: 0,
      fills: [],
    }).passed,
    false,
  );
});
