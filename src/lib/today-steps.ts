import type { MorningState } from "./morning.ts";

export type StepState = "done" | "now" | "todo";
export type TodayAction = "start" | "continue" | "review" | "again";
/** 10:00, the practice checkpoint where the desk invites the learner to write the review. */
export const REVIEW_CURSOR = 60;
export const TODAY_STEP_LABELS = ["選一個計畫", "模擬練習", "寫復盤"] as const;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export function taipeiDate(ms: number): string {
  return new Date(ms + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Lobby progress for today (Taipei date) from the latest run of the default lesson. */
export function todaySteps(
  state: Pick<MorningState, "startedAt" | "completed" | "cursor"> | null,
  maxCursor: number,
  now: number,
): { steps: [StepState, StepState, StepState]; action: TodayAction } {
  if (!state?.startedAt || taipeiDate(state.startedAt) !== taipeiDate(now))
    return { steps: ["now", "todo", "todo"], action: "start" };
  if (state.completed) return { steps: ["done", "done", "done"], action: "again" };
  if (state.cursor >= REVIEW_CURSOR || state.cursor >= maxCursor)
    return { steps: ["done", "done", "now"], action: "review" };
  return { steps: ["done", "now", "todo"], action: "continue" };
}
