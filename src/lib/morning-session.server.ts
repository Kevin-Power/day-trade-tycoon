import { createHash, randomUUID } from "node:crypto";
import { applyMorningAction, createMorningState, MorningError, parseMorningAction, visibleMorningState,
  type MorningSource, type MorningStoredState } from "./morning-engine.ts";
import type { Sql } from "./db.ts";
import type { MorningResponse } from "./morning.ts";

type SessionRow = { id: string; state_json: MorningStoredState | string };
function stored(row: SessionRow): MorningStoredState {
  return typeof row.state_json === "string" ? JSON.parse(row.state_json) : row.state_json;
}
async function requireProfile(sql: Sql, userId: string): Promise<void> {
  // Serializing by real profile also protects concurrent starts and idempotency across runs.
  const profile = await sql<{ tos_accepted_at: unknown }>`
    SELECT tos_accepted_at FROM classroom_profiles WHERE user_id = ${userId} FOR UPDATE`;
  if (!profile[0]?.tos_accepted_at) throw new MorningError(403, "請先完成學員資料與教學聲明");
}
function response(state: MorningStoredState | null, source: MorningSource): MorningResponse {
  return { catalog: source.catalog, state: state ? visibleMorningState(state, source) : null };
}
/** Always use a transaction-bound SQL handle and the user ID from the verified cookie session. */
export async function loadMorningSession(sql: Sql, userId: string, source: MorningSource): Promise<MorningResponse> {
  await requireProfile(sql, userId);
  const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions
    WHERE user_id = ${userId} AND lesson_id = ${source.catalog.lessonId}
    ORDER BY created_at DESC, id DESC LIMIT 1`;
  return response(rows[0] ? stored(rows[0]) : null, source);
}
/** Durable exactly-once mutation; retries return this run's current, already revealed state. */
export async function mutateMorningSession(sql: Sql, userId: string, input: unknown, source: MorningSource, clock: number | (() => number) = Date.now): Promise<MorningResponse> {
  const action = parseMorningAction(input);
  await requireProfile(sql, userId);
  // Read the clock after acquiring the owner lock: queued requests cannot reuse stale elapsed time.
  const now = typeof clock === "function" ? clock() : clock;
  const hash = createHash("sha256").update(source.catalog.lessonId + "\n" + JSON.stringify(action)).digest("hex");
  const previous = await sql<{ action_hash: string; session_id: string }>`
    SELECT action_hash, session_id FROM morning_requests WHERE user_id = ${userId} AND request_id = ${action.requestId}::uuid`;
  if (previous[0]) {
    if (previous[0].action_hash !== hash) throw new MorningError(409, "這個操作編號已用於不同內容，請重新讀取練習");
    const rows = await sql<SessionRow>`SELECT id, state_json FROM morning_sessions WHERE id = ${previous[0].session_id}::uuid AND user_id = ${userId} FOR UPDATE`;
    if (!rows[0]) throw new MorningError(404, "找不到這份練習");
    return response(stored(rows[0]), source);
  }
  let state: MorningStoredState;
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
    state = applyMorningAction(stored(rows[0]), action, source, now);
    await sql`UPDATE morning_sessions SET state_json = ${JSON.stringify(state)}::jsonb,
      completed = ${state.completed}, updated_at = NOW() WHERE id = ${state.id}::uuid AND user_id = ${userId}`;
  }
  const counts = await sql<{ count: number }>`SELECT count(*)::int AS count FROM morning_requests WHERE session_id = ${state.id}::uuid`;
  if (counts[0].count >= 1_000) throw new MorningError(429, "本次練習操作次數已達上限，請聯絡講師");
  await sql`INSERT INTO morning_requests (user_id, request_id, session_id, action_hash)
    VALUES (${userId}, ${action.requestId}::uuid, ${state.id}::uuid, ${hash})`;
  return response(state, source);
}
