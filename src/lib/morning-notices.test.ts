import test from "node:test";
import assert from "node:assert/strict";
import type { MorningState } from "./morning.ts";
import { holdingText, orderNotices, sellResults, signedMoney, type OrderNoticeView } from "./morning-notices.ts";
import { EXIT_CANCEL } from "./morning-exit.ts";

type Fill = MorningState["fills"][number];
type Order = MorningState["orders"][number];
const NAMES = { "3533": "嘉澤", "2330": "台積電" };
const fill = (id: string, side: "buy" | "sell", shares: number, price: number, fee: number, tax = 0, code = "3533"): Fill => ({
  id, code, side, shares, price, fee, tax, t: 1_600,
});
const order = (id: string, status: Order["status"], extra: Partial<Order> = {}): Order => ({
  id, code: "3533", side: "sell", shares: 2000, status, submittedCursor: 27, ...extra,
});
const view = (over: Partial<OrderNoticeView> = {}): OrderNoticeView => ({ id: "run", fills: [], orders: [], positions: [], ...over });

// 2026-11-02, the owner's phone: 嘉澤 bought at 1775 and 1795 (fees 1,518 and 1,535), 2 張 at 1,785 on average.
const BUYS = [fill("A", "buy", 1000, 1775, 1518), fill("B", "buy", 1000, 1795, 1535)];

test("a sell's result counts its own fee and tax and the buy fees of the shares it sells", () => {
  const sold = fill("C", "sell", 2000, 1810, 3095, 5430);
  assert.equal(sellResults([...BUYS, sold]).get("C"), (1810 - 1785) * 2000 - 3095 - 5430 - (1518 + 1535));
  // Part of the holding: the average cost and half of the buy fees go with the half that is sold.
  const half = fill("D", "sell", 1000, 1810, 1547, 2715);
  const results = sellResults([...BUYS, half, fill("E", "sell", 1000, 1760, 1504, 2640)]);
  assert.equal(results.get("D"), (1810 - 1785) * 1000 - 1547 - 2715 - 1526.5);
  assert.equal(results.get("E"), (1760 - 1785) * 1000 - 1504 - 2640 - 1526.5);
  assert.equal(sellResults(BUYS).size, 0, "buys have no result");
});

test("each stock keeps its own cost", () => {
  const results = sellResults([fill("A", "buy", 1000, 100, 20, 0, "2330"), ...BUYS, fill("C", "sell", 1000, 110, 20, 33, "2330")]);
  assert.equal(results.get("C"), 10_000 - 20 - 33 - 20);
});

test("a fill the replay has reached is announced once, with the holding after a buy", () => {
  const before = view({ fills: [BUYS[0]], orders: [order("B", "pending", { side: "buy", shares: 1000 })] });
  const after = view({
    fills: BUYS,
    orders: [order("B", "filled", { side: "buy", shares: 1000, price: 1795 })],
    positions: [{ code: "3533", shares: 2000, averageCost: 1785 }],
  });
  assert.deepEqual(orderNotices(before, after, NAMES), [
    { id: "B", label: "成交", text: "買進 嘉澤 1 張 @ 1795 · 庫存 2 張 成本 1785" },
  ]);
  assert.deepEqual(orderNotices(after, after, NAMES), [], "nothing new, nothing said");
});

test("a sell says what it made or lost, fees and tax included", () => {
  const sold = fill("C", "sell", 2000, 1810, 3095, 5430);
  const notices = orderNotices(view({ fills: BUYS }), view({ fills: [...BUYS, sold] }), NAMES);
  assert.deepEqual(notices, [
    { id: "C", label: "成交", text: "賣出 嘉澤 2 張 @ 1810", result: { text: "這筆 +38,422", tone: "up" } },
  ]);
  const lost = orderNotices(view({ fills: BUYS }), view({ fills: [...BUYS, fill("C", "sell", 2000, 1760, 3009, 5280)] }), NAMES);
  assert.deepEqual(lost[0].result, { text: "這筆 -61,342", tone: "down" });
});

test("an order the classroom closes without a fill is said with its reason; the learner's own closing is not", () => {
  const before = view({ orders: [order("S", "pending")] });
  for (const reason of ["成交量不足", "教材結束，委託未成交", "成交價變動後，模擬資金不足，未成交"])
    assert.deepEqual(orderNotices(before, view({ orders: [order("S", reason.includes("資金") ? "rejected" : "cancelled", { reason })] }), NAMES), [
      { id: "S", label: "未成交", text: `賣出 嘉澤 2 張 · ${reason}` },
    ]);
  for (const reason of ["由學員取消", "結束練習時取消尚未成交委託", "放棄這局時取消尚未成交委託"])
    assert.deepEqual(orderNotices(before, view({ orders: [order("S", "cancelled", { reason })] }), NAMES), [], reason);
});

test("opening a run, or another run, announces nothing that was already there", () => {
  const after = view({ fills: BUYS, positions: [{ code: "3533", shares: 2000, averageCost: 1785 }] });
  assert.deepEqual(orderNotices(null, after, NAMES), []);
  assert.deepEqual(orderNotices(view({ id: "older" }), after, NAMES), []);
});

test("money with its sign, and a stock's holding for the quote block", () => {
  assert.equal(signedMoney(46_947), "+46,947");
  assert.equal(signedMoney(-1_234.4), "-1,234");
  assert.equal(signedMoney(0), "0");
  // Three short parts, so a phone can stack them beside the stock's name (a 320px screen has about 118px there).
  // 2026-11-02, 石大哥: 「+4,000」 beside the name and 「+3,270」 under 庫存 were the same holding; the buy fees
  // paid for it now come off here too (+50,000 − 1,518 − 1,535), so with one stock held the two agree.
  assert.deepEqual(holdingText({ code: "3533", shares: 2000, averageCost: 1785 }, 1810, BUYS), {
    lots: "庫存 2 張",
    average: "成本 1785",
    result: { text: "+46,947", tone: "up" },
  });
  assert.deepEqual(holdingText({ code: "3533", shares: 2000, averageCost: 1785.5 }, undefined, BUYS), {
    lots: "庫存 2 張",
    average: "成本 1785.50",
    result: null,
  });
});

test("the holding's fees are the buy fees of the shares still held, stock by stock", () => {
  const fills = [...BUYS, fill("C", "sell", 1000, 1810, 1547, 2715), fill("D", "buy", 1000, 100, 20, 0, "2330")];
  // Half of 嘉澤 sold: half of its buy fees went with it; 台積電's own fee is not 嘉澤's.
  assert.equal(holdingText({ code: "3533", shares: 1000, averageCost: 1785 }, 1785, fills).result?.text, "-1,526");
  assert.equal(holdingText({ code: "2330", shares: 1000, averageCost: 100 }, 100, fills).result?.text, "-20");
});

test("the classroom's 自動出場 sell is said as 停利出場 or 停損出場; the learner's sell it replaced is not said", () => {
  const before = view({ fills: BUYS, orders: [order("S", "pending", { limitPrice: 1830 })] });
  const exit = order("X", "filled", { auto: "stopLoss", triggerPrice: 1765, price: 1760 });
  const after = view({
    fills: [...BUYS, fill("X", "sell", 2000, 1760, 3009, 5280)],
    orders: [order("S", "cancelled", { limitPrice: 1830, reason: EXIT_CANCEL }), exit],
  });
  assert.deepEqual(orderNotices(before, after, NAMES), [
    { id: "X", label: "停損出場", text: "賣出 嘉澤 2 張 @ 1760", result: { text: "這筆 -61,342", tone: "down" } },
  ]);
  const up = view({
    fills: [...BUYS, fill("Y", "sell", 2000, 1815, 3095, 5445)],
    orders: [order("Y", "filled", { auto: "takeProfit", triggerPrice: 1815, price: 1815 })],
  });
  assert.equal(orderNotices(view({ fills: BUYS }), up, NAMES)[0].label, "停利出場");
});

test("a buy whose fill set 觸價單 says so under it: 已送出觸價單：停利／停損 (2026-11-06, 石大哥)", () => {
  const before = view({ orders: [order("B", "pending", { side: "buy", shares: 1000 })] });
  const after = view({
    fills: [BUYS[0]],
    orders: [order("B", "filled", { side: "buy", shares: 1000, price: 1775 })],
    positions: [{ code: "3533", shares: 1000, averageCost: 1775, exit: { takeProfit: 1805, stopLoss: 1755, fromMs: 1_600_000 } }],
  });
  assert.deepEqual(orderNotices(before, after, NAMES), [
    { id: "A", label: "成交", text: "買進 嘉澤 1 張 @ 1775 · 庫存 1 張 成本 1775", note: "已送出觸價單：停利 1805（+6 檔）／停損 1755（-4 檔）" },
  ]);
  // One side past its limit: only the other is said.
  const oneSide = view({ ...after, positions: [{ code: "3533", shares: 1000, averageCost: 1775, exit: { takeProfit: null, stopLoss: 1755, fromMs: 0 } }] });
  assert.equal(orderNotices(before, oneSide, NAMES)[0].note, "已送出觸價單：停損 1755（-4 檔）");
});
