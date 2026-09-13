import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";

const TEACHER_CODE = "TEACHER";

export const upsertMyProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      displayName: z.string().min(1).max(40),
      classCode: z.string().max(24).optional(),
      acceptTos: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const role = data.classCode === TEACHER_CODE ? "teacher" : "student";
    const classCode = data.classCode === TEACHER_CODE ? "GWVGZ" : (data.classCode ?? "GWVGZ");
    await sql`
      INSERT INTO classroom_profiles (user_id, display_name, role, class_code, tos_accepted_at)
      VALUES (
        ${context.userId},
        ${data.displayName},
        ${role},
        ${classCode},
        ${data.acceptTos ? new Date().toISOString() : null}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        role = CASE WHEN classroom_profiles.role = 'teacher' THEN classroom_profiles.role ELSE EXCLUDED.role END,
        class_code = EXCLUDED.class_code,
        tos_accepted_at = COALESCE(classroom_profiles.tos_accepted_at, EXCLUDED.tos_accepted_at)
    `;
    return { ok: true, role };
  });

export const loadMyProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      user_id: string;
      display_name: string;
      role: string;
      class_code: string;
      tos_accepted_at: string | null;
    }>`
      SELECT user_id, display_name, role, class_code, tos_accepted_at
      FROM classroom_profiles WHERE user_id = ${context.userId} LIMIT 1
    `;
    return rows[0] ?? null;
  });

export const saveClassroomSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      id: z.string(),
      lessonId: z.string(),
      initialEquity: z.number(),
      finalEquity: z.number(),
      maxDrawdownPct: z.number(),
      tradesCount: z.number(),
      violations: z.array(z.string()),
      passed: z.boolean(),
      pausedFills: z.number(),
      trades: z.array(
        z.object({
          id: z.string(),
          simTime: z.number(),
          code: z.string(),
          side: z.string(),
          qty: z.number(),
          price: z.number(),
          fee: z.number(),
          tax: z.number(),
          pnl: z.number(),
          filledWhilePaused: z.boolean().optional(),
        }),
      ),
    }),
  )
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      INSERT INTO classroom_sessions (
        id, user_id, lesson_id, ended_at, initial_equity, final_equity,
        max_drawdown_pct, trades_count, discipline_violations_json, passed, paused_fills_count
      ) VALUES (
        ${data.id}, ${context.userId}, ${data.lessonId}, ${new Date().toISOString()},
        ${data.initialEquity}, ${data.finalEquity}, ${data.maxDrawdownPct}, ${data.tradesCount},
        ${JSON.stringify(data.violations)}, ${data.passed}, ${data.pausedFills}
      )
      ON CONFLICT (id) DO UPDATE SET
        ended_at = EXCLUDED.ended_at,
        final_equity = EXCLUDED.final_equity,
        max_drawdown_pct = EXCLUDED.max_drawdown_pct,
        trades_count = EXCLUDED.trades_count,
        discipline_violations_json = EXCLUDED.discipline_violations_json,
        passed = EXCLUDED.passed,
        paused_fills_count = EXCLUDED.paused_fills_count
    `;
    for (const t of data.trades) {
      await sql`
        INSERT INTO classroom_trades (
          id, session_id, sim_time, code, side, qty, price, fee, tax, pnl, filled_while_paused
        ) VALUES (
          ${t.id}, ${data.id}, ${t.simTime}, ${t.code}, ${t.side}, ${t.qty}, ${t.price},
          ${t.fee}, ${t.tax}, ${t.pnl}, ${t.filledWhilePaused ?? false}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
    return { ok: true };
  });

export const loadTeacherRoster = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const me = await sql<{ role: string; class_code: string }>`
      SELECT role, class_code FROM classroom_profiles WHERE user_id = ${context.userId} LIMIT 1
    `;
    if (me[0]?.role !== "teacher") return { ok: false as const, reason: "不是教師帳號" };
    const classCode = me[0].class_code;
    const students = await sql<{
      user_id: string;
      display_name: string;
      role: string;
    }>`
      SELECT user_id, display_name, role FROM classroom_profiles
      WHERE class_code = ${classCode}
      ORDER BY display_name
    `;
    const sessions = await sql<{
      user_id: string;
      lesson_id: string;
      passed: boolean;
      final_equity: number;
      initial_equity: number;
      max_drawdown_pct: number;
      trades_count: number;
      discipline_violations_json: string;
      ended_at: string | null;
    }>`
      SELECT s.user_id, s.lesson_id, s.passed, s.final_equity, s.initial_equity,
             s.max_drawdown_pct, s.trades_count, s.discipline_violations_json, s.ended_at
      FROM classroom_sessions s
      JOIN classroom_profiles p ON p.user_id = s.user_id
      WHERE p.class_code = ${classCode}
    `;
    return { ok: true as const, classCode, students, sessions };
  });

export const loadLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ lessonId: z.string() }))
  .handler(async ({ data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      display_name: string;
      passed: boolean;
      ret: number;
      max_drawdown_pct: number;
      violations: string;
    }>`
      SELECT p.display_name,
             s.passed,
             CASE WHEN s.initial_equity = 0 THEN 0 ELSE (s.final_equity - s.initial_equity) / s.initial_equity END AS ret,
             s.max_drawdown_pct,
             s.discipline_violations_json AS violations
      FROM classroom_sessions s
      JOIN classroom_profiles p ON p.user_id = s.user_id
      WHERE s.lesson_id = ${data.lessonId}
      ORDER BY s.passed DESC, ret DESC, s.max_drawdown_pct ASC
      LIMIT 20
    `;
    return rows;
  });

export const loadMyCareer = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      lesson_id: string;
      final_equity: number;
      initial_equity: number;
      max_drawdown_pct: number;
      trades_count: number;
      passed: boolean;
      ended_at: string | null;
    }>`
      SELECT id, lesson_id, final_equity, initial_equity, max_drawdown_pct, trades_count, passed, ended_at
      FROM classroom_sessions
      WHERE user_id = ${context.userId}
      ORDER BY ended_at DESC NULLS LAST
      LIMIT 40
    `;
    const careerPnl = rows.reduce((s, r) => s + (r.final_equity - r.initial_equity), 0);
    const wins = rows.filter((r) => r.final_equity > r.initial_equity).length;
    return { sessions: rows, careerPnl, wins, count: rows.length };
  });

export const loadSessionDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const sess = await sql<{
      id: string;
      user_id: string;
      lesson_id: string;
      initial_equity: number;
      final_equity: number;
      max_drawdown_pct: number;
      trades_count: number;
      discipline_violations_json: string;
      passed: boolean;
      paused_fills_count: number;
      ended_at: string | null;
    }>`
      SELECT id, user_id, lesson_id, initial_equity, final_equity, max_drawdown_pct,
             trades_count, discipline_violations_json, passed, paused_fills_count, ended_at
      FROM classroom_sessions
      WHERE id = ${data.id} AND user_id = ${context.userId}
      LIMIT 1
    `;
    if (!sess[0]) return null;
    const trades = await sql<{
      id: string;
      sim_time: number;
      code: string;
      side: string;
      qty: number;
      price: number;
      fee: number;
      tax: number;
      pnl: number;
      filled_while_paused: boolean;
    }>`
      SELECT id, sim_time, code, side, qty, price, fee, tax, pnl, filled_while_paused
      FROM classroom_trades WHERE session_id = ${data.id} ORDER BY sim_time
    `;
    return { session: sess[0], trades };
  });
