import { ISSUE_MINUTES, taipeiParts, weekDates } from "./schedule.ts";

export type WeekDot = { date: string; state: "done" | "missed" | "todo" | "off" };
export type DailyProgress = { streak: number; week: { done: number; total: number; days: WeekDot[] } };

/**
 * Streak: consecutive issued questions answered, counted back from the newest; an unanswered newest
 * question (still open) does not break it. Week: issued questions by issue day; weekdays that had no
 * question are "off" and leave the total (so a holiday week counts out of four).
 */
export function dailyProgress(input: {
  issued: readonly string[];
  answered: ReadonlySet<string>;
  currentIssue: string | null;
  now: number;
}): DailyProgress {
  let index = input.issued.length - 1;
  if (index >= 0 && !input.answered.has(input.issued[index]!)) index--;
  let streak = 0;
  for (; index >= 0 && input.answered.has(input.issued[index]!); index--) streak++;

  const today = taipeiParts(input.now);
  const issued = new Set(input.issued);
  const days: WeekDot[] = weekDates(input.now).map((date) => {
    if (issued.has(date))
      return { date, state: input.answered.has(date) ? "done" : date === input.currentIssue ? "todo" : "missed" };
    if (date > today.date || (date === today.date && today.minutes < ISSUE_MINUTES)) return { date, state: "todo" };
    return { date, state: "off" };
  });
  return {
    streak,
    week: {
      done: days.filter((day) => day.state === "done").length,
      total: 5 - days.filter((day) => day.state === "off").length,
      days,
    },
  };
}
