import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderPresentation } from "./order-presentation.ts";

describe("order presentation preserves the filled and cancelled quantities", () => {
  it("distinguishes the same partial fill before and after cancellation", () => {
    const partial = { status: "partial" as const, lots: 5, filled: 2 };
    assert.deepEqual(orderPresentation(partial), {
      statusLabel: "部分成交，餘量等待中",
      working: true,
      waitingLots: 3,
      cancelledLots: 0,
    });
    assert.deepEqual(orderPresentation({ ...partial, status: "cancelled" }), {
      statusLabel: "部分成交，餘量已取消",
      working: false,
      waitingLots: 0,
      cancelledLots: 3,
    });
    assert.deepEqual(partial, { status: "partial", lots: 5, filled: 2 });
  });

  it("distinguishes no-fill cancellation from a fully filled order", () => {
    assert.deepEqual(orderPresentation({ status: "cancelled", lots: 5, filled: 0 }), {
      statusLabel: "已取消，未成交",
      working: false,
      waitingLots: 0,
      cancelledLots: 5,
    });
    assert.deepEqual(orderPresentation({ status: "filled", lots: 5, filled: 5 }), {
      statusLabel: "全部成交",
      working: false,
      waitingLots: 0,
      cancelledLots: 0,
    });
  });

  it("keeps the full quantity waiting before the first fill", () => {
    assert.deepEqual(orderPresentation({ status: "pending", lots: 5, filled: 0 }), {
      statusLabel: "等待成交",
      working: true,
      waitingLots: 5,
      cancelledLots: 0,
    });
  });
});
