import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import type { TradeRow } from "../lessons/trades.ts";
import type { MorningDelta, MorningIndexBar, MorningResponse, MorningState } from "../morning.ts";
import { MORNING_TAPE_LENGTH } from "../morning-engine.ts";
import {
  TAPE_LENGTH,
  adoptReply,
  formingBar,
  mergeDelta,
  tradeSide,
  tradesUpTo,
  type ReplayState,
} from "./real-replay.ts";

const row = (ms: number, price: number, size = 1, bid: number | null = null, ask: number | null = null): TradeRow => [
  ms,
  price,
  size,
  bid,
  ask,
];
const bar = (t: number, o: number, h: number, l: number, c: number, v: number, a?: number): Bar =>
  a === undefined ? { t, o, h, l, c, v } : { t, o, h, l, c, v, a };
const indexBar = (minute: number): MorningIndexBar => {
  const p = Array.from({ length: 12 }, (_, point) => 20_000 + minute * 10 + point);
  return { t: minute * 60, o: p[0], h: Math.max(...p), l: Math.min(...p), c: p[11], p };
};

/** A run of two stocks at cursor 2: 2330 traded from 09:00, 2317 has not traded yet. */
const held = (over: Partial<ReplayState> = {}): ReplayState => ({
  id: "run-1",
  lessonId: "fubon-20261027-am",
  cursor: 2,
  revision: 3,
  plan: { focusCode: "2330" } as MorningState["plan"],
  codes: ["2330", "2317"],
  bars: { "2330": [bar(0, 1000, 1010, 1000, 1010, 5, 1004), bar(60, 1010, 1015, 1010, 1015, 3, 1007.5)], "2317": [] },
  index: { code: "TAIEX", name: "加權指數", previousClose: 20_000, source: "TWSE", bars: [indexBar(0), indexBar(1)] },
  startingCash: 1_000_000,
  cash: 1_000_000,
  equity: 1_000_000,
  positions: [],
  orders: [],
  fills: [],
  completed: false,
  reflection: "",
  nextAdvanceAt: 0,
  tape: { "2330": [row(400, 1000, 5), row(60_100, 1010, 2), row(119_000, 1015, 1)], "2317": [] },
  ...over,
});
const delta = (cell: number, over: Partial<MorningDelta> = {}): MorningDelta => ({
  cell,
  bars: { "2330": bar(cell * 60, 1015, 1020, 1015, 1020, 3, 1010), "2317": null },
  index: indexBar(cell),
  trades: { "2330": [row(cell * 60_000 + 500, 1015, 1), row(cell * 60_000 + 30_000, 1020, 2)], "2317": [] },
  ...over,
});
/** What an advance answers: the run without bars or TAIEX, and the cell it revealed. */
const advanced = (state: ReplayState, cell: number, over: Partial<MorningResponse> = {}): MorningResponse => {
  const { tape: _tape, latest: _latest, index: _index, ...rest } = state;
  return {
    catalog: { lessonId: state.lessonId } as MorningResponse["catalog"],
    state: { ...rest, bars: {}, cursor: cell + 1, revision: state.revision + 1 },
    delta: delta(cell),
    ...over,
  };
};

test("mergeDelta appends bars, index and trades once", () => {
  const before = held();
  const untouched = structuredClone(before);
  const once = mergeDelta(before, delta(2));
  assert.equal(once.cursor, 3);
  assert.deepEqual(once.bars["2330"], [...before.bars["2330"], delta(2).bars["2330"]]);
  assert.deepEqual(once.bars["2317"], [], "a stock that has not traded yet gets no bar");
  assert.deepEqual(
    once.index!.bars.map((item) => item.t),
    [0, 60, 120],
  );
  assert.deepEqual(once.latest, { cell: 2, trades: delta(2).trades }, "the new cell's trades wait to be replayed");
  assert.deepEqual(once.tape, before.tape, "the tape holds the trades before the replayed cell");
  assert.deepEqual(before, untouched, "the desk's state is never changed in place");

  // The same cell again (a retried advance): nothing changes.
  assert.equal(mergeDelta(once, delta(2)), once);
  assert.deepEqual(mergeDelta(once, delta(2)), once);
  // A cell after the next one cannot be added: the desk would miss a minute.
  assert.equal(mergeDelta(before, delta(3)), before);

  // The next cell moves the replayed one onto the tape, which keeps the latest TAPE_LENGTH trades of each stock.
  const twice = mergeDelta(once, delta(3));
  assert.equal(twice.cursor, 4);
  assert.deepEqual(twice.tape!["2330"], [...before.tape!["2330"], ...delta(2).trades["2330"]]);
  assert.deepEqual(twice.latest, { cell: 3, trades: delta(3).trades });
  const busy = Array.from({ length: 50 }, (_, k) => row(3 * 60_000 + k * 1000, 1020 + (k % 3) * 5, 1));
  const after = mergeDelta(mergeDelta(once, delta(3, { trades: { "2330": busy, "2317": [] } })), delta(4));
  assert.equal(TAPE_LENGTH, MORNING_TAPE_LENGTH, "as many as a snapshot's tape");
  assert.equal(after.tape!["2330"].length, TAPE_LENGTH);
  assert.deepEqual(after.tape!["2330"], busy.slice(-TAPE_LENGTH));
});

test("a stock's first bar and a run without TAIEX merge too", () => {
  const first = mergeDelta(
    held({ index: undefined }),
    delta(2, { bars: { "2330": bar(120, 1015, 1015, 1015, 1015, 0, 1007.5), "2317": bar(120, 50, 50, 50, 50, 2, 50) } }),
  );
  assert.deepEqual(first.bars["2317"], [bar(120, 50, 50, 50, 50, 2, 50)]);
  assert.equal(first.index, undefined);
});

test("forming bar equals cell bar when all trades played", () => {
  // 30 lots traded before at an average of 100; this minute adds 10 lots for 1004.5.
  const rows = [row(120_400, 100, 2), row(121_000, 101, 3), row(150_000, 99.5, 1), row(179_999, 100.5, 4)];
  const previous = bar(60, 100, 100, 100, 100, 10, 100);
  const cell = bar(120, 100, 101, 99.5, 100.5, 10, 100.11); // (3000 + 1004.5) / 40 = 100.1125
  assert.deepEqual(formingBar(120_000, rows, rows.length, previous, 30), cell);
  // Part-way: what the first two trades made, the day's average with them.
  assert.deepEqual(formingBar(120_000, rows, 2, previous, 30), bar(120, 100, 101, 100, 101, 5, 100.09));
  // No trade yet in the minute: flat at the last trade, no volume, the average carried.
  assert.deepEqual(formingBar(120_000, rows, 0, previous, 30), bar(120, 100, 100, 100, 100, 0, 100));
  // A stock's first minute: nothing before its first trade, then that minute's own average.
  assert.equal(formingBar(120_000, rows, 0, undefined), null);
  assert.deepEqual(formingBar(120_000, rows, 4, undefined), bar(120, 100, 101, 99.5, 100.5, 10, 100.45));
  // A source without an average gets none.
  assert.deepEqual(formingBar(120_000, rows, 1, bar(60, 100, 100, 100, 100, 10), 10), bar(120, 100, 100, 100, 100, 2));
});

test("tradeSide classifies ask/bid/neither", () => {
  assert.equal(tradeSide(row(0, 100.5, 1, 100, 100.5)), "ask", "at the ask: 外盤");
  assert.equal(tradeSide(row(0, 100, 1, 100, 100.5)), "bid", "at the bid: 內盤");
  assert.equal(tradeSide(row(0, 100, 1, 99.5, 100.5)), null, "between them: neither");
  assert.equal(tradeSide(row(0, 100, 1, null, null)), null, "no quote at the time");
  assert.equal(tradeSide(row(0, 100, 1, null, 100)), "ask");
  assert.equal(tradeSide(row(0, 100, 1, 100, null)), "bid");
  assert.equal(tradeSide(row(0, 0.1 + 0.2, 1, 0.25, 0.3)), "ask", "the same price however it was written");
});

test("tradesUpTo boundary", () => {
  const rows = [row(100, 1), row(200, 2), row(200, 3), row(300, 4)];
  assert.equal(tradesUpTo(rows, 99), 0);
  assert.equal(tradesUpTo(rows, 100), 1, "a trade at the moment itself has been played");
  assert.equal(tradesUpTo(rows, 199), 1);
  assert.equal(tradesUpTo(rows, 200), 3, "trades at the same moment play together");
  assert.equal(tradesUpTo(rows, 299.9), 3);
  assert.equal(tradesUpTo(rows, 300), 4);
  assert.equal(tradesUpTo(rows, Number.POSITIVE_INFINITY), 4);
  assert.equal(tradesUpTo(rows, -1), 0);
  assert.equal(tradesUpTo([], 1000), 0);
});

test("a snapshot is the desk's data as it is, its tape on the run", () => {
  const { tape, latest: _latest, ...run } = held();
  const snapshot: MorningResponse = { catalog: {} as MorningResponse["catalog"], state: run, tape: tape! };
  const adopted = adoptReply({ catalog: {} as MorningResponse["catalog"], state: held({ cursor: 9 }) }, snapshot)!;
  assert.equal(adopted.state!.latest, undefined, "nothing replays from a snapshot");
  assert.deepEqual(adopted.state, { ...run, tape });
  const none: MorningResponse = { catalog: {} as MorningResponse["catalog"], state: null };
  assert.equal(adoptReply(null, none), none);
});

test("a step keeps the desk's bars, TAIEX, trades and lesson list, and takes the rest from the reply", () => {
  const before = held({ latest: { cell: 1, trades: { "2330": [row(60_100, 1010, 2)] } } });
  const lessons = [{ lessonId: "fubon-20261027-am", date: "2026-10-27", title: "10/27" }];
  const previous: MorningResponse = { catalog: {} as MorningResponse["catalog"], state: before, lessons };
  const { tape: _tape, latest: _latest, index: _index, ...rest } = before;
  const ordered: MorningResponse = {
    catalog: { lessonId: "x" } as MorningResponse["catalog"],
    state: { ...rest, bars: {}, revision: 4, cash: 900_000 },
  };
  const adopted = adoptReply(previous, ordered)!;
  assert.equal(adopted.state!.revision, 4);
  assert.equal(adopted.state!.cash, 900_000);
  assert.deepEqual(adopted.state!.bars, before.bars);
  assert.deepEqual(adopted.state!.index, before.index);
  assert.deepEqual(adopted.state!.tape, before.tape);
  assert.deepEqual(adopted.state!.latest, before.latest, "an order mid-replay keeps the minute playing");
  assert.equal(adopted.catalog, ordered.catalog);
  assert.deepEqual(adopted.lessons, lessons, "a step does not carry the lesson list; the desk keeps it");
  // A step that moved the run on without a cell (another tab advanced): the desk needs a snapshot.
  assert.equal(adoptReply(previous, { ...ordered, state: { ...ordered.state!, cursor: 3 } }), null);
});

test("an advance adds the cell after the desk's own; any other cell asks for a snapshot", () => {
  const book = { code: "2330", start: null, frames: [], gaps: [], sizes: false };
  const previous: MorningResponse = { catalog: {} as MorningResponse["catalog"], state: held() };
  const reply = advanced(held(), 2, { delta: { ...delta(2), book } });
  const adopted = adoptReply(previous, reply)!;
  assert.equal(adopted.state!.cursor, 3);
  assert.equal(adopted.state!.revision, 4);
  assert.deepEqual(adopted.state!.bars, mergeDelta(held(), delta(2)).bars);
  assert.deepEqual(adopted.state!.index!.bars.length, 3);
  assert.deepEqual(adopted.state!.latest, { cell: 2, trades: delta(2).trades });
  assert.deepEqual(adopted.book, book, "the cell's books stay with the desk until the next cell");
  // A retried advance answered with a later cell, or one the desk already has: load the run as it is.
  assert.equal(adoptReply(previous, advanced(held(), 3)), null);
  assert.equal(adoptReply({ ...previous, state: mergeDelta(held(), delta(2)) }, reply), null);
  // An advance of another run, or with no run on the desk.
  assert.equal(adoptReply({ ...previous, state: held({ id: "run-2" }) }, reply), null);
  assert.equal(adoptReply(null, reply), null);
  // An advance without books clears the previous cell's.
  const next = adoptReply(adopted, advanced(adopted.state!, 3))!;
  assert.equal(next.book, undefined);
  assert.equal(next.state!.cursor, 4);
});
