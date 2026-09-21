import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEAVE_DESK_NO_FLATTEN,
  LEAVE_DESK_NO_RECORD,
  leaveDeskNeedsConfirm,
  leaveDeskOrderLine,
  leaveDeskPositionLine,
  leaveDeskRisk,
} from "./leave-desk.ts";

function engine(opts: {
  positions?: Array<{ lots: number }>;
  orders?: Array<{ status: "pending" | "partial" | "filled" | "cancelled" }>;
}) {
  const positions = new Map<string, { lots: number }>();
  (opts.positions ?? []).forEach((p, i) => positions.set(`C${i}`, p));
  return { positions, orders: opts.orders ?? [] };
}

describe("leaveDeskRisk", () => {
  it("is empty without an engine", () => {
    assert.deepEqual(leaveDeskRisk(null), { openPositions: 0, openOrders: 0 });
    assert.equal(leaveDeskNeedsConfirm(leaveDeskRisk(null)), false);
  });

  it("ignores flat inventory and finished orders", () => {
    const risk = leaveDeskRisk(
      engine({
        positions: [{ lots: 0 }, { lots: 0 }],
        orders: [{ status: "filled" }, { status: "cancelled" }],
      }),
    );
    assert.deepEqual(risk, { openPositions: 0, openOrders: 0 });
    assert.equal(leaveDeskNeedsConfirm(risk), false);
  });

  it("counts open positions and working orders", () => {
    const risk = leaveDeskRisk(
      engine({
        positions: [{ lots: 2 }, { lots: -1 }, { lots: 0 }],
        orders: [{ status: "pending" }, { status: "partial" }, { status: "filled" }],
      }),
    );
    assert.deepEqual(risk, { openPositions: 2, openOrders: 2 });
    assert.equal(leaveDeskNeedsConfirm(risk), true);
  });
});

describe("leave-desk copy", () => {
  it("warns that leave discards the session and does not flatten", () => {
    assert.match(LEAVE_DESK_NO_RECORD, /不會寫入戰績/);
    assert.match(LEAVE_DESK_NO_FLATTEN, /不會自動平倉/);
    assert.equal(LEAVE_DESK_NO_FLATTEN.includes("已市價清倉"), false);
    assert.equal(leaveDeskPositionLine(2), "尚有 2 檔庫存未平。");
    assert.equal(leaveDeskOrderLine(1), "尚有 1 筆未成交委託。");
    assert.equal(leaveDeskPositionLine(0), null);
  });
});
