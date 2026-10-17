import type { Bar } from "../game/types.ts";

export type DailyKind = "intraday-high" | "previous-high";
export type DailyChoice = "enter" | "watch" | "skip";
export type DailyOutcome = {
  /** A later confirmed high above the level (the chart's rule), not a single poke. */
  higherHigh: boolean;
  higherHighT: number | null;
  /** First later bar whose high is above the level. */
  firstBreakT: number | null;
  firstBreakPrice: number | null;
  maxAfter: number;
  close: number;
};
export type DailyQuestionPayload = {
  dataDate: string;
  code: string;
  name: string;
  kind: DailyKind;
  level: number;
  levelT: number | null;
  questionT: number;
  referencePrice: number;
  pullbackLow: number;
  stops: { pullback: number; belowLevel: number };
  /** The whole day; server only. */
  bars: Bar[];
  /** Server only until the learner answers. */
  outcome: DailyOutcome;
};
export type DailyCandidate = Omit<DailyQuestionPayload, "dataDate"> & { tradeValue: number; pullbackPct: number };
