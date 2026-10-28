import type { Bar } from "./game/types";
import type { Celebration } from "./discipline/score";
import type { BookLevels } from "./lessons/books.ts";
import type { TradeRow } from "./lessons/trades.ts";
import type { LessonPicker, RunRecord } from "./lessons/types.ts";

export type MorningPlan = {
  exerciseId?: string;
  bias: "observe" | "bullish" | "bearish";
  focusCode: string;
  reason: string;
  entry: string;
  stop: string;
};
export type MorningCatalog = {
  lessonId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  maxCursor: number;
  /** `previous5CloseMean` is null when fewer than five full-market days come before the lesson (③ decision N). */
  symbols: { code: string; name: string; previousClose: number; previous5CloseMean: number | null }[];
  context: { label: string; value: string; asOf: string }[];
  strategy: string[];
  notices: string[];
  videoUrl: string | null;
  /** Present only when the source documents whole-share minute volume in lots (張). */
  volumeUnit?: "lot";
  /** The default 自選's desk wording, on a catalog made of a picker's defaults. */
  note?: { title: string; detail: string | null };
  /** The lesson day has recorded books (五檔). */
  booksAvailable?: boolean;
};
/** One TAIEX minute built from TWSE's twelve 5-second values after the minute starts (`p`, oldest first). */
export type MorningIndexBar = { t: number; o: number; h: number; l: number; c: number; p: number[] };
/** The lesson's real TAIEX (TWSE 5-second index); revealed minute by minute like the stock bars. */
export type MorningIndexSeries = {
  code: "TAIEX";
  name: string;
  previousClose: number;
  source: string;
  bars: MorningIndexBar[];
};
/** A lesson in the date list: no stocks, no bars, nothing of the day's market. */
export type MorningLessonSummary = { lessonId: string; date: string; title: string };
export type MorningOrder = {
  id: string;
  code: string;
  side: "buy" | "sell";
  shares: number;
  status: "pending" | "filled" | "cancelled" | "rejected";
  submittedCursor: number;
  price?: number;
  reason?: string;
  limitPrice?: number;
  entryMode?: "lightning";
  /** A real trade after it has been looked at without filling it: a limit then fills at its own price (③ §5). */
  seen?: boolean;
};
export type MorningFill = {
  id: string;
  code: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  fee: number;
  tax: number;
  /** Seconds after 09:00. */
  t: number;
  /** The real trade's time, ms after 09:00, on a run made of real trades. */
  ms?: number;
};
export type MorningState = {
  id: string;
  lessonId: string;
  cursor: number;
  revision: number;
  plan: MorningPlan;
  /** The stocks of this run, in the order chosen; runs of the old lessons have none (all the lesson's stocks). */
  codes?: string[];
  /** The published files the run started on; a run is refused against any other. */
  sourceHash?: string;
  bars: Record<string, Bar[]>;
  /** The lesson's real TAIEX up to the cursor, when the lesson has one; never stored. */
  index?: MorningIndexSeries;
  startingCash: number;
  cash: number;
  equity: number;
  positions: { code: string; shares: number; averageCost: number }[];
  orders: MorningOrder[];
  fills: MorningFill[];
  completed: boolean;
  /** Given up without a reflection: completed, but never counted for discipline. */
  abandoned?: boolean;
  reflection: string;
  nextAdvanceAt: number;
  /** When this run was created (ms); runs saved before 2026-10-17 have none. */
  startedAt?: number;
};
/** The recorded books of one stock in one revealed cell; `gaps` are its stretches with no known book (R7). */
export type MorningBookCell = {
  code: string;
  start: BookLevels | null;
  frames: [number, BookLevels][];
  gaps: [number, number][];
  sizes: boolean;
};
/** What one advance reveals: cell `cell` (the cursor minus one) of every stock of the run, and nothing after it. */
export type MorningDelta = {
  cell: number;
  /** null: the stock has not traded yet, so the cell has no bar. */
  bars: Record<string, Bar | null>;
  index: MorningIndexBar | null;
  /** Every real trade of the cell, by stock. */
  trades: Record<string, TradeRow[]>;
  book?: MorningBookCell;
};
/** The latest revealed trades of every stock of the run, for the trade list when a run is opened. */
export type MorningTape = Record<string, TradeRow[]>;
/**
 * What /api/morning answers. A snapshot (GET, and a start) carries the run's revealed bars, TAIEX and `tape`; a step
 * (advance, order, cancel, finish, abandon) carries the run without them (`state.bars` is `{}`, no `index`): the desk
 * keeps what it has and adds each advance's `delta`. Nothing in either is at or after the cursor.
 */
export type MorningResponse = {
  /** A run's stocks in the order chosen; with no run, the day's default 自選. `note` is the default's desk wording. */
  catalog: MorningCatalog;
  state: MorningState | null;
  /** GET only: the open lesson days, newest first. */
  lessons?: MorningLessonSummary[];
  /** Only on the request that finished the round; retries and other actions have none. */
  celebration?: Celebration | null;
  /** Advance only: the cell just revealed. */
  delta?: MorningDelta;
  /** Snapshots only: the last revealed trades of each stock of the run. */
  tape?: MorningTape;
  /** GET with no unfinished run shown: the day's stocks and default 自選 for a new run (a guest's never uses the list). */
  picker?: LessonPicker;
  /** GET only: the learner's latest 20 runs, newest first, the retired lessons' included. */
  records?: RunRecord[];
  /** GET of a run: the 主角股's recorded books in the last revealed cell, when the day has them. */
  book?: MorningDelta["book"];
  retired?: boolean;
};
/** The classroom has no daily lessons: none configured (on-prem) or none published yet. Nothing else is sent. */
export type MorningUnavailable = { unavailable: string };
export type MorningReply = MorningResponse | MorningUnavailable;
export type MorningAction =
  | { action: "start"; requestId: string; plan: MorningPlan; codes: string[]; guestTerms?: true }
  | { action: "advance"; requestId: string; id: string; expectedRevision: number; view?: string }
  | { action: "abandon"; requestId: string; id: string; expectedRevision: number }
  | {
      action: "order";
      requestId: string;
      id: string;
      expectedRevision: number;
      code: string;
      side: "buy" | "sell";
      lots: number;
      limitPrice?: number;
      entryMode?: "lightning";
    }
  | { action: "cancel"; requestId: string; id: string; expectedRevision: number; orderId: string }
  | {
      action: "finish";
      requestId: string;
      id: string;
      expectedRevision: number;
      reflection: string;
    };
