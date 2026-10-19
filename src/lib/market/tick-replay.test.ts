import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import { formingBar, minuteTicks, tickSeed } from "./tick-replay.ts";
import { roundToTick } from "./ticks.ts";

const bar = (o: number, h: number, l: number, c: number, v: number, t = 60): Bar => ({ t, o, h, l, c, v });

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
      const ticks = minuteTicks(b, tickSeed("lesson", "2317", 1));
      const prices = ticks.map((t) => t.price);
      assert.equal(prices[0], b.o);
      assert.equal(prices.at(-1), b.c);
      assert.ok(prices.every((p) => p >= b.l && p <= b.h), "inside the minute's low and high");
      assert.equal(Math.max(...prices), b.h);
      assert.equal(Math.min(...prices), b.l);
    });

    it(`${name}: every trade is a legal TWSE price, at increasing times inside the minute`, () => {
      const ticks = minuteTicks(b, tickSeed("lesson", "2317", 2));
      for (const t of ticks) assert.equal(roundToTick(t.price), t.price, `${t.price} is off the tick grid`);
      for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].at > ticks[i - 1].at, "times increase");
      assert.ok(ticks[0].at > 0 && ticks.at(-1)!.at < 1, "all trades fall inside the minute");
    });

    it(`${name}: trade sizes add up to the minute's real volume in lots`, () => {
      const ticks = minuteTicks(b, tickSeed("lesson", "2317", 3));
      assert.equal(ticks.reduce((sum, t) => sum + t.lots, 0), Math.round(b.v / 1000));
      assert.ok(ticks.every((t) => t.lots >= 1), "every trade is at least one lot");
    });
  }

  it("keeps a minute readable: no more than 60 trades, at least 2 even when the price never moves", () => {
    assert.ok(minuteTicks(CASES[6][1], tickSeed("lesson", "2317", 4)).length <= 60);
    const flat = minuteTicks(CASES[5][1], tickSeed("lesson", "2317", 4));
    assert.ok(flat.length >= 2);
    assert.ok(flat.every((t) => t.price === 257));
  });

  it("is the same for the same lesson, stock and minute, and differs between minutes", () => {
    const b = CASES[0][1];
    assert.deepEqual(minuteTicks(b, tickSeed("lesson", "2317", 7)), minuteTicks(b, tickSeed("lesson", "2317", 7)));
    assert.notDeepEqual(minuteTicks(b, tickSeed("lesson", "2317", 7)), minuteTicks(b, tickSeed("lesson", "2317", 8)));
  });

  it("marks upticks as trades at the ask (外盤) and downticks at the bid (內盤)", () => {
    const ticks = minuteTicks(CASES[0][1], tickSeed("lesson", "2317", 9));
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i].price > ticks[i - 1].price) assert.equal(ticks[i].side, "ask");
      if (ticks[i].price < ticks[i - 1].price) assert.equal(ticks[i].side, "bid");
      if (ticks[i].price === ticks[i - 1].price) assert.equal(ticks[i].side, ticks[i - 1].side);
    }
  });

  it("a minute with no recorded volume still moves the price but reports no lots", () => {
    const ticks = minuteTicks(bar(263, 266.5, 263, 264.5, 0, 0), tickSeed("lesson", "2317", 0));
    assert.ok(ticks.length >= 2);
    assert.ok(ticks.every((t) => t.lots === 0));
  });
});

describe("formingBar", () => {
  const b = CASES[0][1];
  const ticks = minuteTicks(b, tickSeed("lesson", "2317", 1));

  it("shows the opening trade from the start, so the bar never disappears", () => {
    const start = formingBar(b, ticks, 0);
    assert.equal(start.o, b.o);
    assert.equal(start.c, b.o);
    assert.equal(start.t, b.t);
  });

  it("grows from the trades so far and ends as the real bar", () => {
    const half = formingBar(b, ticks, 0.5);
    const seen = ticks.filter((t) => t.at <= 0.5 || t === ticks[0]).map((t) => t.price);
    assert.equal(half.h, Math.max(...seen));
    assert.equal(half.l, Math.min(...seen));
    assert.equal(half.c, seen.at(-1));
    assert.ok(half.v <= b.v);
    assert.deepEqual(formingBar(b, ticks, 1), b);
  });
});
