// The recorded five-level books (books/<day>/symbols/<code>.json.gz) of a lesson day's morning, by cell.
// The file format is the one tools/fubon-daily/fubon_daily/books_compact.py writes: rows [dt, flags, payload] in
// arrival order, dt in ms after the row before it (the first row's is its time after 09:00, negative before it).
import { CELL_MS, MORNING_CELLS, MORNING_END_MS } from "./trades.ts";

/** Best price first on both sides; [price, size]. A side shows only the levels that hold an order. */
export type BookLevels = { bids: [number, number][]; asks: [number, number][] };

const LEVELS = 5;
const SLOTS = 2 * LEVELS; // 0–4 bids, 5–9 asks
const WIDTH = 2 * SLOTS; // price and size of every slot
const FULL = 4; // flag: the row holds the whole book, not the changed slots

/**
 * One row per book message of the morning, in arrival order, with the book after it (`WIDTH` numbers per row:
 * price and size of each slot, NaN for an empty slot). A time that goes back is held at the latest time seen so
 * far, so times never decrease and a book is never shown before its time. Before 09:00 only the last row is
 * kept, since only the state at 09:00 matters; rows from 10:30 on, and rows inside a gap, are not kept.
 */
export type BookTimeline = {
  readonly times: readonly number[];
  readonly values: Float64Array;
  /** Stretches (ms after 09:00, start included, end not) whose books are unknown; sorted, apart from each other. */
  readonly gaps: readonly (readonly [number, number])[];
};

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function readGaps(gaps: unknown[]): [number, number][] | null {
  const spans: [number, number][] = [];
  for (const gap of gaps) {
    if (!Array.isArray(gap) || gap.length !== 2 || !isNumber(gap[0]) || !isNumber(gap[1]) || gap[1] <= gap[0]) return null;
    spans.push([gap[0], gap[1]]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

/** Puts one side's levels (at most five [price, size]) into the slots from `from`; false when it is not one. */
function fillSide(slots: number[], from: number, levels: unknown): boolean {
  if (!Array.isArray(levels) || levels.length > LEVELS) return false;
  for (let index = 0; index < LEVELS; index += 1) {
    const level: unknown = levels[index];
    if (index >= levels.length) {
      slots[2 * (from + index)] = Number.NaN;
      slots[2 * (from + index) + 1] = Number.NaN;
    } else if (Array.isArray(level) && level.length === 2 && isNumber(level[0]) && isNumber(level[1])) {
      slots[2 * (from + index)] = level[0];
      slots[2 * (from + index) + 1] = level[1];
    } else return false;
  }
  return true;
}

/** The morning of a books file as a timeline; `null` when the file is not one (any row of the morning is bad). */
export function readBookTimeline(doc: unknown): BookTimeline | null {
  if (!doc || typeof doc !== "object") return null;
  const { schema, rows, gaps } = doc as Record<string, unknown>;
  if (schema !== 1 || !Array.isArray(rows) || !Array.isArray(gaps)) return null;
  const spans = readGaps(gaps);
  if (!spans) return null;
  const times: number[] = [];
  const values: number[] = [];
  const slots = new Array<number>(WIDTH).fill(Number.NaN);
  let time = 0;
  let latest = -Infinity;
  let gap = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const [dt, flags, payload] = row as [unknown, unknown, unknown];
    if (!isNumber(dt) || !Number.isInteger(flags) || (flags as number) < 0) return null;
    time += dt;
    latest = Math.max(latest, time);
    if (latest >= MORNING_END_MS) break;
    if (((flags as number) & FULL) !== 0) {
      if (!Array.isArray(payload) || payload.length !== 2) return null;
      if (!fillSide(slots, 0, payload[0]) || !fillSide(slots, LEVELS, payload[1])) return null;
    } else {
      if (!Array.isArray(payload)) return null;
      for (const change of payload) {
        if (!Array.isArray(change) || change.length !== 3) return null;
        const [slot, price, size] = change as [unknown, unknown, unknown];
        if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= SLOTS) return null;
        const at = 2 * (slot as number);
        if (price === null && size === null) {
          slots[at] = Number.NaN;
          slots[at + 1] = Number.NaN;
        } else if (isNumber(price) && isNumber(size)) {
          slots[at] = price;
          slots[at + 1] = size;
        } else return null;
      }
    }
    while (gap < spans.length && spans[gap][1] <= latest) gap += 1;
    if (gap < spans.length && spans[gap][0] <= latest) continue; // the state moves on, but this time is not known
    if (latest < 0 && times.length && times[times.length - 1] < 0) {
      times.pop();
      values.length -= WIDTH;
    }
    times.push(latest);
    for (const value of slots) values.push(value);
  }
  return { times, values: Float64Array.from(values), gaps: spans };
}

/** Index of the first row at or after `ms`. */
function firstAtOrAfter(times: readonly number[], ms: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (times[middle] < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

function levelsAt(values: Float64Array, row: number): BookLevels {
  const side = (from: number): [number, number][] => {
    const levels: [number, number][] = [];
    for (let slot = from; slot < from + LEVELS; slot += 1) {
      const price = values[row * WIDTH + 2 * slot];
      if (!Number.isNaN(price)) levels.push([price, values[row * WIDTH + 2 * slot + 1]]);
    }
    return levels;
  };
  return { bids: side(0), asks: side(LEVELS) };
}

export type BookCell = {
  /** The book when the cell starts (the last one before it); null when it is unknown or nothing had come yet. */
  start: BookLevels | null;
  /** The whole book after each change inside the cell, with its time (ms after 09:00), in arrival order. */
  frames: [ms: number, book: BookLevels][];
  /** The parts of the cell whose book is unknown (recording gaps), clipped to the cell: no frame lies in them. */
  gaps: [from: number, to: number][];
};

/** The books of cell 0–89, which holds ms in [cell·60000, (cell+1)·60000). Any other cell is empty. */
export function bookCell(timeline: BookTimeline, cell: number): BookCell {
  if (!Number.isInteger(cell) || cell < 0 || cell >= MORNING_CELLS) return { start: null, frames: [], gaps: [] };
  const from = cell * CELL_MS;
  const to = from + CELL_MS;
  const gaps: [number, number][] = [];
  for (const [begin, end] of timeline.gaps) {
    if (end > from && begin < to) gaps.push([Math.max(begin, from), Math.min(end, to)]);
  }
  const first = firstAtOrAfter(timeline.times, from);
  const last = firstAtOrAfter(timeline.times, to);
  const frames: [number, BookLevels][] = [];
  for (let row = first; row < last; row += 1) frames.push([timeline.times[row], levelsAt(timeline.values, row)]);
  // The last book before the cell is the start unless a gap began after it (and not after the cell started): what
  // the book did since is unknown, whether the gap is still on at the start or ended without a row of its own.
  const before = first > 0 ? timeline.times[first - 1] : Infinity;
  const unknown = timeline.gaps.some(([begin]) => begin > before && begin <= from);
  return { start: first > 0 && !unknown ? levelsAt(timeline.values, first - 1) : null, frames, gaps };
}
