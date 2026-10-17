import type { PublishedDay } from "../market-days.server.ts";

/** Taipei is UTC+8 all year; never read the process time zone. */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A new question is issued each weekday at 06:00 Taipei time. */
export const ISSUE_MINUTES = 6 * 60;

export function taipeiParts(ms: number): { date: string; weekday: number; minutes: number } {
  const shifted = new Date(ms + TAIPEI_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

/** The weekday whose 06:00 issue is the latest one at `now`. */
export function issueDayFor(now: number): string {
  const today = taipeiParts(now);
  if (isWeekday(today.weekday) && today.minutes >= ISSUE_MINUTES) return today.date;
  for (let back = 1; back <= 7; back++) {
    const earlier = taipeiParts(now - back * DAY_MS);
    if (isWeekday(earlier.weekday)) return earlier.date;
  }
  return today.date;
}

/** The newest full-market data day before the issue day that was published by its 06:00. */
export function dataDayForIssue(days: readonly PublishedDay[], issueDay: string): string | null {
  const issueAt = Date.parse(`${issueDay}T06:00:00+08:00`);
  const eligible = days
    .filter((day) => day.coverage === "full-market" && day.date < issueDay && Date.parse(day.publishedAt) <= issueAt)
    .map((day) => day.date)
    .sort();
  return eligible.at(-1) ?? null;
}

/** Monday to Friday of the Taipei week containing `now` (Sunday belongs to the week before). */
export function weekDates(now: number): string[] {
  const today = taipeiParts(now);
  const sinceMonday = today.weekday === 0 ? 6 : today.weekday - 1;
  return Array.from({ length: 5 }, (_, index) => taipeiParts(now + (index - sinceMonday) * DAY_MS).date);
}
