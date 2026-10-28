import test from "node:test";
import assert from "node:assert/strict";
import type { MarketBarRow } from "../market-days.server.ts";
import { CELL_MS, MORNING_CELLS, MORNING_END_MS, cellSlice, morningBars, type TradeRow } from "./trades.ts";

/** A trade `min` minutes and `sec` seconds after 09:00. */
const trade = (min: number, sec: number, price: number, size = 1): TradeRow => [min * 60_000 + sec * 1000, price, size, null, null];

/** The one-minute bars the fetcher would publish for these trades (t in seconds, a = the minute's VWAP). */
function barsOf(trades: readonly TradeRow[]): MarketBarRow[] {
  const cells = new Map<number, TradeRow[]>();
  for (const row of trades) {
    const cell = Math.floor(row[0] / CELL_MS);
    cells.set(cell, [...(cells.get(cell) ?? []), row]);
  }
  return [...cells.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([cell, rows]) => {
      const prices = rows.map((row) => row[1]);
      const volume = rows.reduce((sum, row) => sum + row[2], 0);
      const value = rows.reduce((sum, row) => sum + row[1] * row[2], 0);
      return [cell * 60, prices[0], Math.max(...prices), Math.min(...prices), prices.at(-1)!, volume, value / volume];
    });
}

test("constants", () => {
  assert.equal(CELL_MS, 60_000);
  assert.equal(MORNING_CELLS, 90);
  assert.equal(MORNING_END_MS, 5_400_000);
});

test("morningBars matches and keeps a", () => {
  const trades = [trade(0, 1, 100, 2), trade(0, 30, 101, 3), trade(0, 59, 99.5, 1), trade(1, 0, 100.5, 4), trade(1, 20, 100, 2)];
  const bars = morningBars(barsOf(trades), trades)!;
  assert.equal(bars.length, MORNING_CELLS);
  assert.deepEqual(bars[0], { t: 0, o: 100, h: 101, l: 99.5, c: 99.5, v: 6, a: (100 * 2 + 101 * 3 + 99.5) / 6 });
  assert.deepEqual(bars[1], { t: 60, o: 100.5, h: 100.5, l: 100, c: 100, v: 6, a: (100.5 * 4 + 100 * 2) / 6 });
  assert.equal(bars.at(-1)!.t, 89 * 60);
});

test("first trade at 09:03 → bars start at t=180", () => {
  const trades = [trade(3, 5, 50), trade(3, 40, 50.1), trade(4, 0, 50.2)];
  const bars = morningBars(barsOf(trades), trades)!;
  assert.equal(bars.length, MORNING_CELLS - 3);
  assert.equal(bars[0].t, 180);
  assert.equal(bars[0].o, 50);
  assert.deepEqual(bars.map((bar) => bar.t).slice(0, 3), [180, 240, 300]);
});

test("quiet cell → flat v:0 bar carrying previous close and a", () => {
  const trades = [trade(0, 10, 100, 2), trade(0, 50, 102, 2), trade(3, 0, 103, 1)];
  const day = barsOf(trades);
  const bars = morningBars(day, trades)!;
  const carried = day[0][6];
  assert.deepEqual(bars[1], { t: 60, o: 102, h: 102, l: 102, c: 102, v: 0, a: carried });
  assert.deepEqual(bars[2], { t: 120, o: 102, h: 102, l: 102, c: 102, v: 0, a: carried });
  assert.equal(bars[3].v, 1);
  assert.deepEqual(bars[4], { t: 240, o: 103, h: 103, l: 103, c: 103, v: 0, a: day[1][6] });
});

test("one lot missing → null", () => {
  const trades = [trade(0, 1, 100, 2), trade(0, 30, 101, 3), trade(2, 0, 100, 1)];
  const day = barsOf(trades);
  assert.notEqual(morningBars(day, trades), null);
  assert.equal(morningBars(day, [trades[0], trade(0, 30, 101, 2), trades[2]]), null); // one lot short in the first minute
  assert.equal(morningBars(day, [trades[0], trades[1]]), null); // the whole third minute is missing
});

test("a price, a bar without trades or trades without a bar → null", () => {
  const trades = [trade(0, 1, 100, 2), trade(2, 0, 101, 1)];
  const day = barsOf(trades);
  const wrongHigh = day.map((row) => [...row] as MarketBarRow);
  wrongHigh[0][2] = 100.01;
  assert.equal(morningBars(wrongHigh, trades), null);
  assert.equal(morningBars([...day, [60, 100, 100, 100, 100, 1, 100]], trades), null); // a bar for a quiet minute
  assert.equal(morningBars([day[0]], trades), null); // trades in a minute with no bar
  assert.equal(morningBars([...day, [90, 100, 100, 100, 100, 1, 100]], trades), null); // not on a minute
  assert.equal(morningBars([...day, day[0]], trades), null); // the same minute twice
  assert.equal(morningBars([[-60, 1, 1, 1, 1, 1, 1], ...day], trades), null);
});

test("prices match to 1e-9", () => {
  const trades = [trade(0, 1, 100.1, 1)];
  assert.notEqual(morningBars([[0, 100.1 + 5e-10, 100.1, 100.1, 100.1, 1, 100.1]], trades), null);
  assert.equal(morningBars([[0, 100.1 + 2e-9, 100.1, 100.1, 100.1, 1, 100.1]], trades), null);
});

test("a bar without a usable a is returned without one", () => {
  const trades = [trade(0, 1, 100, 1), trade(2, 0, 101, 1)];
  const bars = morningBars([[0, 100, 100, 100, 100, 1] as unknown as MarketBarRow, [120, 101, 101, 101, 101, 1, 101]], trades)!;
  assert.deepEqual(bars[0], { t: 0, o: 100, h: 100, l: 100, c: 100, v: 1 });
  assert.deepEqual(bars[1], { t: 60, o: 100, h: 100, l: 100, c: 100, v: 0 });
  assert.equal(bars[2].a, 101);
});

test("trades after 10:30 ignored", () => {
  const trades = [trade(0, 1, 100, 1), trade(89, 59, 101, 2)];
  const late: TradeRow[] = [[MORNING_END_MS, 150, 9, null, null], [MORNING_END_MS + 1000, 160, 9, null, null]];
  const day = [...barsOf(trades), [5400, 150, 160, 150, 160, 18, 155] as MarketBarRow];
  const bars = morningBars(day, [...trades, ...late])!;
  assert.equal(bars.length, MORNING_CELLS);
  assert.deepEqual(bars.at(-1), { t: 89 * 60, o: 101, h: 101, l: 101, c: 101, v: 2, a: 101 });
  assert.equal(Math.max(...bars.map((bar) => bar.h)), 101);
});

test("no trade in the morning → []", () => {
  assert.deepEqual(morningBars([], []), []);
  assert.deepEqual(morningBars([[5400, 1, 1, 1, 1, 1, 1]], [[MORNING_END_MS, 1, 1, null, null]]), []);
  assert.equal(morningBars([[0, 1, 1, 1, 1, 1, 1]], []), null);
});

test("cellSlice boundaries", () => {
  const rows: TradeRow[] = [
    [0, 10, 1, null, null],
    [59_999, 11, 1, null, null],
    [60_000, 12, 1, null, null],
    [119_999, 13, 1, null, null],
    [5_399_999, 14, 1, null, null],
    [5_400_000, 15, 1, null, null],
  ];
  assert.deepEqual(cellSlice(rows, 0).map((row) => row[1]), [10, 11]);
  assert.deepEqual(cellSlice(rows, 1).map((row) => row[1]), [12, 13]);
  assert.deepEqual(cellSlice(rows, 2), []);
  assert.deepEqual(cellSlice(rows, 89).map((row) => row[1]), [14]);
  assert.deepEqual(cellSlice(rows, 90).map((row) => row[1]), [15]);
  assert.deepEqual(cellSlice([], 0), []);
});
