import test from "node:test";
import assert from "node:assert/strict";
import { bestQuotes, positionMark, quoteDetailRows, quoteSummary } from "./morning-quote.ts";
import { displayBook } from "./morning-book.ts";

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

test("best bid and ask are the first level of the book the ladder shows, recorded or from the last trade", () => {
  const recorded = displayBook({
    catalog: { booksAvailable: true },
    book: {
      code: "2330",
      start: { bids: [[2575, 8], [2570, 3]], asks: [[2580, 5]] },
      frames: [],
      gaps: [],
      sizes: true,
    },
    lastTrade: null,
    playedMs: 1_000,
  });
  assert.deepEqual(bestQuotes(recorded), { bid: 2575, ask: 2580 });
  const quoted = displayBook({
    catalog: {},
    book: undefined,
    lastTrade: { ms: 5_000, price: 2580, size: 1, side: "ask", bid: 2575, ask: 2580 },
    playedMs: 5_000,
  });
  assert.deepEqual(bestQuotes(quoted), { bid: 2575, ask: 2580 });
  // No trade yet, or a side the trade did not quote (at the limit price, say): that side shows nothing.
  assert.deepEqual(bestQuotes(displayBook({ catalog: {}, book: undefined, lastTrade: null, playedMs: 0 })), { bid: null, ask: null });
  const limitUpTrade = { ms: 9_000, price: 110, size: 4, side: "ask" as const, bid: 110, ask: null };
  assert.deepEqual(bestQuotes(displayBook({ catalog: {}, book: undefined, lastTrade: limitUpTrade, playedMs: 9_000 })), { bid: 110, ask: null });
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

// 報價明細 (spec 4.2): 振幅 = (high − low) ÷ previous close; 均價 only with the source average on every minute.
test("報價明細 shows 振幅 to two decimals and 均價 only when every revealed minute has the source average", () => {
  const bars = [bar(0, 2575, 2590, 2575, 2585), bar(60, 2585, 2585, 2570, 2580)];
  const value = (rows: { label: string; value: string }[], label: string) => rows.find((row) => row.label === label)?.value;
  const plain = quoteDetailRows({ bars, previousClose: 2575, time: "09:02" });
  assert.equal(value(plain, "振幅"), "0.78%");
  assert.equal(value(plain, "成交"), "2580");
  assert.equal(value(plain, "均價"), undefined);
  assert.deepEqual(
    plain.map((row) => row.label),
    ["成交", "漲跌", "漲跌幅", "開盤", "最高", "最低", "昨收", "振幅", "時間"],
  );
  const averaged = quoteDetailRows({
    bars: bars.map((item) => ({ ...item, a: 2580 })),
    previousClose: 2575,
    time: "09:02",
  });
  assert.equal(value(averaged, "均價"), "2580");
  const partly = quoteDetailRows({ bars: [{ ...bars[0], a: 2580 }, bars[1]], previousClose: 2575, time: "09:02" });
  assert.equal(value(partly, "均價"), undefined);
});

test("before the first minute the quote details are dashes, and no row is marked 模擬: the replayed trades are real", () => {
  const empty = quoteDetailRows({ bars: [], previousClose: 2575, time: "—" });
  for (const row of empty) assert.equal(row.value, row.label === "昨收" ? "2575" : "—", row.label);
  const live = quoteDetailRows({ bars: [bar(0, 2575, 2590, 2575, 2585)], previousClose: 2575, time: "09:00:37" });
  assert.deepEqual(
    live.filter((row) => "simulated" in row),
    [],
  );
});
