import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/** Teacher-only: today's daily question, its reveal and who in the class answered what. */
export const loadDailyForTeacher = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql, withSqlTransaction } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const { dailyTeacherView } = await import("@/lib/daily-question.server");
    const user = await requireAuthenticatedUser();
    if (
      classroomRole(user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }) !== "teacher"
    )
      return { ok: false as const, reason: "此帳號尚未由管理員授予講師權限" };
    const sql = await getSql();
    const me = await sql<{ class_code: string }>`SELECT class_code FROM classroom_profiles WHERE user_id = ${context.userId}`;
    if (!me[0]) return { ok: false as const, reason: "請先完成講師的班級資料" };
    const pinned = Date.parse(process.env.DAILY_NOW_ISO ?? "");
    const now = Number.isFinite(pinned) ? pinned : Date.now();
    const dir = process.env.MARKET_DATA_DIR?.trim() ?? "";
    const view = await withSqlTransaction((tx) => dailyTeacherView(tx, me[0]!.class_code, dir, now));
    return { ok: true as const, view };
  });
