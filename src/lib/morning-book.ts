import type { BookLevels } from "./lessons/books.ts";
import type { LiveTrade } from "./market/real-replay.ts";
import { limitDown, limitUp, roundToTick } from "./market/ticks.ts";
import type { MorningBookCell, MorningCatalog } from "./morning.ts";

/** One shown level, best first from 1. `lots` is null where the recording has no size unit (shown as 「—」). */
export type MorningBookLevel = { level: number; price: number; lots: number | null };

/** What the five-level area shows: the real recorded book (`full`) or only the real best bid and ask (`top`). */
export type DisplayedBook = {
  bids: MorningBookLevel[];
  asks: MorningBookLevel[];
  depth: "full" | "top";
  /** Whether the levels carry order sizes (only a recorded book whose day documents its size unit). */
  sizes: boolean;
  /** The line under a `top` book saying why there are no five levels; null with a full book. */
  note: string | null;
};

/** The lesson day has no recorded books at all. */
export const NO_BOOKS_NOTE = "這天沒有五檔掛單資料";
/** The day has books and this stock's own book was delivered, but it is unknown for this stretch (a recording gap). */
export const BOOK_GAP_NOTE = "這段時間沒有五檔資料";
/**
 * The day has books but the server has not delivered this stock's book: the stock was just picked (its books come
 * with the next advance), or the recording has no file for it.
 */
export const BOOK_PENDING_NOTE = "下一分鐘起顯示這檔的五檔";

export function validMorningLimit(price: number, previousClose: number): boolean {
  return (
    Number.isFinite(price) &&
    price > 0 &&
    Math.abs(roundToTick(price) - price) < 1e-8 &&
    price >= limitDown(previousClose) &&
    price <= limitUp(previousClose)
  );
}

/** How many frames (in time order) are at or before `ms`. */
function framesUpTo(frames: readonly (readonly [number, BookLevels])[], ms: number): number {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle][0] <= ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The recorded book at `ms` of the cell the server sent: the last change at or before it; null when unknown then. */
function bookAt(book: MorningBookCell, ms: number): BookLevels | null {
  if (book.gaps.some(([from, to]) => ms >= from && ms < to)) return null;
  const count = framesUpTo(book.frames, ms);
  return count > 0 ? book.frames[count - 1][1] : book.start;
}

/**
 * Whether a recorded level can be offered as a clickable limit price: positive, finite and on the tick grid, and
 * inside the day's ±10% band when the previous close is known. A recording can hold a market-order marker (0) or a
 * stray price; those are not prices a learner may send.
 */
function offeredLevel(price: number, previousClose: number | undefined): boolean {
  if (previousClose !== undefined && Number.isFinite(previousClose) && previousClose > 0)
    return validMorningLimit(price, previousClose);
  return Number.isFinite(price) && price > 0 && Math.abs(roundToTick(price) - price) < 1e-8;
}

/** The offered levels of one side, renumbered from 1 (best first) after the ones that are not prices are left out. */
const levelsOf = (
  levels: readonly (readonly [number, number])[],
  sizes: boolean,
  previousClose: number | undefined,
): MorningBookLevel[] =>
  levels
    .filter(([price]) => offeredLevel(price, previousClose))
    .map(([price, size], index) => ({ level: index + 1, price, lots: sizes ? size : null }));

const quoted = (price: number | null | undefined): price is number =>
  typeof price === "number" && Number.isFinite(price) && price > 0;

/**
 * The five-level area for one stock at the replay position `playedMs` (ms after 09:00; a book is never shown before
 * its own time). With the recorded book of the stock's newest minute: the last change at or before `playedMs`
 * (the minute's starting book before its first change), its sizes only when the day documents their unit. Without
 * one, or inside a recording gap: only the real best bid and ask the last played trade came with, one level each
 * and no sizes, and the line saying why (not delivered yet, a gap, or no books that day). A recorded level that is
 * not a valid limit price is left out. Matching never looks at any of this (decision K).
 */
export function displayBook(input: {
  catalog: Pick<MorningCatalog, "booksAvailable">;
  book: MorningBookCell | undefined;
  lastTrade: LiveTrade | null;
  playedMs: number;
  /** The stock's previous close: recorded levels outside its ±10% band are not offered. */
  previousClose?: number;
}): DisplayedBook {
  const { book, lastTrade, previousClose } = input;
  const recorded = book ? bookAt(book, input.playedMs) : null;
  if (book && recorded) {
    return {
      bids: levelsOf(recorded.bids, book.sizes, previousClose),
      asks: levelsOf(recorded.asks, book.sizes, previousClose),
      depth: "full",
      sizes: book.sizes,
      note: null,
    };
  }
  return {
    bids: quoted(lastTrade?.bid) ? [{ level: 1, price: lastTrade.bid, lots: null }] : [],
    asks: quoted(lastTrade?.ask) ? [{ level: 1, price: lastTrade.ask, lots: null }] : [],
    depth: "top",
    sizes: false,
    // A day with books: a book that was delivered but is unknown here is a gap; no book yet is "coming".
    note: input.catalog.booksAvailable ? (book ? BOOK_GAP_NOTE : BOOK_PENDING_NOTE) : NO_BOOKS_NOTE,
  };
}

/** What an advance asks for besides the minute: the books of the selected stock, when it is one of the run's. */
export function bookView(run: { codes?: readonly string[] }, code: string): { view?: string } {
  return code && (!run.codes || run.codes.includes(code)) ? { view: code } : {};
}

/** Share of bid lots among all shown lots; 0.5 when nothing is shown. Levels without a size count for nothing. */
export function bookPressure(book: {
  bids: readonly MorningBookLevel[];
  asks: readonly MorningBookLevel[];
}): { bidLots: number; askLots: number; bidShare: number } {
  const bidLots = book.bids.reduce((sum, level) => sum + (level.lots ?? 0), 0);
  const askLots = book.asks.reduce((sum, level) => sum + (level.lots ?? 0), 0);
  const total = bidLots + askLots;
  return { bidLots, askLots, bidShare: total > 0 ? bidLots / total : 0.5 };
}

/** 左買右賣 (the 10/20 meeting): a left (委買) cell buys at its price, a right (委賣) cell sells at its price. */
export function bookCellOrder(cell: "bid" | "ask"): "buy" | "sell" {
  return cell === "bid" ? "buy" : "sell";
}

/** Whether a trading cell waits: while the ticket is locked, and a sell without the lots in holdings. A display
 *  book (the phone's 行情 page) only hands the price over, so its cells never wait. */
export function bookCellBlocked(input: {
  cell: "bid" | "ask";
  trading: boolean;
  locked: boolean;
  holdingLots: number;
  lots: number;
}): boolean {
  if (!input.trading) return false;
  return input.locked || (input.cell === "ask" && input.holdingLots < input.lots);
}

/** A cell's accessible name, e.g. 「買1 2575，點擊以 2575 限價買進 1 張」 (spec 5.1). */
export function bookCellLabel(input: {
  cell: "bid" | "ask";
  level: number;
  price: string;
  lots: number;
  trading: boolean;
}): string {
  const buy = input.cell === "bid";
  const name = `${buy ? "買" : "賣"}${input.level} ${input.price}`;
  return input.trading
    ? `${name}，點擊以 ${input.price} 限價${buy ? "買進" : "賣出"} ${input.lots} 張`
    : `${name}，點擊帶入下單（${buy ? "買進" : "賣出"}）`;
}
