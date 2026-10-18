import { createHash, randomUUID } from "node:crypto";
import { applyMorningAction, createMorningState, MorningError, parseMorningAction, visibleMorningState,
  type MorningSource, type MorningStoredState } from "./morning-engine.ts";
import type { Sql } from "./db.ts";
import { summarizeMorningLesson, type MorningLessonSummary, type MorningResponse } from "./morning.ts";
import { celebrationAfterSave } from "./discipline/records.server.ts";
import type { Celebration } from "./discipline/score.ts";

type SessionRow = { id: string; state_json: MorningStoredState | string };
function stored(row: SessionRow): MorningStoredState {
  return typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json;
}
export type PracticeAccess = { kind: "member" } | { kind: "guest"; consented: boolean };
/**
 * Members need an accepted classroom profile; guests (anonymous accounts) never get one and
 * accept the teaching statement by pressing start. The row lock serializes concurrent starts
 * and keeps request idempotency per owner.
 */
export async function requirePracticeAccess(sql: Sql, userId: string): Promise<PracticeAccess> {
  const profile = await sql<{ tos_accepted_at: unknown }>`
    SELECT tos_accepted_at FROM classroom_profiles WHERE user_id = ${userId} FOR UPDATE`;
  if (profile[0]?.tos_accepted_at) return { kind: "member" };
  const user = await sql<{ isAnonymous: boolean }>`SELECT "isAnonymous" FROM "user" WHERE id = ${userId} FOR UPDATE`;
  if (!user[0]?.isAnonymous) throw new MorningError(403, "請先完成學員資料與教學聲明");
  const consent = await sql<{ user_id: string }>`SELECT user_id FROM guest_consents WHERE user_id = ${userId}`;
  return { kind: "guest", consented: consent.length > 0 };
}
function response(state: MorningStoredState | null, source: MorningSource, lessons?: readonly MorningLessonSummary[]): MorningResponse {
  return { catalog: source.catalog, state: state ? visibleMorningState(state, source) : null,
    lessons: lessons ? structuredClone([...lessons]) : [summarizeMorningLesson(source.catalog)] };
}
/** Always use a transaction-bound SQL handle and the user ID from the verified cookie session. */
export async function loadMorningSession(sql: Sql, userId: string, source: MorningSource, lessons?: readonly MorningLessonSummary[]): Promise<MorningResponse> {
  await requirePracticeAccess(sql, userId);
  const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
    WHERE user_id = ${userId} AND lesson_id = ${source.catalog.lessonId}
    ORDER BY created_at DESC, id DESC LIMIT 1`;
  return response(rows[0] ? stored(rows[0]) : null, source, lessons);
}
/** Durable exactly-once mutation; retries return this run's current, already revealed state. */
export async function mutateMorningSession(sql: Sql, userId: string, input: unknown, source: MorningSource, clock: number | (() => number) = Date.now, lessons?: readonly MorningLessonSummary[]): Promise<MorningResponse> {
  const action = parseMorningAction(input);
  const access = await requirePracticeAccess(sql, userId);
  const acceptsTerms = action.action === "start" && action.guestTerms === true;
  if (access.kind === "member" && acceptsTerms) throw new MorningError(400, "這個帳號不需要訪客聲明");
  if (access.kind === "guest" && !access.consented) {
    if (!acceptsTerms) throw new MorningError(403, "請先確認教學聲明");
    await sql`INSERT INTO guest_consents (user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  }
  // Read the clock after acquiring the owner lock: queued requests cannot reuse stale elapsed time.
  const now = typeof clock === "function" ? clock() : clock;
  const hash = createHash("sha256").update(source.catalog.lessonId + "\n" + JSON.stringify(action)).digest("hex");
  const previous = await sql<{ action_hash: string; session_id: string }>`
    SELECT action_hash, session_id FROM morning_requests WHERE user_id = ${userId} AND request_id = ${action.requestId}::uuid`;
  if (previous[0]) {
    if (previous[0].action_hash !== hash) throw new MorningError(409, "這個操作編號已用於不同內容，請重新讀取練習");
    const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions WHERE id = ${previous[0].session_id}::uuid
      AND user_id = ${userId} AND lesson_id = ${source.catalog.lessonId} FOR UPDATE`;
    if (!rows[0]) throw new MorningError(404, "找不到這份練習");
    return response(stored(rows[0]), source, lessons);
  }
  let state: MorningStoredState;
  let celebration: Celebration | null = null;
  if (action.action === "start") {
    const active = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
      WHERE user_id = ${userId} AND lesson_id = ${source.catalog.lessonId} AND completed = FALSE FOR UPDATE`;
    if (active[0]) state = stored(active[0]);
    else {
      state = createMorningState(randomUUID(), action.plan, source, now);
      await sql`INSERT INTO morning_sessions (id, user_id, lesson_id, state_json)
        VALUES (${state.id}::uuid, ${userId}, ${state.lessonId}, ${JSON.stringify(state)}::jsonb)`;
    }
  } else {
    const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
      WHERE id = ${action.id}::uuid AND user_id = ${userId} AND lesson_id = ${source.catalog.lessonId} FOR UPDATE`;
    if (!rows[0]) throw new MorningError(404, "找不到這份練習");
    const previous = stored(rows[0]);
    state = applyMorningAction(previous, action, source, now);
    await sql`UPDATE morning_sessions SET state_json = ${JSON.stringify(state)}::jsonb,
      completed = ${state.completed}, updated_at = NOW() WHERE id = ${state.id}::uuid AND user_id = ${userId}`;
    // The engine refuses a finished run, so a finish that gets here completes it exactly once.
    if (action.action === "finish" && !previous.completed && state.completed)
      celebration = await celebrationAfterSave(sql, userId, now, { practice: state.id });
  }
  const counts = await sql<{ count: number }>`SELECT count(*)::int AS count FROM morning_requests WHERE session_id = ${state.id}::uuid`;
  if (counts[0].count >= 1_000) throw new MorningError(429, "本次練習操作次數已達上限，請聯絡講師");
  await sql`INSERT INTO morning_requests (user_id, request_id, session_id, action_hash)
    VALUES (${userId}, ${action.requestId}::uuid, ${state.id}::uuid, ${hash})`;
  return celebration ? { ...response(state, source, lessons), celebration } : response(state, source, lessons);
}
