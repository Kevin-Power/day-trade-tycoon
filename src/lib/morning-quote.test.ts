import test from "node:test";
import assert from "node:assert/strict";
import { bestQuotes, positionMark, quoteSummary } from "./morning-quote.ts";
import { createMorningBook } from "./morning-book.ts";
import { limitUp } from "./market/ticks.ts";

const bar = (t: number, o: number, h: number, l: number, c: number) => ({ t, o, h, l, c, v: 0 });

test("quote summary reads only revealed bars: last close, change against the previous close, open, high and low", () => {
  const summary = quoteSummary(
    [bar(0, 2575, 2590, 2575, 2585), bar(60, 2585, 2585, 2570, 2580)],
    2575,
  );
  assert.deepEqual(summary, {
    last: 2580,
    change: 5,
    changeText: "5",
    percentText: "+0.19%",
    tone: "up",
    open: 2575,
    high: 2590,
    low: 2570,
  });
});

test("a falling or unchanged close sets the tone; change text has no sign, the arrow carries it", () => {
  assert.equal(quoteSummary([bar(0, 50, 50, 49, 49.35)], 50).tone, "down");
  assert.equal(quoteSummary([bar(0, 50, 50, 49, 49.35)], 50).changeText, "0.65");
  assert.equal(quoteSummary([bar(0, 50, 50, 49, 49.35)], 50).percentText, "-1.30%");
  const flat = quoteSummary([bar(0, 50, 51, 49, 50)], 50);
  assert.equal(flat.tone, "flat");
  assert.equal(flat.changeText, "0");
  assert.equal(flat.percentText, "0.00%");
});

test("before the first minute nothing is invented", () => {
  assert.deepEqual(quoteSummary([], 2575), {
    last: null,
    change: null,
    changeText: "",
    percentText: "",
    tone: "flat",
    open: null,
    high: null,
    low: null,
  });
});

test("best bid and ask come from the same teaching book the ladder shows", () => {
  const book = createMorningBook("2330", 27, 2580, 2575);
  assert.deepEqual(bestQuotes(book), { bid: book.bids[0].price, ask: book.asks[0].price });
  assert.deepEqual(bestQuotes(createMorningBook("2330", 0, 2580, 2575)), { bid: null, ask: null });
  // At the limit-up price there is no ask level, so no ask is shown.
  assert.equal(bestQuotes(createMorningBook("2330", 3, limitUp(100), 100)).ask, null);
});

test("a position's reference P&L is (last close − average cost) × shares, before fees and tax", () => {
  assert.deepEqual(positionMark({ shares: 2000, averageCost: 2582.5 }, 2580), {
    value: -5000,
    tone: "down",
  });
  assert.deepEqual(positionMark({ shares: 1000, averageCost: 254 }, 259.5), {
    value: 5500,
    tone: "up",
  });
  assert.deepEqual(positionMark({ shares: 1000, averageCost: 254 }, undefined), {
    value: null,
    tone: "flat",
  });
  // Floating-point noise never turns an even position into a tiny loss.
  assert.deepEqual(positionMark({ shares: 3000, averageCost: 33.35 }, 33.35), {
    value: 0,
    tone: "flat",
  });
});
