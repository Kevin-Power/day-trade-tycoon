import assert from "node:assert/strict";
import { test } from "node:test";
import { fillClock, fillPriceText, ledgerSummary, lotProgress } from "./morning-ledger.ts";

test("ledgerSummary counts holdings, orders, pending orders and fills", () => {
  const order = (status: "pending" | "filled" | "cancelled" | "rejected") => ({
    id: status, code: "2330", side: "buy" as const, shares: 1000, status, submittedCursor: 1,
  });
  assert.deepEqual(
    ledgerSummary({
      positions: [{ code: "2330", shares: 2000, averageCost: 2582.5 }],
      orders: [order("filled"), order("pending"), order("cancelled")],
      fills: [{ id: "f", code: "2330", side: "buy", shares: 1000, price: 2580, fee: 0, tax: 0, t: 60 }],
    }),
    { positions: 1, orders: 3, pending: 1, fills: 1 },
  );
  assert.deepEqual(ledgerSummary({ positions: [], orders: [], fills: [] }), {
    positions: 0, orders: 0, pending: 0, fills: 0,
  });
});

test("a fill shows the second of its real trade; a run made before the trades were kept still shows its minute", () => {
  // t is whole seconds after 09:00, ms the real trade's millisecond after 09:00.
  assert.equal(fillClock({ t: 187, ms: 187_999 }), "09:03:07");
  assert.equal(fillClock({ t: 0, ms: 0 }), "09:00:00");
  assert.equal(fillClock({ t: 5399, ms: 5_399_999 }), "10:29:59");
  // ms is the truth when the two differ (t is only its floor); a trade in the first millisecond of a second stays in it.
  assert.equal(fillClock({ t: 60, ms: 61_000 }), "09:01:01");
  // An old run has no ms: the minute of its bar, as it was.
  assert.equal(fillClock({ t: 180 }), "09:03");
  assert.equal(fillClock({ t: 180, ms: undefined }), "09:03");
  // An ms that is not a time is not used.
  assert.equal(fillClock({ t: 180, ms: Number.NaN }), "09:03");
  assert.equal(fillClock({ t: 180, ms: -1 }), "09:03");
});

test("a fill's price: one trade's price as the tick grid writes it, an average off the grid to two decimals", () => {
  assert.equal(fillPriceText(1465), "1465");
  assert.equal(fillPriceText(99.5), "99.5");
  assert.equal(fillPriceText(23.45), "23.45");
  assert.equal(fillPriceText(1040.5 / 10), "104.05");
  assert.equal(fillPriceText(302 / 3), "100.67");
  // An average a 1,000+ stock's grid would round to a whole tick keeps its decimals.
  assert.equal(fillPriceText(1462.5), "1462.50");
  assert.equal(fillPriceText(Number.NaN), "--");
});

test("a waiting order's progress: the lots counted of the lots ordered", () => {
  const order = { shares: 400_000 };
  assert.equal(lotProgress({ ...order, filledLots: 120 }), "已累計 120／400 張");
  assert.equal(lotProgress(order), "已累計 0／400 張");
  assert.equal(lotProgress({ shares: 1000 }), "已累計 0／1 張");
});
