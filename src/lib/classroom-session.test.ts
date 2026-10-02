import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { saveImmutableClassroomSession } from "./classroom-session.server.ts";
import type { Sql } from "./db.ts";
import type { ReviewBundle } from "./game/persist.ts";

function sqlFor(db: {
  query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce(
      (text, part, index) => text + (index ? `$${index}` : "") + part,
      "",
    );
    return (await db.query<T>(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) =>
    (await db.query<T>(query, params)).rows;
  return sql;
}
function bundle(id: string): ReviewBundle {
  return {
    rec: {
      id,
      scenarioId: "wed-open",
      scenarioName: "第一課",
      endedAt: 1,
      pnl: 0,
      pnlPct: 0,
      trades: 0,
      wins: 0,
      fees: 0,
      maxDrawdown: 0,
      grade: "C",
      title: "第一課",
    },
    verdicts: [],
    fills: [
      {
        id: "f1",
        orderId: "o1",
        code: "2317",
        side: "buy",
        lots: 1,
        price: 100,
        fee: 0,
        tax: 0,
        time: 0,
        vwapAt: 100,
      },
    ],
    code: "2317",
    capital: 1000000,
    equity: 1000000,
    sessionLabel: "教室",
  };
}
test("real SQL: idempotent immutable sessions, ownership and atomic trade rollback", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../../migrations/0003_classroom.sql", import.meta.url), "utf8"),
    );
    await db.exec(
      "INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('alice','Alice','student','A',NOW()),('bob','Bob','student','B',NOW()),('pending','Pending','student','A',NULL)",
    );
    const save = (value: ReviewBundle, user: string) =>
      db.transaction((tx) => saveImmutableClassroomSession(sqlFor(tx), value, user));
    const first = bundle("first");
    await save(first, "alice");
    await save(first, "alice");
    assert.equal(
      (await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM classroom_sessions")).rows[0]
        .n,
      1,
    );
    assert.equal(
      (await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM classroom_trades")).rows[0].n,
      1,
    );
    await assert.rejects(save(first, "bob"), /無權/);
    await assert.rejects(
      save({ ...first, rec: { ...first.rec, grade: "A" } }, "alice"),
      /不能覆寫/,
    );
    await assert.rejects(save(bundle("not-enrolled"), "pending"), /先完成/);
    const broken = bundle("rollback");
    broken.fills.push({ ...broken.fills[0], id: "invalid", lots: 0 });
    await assert.rejects(save(broken, "alice"));
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM classroom_sessions WHERE id = 'rollback'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM classroom_trades WHERE session_id = 'rollback'",
        )
      ).rows[0].n,
      0,
    );
    await save(bundle("second"), "alice");
    assert.equal(
      (await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM classroom_trades")).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
