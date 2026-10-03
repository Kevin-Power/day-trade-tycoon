import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { reviewBundleSchema } from "@/lib/game/review-schema";
import type { ReviewBundle } from "@/lib/game/persist";
import { addSessionFeedbackSchema, loadSessionFeedbackSchema } from "@/lib/classroom-feedback";

type ProfileRow = {
  user_id: string;
  display_name: string;
  role: string;
  class_code: string;
  tos_accepted_at: string | null;
};
type SessionRow = {
  id: string;
  user_id: string;
  lesson_id: string;
  initial_equity: number;
  final_equity: number;
  max_drawdown_pct: number;
  trades_count: number;
  discipline_violations_json: string;
  passed: boolean;
  ended_at: string | null;
  feedback_count: number;
  last_feedback_at: string | null;
};

export const upsertMyProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      displayName: z.string().trim().min(1).max(40),
      classCode: z.string().trim().max(24).optional(),
      acceptTos: z.literal(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const user = await requireAuthenticatedUser();
    if (user.id !== context.userId) throw new Error("登入身分不一致");
    const classCode = process.env.CLASSROOM_CODE?.trim() || "GWVGZ";
    if (data.classCode && data.classCode !== classCode)
      throw new Error("班級代碼不正確，請向講師確認");
    const role = classroomRole(user, {
      teacherIds: process.env.CLASSROOM_TEACHER_IDS,
      teacherEmails: process.env.TEACHER_EMAILS,
    });
    const sql = await getSql();
    await sql`INSERT INTO classroom_profiles (user_id, display_name, role, class_code, tos_accepted_at)
      VALUES (${user.id}, ${data.displayName}, ${role}, ${classCode}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role,
        tos_accepted_at = COALESCE(classroom_profiles.tos_accepted_at, EXCLUDED.tos_accepted_at)`;
    return { ok: true, role };
  });

export const loadMyProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const user = await requireAuthenticatedUser();
    const sql = await getSql();
    const rows =
      await sql<ProfileRow>`SELECT user_id, display_name, role, class_code, tos_accepted_at FROM classroom_profiles WHERE user_id = ${context.userId}`;
    if (!rows[0]) return null;
    return {
      ...rows[0],
      role: classroomRole(user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }),
    };
  });

/** Educational client-generated records; ownership is enforced, scores are not an anti-cheat attestation. */
export const saveClassroomSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.intersection(reviewBundleSchema, z.object({ expectedUserId: z.string().min(1).max(200) })),
  )
  .handler(async ({ data, context }) => {
    if (data.expectedUserId !== context.userId)
      throw new Error("登入帳號已變更，請回原帳號保存這份復盤");
    const { withSqlTransaction } = await import("@/lib/db");
    const { saveImmutableClassroomSession } = await import("@/lib/classroom-session.server");
    const { expectedUserId: _expectedUserId, ...review } = data;
    return withSqlTransaction((sql) => saveImmutableClassroomSession(sql, review, context.userId));
  });

export const loadTeacherRoster = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const user = await requireAuthenticatedUser();
    if (
      classroomRole(user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }) !== "teacher"
    )
      return { ok: false as const, reason: "此帳號尚未由管理員授予講師權限" };
    const sql = await getSql();
    const me = await sql<{
      class_code: string;
    }>`SELECT class_code FROM classroom_profiles WHERE user_id = ${context.userId}`;
    if (!me[0]) return { ok: false as const, reason: "請先完成講師的班級資料" };
    const classCode = me[0].class_code;
    const students = await sql<{
      user_id: string;
      display_name: string;
      role: string;
    }>`SELECT user_id, display_name, role FROM classroom_profiles WHERE class_code = ${classCode} ORDER BY display_name`;
    const sessions =
      await sql<SessionRow>`SELECT s.id, s.user_id, s.lesson_id, s.initial_equity, s.final_equity, s.max_drawdown_pct, s.trades_count, s.discipline_violations_json, s.passed, to_char(s.ended_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS ended_at
      , (SELECT COUNT(*)::int FROM classroom_session_feedback f WHERE f.session_id = s.id) AS feedback_count
      , (SELECT to_char(MAX(f.created_at) AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') FROM classroom_session_feedback f WHERE f.session_id = s.id) AS last_feedback_at
      FROM classroom_sessions s JOIN classroom_profiles p ON p.user_id = s.user_id WHERE p.class_code = ${classCode} ORDER BY s.ended_at DESC, s.id DESC`;
    return { ok: true as const, classCode, students, sessions };
  });

export const loadLeaderboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ lessonId: z.string().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    return sql<{
      display_name: string;
      passed: boolean;
      ret: number;
      max_drawdown_pct: number;
      violations: string;
    }>`
      SELECT p.display_name, s.passed, (s.final_equity - s.initial_equity) / NULLIF(s.initial_equity, 0) AS ret,
        s.max_drawdown_pct, s.discipline_violations_json AS violations FROM classroom_sessions s
      JOIN classroom_profiles p ON p.user_id = s.user_id
      JOIN classroom_profiles me ON me.class_code = p.class_code AND me.user_id = ${context.userId}
      WHERE s.lesson_id = ${data.lessonId} AND me.tos_accepted_at IS NOT NULL
      ORDER BY s.passed DESC, ret DESC, s.max_drawdown_pct ASC LIMIT 20`;
  });

export const loadMyCareer = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const sessions =
      await sql<SessionRow>`SELECT s.id, s.user_id, s.lesson_id, s.initial_equity, s.final_equity, s.max_drawdown_pct, s.trades_count, s.discipline_violations_json, s.passed, to_char(s.ended_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') AS ended_at
      , (SELECT COUNT(*)::int FROM classroom_session_feedback f WHERE f.session_id = s.id) AS feedback_count
      , (SELECT to_char(MAX(f.created_at) AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS') FROM classroom_session_feedback f WHERE f.session_id = s.id) AS last_feedback_at
      FROM classroom_sessions s WHERE s.user_id = ${context.userId} ORDER BY s.ended_at DESC, s.id DESC LIMIT 40`;
    const totals = await sql<{
      career_pnl: number;
      count: number;
      wins: number;
    }>`SELECT COALESCE(SUM(final_equity-initial_equity), 0) AS career_pnl, COUNT(*) AS count, COUNT(*) FILTER(WHERE final_equity > initial_equity) AS wins FROM classroom_sessions WHERE user_id = ${context.userId}`;
    return {
      sessions,
      careerPnl: Number(totals[0].career_pnl),
      count: Number(totals[0].count),
      wins: Number(totals[0].wins),
    };
  });

export const loadSessionDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1).max(120) }))
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      review_json: string;
    }>`SELECT review_json FROM classroom_sessions WHERE id = ${data.id} AND user_id = ${context.userId}`;
    if (!rows[0]) return null;
    const result = reviewBundleSchema.safeParse(JSON.parse(rows[0].review_json));
    return result.success ? (result.data as ReviewBundle) : null;
  });

export const loadTeacherSessionDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1).max(120) }))
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { readTeacherClassroomReview } = await import("@/lib/classroom-review.server");
    const user = await requireAuthenticatedUser();
    if (user.id !== context.userId) throw new Error("登入身分不一致");
    return readTeacherClassroomReview(await getSql(), data.id, user, {
      teacherIds: process.env.CLASSROOM_TEACHER_IDS,
      teacherEmails: process.env.TEACHER_EMAILS,
    });
  });

export const loadSessionFeedback = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(loadSessionFeedbackSchema)
  .handler(async ({ data, context }) => {
    const { withSqlTransaction } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { readClassroomSessionFeedback } = await import("@/lib/classroom-feedback.server");
    const user = await requireAuthenticatedUser();
    if (user.id !== context.userId) throw new Error("登入身分不一致");
    return withSqlTransaction((sql) =>
      readClassroomSessionFeedback(sql, data, user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }),
    );
  });

export const addSessionFeedback = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(addSessionFeedbackSchema)
  .handler(async ({ data, context }) => {
    const { withSqlTransaction } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { addClassroomSessionFeedback } = await import("@/lib/classroom-feedback.server");
    const user = await requireAuthenticatedUser();
    if (user.id !== context.userId) throw new Error("登入身分不一致");
    return withSqlTransaction((sql) =>
      addClassroomSessionFeedback(sql, data, user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }),
    );
  });
