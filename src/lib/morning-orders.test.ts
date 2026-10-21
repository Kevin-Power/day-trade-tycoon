import test from "node:test";
import assert from "node:assert/strict";
import type { MorningState } from "./morning.ts";
import {
  isLargeOrder,
  LARGE_ORDER_CASH_SHARE,
  orderReports,
  sendFailureMessage,
  type LocalOrderFailure,
} from "./morning-orders.ts";

const NAMES = { "2330": "台積電", "2317": "鴻海" };
const run = (over: Partial<MorningState> = {}): MorningState => ({
  id: "run-1",
  lessonId: "lesson",
  cursor: 41,
  revision: 7,
  plan: { focusCode: "2330" } as MorningState["plan"],
  bars: {},
  startingCash: 10_000_000,
  cash: 9_990_000,
  equity: 9_990_000,
  positions: [],
  orders: [
    { id: "A", code: "2330", side: "buy", shares: 1000, status: "filled", submittedCursor: 20, price: 2575 },
    {
      id: "B",
      code: "2330",
      side: "sell",
      shares: 1000,
      status: "cancelled",
      submittedCursor: 36,
      limitPrice: 2595,
      reason: "由學員取消",
    },
  ],
  fills: [{ id: "A", code: "2330", side: "buy", shares: 1000, price: 2575, fee: 2202, tax: 0, t: 1200 }],
  completed: false,
  reflection: "",
  nextAdvanceAt: 0,
  ...over,
});
const FAILURE: LocalOrderFailure = {
  id: "f-1",
  cursor: 41,
  code: "2330",
  side: "buy",
  lots: 1,
  message: "目前模擬資金不足，無法委託",
};

test("a buy is large from half of the available cash; sells never are", () => {
  assert.equal(LARGE_ORDER_CASH_SHARE, 0.5);
  assert.equal(isLargeOrder({ side: "buy", amount: 2_580_000, availableCash: 10_000_000 }), false);
  assert.equal(isLargeOrder({ side: "buy", amount: 5_160_000, availableCash: 10_000_000 }), true);
  assert.equal(isLargeOrder({ side: "buy", amount: 5_165_000, availableCash: 9_990_000 }), true);
  assert.equal(isLargeOrder({ side: "sell", amount: 9_000_000, availableCash: 1_000 }), false);
  assert.equal(isLargeOrder({ side: "buy", amount: null, availableCash: 10_000_000 }), false);
  assert.equal(isLargeOrder({ side: "buy", amount: 1_000, availableCash: 0 }), false);
});

test("reports read newest first: a failed send, the cancel, its send, the fill and the first send", () => {
  assert.deepEqual(
    orderReports(run(), NAMES, [FAILURE]).map(({ tone, time, text }) => ({ tone, time, text })),
    [
      { tone: "failed", time: "09:41", text: "送出失敗 · 買進 台積電 1 張 · 目前模擬資金不足，無法委託" },
      { tone: "closed", time: null, text: "已撤回 · 賣出 台積電 1 張 限價 2595 · 由學員取消" },
      { tone: "sent", time: "09:36", text: "委託成功 · 賣出 台積電 1 張 限價 2595" },
      { tone: "filled", time: "09:20", text: "成交 · 買進 台積電 1 張 @ 2575" },
      { tone: "sent", time: "09:20", text: "委託成功 · 買進 台積電 1 張 市價（待下一分鐘開盤撮合）" },
    ],
  );
});

test("reports stop at the limit, and without a run only local failures remain", () => {
  assert.equal(orderReports(run(), NAMES, [FAILURE], 2).length, 2);
  assert.deepEqual(
    orderReports(null, NAMES, [FAILURE]).map((report) => report.tone),
    ["failed"],
  );
});

test("an order the next open turned down reads 未成交 with its reason", () => {
  const rejected = run({
    orders: [
      {
        id: "C",
        code: "2317",
        side: "buy",
        shares: 2000,
        status: "rejected",
        submittedCursor: 12,
        reason: "下一分鐘開盤價變動後，模擬資金不足，未成交",
      },
    ],
    fills: [],
  });
  const [latest, sent] = orderReports(rejected, NAMES, []);
  assert.deepEqual(
    { tone: latest.tone, time: latest.time, text: latest.text },
    { tone: "closed", time: null, text: "未成交 · 買進 鴻海 2 張 市價 · 下一分鐘開盤價變動後，模擬資金不足，未成交" },
  );
  assert.equal(sent.text, "委託成功 · 買進 鴻海 2 張 市價（待下一分鐘開盤撮合）");
});

test("a lightning order says so", () => {
  const lightning = run({
    orders: [
      {
        id: "D",
        code: "2330",
        side: "buy",
        shares: 1000,
        status: "pending",
        submittedCursor: 25,
        limitPrice: 2570,
        entryMode: "lightning",
      },
    ],
    fills: [],
  });
  assert.equal(orderReports(lightning, NAMES, [])[0].text, "委託成功 · 閃電 · 買進 台積電 1 張 限價 2570");
});

test("sendFailureMessage reports an order that did not go through, from its own send", () => {
  assert.equal(
    sendFailureMessage({ kind: "conflict", reason: "本次練習已達委託筆數上限" }),
    "本次練習已達委託筆數上限",
  );
  assert.equal(sendFailureMessage({ kind: "conflict", reason: "" }), "進度已更新，這次操作沒有送出。");
  assert.equal(
    sendFailureMessage({ kind: "error", message: "暫時連不上教室，請重試同一筆操作或重新載入進度。" }),
    "暫時連不上教室，請重試同一筆操作或重新載入進度。",
  );
});

test("sendFailureMessage says so when another operation kept the order from being sent", () => {
  assert.equal(sendFailureMessage({ kind: "busy" }), "另一個操作還在處理，這筆委託沒有送出。");
});

test("sendFailureMessage stays quiet for sent orders, sign-in problems and replaced requests", () => {
  assert.equal(sendFailureMessage({ kind: "sent" }), "");
  assert.equal(sendFailureMessage({ kind: "access" }), "");
  assert.equal(sendFailureMessage({ kind: "stale" }), "");
});

test("sendFailureMessage keeps the message of a send whose result is unclear", () => {
  const message = "教室回應超過 20 秒，已停止等待。請核對進度，或重試同一筆操作。";
  assert.equal(sendFailureMessage({ kind: "unknown", message }), message);
});

test("a send whose result is unclear is reported as 回覆不明, not as a failed send", () => {
  const unclear: LocalOrderFailure = {
    ...FAILURE,
    id: "f-2",
    unknown: true,
    message: "暫時連不上教室，請重試同一筆操作或重新載入進度。",
  };
  const [latest] = orderReports(null, NAMES, [unclear]);
  assert.equal(latest!.tone, "unknown");
  assert.equal(latest!.text, "回覆不明 · 買進 台積電 1 張 · 暫時連不上教室，請重試同一筆操作或重新載入進度。");
});
