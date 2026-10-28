import test from "node:test";
import assert from "node:assert/strict";
import { bookCell, readBookTimeline, type BookLevels } from "./books.ts";

// Flags as books_compact.py writes them.
const TRIAL = 1;
const FULL = 4;
const CONTINUOUS = 8;

const doc = (rows: unknown[], gaps: unknown[] = []) => ({
  schema: 1,
  code: "2330",
  date: "2026-10-27",
  sizeUnit: "unverified",
  keyEvery: 60_000,
  rows,
  gaps,
});
const book = (bids: [number, number][], asks: [number, number][]): BookLevels => ({ bids, asks });

// t (ms after 09:00) → what the row says
//   -300000  FULL, trial   (08:55)           bid 100x5 99.5x3 | ask 100.5x4
//      1000  FULL          (09:00:01)        bid 100x10 99.5x3 99x2 | ask 100.5x4 101x6
//     21000  diff          bid1 size 12
//     61000  diff          ask1 emptied
//     60500  diff, t goes back              bid2 = 99.4x7
const rows = [
  [-300_000, FULL | TRIAL, [[[100, 5], [99.5, 3]], [[100.5, 4]]]],
  [301_000, FULL | CONTINUOUS, [[[100, 10], [99.5, 3], [99, 2]], [[100.5, 4], [101, 6]]]],
  [20_000, CONTINUOUS, [[0, 100, 12]]],
  [40_000, CONTINUOUS, [[5, null, null]]],
  [-500, CONTINUOUS, [[1, 99.4, 7]]],
];

test("replays in arrival order", () => {
  const timeline = readBookTimeline(doc(rows))!;
  const cell1 = bookCell(timeline, 1);
  // The row whose time went back is still applied after the one before it, and is shown at the latest time seen.
  assert.deepEqual(cell1.frames, [
    [61_000, book([[100, 12], [99.5, 3], [99, 2]], [[101, 6]])],
    [61_000, book([[100, 12], [99.4, 7], [99, 2]], [[101, 6]])],
  ]);
  assert.deepEqual(bookCell(timeline, 0).frames, [
    [1000, book([[100, 10], [99.5, 3], [99, 2]], [[100.5, 4], [101, 6]])],
    [21_000, book([[100, 12], [99.5, 3], [99, 2]], [[100.5, 4], [101, 6]])],
  ]);
});

test("cell start is the last state before the cell", () => {
  const timeline = readBookTimeline(doc(rows))!;
  // Cell 0: the last row before 09:00 is the pre-open one.
  assert.deepEqual(bookCell(timeline, 0).start, book([[100, 5], [99.5, 3]], [[100.5, 4]]));
  // Cell 1: bid 1 has grown to 12, nothing of cell 1 itself.
  assert.deepEqual(bookCell(timeline, 1).start, book([[100, 12], [99.5, 3], [99, 2]], [[100.5, 4], [101, 6]]));
  // Cell 2 starts with everything cell 1 did.
  assert.deepEqual(bookCell(timeline, 2).start, book([[100, 12], [99.4, 7], [99, 2]], [[101, 6]]));
  assert.deepEqual(bookCell(timeline, 2).frames, []);
});

test("a row exactly on the cell start belongs to the cell, not to its start", () => {
  const timeline = readBookTimeline(doc([[0, FULL, [[[100, 1]], [[101, 1]]]], [60_000, 0, [[0, 100, 2]]]]))!;
  assert.deepEqual(bookCell(timeline, 1).start, book([[100, 1]], [[101, 1]]));
  assert.deepEqual(bookCell(timeline, 1).frames, [[60_000, book([[100, 2]], [[101, 1]])]]);
  assert.deepEqual(bookCell(timeline, 0).start, null);
});

test("frames are full snapshots", () => {
  const timeline = readBookTimeline(doc(rows))!;
  const [first, second] = bookCell(timeline, 1).frames;
  // Every frame carries all the levels, not the change.
  assert.equal(first[1].bids.length, 3);
  assert.equal(first[1].asks.length, 1); // the emptied ask is gone, the second ask moved up
  assert.equal(second[1].bids.length, 3);
  // Frames do not share (or alias) each other's levels.
  second[1].bids[0][1] = 999;
  assert.equal(first[1].bids[0][1], 12);
  assert.equal(bookCell(timeline, 1).frames[0][1].bids[0][1], 12);
});

test("a full row replaces the whole book", () => {
  const timeline = readBookTimeline(doc([
    [1000, FULL, [[[100, 1], [99, 1]], [[101, 1], [102, 1]]]],
    [1000, FULL, [[[98, 5]], []]],
  ]))!;
  assert.deepEqual(bookCell(timeline, 0).frames[1], [2000, book([[98, 5]], [])]);
});

test("inside a gap → null", () => {
  const timeline = readBookTimeline(doc([
    [1000, FULL, [[[100, 10]], [[101, 10]]]],
    [20_000, 0, [[0, 100, 11]]], // 21 s
    [109_000, FULL | CONTINUOUS, [[[99, 3]], [[100, 3]]]], // 130 s, inside the gap: not believed
    [30_000, 0, [[5, 100, 4]]], // 160 s, after the gap
  ], [[50_000, 150_000]]))!;
  // Cell 0 starts before the gap: known until 50 s, then the gap, whose part in the cell is reported.
  const cell0 = bookCell(timeline, 0);
  assert.equal(cell0.start, null); // nothing was known before 09:00
  assert.deepEqual(cell0.frames.map(([ms]) => ms), [1000, 21_000]);
  assert.deepEqual(cell0.gaps, [[50_000, 60_000]]);
  // Cell 1 starts inside the gap.
  const cell1 = bookCell(timeline, 1);
  assert.equal(cell1.start, null);
  assert.deepEqual(cell1.frames, []);
  assert.deepEqual(cell1.gaps, [[60_000, 120_000]]);
  // Cell 2 starts inside the gap too, which ends at 150 s.
  const cell2 = bookCell(timeline, 2);
  assert.equal(cell2.start, null);
  assert.deepEqual(cell2.frames, [[160_000, book([[99, 3]], [[100, 4]])]]);
  assert.deepEqual(cell2.gaps, [[120_000, 150_000]]);
  // Cell 3 starts after it.
  assert.deepEqual(bookCell(timeline, 3).start, book([[99, 3]], [[100, 4]]));
  assert.deepEqual(bookCell(timeline, 3).gaps, []);
});

test("a gap ends where the first row after it is", () => {
  const timeline = readBookTimeline(doc([
    [1000, FULL, [[[100, 10]], [[101, 10]]]],
    [148_000, FULL | CONTINUOUS, [[[99, 3]], [[100, 3]]]], // 149 s
    [31_000, 0, [[5, 100, 4]]], // 180 s
  ], [[50_000, 149_000]]))!;
  const cell2 = bookCell(timeline, 2);
  assert.equal(cell2.start, null);
  assert.deepEqual(cell2.frames, [[149_000, book([[99, 3]], [[100, 3]])]]);
  assert.deepEqual(cell2.gaps, [[120_000, 149_000]]);
  assert.deepEqual(bookCell(timeline, 3).start, book([[99, 3]], [[100, 3]]));
  assert.deepEqual(bookCell(timeline, 3).frames, [[180_000, book([[99, 3]], [[100, 4]])]]);
});

test("only the morning is kept", () => {
  const timeline = readBookTimeline(doc([
    [0, FULL, [[[100, 1]], [[101, 1]]]],
    [5_399_999, 0, [[0, 100, 2]]],
    [1, 0, [[0, 100, 3]]], // 5_400_000
    [60_000, 0, [[0, 100, 4]]],
    "not even a row, after the morning",
  ]))!;
  assert.deepEqual(bookCell(timeline, 89).frames, [[5_399_999, book([[100, 2]], [[101, 1]])]]);
  assert.deepEqual(bookCell(timeline, 90), { start: null, frames: [], gaps: [] });
  assert.deepEqual(bookCell(timeline, -1), { start: null, frames: [], gaps: [] });
  assert.deepEqual(bookCell(timeline, 1.5), { start: null, frames: [], gaps: [] });
});

test("pre-open rows keep only the last state before 09:00", () => {
  const timeline = readBookTimeline(doc([
    [-600_000, FULL | TRIAL, [[[90, 1]], [[91, 1]]]],
    [100_000, TRIAL, [[0, 95, 1]]],
    [100_000, TRIAL, [[5, 96, 2]]],
    [400_000, FULL, [[[100, 1]], [[101, 1]]]], // 09:00:00
  ]))!;
  assert.deepEqual(bookCell(timeline, 0).start, book([[95, 1]], [[96, 2]]));
  assert.deepEqual(bookCell(timeline, 0).frames, [[0, book([[100, 1]], [[101, 1]])]]);
});

test("a bad file is no timeline", () => {
  const good = rows[1];
  for (const bad of [
    null,
    "rows",
    {},
    { ...doc(rows), schema: 2 },
    { ...doc(rows), rows: "x" },
    { ...doc(rows), gaps: "x" },
    { ...doc(rows), gaps: [[10, 5]] },
    { ...doc(rows), gaps: [[10]] },
    { ...doc(rows), gaps: [[0, Number.NaN]] },
    doc([[1, FULL, [[[100, 1]]]]]), // a full row needs bids and asks
    doc([[1, FULL, [[[100, 1], [99, 1], [98, 1], [97, 1], [96, 1], [95, 1]], []]]]), // six levels
    doc([[1, FULL, [[[100]], []]]]),
    doc([[1, FULL, [[[100, "1"]], []]]]),
    doc([[1, 0, [[10, 100, 1]]]]), // slot 10
    doc([[1, 0, [[-1, 100, 1]]]]),
    doc([[1, 0, [[0.5, 100, 1]]]]),
    doc([[1, 0, [[0, 100, null]]]]), // a price without a size
    doc([[1, 0, [[0, null, 1]]]]),
    doc([[1, 0, "x"]]),
    doc([[1, 0.5, []]]),
    doc([["1", 0, []]]),
    doc([good, [1, FULL]]),
    doc([good, [1]]),
    doc([good, null]),
  ]) {
    assert.equal(readBookTimeline(bad), null, JSON.stringify(bad)?.slice(0, 80));
  }
  // An empty file and a file with no rows are valid: there is just nothing to show.
  assert.deepEqual(bookCell(readBookTimeline(doc([]))!, 0), { start: null, frames: [], gaps: [] });
});

test("a diff row before any full row builds on an empty book", () => {
  const timeline = readBookTimeline(doc([[1000, 0, [[0, 100, 5], [5, 101, 6]]]]))!;
  assert.deepEqual(bookCell(timeline, 0).frames, [[1000, book([[100, 5]], [[101, 6]])]]);
});
