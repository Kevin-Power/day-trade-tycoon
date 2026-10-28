import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOK_GAP_NOTE,
  NO_BOOKS_NOTE,
  bookCellBlocked,
  bookCellLabel,
  bookCellOrder,
  bookPressure,
  bookView,
  displayBook,
  validMorningLimit,
} from "./morning-book.ts";
import type { LiveTrade } from "./market/real-replay.ts";
import type { MorningBookCell } from "./morning.ts";
import { limitDown, limitUp } from "./market/ticks.ts";

// Cell 2 (09:02): ms 120 000 to 179 999. The book is 100 / 100.5 at its start, then changes twice.
const book = (over: Partial<MorningBookCell> = {}): MorningBookCell => ({
  code: "2330",
  start: {
    bids: [
      [100, 5],
      [99.5, 7],
    ],
    asks: [[100.5, 4]],
  },
  frames: [
    [130_000, { bids: [[100, 6]], asks: [[100.5, 3], [101, 8]] }],
    [150_000, { bids: [[100.5, 2], [100, 6]], asks: [[101, 8]] }],
  ],
  gaps: [],
  sizes: true,
  ...over,
});
const trade = (over: Partial<LiveTrade> = {}): LiveTrade => ({
  ms: 140_000,
  price: 100.5,
  size: 1,
  side: "ask",
  bid: 100,
  ask: 100.5,
  ...over,
});
const WITH_BOOKS = { booksAvailable: true };
const WITHOUT_BOOKS = {};

test("full book uses the last frame at or before playedMs", () => {
  const at = (playedMs: number) => displayBook({ catalog: WITH_BOOKS, book: book(), lastTrade: trade(), playedMs });
  // A frame counts from its own millisecond on.
  const second = at(150_000);
  assert.equal(second.depth, "full");
  assert.equal(second.sizes, true);
  assert.equal(second.note, null);
  assert.deepEqual(second.bids, [
    { level: 1, price: 100.5, lots: 2 },
    { level: 2, price: 100, lots: 6 },
  ]);
  assert.deepEqual(second.asks, [{ level: 1, price: 101, lots: 8 }]);
  // One millisecond earlier it is still the first frame, whatever the last trade says.
  assert.deepEqual(at(149_999).bids, [{ level: 1, price: 100, lots: 6 }]);
  assert.deepEqual(at(149_999).asks, [
    { level: 1, price: 100.5, lots: 3 },
    { level: 2, price: 101, lots: 8 },
  ]);
  // Before the cell's first change the book is the one the cell started with; at the end of the cell, its last.
  assert.deepEqual(at(120_000).bids, [
    { level: 1, price: 100, lots: 5 },
    { level: 2, price: 99.5, lots: 7 },
  ]);
  assert.deepEqual(at(129_999).asks, [{ level: 1, price: 100.5, lots: 4 }]);
  assert.deepEqual(at(179_999).bids, second.bids);
});

test("a recorded book without a size unit keeps its prices and shows no sizes", () => {
  const shown = displayBook({
    catalog: WITH_BOOKS,
    book: book({ sizes: false }),
    lastTrade: trade(),
    playedMs: 135_000,
  });
  assert.equal(shown.depth, "full");
  assert.equal(shown.sizes, false);
  assert.deepEqual(shown.bids, [{ level: 1, price: 100, lots: null }]);
  assert.deepEqual(shown.asks.map((level) => level.lots), [null, null]);
  assert.equal(shown.note, null);
});

test("an empty side is shown empty, and a book that never started and never changed shows the gap note", () => {
  const sparse = displayBook({
    catalog: WITH_BOOKS,
    book: book({ frames: [[125_000, { bids: [[100, 1]], asks: [] }]] }),
    lastTrade: trade(),
    playedMs: 126_000,
  });
  assert.equal(sparse.depth, "full");
  assert.deepEqual(sparse.asks, []);
  const unknown = displayBook({
    catalog: WITH_BOOKS,
    book: book({ start: null, frames: [[170_000, { bids: [[100, 1]], asks: [[101, 1]] }]] }),
    lastTrade: trade(),
    playedMs: 126_000,
  });
  assert.equal(unknown.depth, "top");
  assert.equal(unknown.note, BOOK_GAP_NOTE);
});

test("no book → best bid/ask from the last trade, sizes hidden", () => {
  const shown = displayBook({ catalog: WITHOUT_BOOKS, book: undefined, lastTrade: trade(), playedMs: 140_000 });
  assert.deepEqual(shown, {
    bids: [{ level: 1, price: 100, lots: null }],
    asks: [{ level: 1, price: 100.5, lots: null }],
    depth: "top",
    sizes: false,
    note: NO_BOOKS_NOTE,
  });
  assert.equal(NO_BOOKS_NOTE, "這天沒有五檔掛單資料");
  // A trade that carries no bid or ask (an auction trade) leaves that side empty; no trade at all leaves both.
  const noAsk = displayBook({ catalog: WITHOUT_BOOKS, book: undefined, lastTrade: trade({ ask: null }), playedMs: 0 });
  assert.equal(noAsk.bids.length, 1);
  assert.deepEqual(noAsk.asks, []);
  const none = displayBook({ catalog: WITHOUT_BOOKS, book: undefined, lastTrade: null, playedMs: 0 });
  assert.deepEqual([none.bids, none.asks, none.depth, none.sizes], [[], [], "top", false]);
  // Prices that are not numbers are never shown.
  const odd = displayBook({ catalog: WITHOUT_BOOKS, book: undefined, lastTrade: trade({ bid: NaN, ask: 0 }), playedMs: 0 });
  assert.deepEqual([odd.bids, odd.asks], [[], []]);
});

test("a day with books but no book for this stock yet is not told as a day without books", () => {
  // The desk gets a stock's books with the next advance after it is picked; until then, the real best bid/ask.
  const shown = displayBook({ catalog: WITH_BOOKS, book: undefined, lastTrade: trade(), playedMs: 140_000 });
  assert.equal(shown.depth, "top");
  assert.equal(shown.note, BOOK_GAP_NOTE);
  assert.equal(BOOK_GAP_NOTE, "這段時間沒有五檔資料");
  assert.deepEqual([shown.bids[0].price, shown.asks[0].price], [100, 100.5]);
});

test("gap → top with the gap note", () => {
  const gapped = book({ gaps: [[140_000, 160_000]] });
  const at = (playedMs: number) => displayBook({ catalog: WITH_BOOKS, book: gapped, lastTrade: trade(), playedMs });
  // Inside the gap the book is unknown, even though a frame before it exists.
  for (const playedMs of [140_000, 150_000, 159_999]) {
    const shown = at(playedMs);
    assert.equal(shown.depth, "top", String(playedMs));
    assert.equal(shown.note, BOOK_GAP_NOTE);
    assert.equal(shown.sizes, false);
    assert.deepEqual(
      [shown.bids, shown.asks],
      [[{ level: 1, price: 100, lots: null }], [{ level: 1, price: 100.5, lots: null }]],
    );
  }
  // The gap starts at its first millisecond and ends before its last: the book is known on both sides of it.
  assert.equal(at(139_999).depth, "full");
  assert.equal(at(160_000).depth, "full");
  // A gap from the start of the cell leaves the cell's start book unknown too.
  const fromStart = displayBook({
    catalog: WITH_BOOKS,
    book: book({ start: null, gaps: [[120_000, 130_000]] }),
    lastTrade: trade(),
    playedMs: 121_000,
  });
  assert.equal(fromStart.depth, "top");
  assert.equal(fromStart.note, BOOK_GAP_NOTE);
});

test("the book never runs ahead of the replay", () => {
  const future = displayBook({ catalog: WITH_BOOKS, book: book(), lastTrade: null, playedMs: 129_999 });
  assert.deepEqual(future.asks, [{ level: 1, price: 100.5, lots: 4 }]);
  assert.ok(!JSON.stringify(future).includes("101"));
});

test("an advance asks for the selected stock's books when it is one of the run's", () => {
  assert.deepEqual(bookView({ codes: ["2330", "2317"] }, "2317"), { view: "2317" });
  assert.deepEqual(bookView({ codes: ["2330"] }, "2317"), {});
  assert.deepEqual(bookView({ codes: ["2330"] }, ""), {});
  // A run of the old lessons has no codes of its own: every stock of the lesson is in it.
  assert.deepEqual(bookView({}, "2330"), { view: "2330" });
});

test("price limits never accept a price outside the tick or the daily band", () => {
  for (const value of [0, -1, NaN, Infinity, 100.1, 89.9, 110.5]) assert.equal(validMorningLimit(value, 100), false);
  assert.equal(validMorningLimit(100.5, 100), true);
  assert.equal(validMorningLimit(limitUp(100), 100), true);
  assert.equal(validMorningLimit(limitDown(100), 100), true);
});

test("book pressure sums the shown lots, ignores levels without a size and never divides by zero", () => {
  const book = {
    bids: [
      { level: 1, price: 100, lots: 30 },
      { level: 2, price: 99.5, lots: 10 },
    ],
    asks: [{ level: 1, price: 100.5, lots: 20 }],
  };
  assert.deepEqual(bookPressure(book), { bidLots: 40, askLots: 20, bidShare: 40 / 60 });
  assert.deepEqual(bookPressure({ bids: [], asks: [] }), { bidLots: 0, askLots: 0, bidShare: 0.5 });
  assert.deepEqual(
    bookPressure({ bids: [{ level: 1, price: 100, lots: null }], asks: [{ level: 1, price: 100.5, lots: null }] }),
    { bidLots: 0, askLots: 0, bidShare: 0.5 },
  );
  // With no ask side every shown lot is a bid.
  assert.equal(bookPressure({ bids: book.bids, asks: [] }).bidShare, 1);
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
