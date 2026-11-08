import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { summarizeMorningClass, type MorningClassRow } from "@/lib/morning-class-summary";

type Row = {
  user_id: string;
  display_name: string;
  lesson_id: string;
  equity: number | string | null;
  starting: number | string | null;
  orders: unknown;
  fills: unknown;
  positions: unknown;
};

function records(value: unknown): Record<string, unknown>[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

/**
 * Teacher-only: the class's completed daily-lesson rounds, summed per lesson day (2026-11-08, 本課總結). Guests are
 * not class members, so they never appear; abandoned rounds are left out, as the learner's own records leave them.
 */
export const loadMorningClassSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const { lessonDate } = await import("@/lib/morning-data.server");
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
    const rows = await sql<Row>`
      SELECT s.user_id, p.display_name, s.lesson_id,
        CASE WHEN jsonb_typeof(s.state_json->'equity') = 'number' THEN (s.state_json->>'equity')::float8 END AS equity,
        CASE WHEN jsonb_typeof(s.state_json->'startingCash') = 'number' THEN (s.state_json->>'startingCash')::float8 END AS starting,
        s.state_json->'orders' AS orders, s.state_json->'fills' AS fills, s.state_json->'positions' AS positions
      FROM morning_sessions s JOIN classroom_profiles p ON p.user_id = s.user_id
      WHERE p.class_code = ${me[0].class_code} AND s.completed AND s.lesson_id LIKE 'fubon-%'
        AND NOT COALESCE(s.state_json->>'abandoned' = 'true', FALSE)
      ORDER BY s.lesson_id DESC, s.created_at ASC, s.id ASC`;
    const summaryRows = rows.flatMap((row): MorningClassRow[] => {
      const date = lessonDate(row.lesson_id);
      if (!date) return [];
      const equity = Number(row.equity);
      const starting = Number(row.starting);
      return [
        {
          userId: row.user_id,
          name: row.display_name,
          lessonId: row.lesson_id,
          date,
          equity: Number.isFinite(equity) ? equity : 0,
          startingCash: Number.isFinite(starting) ? starting : 0,
          orders: records(row.orders).map((order) => ({
            id: String(order.id ?? ""),
            auto: order.auto === "takeProfit" || order.auto === "stopLoss" ? order.auto : null,
          })),
          fills: records(row.fills).map((fill) => ({
            id: String(fill.id ?? ""),
            side: fill.side === "sell" ? ("sell" as const) : ("buy" as const),
          })),
          positions: records(row.positions).map((position) => ({ shares: Number(position.shares) || 0 })),
        },
      ];
    });
    return { ok: true as const, lessons: summarizeMorningClass(summaryRows) };
  });
