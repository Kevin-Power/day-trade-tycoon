import test from "node:test";
import assert from "node:assert/strict";
import {
  bookCellBlocked,
  bookCellLabel,
  bookCellOrder,
  bookPressure,
  createMorningBook,
  validMorningLimit,
} from "./morning-book.ts";
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

test("book pressure sums illustrative lots and never divides by zero", () => {
  const book = createMorningBook("2330", 12, 2580, 2575);
  const pressure = bookPressure(book);
  assert.equal(pressure.bidLots, book.bids.reduce((sum, level) => sum + level.lots, 0));
  assert.equal(pressure.askLots, book.asks.reduce((sum, level) => sum + level.lots, 0));
  assert.ok(
    Math.abs(pressure.bidShare - pressure.bidLots / (pressure.bidLots + pressure.askLots)) < 1e-12,
  );
  assert.deepEqual(bookPressure({ bids: [], asks: [] }), { bidLots: 0, askLots: 0, bidShare: 0.5 });
  // At limit-up the ask side is empty, so every shown lot is a bid.
  assert.equal(bookPressure(createMorningBook("2330", 1, limitUp(100), 100)).bidShare, 1);
});

// 左買右賣 (the 10/20 meeting, spec 5.1): the side of the clicked cell decides the order.
test("a left (委買) cell buys at its price and a right (委賣) cell sells at its price", () => {
  assert.equal(bookCellOrder("bid"), "buy");
  assert.equal(bookCellOrder("ask"), "sell");
});

test("trading cells wait while the ticket is locked and a sell needs the lots in holdings; a display book never waits", () => {
  const base = { trading: true, locked: false, holdingLots: 0, lots: 1 } as const;
  assert.equal(bookCellBlocked({ ...base, cell: "bid" }), false);
  assert.equal(bookCellBlocked({ ...base, cell: "ask" }), true);
  assert.equal(bookCellBlocked({ ...base, cell: "ask", holdingLots: 1 }), false);
  assert.equal(bookCellBlocked({ ...base, cell: "ask", holdingLots: 1, lots: 2 }), true);
  assert.equal(bookCellBlocked({ ...base, cell: "bid", locked: true }), true);
  assert.equal(bookCellBlocked({ ...base, cell: "ask", trading: false }), false);
});

test("each cell says its side, level and price, and what a click does", () => {
  assert.equal(
    bookCellLabel({ cell: "bid", level: 1, price: "2575", lots: 1, trading: true }),
    "買1 2575，點擊以 2575 限價買進 1 張",
  );
  assert.equal(
    bookCellLabel({ cell: "ask", level: 2, price: "2585", lots: 3, trading: true }),
    "賣2 2585，點擊以 2585 限價賣出 3 張",
  );
  assert.equal(
    bookCellLabel({ cell: "ask", level: 1, price: "2580", lots: 1, trading: false }),
    "賣1 2580，點擊帶入下單（賣出）",
  );
});
