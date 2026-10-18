import { weekDates } from "../daily/schedule.ts";
import type { DailyChoice } from "../daily/types.ts";

/**
 * Discipline points (spec docs/superpowers/specs/2026-10-18-discipline-levels-design.md). Everything is
 * recomputed from saved answers and finished rounds, so points never depend on profit and never go down.
 */
/**
 * `brokeOut` is null when the saved question has no readable outcome: the answer counts, the read does not.
 * `at` is when the learner answered (ms).
 */
export type DailyRecord = { questionId: string; issueDate: string; choice: DailyChoice; reason: boolean; brokeOut: boolean | null; at: number };
/** One finished round; `day` is the Taipei date the round was started, `at` when it was last saved (ms). */
export type PracticeRecord = { id: string; day: string; reflection: boolean; onPlan: boolean; flat: boolean; at: number };
export type DisciplineInput = { daily: DailyRecord[]; practice: PracticeRecord[]; issued: string[]; now: number };

export type ScoreLineId = "answered" | "reason" | "eye" | "completed" | "on-plan" | "flat";
export type ScoreLine = { id: ScoreLineId; label: string; points: number; kind: "discipline" | "eye" };
export type ScoreEvent = { key: string; source: "daily" | "practice"; date: string; points: number; lines: ScoreLine[] };
export type LevelView = { no: number; title: string; min: number; next: { no: number; title: string; min: number } | null };
export type BadgeId = "first-daily" | "first-practice" | "streak-5" | "full-week" | "reasons-10" | "practice-5" | "daily-20" | "practice-20";
export type BadgeView = { id: BadgeId; title: string; rule: string; earned: boolean; earnedOn: string | null; have: number; need: number };
export type DisciplineSummary = { total: number; discipline: number; eye: number; level: LevelView; badges: BadgeView[]; recent: ScoreEvent[] };
export type Celebration = {
  source: "daily" | "practice";
  gained: ScoreLine[];
  points: number;
  beforeTotal: number;
  total: number;
  before: LevelView;
  after: LevelView;
  newBadges: BadgeView[];
  /** A finished round on a day whose practice points were already counted. */
  alreadyCounted: boolean;
};

const LINES: Record<ScoreLineId, ScoreLine> = {
  answered: { id: "answered", label: "完成作答", points: 10, kind: "discipline" },
  reason: { id: "reason", label: "說出理由", points: 5, kind: "discipline" },
  eye: { id: "eye", label: "眼力：判讀和走勢一致", points: 3, kind: "eye" },
  completed: { id: "completed", label: "完成一輪並復盤", points: 15, kind: "discipline" },
  "on-plan": { id: "on-plan", label: "照計畫的股票", points: 5, kind: "discipline" },
  flat: { id: "flat", label: "收盤前不留倉", points: 5, kind: "discipline" },
};

export const LEVELS = [
  { no: 1, title: "新手學員", min: 0, cheer: "歡迎加入，先從每天一題開始。" },
  { no: 2, title: "準時報到", min: 25, cheer: "今天有來練習，這就是最好的開始。" },
  { no: 3, title: "有計畫", min: 80, cheer: "先寫計畫再下單，你已經比多數人穩。" },
  { no: 4, title: "停損守門員", min: 160, cheer: "每一筆都先想好停損，這就是守門員。" },
  { no: 5, title: "紀律學員", min: 280, cheer: "照計畫做，不追不怕，紀律慢慢成形。" },
  { no: 6, title: "穩健操盤", min: 450, cheer: "不急著賺，先求穩，你做到了。" },
  { no: 7, title: "冷靜判讀", min: 680, cheer: "看清楚再出手，判讀越來越冷靜。" },
  { no: 8, title: "紀律高手", min: 980, cheer: "紀律已經變成習慣，繼續保持。" },
  { no: 9, title: "盤感老手", min: 1350, cheer: "練了這麼多天，盤感是累積出來的。" },
  { no: 10, title: "紀律大師", min: 1800, cheer: "你用每天的紀律走到這裡，值得驕傲。" },
] as const;

const BADGES: readonly { id: BadgeId; title: string; rule: string; need: number }[] = [
  { id: "first-daily", title: "第一題", rule: "第一次完成每日一題", need: 1 },
  { id: "first-practice", title: "第一輪", rule: "第一次完成模擬練習並復盤", need: 1 },
  { id: "streak-5", title: "連續 5 天", rule: "每日一題連續完成 5 題", need: 5 },
  { id: "full-week", title: "全勤一週", rule: "一週發出的題目全部完成", need: 5 },
  { id: "reasons-10", title: "說出理由 10 次", rule: "10 題有選理由", need: 10 },
  { id: "practice-5", title: "練習 5 天", rule: "在 5 個不同的日子完成練習", need: 5 },
  { id: "daily-20", title: "每日一題 20 題", rule: "完成 20 題每日一題", need: 20 },
  { id: "practice-20", title: "練習 20 天", rule: "在 20 個不同的日子完成練習", need: 20 },
];

export function levelFor(total: number): LevelView {
  let index = 0;
  while (index + 1 < LEVELS.length && total >= LEVELS[index + 1]!.min) index++;
  const level = LEVELS[index]!;
  const next = LEVELS[index + 1];
  return { no: level.no, title: level.title, min: level.min, next: next ? { no: next.no, title: next.title, min: next.min } : null };
}

/** The read matches the reveal's lesson: enter on a breakout, watch or skip when there was none. */
export function dailyLines(record: DailyRecord): ScoreLine[] {
  const read = record.brokeOut === null ? false : record.brokeOut ? record.choice === "enter" : record.choice !== "enter";
  return [LINES.answered, ...(record.reason ? [LINES.reason] : []), ...(read ? [LINES.eye] : [])];
}

/** No orders counts as on plan and flat: not trading when the setup never came is discipline too. */
export function practiceLines(record: PracticeRecord): ScoreLine[] {
  if (!record.reflection) return [];
  return [LINES.completed, ...(record.onPlan ? [LINES["on-plan"]] : []), ...(record.flat ? [LINES.flat] : [])];
}

const total = (lines: readonly ScoreLine[]) => lines.reduce((sum, line) => sum + line.points, 0);

function events(input: DisciplineInput): ScoreEvent[] {
  const daily = input.daily.map((record): ScoreEvent => {
    const lines = dailyLines(record);
    return { key: `daily:${record.questionId}`, source: "daily", date: record.issueDate, points: total(lines), lines };
  });
  const bestByDay = new Map<string, ScoreEvent>();
  for (const record of input.practice) {
    const lines = practiceLines(record);
    if (!lines.length) continue;
    const event: ScoreEvent = { key: `practice:${record.day}`, source: "practice", date: record.day, points: total(lines), lines };
    const best = bestByDay.get(record.day);
    if (!best || event.points > best.points) bestByDay.set(record.day, event);
  }
  return [...daily, ...bestByDay.values()];
}

const DAY_MS = 86_400_000;
function mondayOf(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const weekday = new Date(ms).getUTCDay();
  return new Date(ms - (weekday === 0 ? 6 : weekday - 1) * DAY_MS).toISOString().slice(0, 10);
}

function badgeViews(input: DisciplineInput, practiceDays: string[]): BadgeView[] {
  const answers = [...input.daily].sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  const answered = new Set(answers.map((record) => record.issueDate));
  const issued = [...new Set([...input.issued, ...answered])].sort();
  const reasons = answers.filter((record) => record.reason);

  let run = 0;
  let longest = 0;
  let streakOn: string | null = null;
  for (const date of issued) {
    run = answered.has(date) ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (run === 5 && !streakOn) streakOn = date;
  }

  // A week's questions are final once the next week has started; a five-question week is complete at once.
  const thisMonday = weekDates(input.now)[0]!;
  const weeks = new Map<string, string[]>();
  for (const date of issued) weeks.set(mondayOf(date), [...(weeks.get(mondayOf(date)) ?? []), date]);
  let bestWeek = 0;
  let weekOn: string | null = null;
  for (const [monday, dates] of [...weeks].sort(([a], [b]) => a.localeCompare(b))) {
    const done = dates.filter((date) => answered.has(date)).length;
    bestWeek = Math.max(bestWeek, done);
    if (!weekOn && done === dates.length && (dates.length === 5 || monday < thisMonday)) weekOn = dates.at(-1)!;
  }

  const nth = (dates: readonly string[], need: number) => dates[need - 1] ?? null;
  const facts: Record<BadgeId, { have: number; on: string | null }> = {
    "first-daily": { have: answers.length, on: nth(answers.map((record) => record.issueDate), 1) },
    "first-practice": { have: practiceDays.length, on: nth(practiceDays, 1) },
    "streak-5": { have: longest, on: streakOn },
    "full-week": { have: bestWeek, on: weekOn },
    "reasons-10": { have: reasons.length, on: nth(reasons.map((record) => record.issueDate), 10) },
    "practice-5": { have: practiceDays.length, on: nth(practiceDays, 5) },
    "daily-20": { have: answers.length, on: nth(answers.map((record) => record.issueDate), 20) },
    "practice-20": { have: practiceDays.length, on: nth(practiceDays, 20) },
  };
  return BADGES.map(({ id, title, rule, need }) => {
    const { have, on } = facts[id];
    return { id, title, rule, need, have: Math.min(have, need), earned: on !== null, earnedOn: on };
  });
}

export function disciplineSummary(input: DisciplineInput): DisciplineSummary {
  const all = events(input);
  const lines = all.flatMap((event) => event.lines);
  const sum = total(lines);
  const practiceDays = all.filter((event) => event.source === "practice").map((event) => event.date).sort();
  const recent = [...all]
    .sort((a, b) => b.date.localeCompare(a.date) || (a.source === b.source ? 0 : a.source === "daily" ? -1 : 1))
    .slice(0, 10);
  return {
    total: sum,
    discipline: total(lines.filter((line) => line.kind === "discipline")),
    eye: total(lines.filter((line) => line.kind === "eye")),
    level: levelFor(sum),
    badges: badgeViews(input, practiceDays),
    recent,
  };
}

/**
 * When the learner last answered or saved a round (capped at `now`). A badge that time alone completed
 * since then, like a holiday week ending, was not there when they last acted, so it is still new.
 */
function lastActive(input: DisciplineInput): number {
  const times = [...input.daily, ...input.practice].map((record) => record.at).filter(Number.isFinite);
  return times.length ? Math.min(input.now, Math.max(...times)) : input.now;
}

/** What the answer or round just saved added: the summary with it minus the summary without it. */
export function celebrationFor(before: DisciplineInput, after: DisciplineInput, source: "daily" | "practice"): Celebration {
  const was = disciplineSummary({ ...before, now: lastActive(before) });
  const now = disciplineSummary(after);
  const previous = new Map(events(before).map((event) => [event.key, event]));
  const gained = events(after)
    .filter((event) => event.source === source && event.points > (previous.get(event.key)?.points ?? 0))
    .flatMap((event) => {
      const had = new Set(previous.get(event.key)?.lines.map((line) => line.id));
      return event.lines.filter((line) => !had.has(line.id));
    });
  const points = now.total - was.total;
  const earned = new Set(was.badges.filter((item) => item.earned).map((item) => item.id));
  return {
    source,
    gained,
    points,
    beforeTotal: was.total,
    total: now.total,
    before: was.level,
    after: now.level,
    newBadges: now.badges.filter((item) => item.earned && !earned.has(item.id)),
    alreadyCounted: source === "practice" && points === 0,
  };
}
