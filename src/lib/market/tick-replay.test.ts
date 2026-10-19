import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import { formingBar, minuteTicks, tickSeed, type MinuteContext } from "./tick-replay.ts";
import { roundToTick } from "./ticks.ts";

const bar = (o: number, h: number, l: number, c: number, v: number, t = 60): Bar => ({ t, o, h, l, c, v });
const lotsOf = (b: Bar): MinuteContext => ({ previous: b.o, lots: Math.round(b.v / 1000) });

// Real 1-minute bars from the 2026-10-06 lesson, plus band-edge and extreme cases.
const CASES: [string, Bar][] = [
  ["鴻海 down minute", bar(265, 265, 261.5, 263, 3_951_000)],
  ["鴻海 up minute", bar(259, 259.5, 258.5, 259.5, 457_259)],
  ["台積電 5-point grid", bar(2580, 2590, 2575, 2585, 2_100_000)],
  ["聯發科 wide minute", bar(4955, 5010, 4930, 4990, 380_000)],
  ["crosses the 0.1/0.5 band at 100", bar(99.5, 101, 99.2, 100.5, 820_000)],
  ["flat minute", bar(257, 257, 257, 257, 120_000)],
  ["120-tick range", bar(300, 330, 270, 310, 9_000_000)],
];

describe("minuteTicks", () => {
  for (const [name, b] of CASES) {
    it(`${name}: opens at the open, closes at the close, stays inside and touches the real range`, () => {
      const ticks = minuteTicks(b, tickSeed("lesson", "2317", 1), lotsOf(b));
      const prices = ticks.map((t) => t.price);
      assert.equal(prices[0], b.o);
      assert.equal(prices.at(-1), b.c);
      assert.ok(prices.every((p) => p >= b.l && p <= b.h), "inside the minute's low and high");
      assert.equal(Math.max(...prices), b.h);
      assert.equal(Math.min(...prices), b.l);
    });

    it(`${name}: every trade is a legal TWSE price, at increasing times inside the minute`, () => {
      const ticks = minuteTicks(b, tickSeed("lesson", "2317", 2), lotsOf(b));
      for (const t of ticks) assert.equal(roundToTick(t.price), t.price, `${t.price} is off the tick grid`);
      for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].at > ticks[i - 1].at, "times increase");
      assert.ok(ticks[0].at > 0 && ticks.at(-1)!.at < 1, "all trades fall inside the minute");
      assert.equal(Math.floor(ticks[0].at * 60), 0, "the opening trade is stamped at the minute's first second");
    });

    it(`${name}: trade sizes add up to the minute's volume in lots`, () => {
      const ticks = minuteTicks(b, tickSeed("lesson", "2317", 3), lotsOf(b));
      assert.equal(ticks.reduce((sum, t) => sum + t.lots, 0), Math.round(b.v / 1000));
      assert.ok(ticks.every((t) => t.lots >= 1), "every trade is at least one lot");
    });
  }

  it("trades busily even in a narrow minute: more volume, more trades, bouncing between neighbouring prices", () => {
    // 台積電 moved only 2575–2590 (three 5-point ticks) but traded 2,100 lots in this minute.
    const narrow = minuteTicks(CASES[2][1], tickSeed("lesson", "2330", 5), lotsOf(CASES[2][1]));
    assert.ok(narrow.length >= 14, `${narrow.length} trades`);
    const moves = narrow.filter((t, i) => i > 0 && t.price !== narrow[i - 1].price).length;
    assert.ok(moves >= 6, `${moves} price changes`);
    const quietBar = bar(258, 258.5, 258, 258, 120_000);
    const quiet = minuteTicks(quietBar, tickSeed("lesson", "2317", 5), lotsOf(quietBar));
    assert.ok(quiet.length >= 10 && quiet.length < narrow.length, `${quiet.length} trades in a quiet minute`);
    assert.ok(minuteTicks(CASES[0][1], tickSeed("lesson", "2317", 5), lotsOf(CASES[0][1])).length <= 30);
  });

  it("keeps a minute readable: no more than 60 trades, at least 2 even when the price never moves", () => {
    assert.ok(minuteTicks(CASES[6][1], tickSeed("lesson", "2317", 4), lotsOf(CASES[6][1])).length <= 60);
    const flat = minuteTicks(CASES[5][1], tickSeed("lesson", "2317", 4), lotsOf(CASES[5][1]));
    assert.ok(flat.length >= 2);
    assert.ok(flat.every((t) => t.price === 257));
  });

  it("is the same for the same lesson, stock and minute, and differs between minutes", () => {
    const b = CASES[0][1];
    const at = (minute: number) => minuteTicks(b, tickSeed("lesson", "2317", minute), lotsOf(b));
    assert.deepEqual(at(7), at(7));
    assert.notDeepEqual(at(7), at(8));
  });

  it("marks upticks as trades at the ask (外盤) and downticks at the bid (內盤)", () => {
    const ticks = minuteTicks(CASES[0][1], tickSeed("lesson", "2317", 9), lotsOf(CASES[0][1]));
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i].price > ticks[i - 1].price) assert.equal(ticks[i].side, "ask");
      if (ticks[i].price < ticks[i - 1].price) assert.equal(ticks[i].side, "bid");
      if (ticks[i].price === ticks[i - 1].price) assert.equal(ticks[i].side, ticks[i - 1].side);
    }
  });

  it("never gives away the minute's result: the opening side follows the previous price, the legs are drawn", () => {
    const down = bar(260, 262, 257, 257.5, 900_000);
    // Opened above the previous trade, so the first trade lifted the ask although the minute closes down.
    assert.equal(minuteTicks(down, tickSeed("lesson", "2317", 1), { previous: 259.5, lots: 900 })[0].side, "ask");
    assert.equal(minuteTicks(down, tickSeed("lesson", "2317", 1), { previous: 260.5, lots: 900 })[0].side, "bid");
    // Which extreme comes first is drawn, not read from the close.
    const up = bar(259, 261, 257, 260.5, 900_000);
    const lowFirst = Array.from({ length: 60 }, (_, minute) => {
      const ticks = minuteTicks(up, tickSeed("lesson", "2317", minute), { previous: 259, lots: 900 });
      return ticks.findIndex((t) => t.price === up.l) < ticks.findIndex((t) => t.price === up.h);
    });
    assert.ok(lowFirst.includes(true) && lowFirst.includes(false), "both orders occur");
  });

  it("never hangs on prices off the stock grid and returns nothing for unusable bars", () => {
    for (const b of [bar(254, 255.2, 253.9, 254.3, 500_000), bar(180.35, 180.6, 180.1, 180.45, 90_000), bar(10.1, 10.149999999999999, 10.05, 10.1, 50_000)]) {
      const ticks = minuteTicks(b, tickSeed("lesson", "0050", 1), lotsOf(b));
      assert.ok(ticks.length >= 2 && ticks.length <= 60);
      assert.equal(ticks[0].price, b.o);
      assert.equal(ticks.at(-1)!.price, b.c);
      assert.ok(ticks.every((t) => t.price >= b.l && t.price <= b.h));
    }
    assert.deepEqual(minuteTicks(bar(NaN, 1, 1, 1, 0), "x", { previous: 1, lots: 0 }), []);
    assert.deepEqual(minuteTicks(bar(10, 9, 11, 10, 0), "x", { previous: 10, lots: 0 }), [], "high below low");
  });

  it("uses the lesson's own volume: no sizes when it is unverified, every trade sized when lots are few", () => {
    const b = CASES[1][1];
    assert.ok(minuteTicks(b, tickSeed("lesson", "2317", 1), { previous: b.o, lots: null }).every((t) => t.lots === 0));
    const thin = minuteTicks(b, tickSeed("lesson", "2317", 1), { previous: b.o, lots: 6 });
    assert.equal(thin.reduce((sum, t) => sum + t.lots, 0), 6);
    assert.ok(thin.length <= 6 && thin.every((t) => t.lots >= 1));
    assert.ok(minuteTicks(bar(263, 266.5, 263, 264.5, 0), "x", { previous: 263, lots: 0 }).every((t) => t.lots === 0));
  });
});

describe("formingBar", () => {
  const b: Bar = { ...CASES[0][1], a: 263.4 };
  const ticks = minuteTicks(b, tickSeed("lesson", "2317", 1), lotsOf(b));

  it("shows the opening trade from the start, so the bar never disappears", () => {
    const start = formingBar(b, ticks, 0, 262.8);
    assert.equal(start.o, b.o);
    assert.equal(start.c, b.o);
    assert.equal(start.t, b.t);
  });

  it("grows from the trades so far, keeps the earlier average until the minute closes, and ends as the real bar", () => {
    const half = formingBar(b, ticks, 0.5, 262.8);
    const seen = ticks.filter((t, i) => i === 0 || t.at <= 0.5);
    assert.equal(half.h, Math.max(...seen.map((t) => t.price)));
    assert.equal(half.l, Math.min(...seen.map((t) => t.price)));
    assert.equal(half.c, seen.at(-1)!.price);
    assert.equal(half.v, Math.round((b.v * seen.reduce((s, t) => s + t.lots, 0)) / ticks.reduce((s, t) => s + t.lots, 0)));
    assert.ok(Number.isInteger(half.v));
    assert.equal(half.a, 262.8);
    const last = formingBar(b, ticks, ticks.at(-1)!.at, 262.8);
    assert.equal(last.v, b.v, "the volume reaches the real figure with the last trade, so nothing jumps at rest");
    assert.deepEqual(formingBar(b, ticks, 1, 262.8), b);
    assert.equal("a" in formingBar(CASES[0][1], ticks, 0.5, 262.8), false, "no average where the source has none");
  });
});
