import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerSummary } from "./morning-ledger.ts";

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
