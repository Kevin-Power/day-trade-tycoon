import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import type { DaySymbol } from "../market-days.server.ts";
import { buildQuestion, intradayCandidate, pickQuestion, poolSymbols, previousHighCandidate, rankCandidates } from "./pick.ts";
import type { DailyCandidate } from "./types.ts";

const sym = (code: string, extra: Partial<DaySymbol> = {}): DaySymbol => ({
  code, name: `測試${code}`, referencePrice: 98, close: 99, tradeVolume: 1_000, tradeValue: 100_000_000,
  disposition: false, bars: 270, ...extra,
});
/** Bars from [high, low, close] per minute starting at 09:00; each open is the previous close. */
function minutes(rows: readonly (readonly [number, number, number])[]): Bar[] {
  return rows.map(([h, l, c], index) => ({ t: index * 60, o: index ? rows[index - 1]![2] : c, h, l, c, v: 10 }));
}
/** 09:00–09:12: rise to a confirmed high of 100 at 09:07, pull back to 99, return to 99.8 at 09:12. */
const RETEST: [number, number, number][] = [
  [98.1, 97.9, 98], [98.3, 98, 98.2], [98.5, 98.2, 98.4], [98.7, 98.4, 98.6], [98.9, 98.6, 98.8], [99.1, 98.8, 99],
  [99.6, 99, 99.5], [100, 99.5, 99.8], [99.7, 99.4, 99.5], [99.4, 99.1, 99.2], [99.2, 99, 99], [99.3, 99, 99.2],
  [99.85, 99.2, 99.8],
];
const FILL = (count: number, high = 99.6): [number, number, number][] =>
  Array.from({ length: count }, (_, index) => [high - (index % 3) * 0.1, high - 0.5, high - 0.3] as [number, number, number]);
function afterRetest(highs: readonly number[]): Bar[] {
  return minutes([...RETEST, ...highs.map((h) => [h, h - 0.6, h - 0.2] as [number, number, number]), ...FILL(40)]);
}

test("an intraday high, a real pullback and a return near it make a question", () => {
  const c = intradayCandidate(sym("2330"), afterRetest([]), 0.003)!;
  assert.equal(c.kind, "intraday-high");
  assert.equal(c.level, 100);
  assert.equal(c.levelT, 7 * 60);
  assert.equal(c.questionT, 12 * 60);
  assert.equal(c.pullbackLow, 99);
  assert.equal(c.stops.pullback, 99);
  assert.equal(c.stops.belowLevel, 99);
  assert.ok(c.stops.pullback < 99.8 && c.stops.belowLevel < 99.8);
});

test("a high that is not the day's high so far is not used", () => {
  const rows = RETEST.map((row, index) => (index === 1 ? ([101, 98, 98.2] as [number, number, number]) : row));
  assert.equal(intradayCandidate(sym("1"), minutes([...rows, ...FILL(40)]), 0.003), null);
});

test("trading above the high before the return disqualifies it", () => {
  const rows = RETEST.map((row, index) => (index === 9 ? ([100.5, 99.1, 99.2] as [number, number, number]) : row));
  assert.equal(intradayCandidate(sym("1"), minutes([...rows, ...FILL(40)]), 0.003), null);
});

test("a question too late in the day or without 30 minutes left is not used", () => {
  const late = minutes([...FILL(200, 97), ...RETEST.map(([h, l, c]) => [h, l, c] as [number, number, number]), ...FILL(40)]);
  assert.equal(intradayCandidate(sym("1"), late, 0.003), null);
  assert.equal(intradayCandidate(sym("1"), minutes([...RETEST, ...FILL(20)]), 0.003), null);
});

test("a higher high needs a new confirmed high above the level, not one tick", () => {
  // The level 100 trades in 0.5 ticks: 100.5 is one tick above, 101 is two.
  assert.equal(intradayCandidate(sym("1"), afterRetest([100.5, 99.9, 99.8]), 0.003)!.outcome.higherHigh, false);
  assert.equal(intradayCandidate(sym("1"), afterRetest([100.5, 100.5, 99.6, 99.5]), 0.003)!.outcome.higherHigh, false);
  const broke = intradayCandidate(sym("1"), afterRetest([100.5, 101, 100.5, 100.1]), 0.003)!;
  assert.equal(broke.outcome.higherHigh, true);
  assert.equal(broke.outcome.higherHighT, 14 * 60);
  assert.equal(broke.outcome.firstBreakT, 13 * 60);
  assert.equal(broke.outcome.firstBreakPrice, 100.5);
  assert.equal(broke.outcome.maxAfter, 101);
});

test("a confirmed high one tick above that closes one tick above is not a higher high", () => {
  // Like 中鋼 on 2026-10-16: 19.5 → 19.55, closing at 19.55.
  const flat = Array.from({ length: 36 }, () => [100.5, 100, 100.5] as [number, number, number]);
  const bars = minutes([...RETEST, [100.5, 99.9, 100.2], [100, 99.8, 99.9], [99.9, 99.7, 99.8], ...flat]);
  const outcome = intradayCandidate(sym("1"), bars, 0.003)!.outcome;
  assert.equal(outcome.close, 100.5);
  assert.equal(outcome.higherHigh, false);
});

test("a breakout that holds into the close is a higher high without a confirmed high", () => {
  // A limit-up lock is a plateau, which never confirms (like 台虹 on 2026-10-16).
  const lock = minutes([...RETEST, [102, 99.8, 102], ...Array.from({ length: 39 }, () => [102, 102, 102] as [number, number, number])]);
  const locked = intradayCandidate(sym("1"), lock, 0.003)!.outcome;
  assert.equal(locked.higherHigh, true);
  assert.equal(locked.higherHighT, 13 * 60);
  assert.equal(locked.close, 102);
  // A steady rise into the close never has two lower minutes on its right either.
  const rise = minutes([...RETEST, ...Array.from({ length: 40 }, (_, index) => {
    const high = 99.9 + index / 10;
    return [high, high - 0.3, high - 0.1] as [number, number, number];
  })]);
  assert.equal(intradayCandidate(sym("1"), rise, 0.003)!.outcome.higherHigh, true);
});

test("previous-high questions need the reference price to equal yesterday's close", () => {
  const bars = afterRetest([]);
  assert.equal(previousHighCandidate(sym("1", { referencePrice: 98 }), bars, { high: 100, close: 97.9 }, 0.003), null);
  assert.equal(previousHighCandidate(sym("1", { referencePrice: 98 }), bars, null, 0.003), null);
  const gapUp = minutes([[100.5, 100.1, 100.3], ...RETEST.slice(1), ...FILL(40)]);
  assert.equal(previousHighCandidate(sym("1", { referencePrice: 98 }), gapUp, { high: 100, close: 98 }, 0.003), null);
  const c = previousHighCandidate(sym("1", { referencePrice: 98 }), minutes([...RETEST.slice(0, 7), [99.75, 99.5, 99.72], ...FILL(40)]),
    { high: 100, close: 98 }, 0.003)!;
  assert.equal(c.kind, "previous-high");
  assert.equal(c.level, 100);
  assert.equal(c.levelT, null);
  assert.equal(c.questionT, 7 * 60);
});

const candidate = (code: string, higherHigh: boolean, extra: Partial<DailyCandidate> = {}): DailyCandidate => ({
  code, name: code, kind: "intraday-high", level: 100, levelT: 420, questionT: 1_200, referencePrice: 98, pullbackLow: 99,
  stops: { pullback: 99, belowLevel: 99 }, bars: [],
  outcome: { higherHigh, higherHighT: null, firstBreakT: null, firstBreakPrice: null, maxAfter: 99.9, close: 99 },
  tradeValue: 1_000_000 - Number(code), pullbackPct: 0.01, ...extra,
});

test("the same data always picks the same question", () => {
  const list = Array.from({ length: 12 }, (_, index) => candidate(String(index), index % 2 === 0));
  assert.deepEqual(pickQuestion("2026-10-16", list), pickQuestion("2026-10-16", list));
  assert.equal(pickQuestion("2026-10-16", []), null);
});

test("with both outcomes in the top 10 the seed picks the outcome group first", () => {
  const list = Array.from({ length: 10 }, (_, index) => candidate(String(index), index !== 3));
  const outcomes = Array.from({ length: 40 }, (_, day) =>
    pickQuestion(`2026-11-${String(day + 1).padStart(2, "0")}`, list)!.outcome.higherHigh);
  assert.ok(outcomes.filter(Boolean).length >= 10);
  assert.ok(outcomes.filter((value) => !value).length >= 10);
});

test("clean setups rank first, then liquid stocks; only the top 10 are drawn from", () => {
  const messy = Array.from({ length: 10 }, (_, index) => candidate(`9${index}`, true, { pullbackPct: 0.08, tradeValue: 9e12 - index }));
  const lateButClean = candidate("7", true, { questionT: 9_600, tradeValue: 5 });
  const clean = candidate("5", true, { tradeValue: 1 });
  const ranked = rankCandidates([...messy, lateButClean, clean]).map((value) => value.code);
  assert.deepEqual(ranked.slice(0, 2), ["5", "90"]);
  assert.equal(ranked.length, 10);
  assert.equal(ranked.includes("7"), false);
});

test("the pool is top 50 by value and by volume without disposition or thin stocks", () => {
  const symbols = Array.from({ length: 120 }, (_, index) =>
    sym(String(1000 + index), { tradeValue: index, tradeVolume: 1_000 - index, bars: index === 119 ? 100 : 270, disposition: index === 118 }));
  const pool = poolSymbols(symbols).map((value) => value.code);
  assert.equal(pool.includes("1119"), false);
  assert.equal(pool.includes("1118"), false);
  assert.ok(pool.includes("1117"));
  assert.ok(pool.includes("1000"));
  assert.equal(pool.includes("1060"), false);
});

test("the wider 0.6% search is used only when 0.3% finds nothing", () => {
  const near = minutes([...RETEST.slice(0, 12), [99.55, 99.2, 99.5], ...FILL(40, 99.3)]);
  const question = buildQuestion({ dataDate: "2026-10-16", symbols: [sym("2330")], barsOf: () => near, previousOf: () => null });
  assert.equal(question?.code, "2330");
  assert.equal(question?.dataDate, "2026-10-16");
  const both = buildQuestion({ dataDate: "2026-10-16", symbols: [sym("2330"), sym("2317")],
    barsOf: (code) => (code === "2317" ? afterRetest([]) : near), previousOf: () => null });
  assert.equal(both?.code, "2317");
});

test("a missing or broken symbol is skipped", () => {
  const question = buildQuestion({ dataDate: "2026-10-16", symbols: [sym("2330"), sym("2317")],
    barsOf: (code) => (code === "2330" ? null : afterRetest([])), previousOf: () => null });
  assert.equal(question?.code, "2317");
});
