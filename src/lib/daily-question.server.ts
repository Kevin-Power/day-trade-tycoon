import type { Bar } from "./game/types.ts";
import type { Sql } from "./db.ts";
import { MorningError } from "./morning-engine.ts";
import { requirePracticeAccess } from "./morning-session.server.ts";
import { listPublishedDays, readDaySymbols, readSymbolBars, type PublishedDay } from "./market-days.server.ts";
import { densifyBars } from "./daily/bars.ts";
import { buildQuestion, poolSymbols } from "./daily/pick.ts";
import { dataDayForIssue, issueDayFor } from "./daily/schedule.ts";
import { dailyProgress, type DailyProgress } from "./daily/progress.ts";
import { dailyAnswerSchema, validateStop } from "./daily/answer.ts";
import { entryResult, type EntryResult } from "./daily/reveal.ts";
import type { DailyChoice, DailyOutcome, DailyQuestionPayload } from "./daily/types.ts";
import { celebrationAfterSave } from "./discipline/records.server.ts";
import type { Celebration } from "./discipline/score.ts";

export type DailyQuestionView = Omit<DailyQuestionPayload, "bars" | "outcome"> & { bars: Bar[]; issueDate: string };
export type DailyReveal = {
  bars: Bar[];
  outcome: DailyOutcome;
  entry: EntryResult | null;
  counts: { enter: number; watch: number; skip: number; total: number };
};
export type DailyAnswer = { choice: DailyChoice; stopPrice: number | null; reason: string | null };
export type DailyResponse = {
  question: DailyQuestionView | null;
  answer: DailyAnswer | null;
  reveal: DailyReveal | null;
  progress: DailyProgress;
  needsTerms: boolean;
  /** Only on the POST that saved the answer; a resend gets null. */
  celebration?: Celebration | null;
};
type Current = { id: string; issueDate: string; payload: DailyQuestionPayload };

const parsePayload = (value: unknown): DailyQuestionPayload =>
  (typeof value === "string" ? JSON.parse(value) : value) as DailyQuestionPayload;

/**
 * Loads the data day's pool (and the previous full-market day for 昨高) and picks the question.
 * Resolves to null only when the day was read and has no candidate; a day that cannot be read throws.
 */
async function generate(dir: string, days: readonly PublishedDay[], dataDay: string): Promise<DailyQuestionPayload | null> {
  const symbols = await readDaySymbols(dir, dataDay);
  if (!symbols) throw new Error("The data day's symbol list cannot be read");
  const pool = poolSymbols(symbols);
  const previousDay = days.filter((day) => day.coverage === "full-market" && day.date < dataDay).at(-1)?.date;
  // Without a readable previous day only intraday questions are made, as when there is none (spec §2).
  const previousSymbols = previousDay ? await readDaySymbols(dir, previousDay) : null;
  const bars = new Map<string, Bar[]>();
  const previous = new Map<string, { high: number; close: number }>();
  await Promise.all(
    pool.map(async (symbol) => {
      try {
        const rows = await readSymbolBars(dir, dataDay, symbol.code);
        if (rows?.length) bars.set(symbol.code, densifyBars(rows));
        const before = previousSymbols?.find((item) => item.code === symbol.code);
        if (previousDay && before) {
          const earlier = await readSymbolBars(dir, previousDay, symbol.code);
          if (earlier?.length) previous.set(symbol.code, { high: Math.max(...earlier.map((row) => row[2])), close: before.close });
        }
      } catch {
        // One bad symbol is skipped, not fatal for the day.
      }
    }),
  );
  if (pool.length && !bars.size) throw new Error("No bars file of the data day can be read");
  return buildQuestion({
    dataDate: dataDay,
    symbols: pool,
    barsOf: (code) => bars.get(code) ?? null,
    previousOf: (code) => previous.get(code) ?? null,
  });
}

/** A failed build is retried at most this often per issue day, so requests do not re-read every file. */
const RETRY_MS = 10 * 60_000;
/** Last failed build per data folder and issue day; in memory, so a restart retries at once. */
const failedAt = new Map<string, number>();

/** Issues the question on the first request after a weekday's 06:00, then returns the current one. */
export async function ensureCurrentQuestion(sql: Sql, dir: string, now: number): Promise<Current | null> {
  const issueDay = issueDayFor(now);
  // No data folder configured: keep serving questions already issued, never read a relative path.
  const days = dir ? await listPublishedDays(dir) : [];
  const dataDay = dataDayForIssue(days, issueDay);
  if (dataDay) {
    const existing = await sql<{ id: string }>`SELECT id FROM daily_questions WHERE id = ${dataDay}`;
    const key = `${dir}\n${issueDay}`;
    const failed = failedAt.get(key);
    if (!existing[0] && (failed === undefined || now - failed >= RETRY_MS)) {
      let payload: DailyQuestionPayload | null | undefined;
      try {
        payload = await generate(dir, days, dataDay);
        failedAt.delete(key);
      } catch {
        // Unreadable data or an error is not "no question that day": nothing is stored, the previous
        // question stays current, and a later request tries again.
        failedAt.set(key, now);
      }
      if (payload !== undefined)
        await sql`INSERT INTO daily_questions (id, issue_date, payload)
          VALUES (${dataDay}, ${payload ? issueDay : null}, ${payload ? JSON.stringify(payload) : null}::jsonb)
          ON CONFLICT DO NOTHING`;
    }
  }
  const rows = await sql<{ id: string; issue_date: string; payload: unknown }>`
    SELECT id, issue_date::text AS issue_date, payload FROM daily_questions
    WHERE payload IS NOT NULL AND issue_date IS NOT NULL AND issue_date <= ${issueDay}::date
    ORDER BY issue_date DESC LIMIT 1`;
  return rows[0] ? { id: rows[0].id, issueDate: rows[0].issue_date, payload: parsePayload(rows[0].payload) } : null;
}

function view(current: Current): DailyQuestionView {
  const { bars, outcome: _outcome, ...question } = current.payload;
  return { ...question, bars: bars.filter((bar) => bar.t <= question.questionT), issueDate: current.issueDate };
}

async function reveal(sql: Sql, current: Current, answer: DailyAnswer | null): Promise<DailyReveal> {
  const rows = await sql<{ choice: DailyChoice; count: number }>`
    SELECT choice, count(*)::int AS count FROM daily_answers WHERE question_id = ${current.id} GROUP BY choice`;
  const counts = { enter: 0, watch: 0, skip: 0, total: 0 };
  for (const row of rows) {
    counts[row.choice] = Number(row.count);
    counts.total += Number(row.count);
  }
  const entry = answer?.choice === "enter" && answer.stopPrice !== null ? entryResult(current.payload, answer.stopPrice) : null;
  return { bars: current.payload.bars, outcome: current.payload.outcome, entry, counts };
}

async function answersOf(sql: Sql, userId: string) {
  return sql<{ question_id: string; issue_date: string | null; choice: DailyChoice; stop_price: string | number | null; reason: string | null }>`
    SELECT a.question_id, q.issue_date::text AS issue_date, a.choice, a.stop_price, a.reason
    FROM daily_answers a JOIN daily_questions q ON q.id = a.question_id WHERE a.user_id = ${userId}`;
}

export async function loadDaily(
  sql: Sql,
  userId: string,
  dir: string,
  now: number,
  options: { teacherReveal?: boolean } = {},
): Promise<DailyResponse> {
  const access = await requirePracticeAccess(sql, userId);
  const current = await ensureCurrentQuestion(sql, dir, now);
  const answers = await answersOf(sql, userId);
  const issued = await sql<{ issue_date: string }>`
    SELECT issue_date::text AS issue_date FROM daily_questions
    WHERE payload IS NOT NULL AND issue_date IS NOT NULL AND issue_date <= ${issueDayFor(now)}::date ORDER BY issue_date`;
  const progress = dailyProgress({
    issued: issued.map((row) => row.issue_date),
    answered: new Set(answers.flatMap((row) => (row.issue_date ? [row.issue_date] : []))),
    currentIssue: current?.issueDate ?? null,
    now,
  });
  const needsTerms = access.kind === "guest" && !access.consented;
  if (!current) return { question: null, answer: null, reveal: null, progress, needsTerms };
  const mine = answers.find((row) => row.question_id === current.id);
  const answer: DailyAnswer | null = mine
    ? { choice: mine.choice, stopPrice: mine.stop_price === null ? null : Number(mine.stop_price), reason: mine.reason }
    : null;
  return {
    question: view(current),
    answer,
    reveal: answer || options.teacherReveal ? await reveal(sql, current, answer) : null,
    progress,
    needsTerms,
  };
}

/** One answer per learner per question; a resend returns the first answer unchanged. */
export async function answerDaily(sql: Sql, userId: string, input: unknown, dir: string, now: number): Promise<DailyResponse> {
  const parsed = dailyAnswerSchema.safeParse(input);
  if (!parsed.success) throw new MorningError(400, "請確認作答內容");
  const body = parsed.data;
  const access = await requirePracticeAccess(sql, userId);
  const current = await ensureCurrentQuestion(sql, dir, now);
  if (!current || current.id !== body.questionId) throw new MorningError(409, "題目已更新，請重新載入");
  const existing = await sql<{ choice: string }>`
    SELECT choice FROM daily_answers WHERE user_id = ${userId} AND question_id = ${current.id}`;
  if (existing[0]) return { ...(await loadDaily(sql, userId, dir, now)), celebration: null };
  if (access.kind === "member" && body.guestTerms) throw new MorningError(400, "這個帳號不需要訪客聲明");
  if (access.kind === "guest" && !access.consented) {
    if (!body.guestTerms) throw new MorningError(403, "請先確認教學聲明");
    await sql`INSERT INTO guest_consents (user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  }
  const problem = validateStop(current.payload, body.choice, body.stopPrice);
  if (problem) throw new MorningError(400, problem);
  const inserted = await sql<{ question_id: string }>`INSERT INTO daily_answers (user_id, question_id, choice, stop_price, reason)
    VALUES (${userId}, ${current.id}, ${body.choice}, ${body.stopPrice ?? null}, ${body.reason ?? null})
    ON CONFLICT (user_id, question_id) DO NOTHING RETURNING question_id`;
  const response = await loadDaily(sql, userId, dir, now);
  if (!inserted.length) return { ...response, celebration: null };
  return { ...response, celebration: await celebrationAfterSave(sql, userId, now, { daily: current.id }) };
}

/** Teacher card: the current question, its reveal, the class list and how many guests answered. */
export async function dailyTeacherView(sql: Sql, classCode: string, dir: string, now: number) {
  const current = await ensureCurrentQuestion(sql, dir, now);
  if (!current) return { question: null, reveal: null, rows: [], guests: 0 };
  const rows = await sql<{ name: string; choice: DailyChoice | null; stop_price: string | number | null; reason: string | null; answered_at: string | null }>`
    SELECT p.display_name AS name, a.choice, a.stop_price, a.reason,
      to_char(a.answered_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') AS answered_at
    FROM classroom_profiles p
    LEFT JOIN daily_answers a ON a.user_id = p.user_id AND a.question_id = ${current.id}
    WHERE p.class_code = ${classCode} AND p.role <> 'teacher'
    ORDER BY p.display_name`;
  const guests = await sql<{ count: number }>`
    SELECT count(*)::int AS count FROM daily_answers a JOIN "user" u ON u.id = a.user_id
    WHERE a.question_id = ${current.id} AND u."isAnonymous"`;
  return {
    question: view(current),
    reveal: await reveal(sql, current, null),
    rows: rows.map((row) => ({
      name: row.name,
      choice: row.choice,
      stopPrice: row.stop_price === null ? null : Number(row.stop_price),
      reason: row.reason,
      answeredAt: row.answered_at,
    })),
    guests: Number(guests[0]?.count ?? 0),
  };
}
