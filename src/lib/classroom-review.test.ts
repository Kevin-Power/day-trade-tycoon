import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { readTeacherClassroomReview } from "./classroom-review.server.ts";
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

test("real SQL: teacher review is verified, same-class, consented and read-only", async (t) => {
  const db = new PGlite();
  const teacher = { id: "teacher", email: "teacher@example.invalid", emailVerified: true };
  const policy = { teacherEmails: teacher.email, teacherIds: "teacher,unverified" };
  const review: ReviewBundle = {
    rec: {
      id: "lesson-record",
      scenarioId: "wed-open",
      scenarioName: "第一课",
      endedAt: 1,
      pnl: 0,
      pnlPct: 0,
      trades: 0,
      wins: 0,
      fees: 0,
      maxDrawdown: 0,
      grade: "C",
      title: "練習",
    },
    verdicts: [],
    fills: [],
    code: "2330",
    capital: 1000000,
    equity: 1000000,
    sessionLabel: "教室",
  };
  try {
    await db.exec(
      await readFile(new URL("../../migrations/0003_classroom.sql", import.meta.url), "utf8"),
    );
    await db.exec(
      "INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('teacher','Teacher','teacher','A',NOW()),('student','Student','student','A',NOW()),('spoofed','Spoofed','teacher','A',NOW())",
    );
    const sql = sqlFor(db);
    await db.transaction((tx) => saveImmutableClassroomSession(sqlFor(tx), review, "student"));
    const read = () => readTeacherClassroomReview(sql, review.rec.id, teacher, policy);
    await t.test("verified teacher reads same-class student's original bundle", async () => {
      assert.deepEqual(await read(), { bundle: review, studentName: "Student" });
    });
    await t.test("anonymous caller is denied", async () => {
      await assert.rejects(readTeacherClassroomReview(sql, review.rec.id, null, policy), /無權/);
    });
    await t.test("student cannot gain access from stored teacher role", async () => {
      await assert.rejects(
        readTeacherClassroomReview(
          sql,
          review.rec.id,
          { id: "spoofed", email: "student@example.invalid", emailVerified: true },
          policy,
        ),
        /無權/,
      );
    });
    await t.test("unverified allowlisted email or ID cannot read a review", async () => {
      await assert.rejects(
        readTeacherClassroomReview(
          sql,
          review.rec.id,
          { ...teacher, emailVerified: false },
          policy,
        ),
        /無權/,
      );
      await assert.rejects(
        readTeacherClassroomReview(
          sql,
          review.rec.id,
          { id: "unverified", email: "other@example.invalid", emailVerified: false },
          policy,
        ),
        /無權/,
      );
    });
    await t.test("cross-class, blank class and absent profiles disclose no review", async () => {
      await sql`UPDATE classroom_profiles SET class_code = 'B' WHERE user_id = 'teacher'`;
      assert.equal(await read(), null);
      await sql`UPDATE classroom_profiles SET class_code = '   ' WHERE user_id IN ('teacher', 'student')`;
      assert.equal(await read(), null);
      await sql`UPDATE classroom_profiles SET class_code = 'A' WHERE user_id IN ('teacher', 'student')`;
      assert.equal(
        await readTeacherClassroomReview(sql, review.rec.id, { ...teacher, id: "missing" }, policy),
        null,
      );
    });
    await t.test("both participants must have accepted classroom terms", async () => {
      await sql`UPDATE classroom_profiles SET tos_accepted_at = NULL WHERE user_id = 'teacher'`;
      assert.equal(await read(), null);
      await sql`UPDATE classroom_profiles SET tos_accepted_at = NOW() WHERE user_id = 'teacher'`;
      await sql`UPDATE classroom_profiles SET tos_accepted_at = NULL WHERE user_id = 'student'`;
      assert.equal(await read(), null);
      await sql`UPDATE classroom_profiles SET tos_accepted_at = NOW() WHERE user_id = 'student'`;
    });
    await t.test("unknown session and mismatched embedded ID disclose no review", async () => {
      assert.equal(await readTeacherClassroomReview(sql, "unknown", teacher, policy), null);
      await sql`UPDATE classroom_sessions SET review_json = ${JSON.stringify({ ...review, rec: { ...review.rec, id: "other" } })} WHERE id = ${review.rec.id}`;
      assert.equal(await read(), null);
      await sql`UPDATE classroom_sessions SET review_json = ${JSON.stringify(review)} WHERE id = ${review.rec.id}`;
    });
    await t.test("reads preserve the saved session and trade ledger", async () => {
      assert.deepEqual(await read(), { bundle: review, studentName: "Student" });
      assert.equal(
        (
          await sql<{
            review_json: string;
          }>`SELECT review_json FROM classroom_sessions WHERE id = ${review.rec.id}`
        )[0].review_json,
        JSON.stringify(review),
      );
      assert.equal(
        (await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM classroom_trades`)[0].n,
        0,
      );
    });
  } finally {
    await db.close();
  }
});
