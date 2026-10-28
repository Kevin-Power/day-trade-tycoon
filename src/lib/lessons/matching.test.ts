import test from "node:test";
import assert from "node:assert/strict";
import { matchOrder, tradesBefore } from "./matching.ts";
import type { TradeRow } from "./trades.ts";

const row = (ms: number, price: number, size = 1): TradeRow => [ms, price, size, null, null];

test("a market order fills at the first trade's price and time, whatever its size", () => {
  const cell = [row(61_250, 101, 1), row(61_900, 99, 50)];
  assert.deepEqual(matchOrder({ side: "buy" }, cell), { kind: "fill", price: 101, ms: 61_250 });
  assert.deepEqual(matchOrder({ side: "sell" }, cell), { kind: "fill", price: 101, ms: 61_250 });
  // Having seen trades before changes nothing for a market order.
  assert.deepEqual(matchOrder({ side: "buy", seen: true }, cell), { kind: "fill", price: 101, ms: 61_250 });
});

test("a limit whose first trade after it is at or better than the limit fills at that trade's price", () => {
  assert.deepEqual(matchOrder({ side: "buy", limitPrice: 100 }, [row(60_400, 99.5), row(60_500, 98)]), {
    kind: "fill",
    price: 99.5,
    ms: 60_400,
  });
  assert.deepEqual(matchOrder({ side: "buy", limitPrice: 100, seen: false }, [row(60_400, 100)]), {
    kind: "fill",
    price: 100,
    ms: 60_400,
  });
});

test("a limit not reached by the first trade rests, then fills at the limit when a later trade touches it", () => {
  const cell = [row(60_000, 101), row(60_100, 100.5), row(60_200, 99), row(60_300, 98)];
  assert.deepEqual(matchOrder({ side: "buy", limitPrice: 100 }, cell), { kind: "fill", price: 100, ms: 60_200 });
  // Seen in an earlier cell: even this cell's first trade fills at the limit, not at its better price.
  assert.deepEqual(matchOrder({ side: "buy", limitPrice: 100, seen: true }, [row(120_500, 99)]), {
    kind: "fill",
    price: 100,
    ms: 120_500,
  });
  assert.deepEqual(matchOrder({ side: "buy", limitPrice: 100 }, [row(60_000, 101), row(60_100, 100.5)]), {
    kind: "wait",
    seen: true,
  });
});

test("a limit sell compares the other way", () => {
  assert.deepEqual(matchOrder({ side: "sell", limitPrice: 100 }, [row(60_000, 100.5)]), {
    kind: "fill",
    price: 100.5,
    ms: 60_000,
  });
  assert.deepEqual(matchOrder({ side: "sell", limitPrice: 100 }, [row(60_000, 99), row(60_700, 101)]), {
    kind: "fill",
    price: 100,
    ms: 60_700,
  });
  assert.deepEqual(matchOrder({ side: "sell", limitPrice: 100, seen: true }, [row(180_000, 102)]), {
    kind: "fill",
    price: 100,
    ms: 180_000,
  });
  assert.deepEqual(matchOrder({ side: "sell", limitPrice: 100 }, [row(60_000, 99.9)]), { kind: "wait", seen: true });
});

test("an empty cell waits and leaves seen as it was", () => {
  assert.deepEqual(matchOrder({ side: "buy" }, []), { kind: "wait", seen: false });
  assert.deepEqual(matchOrder({ side: "buy", limitPrice: 100 }, []), { kind: "wait", seen: false });
  assert.deepEqual(matchOrder({ side: "sell", limitPrice: 100, seen: true }, []), { kind: "wait", seen: true });
});

test("tradesBefore counts the trades strictly before a time", () => {
  const trades = [row(0, 1), row(59_999, 1), row(60_000, 1), row(60_000, 1), row(130_000, 1)];
  assert.equal(tradesBefore(trades, 0), 0);
  assert.equal(tradesBefore(trades, 60_000), 2);
  assert.equal(tradesBefore(trades, 60_001), 4);
  assert.equal(tradesBefore(trades, 5_400_000), 5);
  assert.equal(tradesBefore([], 60_000), 0);
});
