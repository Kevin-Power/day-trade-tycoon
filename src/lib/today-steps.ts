import { MORNING_CELLS } from "./lessons/trades.ts";
import type { MorningState } from "./morning.ts";

export type StepState = "done" | "now" | "todo";
export type TodayAction = "start" | "continue" | "review" | "again";
/** 10:00, the practice checkpoint where the desk invites the learner to write the review. */
export const REVIEW_CURSOR = 60;
export const TODAY_STEP_LABELS = ["選一個計畫", "模擬練習", "寫復盤"] as const;
export const TODAY_ACTION_LABELS: Record<TodayAction, string> = {
  start: "開始今天的練習",
  continue: "繼續練習",
  review: "寫復盤",
  again: "再練一輪",
};

/**
 * What the lobby card shows. `action` null means nothing to press: the classroom has no daily lessons, and `note` is
 * the server's sentence for it (shown where the button would be).
 */
export type TodayView = {
  steps: [StepState, StepState, StepState];
  action: TodayAction | null;
  note: string | null;
};
/** Before the read arrives, or when it fails: the practice page shows the real state. */
export const TODAY_START: TodayView = { steps: ["now", "todo", "todo"], action: "start", note: null };

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export function taipeiDate(ms: number): string {
  return new Date(ms + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Lobby progress from the latest run of the default lesson. An unfinished run is always continued
 * (the server keeps one open run per lesson); a finished one counts only on its own Taipei day.
 */
export function todaySteps(
  state: Pick<MorningState, "startedAt" | "completed" | "cursor"> | null,
  maxCursor: number,
  now: number,
): { steps: [StepState, StepState, StepState]; action: TodayAction } {
  if (state && !state.completed) {
    if (state.cursor >= REVIEW_CURSOR || state.cursor >= maxCursor)
      return { steps: ["done", "done", "now"], action: "review" };
    return { steps: ["done", "now", "todo"], action: "continue" };
  }
  if (state?.startedAt && taipeiDate(state.startedAt) === taipeiDate(now))
    return { steps: ["done", "done", "done"], action: "again" };
  return { steps: ["now", "todo", "todo"], action: "start" };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The newest open lesson day, which is the day the card's own link opens: the day list first, else the picker's day. */
function newestLessonDate(reply: Record<string, unknown>): string | null {
  const first: unknown = Array.isArray(reply.lessons) ? reply.lessons[0] : undefined;
  if (isRecord(first) && typeof first.date === "string") return first.date;
  return isRecord(reply.picker) && typeof reply.picker.date === "string" ? reply.picker.date : null;
}

/**
 * Whether the learner has finished a run (kept, not given up) of the newest lesson. The records carry the lesson day
 * but not when the run began, so "today" is the lesson the card opens (a day of daily lessons is one lesson); a run of
 * an older day, an old lesson's run, an unfinished or an abandoned one does not count.
 */
function finishedNewest(reply: Record<string, unknown>): boolean {
  const newest = newestLessonDate(reply);
  if (newest === null || !Array.isArray(reply.records)) return false;
  return reply.records.some(
    (record: unknown) =>
      isRecord(record) &&
      record.date === newest &&
      record.completed === true &&
      record.abandoned === false &&
      record.retired === false,
  );
}

/**
 * The card's view of a bare `GET /api/morning` (no lesson in the URL): the open run when there is one, else the newest
 * day's picker with the learner's records, or `{ unavailable }` when the classroom has no daily lessons. Only the
 * run's `cursor`, `completed` and `startedAt`, the day list or picker's date and the records are read: no catalog.
 * null: not a reply the card understands, so what it shows stays.
 */
export function todayFromReply(reply: unknown, now: number): TodayView | null {
  if (!isRecord(reply)) return null;
  if ("unavailable" in reply)
    return typeof reply.unavailable === "string" && reply.unavailable
      ? { steps: ["todo", "todo", "todo"], action: null, note: reply.unavailable }
      : null;
  if (!("state" in reply)) return null;
  let run: Pick<MorningState, "startedAt" | "completed" | "cursor"> | null = null;
  if (reply.state !== null) {
    const state = reply.state;
    if (!isRecord(state) || typeof state.cursor !== "number" || typeof state.completed !== "boolean") return null;
    run = {
      cursor: state.cursor,
      completed: state.completed,
      ...(typeof state.startedAt === "number" ? { startedAt: state.startedAt } : {}),
    };
  }
  // Every daily lesson has MORNING_CELLS cells, so the catalog's maxCursor is not needed.
  const view = todaySteps(run, MORNING_CELLS, now);
  // A finished round leaves no state on a bare GET (it opens the newest day's picker), so it is read from the records.
  if (view.action === "start" && finishedNewest(reply))
    return { steps: ["done", "done", "done"], action: "again", note: null };
  return { ...view, note: null };
}

/** Starting fresh asks the practice page for a new plan instead of showing an old finished round. */
export function todayLink(action: TodayAction): { panel: "trade"; new?: "1" } {
  return action === "start" || action === "again" ? { panel: "trade", new: "1" } : { panel: "trade" };
}
