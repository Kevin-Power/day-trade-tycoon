import { randomUUID } from "node:crypto";
import { classroomRole, type ClassroomIdentity } from "./classroom-policy.ts";
import {
  addSessionFeedbackSchema,
  loadSessionFeedbackSchema,
  SESSION_FEEDBACK_PAGE_SIZE,
  type AddSessionFeedbackInput,
  type LoadSessionFeedbackInput,
  type SessionFeedback,
  type SessionFeedbackPage,
} from "./classroom-feedback.ts";
import type { Sql } from "./db.ts";

type TeacherPolicy = { teacherIds?: string; teacherEmails?: string };
type FeedbackRow = {
  id: string;
  session_id: string;
  author_name: string;
  observation: string;
  next_step: string;
  created_at: string;
};

const noAccess = () => new Error("目前帳號無權查看或新增這份練習的講師回饋");

/** SQL must be transaction-bound; row locks last through the caller's read/write. */
async function lockFeedbackAccess(
  sql: Sql,
  sessionId: string,
  user: ClassroomIdentity | null,
  policy: TeacherPolicy,
  write: boolean,
): Promise<{ authorName: string | null }> {
  if (!user) throw noAccess();
  const sessions = await sql<{ user_id: string }>`
    SELECT user_id FROM classroom_sessions WHERE id = ${sessionId} FOR SHARE`;
  if (!sessions[0]) throw noAccess();
  if (!write && sessions[0].user_id === user.id) return { authorName: null };
  if (!user.emailVerified || classroomRole(user, policy) !== "teacher") throw noAccess();
  const profiles = await sql<{ display_name: string }>`
    SELECT teacher.display_name
    FROM classroom_profiles teacher
    JOIN classroom_profiles student ON student.user_id = ${sessions[0].user_id}
    WHERE teacher.user_id = ${user.id}
      AND NULLIF(BTRIM(teacher.class_code), '') IS NOT NULL
      AND student.class_code = teacher.class_code
      AND teacher.tos_accepted_at IS NOT NULL
      AND student.tos_accepted_at IS NOT NULL
    FOR SHARE OF teacher, student`;
  if (!profiles[0]) throw noAccess();
  return { authorName: profiles[0].display_name.trim() || "本班講師" };
}

function feedbackFromRow(row: FeedbackRow): SessionFeedback {
  return {
    id: row.id,
    sessionId: row.session_id,
    authorName: row.author_name,
    observation: row.observation,
    nextStep: row.next_step,
    createdAt: row.created_at,
  };
}

/** Caller supplies a server-verified user and a transaction-bound SQL handle. */
export async function readClassroomSessionFeedback(
  sql: Sql,
  input: LoadSessionFeedbackInput,
  user: ClassroomIdentity | null,
  policy: TeacherPolicy,
): Promise<SessionFeedbackPage> {
  const data = loadSessionFeedbackSchema.parse(input);
  await lockFeedbackAccess(sql, data.sessionId, user, policy, false);
  const beforeTime = data.before?.createdAt ?? null;
  const beforeId = data.before?.id ?? null;
  const rows = await sql<FeedbackRow>`
    SELECT id, session_id, author_name, observation, next_step,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM classroom_session_feedback
    WHERE session_id = ${data.sessionId}
      AND (${beforeTime}::timestamptz IS NULL
        OR created_at < ${beforeTime}::timestamptz
        OR (created_at = ${beforeTime}::timestamptz AND id < ${beforeId}::uuid))
    ORDER BY created_at DESC, id DESC
    LIMIT ${SESSION_FEEDBACK_PAGE_SIZE + 1}`;
  const items = rows.slice(0, SESSION_FEEDBACK_PAGE_SIZE).map(feedbackFromRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > SESSION_FEEDBACK_PAGE_SIZE && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

/** Caller supplies a server-verified user and a transaction-bound SQL handle. */
export async function addClassroomSessionFeedback(
  sql: Sql,
  input: AddSessionFeedbackInput,
  user: ClassroomIdentity | null,
  policy: TeacherPolicy,
): Promise<SessionFeedback> {
  const data = addSessionFeedbackSchema.parse(input);
  const { authorName } = await lockFeedbackAccess(sql, data.sessionId, user, policy, true);
  if (!user || authorName === null) throw noAccess();
  await sql`
    INSERT INTO classroom_session_feedback
      (id, session_id, author_user_id, author_name, observation, next_step, request_id)
    VALUES (${randomUUID()}::uuid, ${data.sessionId}, ${user.id}, ${authorName},
      ${data.observation}, ${data.nextStep}, ${data.requestId}::uuid)
    ON CONFLICT (author_user_id, request_id) DO NOTHING`;
  const rows = await sql<FeedbackRow>`
    SELECT id, session_id, author_name, observation, next_step,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM classroom_session_feedback
    WHERE author_user_id = ${user.id} AND request_id = ${data.requestId}::uuid`;
  const saved = rows[0];
  if (
    !saved ||
    saved.session_id !== data.sessionId ||
    saved.observation !== data.observation ||
    saved.next_step !== data.nextStep
  ) {
    throw new Error("這次回饋已送出，重試內容不一致；請重新載入後再新增回饋。");
  }
  return feedbackFromRow(saved);
}
