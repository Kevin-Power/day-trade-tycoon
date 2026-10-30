import test from "node:test";
import assert from "node:assert/strict";
import { endReason, matchOrder, tradesBefore, type PendingLike } from "./matching.ts";
import type { TradeRow } from "./trades.ts";

const row = (ms: number, price: number, size = 1): TradeRow => [ms, price, size, null, null];
/** Plays cells one after another the way the engine does: what a wait gathered is carried into the next cell. */
function play(order: PendingLike, cells: readonly (readonly TradeRow[])[]) {
  let pending = { ...order };
  for (const cell of cells) {
    const result = matchOrder(pending, cell);
    if (result.kind === "fill") return result;
    const { kind: _wait, ...progress } = result;
    pending = { ...pending, ...progress };
  }
  return { kind: "end" as const, reason: endReason(pending), pending };
}

test("a one-lot market order fills at the first trade after it, whatever that trade's size", () => {
  const cell = [row(61_250, 101, 1), row(61_900, 99, 50)];
  assert.deepEqual(matchOrder({ side: "buy", lots: 1 }, cell), { kind: "fill", price: 101, ms: 61_250 });
  assert.deepEqual(matchOrder({ side: "sell", lots: 1 }, [row(61_250, 101, 40)]), { kind: "fill", price: 101, ms: 61_250 });
});

test("a market order counts every trade until its lots are reached, at their average; the last trade only for the lots needed", () => {
  // 5 lots: 2 at 100, 1 at 101, then 2 of the 4 at 102 → (200 + 101 + 204) / 5 = 101, at the third trade's time.
  const cell = [row(60_100, 100, 2), row(60_200, 101, 1), row(60_300, 102, 4), row(60_400, 90, 9)];
  assert.deepEqual(matchOrder({ side: "buy", lots: 5 }, cell), { kind: "fill", price: 101, ms: 60_300 });
  assert.deepEqual(matchOrder({ side: "sell", lots: 5 }, cell), { kind: "fill", price: 101, ms: 60_300 });
  // Not enough yet: it waits with what it has counted.
  assert.deepEqual(matchOrder({ side: "buy", lots: 400 }, cell), {
    kind: "wait",
    seen: true,
    filledLots: 16,
    filledValue: 200 + 101 + 408 + 810,
    atLimit: false,
  });
});

test("the lots are counted across cells, and the fill is at the trade that completes them", () => {
  const cells = [
    [row(60_000, 100, 30), row(60_500, 101, 50)],
    [],
    [row(180_000, 102, 100), row(180_900, 103, 300)],
  ];
  // 30 + 50 + 100 + 220 of the 300 = 400 lots.
  const value = 100 * 30 + 101 * 50 + 102 * 100 + 103 * 220;
  assert.deepEqual(play({ side: "buy", lots: 400 }, cells), { kind: "fill", price: value / 400, ms: 180_900 });
  // After the first cell: 80 counted; the empty cell leaves that as it was.
  const first = matchOrder({ side: "buy", lots: 400 }, cells[0]);
  assert.deepEqual(first, { kind: "wait", seen: true, filledLots: 80, filledValue: 100 * 30 + 101 * 50, atLimit: false });
  assert.deepEqual(matchOrder({ side: "buy", lots: 400, ...first }, []), first);
});

test("a limit whose first trade after it already touches fills at the average of the touching trades, never worse than the limit", () => {
  // Buy 4 at 100: 1 at 99, the 101 does not touch, 2 at 100, then 1 of the 3 at 98 → (99 + 200 + 98) / 4 = 99.25.
  const cell = [row(60_400, 99, 1), row(60_500, 101, 5), row(60_600, 100, 2), row(60_700, 98, 3)];
  assert.deepEqual(matchOrder({ side: "buy", lots: 4, limitPrice: 100 }, cell), { kind: "fill", price: 99.25, ms: 60_700 });
  // A single lot is the first trade's price.
  assert.deepEqual(matchOrder({ side: "buy", lots: 1, limitPrice: 100 }, [row(60_400, 99.5, 1), row(60_500, 98, 1)]), {
    kind: "fill",
    price: 99.5,
    ms: 60_400,
  });
  // Sell 3 at 100: 2 at 101, the 99 does not touch, 1 at 100 → (202 + 100) / 3, at least the limit.
  const sold = matchOrder({ side: "sell", lots: 3, limitPrice: 100 }, [
    row(60_000, 101, 2),
    row(60_100, 99, 9),
    row(60_200, 100, 4),
  ]);
  assert.deepEqual(sold, { kind: "fill", price: 302 / 3, ms: 60_200 });
  assert.ok(sold.kind === "fill" && sold.price >= 100);
  // Waiting after touching first: the average is kept, the order is not a resting one.
  assert.deepEqual(matchOrder({ side: "buy", lots: 10, limitPrice: 100 }, [row(60_000, 99, 2), row(60_100, 101, 7)]), {
    kind: "wait",
    seen: true,
    filledLots: 2,
    filledValue: 198,
    atLimit: false,
  });
});

test("a limit not touched by the first trade after it rests, and fills at the limit once touching trades reach its lots", () => {
  // Buy 3 at 100: 101 does not touch (it rests), then 100 ×1, 99 ×1, 98 ×4 → 3 lots at the 98, filled at 100.
  const cell = [row(60_000, 101, 5), row(60_100, 100, 1), row(60_200, 99, 1), row(60_300, 98, 4)];
  assert.deepEqual(matchOrder({ side: "buy", lots: 3, limitPrice: 100 }, cell), { kind: "fill", price: 100, ms: 60_300 });
  // Across cells: resting since the first cell, the better trades of the next one still fill at the limit.
  assert.deepEqual(
    play({ side: "buy", lots: 5, limitPrice: 100 }, [[row(60_000, 100.5, 3), row(60_100, 99, 2)], [row(120_500, 95, 9)]]),
    { kind: "fill", price: 100, ms: 120_500 },
  );
  // Sell mirrored: 99 does not touch, 100.5 ×2 and 102 ×1 reach 3 lots at the limit.
  assert.deepEqual(
    matchOrder({ side: "sell", lots: 3, limitPrice: 100 }, [row(60_000, 99, 9), row(60_100, 100.5, 2), row(60_700, 102, 1)]),
    { kind: "fill", price: 100, ms: 60_700 },
  );
  // Still short: it waits as a resting order with the lots counted.
  assert.deepEqual(matchOrder({ side: "buy", lots: 5, limitPrice: 100 }, [row(60_000, 101, 1), row(60_100, 100, 2)]), {
    kind: "wait",
    seen: true,
    filledLots: 2,
    filledValue: 200,
    atLimit: true,
  });
});

test("the three reasons an order still waiting at 10:30 is cancelled", () => {
  // No trade at all after it.
  assert.deepEqual(play({ side: "buy", lots: 1 }, [[], []]), {
    kind: "end",
    reason: "之後沒有成交",
    pending: { side: "buy", lots: 1, seen: false, filledLots: 0, filledValue: 0, atLimit: false },
  });
  assert.equal(endReason({}), "之後沒有成交");
  // Trades, none touching.
  const untouched = play({ side: "buy", lots: 1, limitPrice: 99 }, [[row(60_000, 100), row(60_100, 101)], [row(120_000, 100)]]);
  assert.equal(untouched.kind === "end" && untouched.reason, "教材結束，委託未成交");
  // Touching, but not enough lots.
  const short = play({ side: "buy", lots: 400, limitPrice: 100 }, [[row(60_000, 100, 120)], [row(120_000, 101, 900)]]);
  assert.equal(short.kind === "end" && short.reason, "成交量不足");
  assert.equal(short.kind === "end" && short.pending.filledLots, 120);
  const market = play({ side: "sell", lots: 400 }, [[row(60_000, 100, 399)]]);
  assert.equal(market.kind === "end" && market.reason, "成交量不足");
});

test("an empty cell waits and leaves everything as it was", () => {
  assert.deepEqual(matchOrder({ side: "buy", lots: 1 }, []), {
    kind: "wait",
    seen: false,
    filledLots: 0,
    filledValue: 0,
    atLimit: false,
  });
  const before = { seen: true, filledLots: 7, filledValue: 700, atLimit: true };
  assert.deepEqual(matchOrder({ side: "sell", lots: 9, limitPrice: 100, ...before }, []), { kind: "wait", ...before });
});

test("tradesBefore counts the trades strictly before a time", () => {
  const trades = [row(0, 1), row(59_999, 1), row(60_000, 1), row(60_000, 1), row(130_000, 1)];
  assert.equal(tradesBefore(trades, 0), 0);
  assert.equal(tradesBefore(trades, 60_000), 2);
  assert.equal(tradesBefore(trades, 60_001), 4);
  assert.equal(tradesBefore(trades, 5_400_000), 5);
  assert.equal(tradesBefore([], 60_000), 0);
});
