import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePass } from "./pass-rules.ts";
import type { Fill } from "./types.ts";

function fill(partial: Partial<Fill> & Pick<Fill, "id" | "side" | "price" | "time">): Fill {
  return {
    orderId: partial.id,
    code: "2317",
    lots: 1,
    fee: 40,
    tax: 0,
    vwapAt: partial.price,
    ...partial,
  };
}

test("P1-3 第 1 課：攤平 + 持倉到收盤必須未通過且指出兩條", () => {
  const r = evaluatePass({
    lessonId: "wed-open",
    pnl: -8000,
    fees: 400,
    maxDrawdown: 0.012,
    endT: 45 * 60,
    positionsOpen: 0,
    forcedClose: true,
    fills: [
      fill({ id: "a", side: "buy", price: 243, time: 30 }),
      fill({ id: "b", side: "buy", price: 239, time: 180 }),
    ],
  });
  const failed = r.verdicts.filter((v) => !v.passed).map((v) => v.rule.code);
  assert.equal(r.passed, false);
  assert.ok(failed.includes("no_average_down"), `missing 攤平, got ${failed.join(",")}`);
  assert.ok(failed.includes("flatten_before_close"), `missing 收盤未平倉, got ${failed.join(",")}`);
});

test("自行平倉且未攤平則收盤規則通過", () => {
  const r = evaluatePass({
    lessonId: "wed-open",
    pnl: 1200,
    fees: 300,
    maxDrawdown: 0.004,
    endT: 45 * 60,
    positionsOpen: 0,
    forcedClose: false,
    fills: [
      fill({ id: "a", side: "buy", price: 243, time: 30 }),
      fill({ id: "b", side: "sell", price: 245, time: 600, tax: 367 }),
    ],
  });
  const flat = r.verdicts.find((v) => v.rule.code === "flatten_before_close");
  const avg = r.verdicts.find((v) => v.rule.code === "no_average_down");
  assert.equal(flat?.passed, true);
  assert.equal(avg?.passed, true);
});
