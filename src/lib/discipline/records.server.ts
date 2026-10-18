import type { Sql } from "../db.ts";
import { brokeOut } from "../daily/reveal.ts";
import { issueDayFor } from "../daily/schedule.ts";
import type { DailyChoice, DailyOutcome } from "../daily/types.ts";
import { celebrationFor, type Celebration, type DisciplineInput } from "./score.ts";

function json<T>(value: T | string | null): T | null {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** A saved question without a usable level or outcome still counts the answer, just not the read. */
function readOf(outcome: DailyOutcome | string | null, level: number | string | null): boolean | null {
  const parsed = json(outcome);
  const price = Number(json(level));
  if (!parsed || typeof parsed !== "object" || !Number.isFinite(price) || price <= 0) return null;
  try {
    return brokeOut(parsed, price);
  } catch {
    return null;
  }
}

/**
 * The learner's saved answers and finished rounds, reduced to what scoring needs. Only the question's
 * level and outcome are read, never its bars; only finished rounds count.
 */
export async function readDisciplineInput(sql: Sql, userId: string, now: number): Promise<DisciplineInput> {
  const answers = await sql<{
    question_id: string; issue_date: string; choice: DailyChoice; reason: boolean;
    level: number | string | null; outcome: DailyOutcome | string | null;
  }>`
    SELECT a.question_id, q.issue_date::text AS issue_date, a.choice, a.reason IS NOT NULL AS reason,
      q.payload->'level' AS level, q.payload->'outcome' AS outcome
    FROM daily_answers a JOIN daily_questions q ON q.id = a.question_id
    WHERE a.user_id = ${userId} AND q.issue_date IS NOT NULL AND q.payload IS NOT NULL`;
  const issued = await sql<{ issue_date: string }>`
    SELECT issue_date::text AS issue_date FROM daily_questions
    WHERE payload IS NOT NULL AND issue_date IS NOT NULL AND issue_date <= ${issueDayFor(now)}::date ORDER BY issue_date`;
  const rounds = await sql<{
    id: string; day: string; focus: string | null; reflection: string | null;
    orders: { code?: string }[] | string | null; positions: { shares?: number }[] | string | null;
  }>`
    SELECT id::text AS id, to_char(created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS day,
      state_json->'plan'->>'focusCode' AS focus, state_json->>'reflection' AS reflection,
      state_json->'orders' AS orders, state_json->'positions' AS positions
    FROM morning_sessions WHERE user_id = ${userId} AND completed`;
  return {
    daily: answers.map((row) => ({
      questionId: row.question_id,
      issueDate: row.issue_date,
      choice: row.choice,
      reason: row.reason,
      brokeOut: readOf(row.outcome, row.level),
    })),
    issued: issued.map((row) => row.issue_date),
    practice: rounds.map((row) => {
      const orders = json(row.orders);
      const positions = json(row.positions);
      return {
        id: row.id,
        day: row.day,
        reflection: Boolean(row.reflection?.trim()),
        onPlan: (Array.isArray(orders) ? orders : []).every((order) => order.code === row.focus),
        flat: (Array.isArray(positions) ? positions : []).every((position) => !position.shares),
      };
    }),
    now,
  };
}

/**
 * Right after one answer or round was saved: read the records once and compare them with and without
 * it. The celebration is a nicety, so any problem yields null and never fails the save.
 */
export async function celebrationAfterSave(
  sql: Sql,
  userId: string,
  now: number,
  saved: { daily: string } | { practice: string },
): Promise<Celebration | null> {
  try {
    const after = await readDisciplineInput(sql, userId, now);
    if ("daily" in saved)
      return celebrationFor({ ...after, daily: after.daily.filter((record) => record.questionId !== saved.daily) }, after, "daily");
    return celebrationFor({ ...after, practice: after.practice.filter((record) => record.id !== saved.practice) }, after, "practice");
  } catch {
    return null;
  }
}
