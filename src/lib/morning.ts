import type { Bar } from "./game/types";
import type { Celebration } from "./discipline/score";

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
  symbols: { code: string; name: string; previousClose: number; previous5CloseMean: number }[];
  context: { label: string; value: string; asOf: string }[];
  strategy: string[];
  notices: string[];
  videoUrl: string | null;
  /** Present only when the source documents whole-share minute volume in lots (張). */
  volumeUnit?: "lot";
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
export type MorningLessonSummary = Pick<
  MorningCatalog,
  "lessonId" | "title" | "date" | "start" | "end" | "maxCursor"
> & {
  symbols: { code: string; name: string }[];
};
/** Public selection metadata only: no source bars or unrevealed market context. */
export function summarizeMorningLesson(catalog: MorningCatalog): MorningLessonSummary {
  return {
    lessonId: catalog.lessonId,
    title: catalog.title,
    date: catalog.date,
    start: catalog.start,
    end: catalog.end,
    maxCursor: catalog.maxCursor,
    symbols: catalog.symbols.map(({ code, name }) => ({ code, name })),
  };
}
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
};
export type MorningFill = {
  id: string;
  code: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  fee: number;
  tax: number;
  t: number;
};
export type MorningState = {
  id: string;
  lessonId: string;
  cursor: number;
  revision: number;
  plan: MorningPlan;
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
  reflection: string;
  nextAdvanceAt: number;
  /** When this run was created (ms); runs saved before 2026-10-17 have none. */
  startedAt?: number;
};
export type MorningResponse = {
  catalog: MorningCatalog;
  state: MorningState | null;
  lessons?: MorningLessonSummary[];
  /** Only on the request that finished the round; retries and other actions have none. */
  celebration?: Celebration | null;
};
export type MorningAction =
  | { action: "start"; requestId: string; plan: MorningPlan; guestTerms?: true }
  | { action: "advance"; requestId: string; id: string; expectedRevision: number }
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
