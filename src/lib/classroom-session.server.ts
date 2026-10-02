import { assertSessionOwner } from "./classroom-policy.ts";
import type { Sql } from "./db.ts";
import type { ReviewBundle } from "./game/persist.ts";

/** Caller must supply an authenticated ID and a transaction-bound SQL handle. */
export async function saveImmutableClassroomSession(sql: Sql, data: ReviewBundle, userId: string) {
  const profile = await sql<{
    tos_accepted_at: unknown;
  }>`SELECT tos_accepted_at FROM classroom_profiles WHERE user_id = ${userId}`;
  if (!profile[0]?.tos_accepted_at) throw new Error("請先完成學員資料與教學聲明");
  const rec = data.rec;
  const serialized = JSON.stringify(data);
  await sql`INSERT INTO classroom_sessions (id, user_id, lesson_id, initial_equity, final_equity, max_drawdown_pct, trades_count, discipline_violations_json, passed, paused_fills_count, review_json)
    VALUES (${rec.id}, ${userId}, ${rec.scenarioId}, ${data.capital}, ${data.equity}, ${rec.maxDrawdown}, ${rec.trades}, ${JSON.stringify(rec.violations ?? [])}, ${rec.passed ?? false}, ${rec.pausedFills ?? 0}, ${serialized})
    ON CONFLICT (id) DO NOTHING`;
  const owner = await sql<{
    user_id: string;
  }>`SELECT user_id FROM classroom_sessions WHERE id = ${rec.id} FOR UPDATE`;
  assertSessionOwner(owner[0]?.user_id ?? "", userId);
  const existing = await sql<{
    review_json: string;
  }>`SELECT review_json FROM classroom_sessions WHERE id = ${rec.id}`;
  if (existing[0].review_json !== serialized) throw new Error("此練習已結算，不能覆寫紀錄");
  for (const fill of data.fills) {
    await sql`INSERT INTO classroom_trades (id, session_id, sim_time, code, side, qty, price, fee, tax, filled_while_paused)
      VALUES (${`${rec.id}:${fill.id}`}, ${rec.id}, ${fill.time}, ${fill.code}, ${fill.side}, ${fill.lots}, ${fill.price}, ${fill.fee}, ${fill.tax}, ${fill.filledWhilePaused ?? false})
      ON CONFLICT (id) DO NOTHING`;
  }
  return { ok: true };
}
