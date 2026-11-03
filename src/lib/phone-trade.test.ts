import test from "node:test";
import assert from "node:assert/strict";
import type { MorningState } from "./morning.ts";
import { phoneTrade, type PhoneTradeInput } from "./phone-trade.ts";

type Order = MorningState["orders"][number];
const NAMES = { "2330": "台積電", "3037": "欣興" };
const order = (over: Partial<Order>): Order => ({
  id: "o1", code: "2330", side: "buy", shares: 1000, status: "pending", submittedCursor: 3, ...over,
});
const input = (over: Partial<PhoneTradeInput> = {}, session: Partial<PhoneTradeInput["session"]> = {}): PhoneTradeInput => ({
  session: { cursor: 4, completed: false, cash: 10_000_000, orders: [], positions: [], ...session },
  code: "2330",
  names: NAMES,
  lots: 1,
  reference: 1465,
  atEnd: false,
  busy: false,
  sending: null,
  armed: false,
  ...over,
});
const ready = (view: ReturnType<typeof phoneTrade>) => {
  assert.equal(view.kind, "ready");
  return view as Extract<typeof view, { kind: "ready" }>;
};

test("with no holding, 買進 sends at market and 賣出 says there is nothing to sell", () => {
  const view = ready(phoneTrade(input()));
  assert.deepEqual(view.buy, { enabled: true, label: "買進", sub: "市價", tap: "send" });
  assert.deepEqual(view.sell, { enabled: false, label: "賣出", sub: "沒有庫存", lots: 0 });
});

test("賣出 sells the whole holding of the stock on screen and says how many lots", () => {
  const view = ready(phoneTrade(input({}, { positions: [{ code: "2330", shares: 2000, averageCost: 1462.5 }] })));
  assert.deepEqual(view.sell, { enabled: true, label: "賣出", sub: "全部 2 張", lots: 2 });
  // Another stock's holding is not this stock's.
  const other = ready(phoneTrade(input({ code: "3037" }, { positions: [{ code: "2330", shares: 2000, averageCost: 1462.5 }] })));
  assert.equal(other.sell.enabled, false);
});

test("the learner's waiting order takes the buttons' place, with its progress and its id to withdraw it", () => {
  const view = phoneTrade(input({}, { orders: [order({ filledLots: 0 })] }));
  assert.deepEqual(view, {
    kind: "waiting",
    orderId: "o1",
    text: "委託中 · 買進 台積電 1 張 市價",
    progress: "已累計 0／1 張",
  });
  // One waiting order for the whole run: another stock's order also waits here, named.
  const limit = phoneTrade(input({ code: "3037" }, { orders: [order({ side: "sell", shares: 2000, limitPrice: 1470 })] }));
  assert.equal(limit.kind === "waiting" && limit.text, "委託中 · 賣出 台積電 2 張 限價 1470");
});

test("while the classroom's 自動出場 sell of the stock waits, neither button can be pressed", () => {
  const view = ready(phoneTrade(input({}, {
    positions: [{ code: "2330", shares: 1000, averageCost: 1465 }],
    orders: [order({ id: "auto", side: "sell", auto: "takeProfit" })],
  })));
  assert.equal(view.buy.enabled, false);
  assert.equal(view.sell.enabled, false);
  assert.equal(view.sell.sub, "自動停利中");
  // Another stock's 自動出場 does not lock this one.
  const other = ready(phoneTrade(input({ code: "3037" }, { orders: [order({ id: "auto", side: "sell", auto: "stopLoss" })] })));
  assert.equal(other.buy.enabled, true);
});

test("a buy the cash cannot pay for, its fee included, cannot be pressed and says so", () => {
  const view = ready(phoneTrade(input({ lots: 7 }, { cash: 10_000_000 })));
  assert.deepEqual(view.buy, { enabled: false, label: "買進", sub: "資金不足", tap: "send" });
});

test("a buy of half the cash or more needs a second tap, which the first one asks for", () => {
  const first = ready(phoneTrade(input({ lots: 4 })));
  assert.deepEqual(first.buy, { enabled: true, label: "買進", sub: "市價", tap: "arm" });
  const second = ready(phoneTrade(input({ lots: 4, armed: true })));
  assert.deepEqual(second.buy, { enabled: true, label: "確認買進", sub: "大額 59%", tap: "send" });
});

test("before the first minute, after the close and while a request is out, nothing is sent", () => {
  for (const [over, session, sub] of [
    [{}, { cursor: 0 }, "第一分鐘後"],
    [{ atEnd: true }, {}, "已收盤"],
    [{}, { completed: true }, "已收盤"],
  ] as const) {
    const view = ready(phoneTrade(input(over, session)));
    assert.equal(view.buy.enabled, false);
    assert.equal(view.buy.sub, sub);
    assert.equal(view.sell.enabled, false);
  }
  const busy = ready(phoneTrade(input({ busy: true }, { positions: [{ code: "2330", shares: 1000, averageCost: 1465 }] })));
  assert.equal(busy.buy.enabled, false);
  assert.equal(busy.sell.enabled, false);
  assert.equal(busy.buy.sub, "市價", "a busy desk keeps the words");
  const sending = ready(phoneTrade(input({ busy: true, sending: "buy" })));
  assert.equal(sending.buy.sub, "送出中…");
});
