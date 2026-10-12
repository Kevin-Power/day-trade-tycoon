import test from "node:test";
import assert from "node:assert/strict";
import { createMorningBook, validMorningLimit } from "./morning-book.ts";
import { limitDown, limitUp } from "./market/ticks.ts";

test("illustrative depth has distinct legal prices, stable simulated quantities and no pre-open quotes", () => {
  assert.deepEqual(createMorningBook("2330", 0, 100, 100), { bids: [], asks: [] });
  assert.deepEqual(createMorningBook("2330", 1, NaN, 100), { bids: [], asks: [] });
  for (const price of [9.99, 10, 49.95, 50, 99.9, 100, 499.5, 500, 999, 1000, 2580]) {
    const book = createMorningBook("2330", 12, price, price);
    assert.equal(book.bids.length, 5);
    assert.equal(book.asks.length, 5);
    assert.deepEqual(createMorningBook("2330", 12, price, price), book);
    const prices = [...book.bids, ...book.asks].map((level) => level.price);
    assert.equal(new Set(prices).size, 10);
    assert.ok(prices.every((value) => validMorningLimit(value, price)));
    assert.ok(book.bids.every((level, i) => i === 0 || level.price < book.bids[i - 1].price));
    assert.ok(book.asks.every((level, i) => i === 0 || level.price > book.asks[i - 1].price));
    assert.ok(book.asks[0].price > book.bids[0].price);
    assert.ok(
      [...book.bids, ...book.asks].every((level) => Number.isInteger(level.lots) && level.lots > 0),
    );
  }
});

test("price limits never manufacture duplicate or out-of-band depth at the boundary", () => {
  const atUp = createMorningBook("2330", 1, limitUp(100), 100);
  assert.deepEqual(atUp.asks, []);
  assert.equal(atUp.bids.length, 5);
  const atDown = createMorningBook("2330", 1, limitDown(100), 100);
  assert.equal(atDown.bids.length, 1);
  assert.equal(atDown.asks.length, 5);
  for (const value of [0, -1, NaN, Infinity, 100.1, 89.9, 110.5])
    assert.equal(validMorningLimit(value, 100), false);
  assert.equal(validMorningLimit(100.5, 100), true);
});
