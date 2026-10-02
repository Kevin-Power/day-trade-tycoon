import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  addSessionFeedbackSchema,
  loadSessionFeedbackSchema,
  type AddSessionFeedbackInput,
  type LoadSessionFeedbackInput,
  type SessionFeedback,
} from "./classroom-feedback.ts";
import {
  addClassroomSessionFeedback,
  readClassroomSessionFeedback,
} from "./classroom-feedback.server.ts";
import { saveImmutableClassroomSession } from "./classroom-session.server.ts";
import type { ClassroomIdentity } from "./classroom-policy.ts";
import type { ReviewBundle } from "./game/persist.ts";
import type { Sql } from "./db.ts";

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

const validInput = (): AddSessionFeedbackInput => ({
  sessionId: "feedback-session",
  requestId: randomUUID(),
  observation: "看得出有先確認商品與張數。",
  nextStep: "下次請說明離場條件，再核對成交。",
});

test("feedback inputs trim required text and reject oversized, empty or forged metadata", () => {
  const input = validInput();
  const parsed = addSessionFeedbackSchema.parse({
    ...input,
    observation: " \n觀察內容\t",
    nextStep: " 下次重點 ",
  });
  assert.equal(parsed.observation, "觀察內容");
  assert.equal(parsed.nextStep, "下次重點");
  assert.equal(
    addSessionFeedbackSchema.safeParse({
      ...input,
      observation: "a".repeat(600),
      nextStep: "b".repeat(300),
    }).success,
    true,
  );
  for (const patch of [
    { observation: " \n\t " },
    { nextStep: "" },
    { observation: "a".repeat(601) },
    { nextStep: "a".repeat(301) },
    { observation: null },
    { nextStep: 1 },
    { sessionId: "" },
    { sessionId: "bad id" },
    { requestId: "not-a-uuid" },
    { authorName: "偽造講師" },
    { author_user_id: "teacher" },
    { role: "teacher" },
    { createdAt: "2026-10-02T00:00:00Z" },
  ])
    assert.equal(
      addSessionFeedbackSchema.safeParse({ ...input, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
});

test("feedback cursors accept exact UTC microseconds and reject malformed or injected fields", () => {
  const before = { createdAt: "2026-10-02T08:01:02.123456Z", id: randomUUID() };
  assert.deepEqual(
    loadSessionFeedbackSchema.parse({ sessionId: "feedback-session", before }).before,
    before,
  );
  for (const patch of [
    { createdAt: "tomorrow" },
    { createdAt: "2026-13-42T00:00:00Z" },
    { id: "not-a-uuid" },
    { author: "teacher" },
  ])
    assert.equal(
      loadSessionFeedbackSchema.safeParse({
        sessionId: "feedback-session",
        before: { ...before, ...patch },
      }).success,
      false,
    );
  assert.equal(
    loadSessionFeedbackSchema.safeParse({ sessionId: "feedback-session", role: "teacher" }).success,
    false,
  );
});

test("real SQL: feedback authorization, immutability, retries, pagination and class transfers", async (t) => {
  const db = new PGlite();
  const teacher: ClassroomIdentity = {
    id: "teacher",
    email: "teacher@example.invalid",
    emailVerified: true,
  };
  const teacher2: ClassroomIdentity = {
    id: "teacher2",
    email: "teacher2@example.invalid",
    emailVerified: true,
  };
  const teacherB: ClassroomIdentity = {
    id: "teacher-b",
    email: "teacher-b@example.invalid",
    emailVerified: true,
  };
  const student: ClassroomIdentity = {
    id: "student",
    email: "student@example.invalid",
    emailVerified: false,
  };
  const other: ClassroomIdentity = {
    id: "other",
    email: "other@example.invalid",
    emailVerified: true,
  };
  const spoofed: ClassroomIdentity = {
    id: "spoofed",
    email: "spoofed@example.invalid",
    emailVerified: true,
  };
  const policy = {
    teacherIds: "teacher,teacher2,teacher-b",
    teacherEmails: "teacher@example.invalid",
  };
  const review: ReviewBundle = {
    rec: {
      id: "feedback-session",
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
      title: "練習",
    },
    verdicts: [],
    code: "2330",
    capital: 1000000,
    equity: 1000000,
    sessionLabel: "教室",
    fills: [
      {
        id: "F1",
        orderId: "O1",
        code: "2330",
        side: "buy",
        lots: 1,
        price: 100,
        fee: 0,
        tax: 0,
        time: 120,
        vwapAt: 100,
      },
    ],
    firstTradePlan: {
      plan: {
        version: 1,
        code: "2330",
        side: "buy",
        lots: 1,
        simTime: 100,
        entryCondition: "原進場條件",
        exitCondition: "原離場條件",
        maxLoss: 1000,
      },
      order: { id: "O1", code: "2330", side: "buy", type: "limit", lots: 1, price: 100, time: 120 },
    },
  };
  const add = (input = validInput(), user: ClassroomIdentity | null = teacher) =>
    db.transaction((tx) => addClassroomSessionFeedback(sqlFor(tx), input, user, policy));
  const read = (
    input: LoadSessionFeedbackInput = { sessionId: review.rec.id },
    user: ClassroomIdentity | null = student,
  ) => db.transaction((tx) => readClassroomSessionFeedback(sqlFor(tx), input, user, policy));
  let originalFeedback: SessionFeedback;
  const originalInput = validInput();
  try {
    await db.exec(
      await readFile(new URL("../../migrations/0003_classroom.sql", import.meta.url), "utf8"),
    );
    await db.exec(
      await readFile(
        new URL("../../migrations/0005_classroom_feedback.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(
      "INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('teacher','第一位講師','teacher','A',NOW()),('teacher2','第二位講師','teacher','A',NOW()),('teacher-b','B班講師','teacher','B',NOW()),('student','原學員','student','A',NOW()),('other','另一位學員','student','A',NOW()),('spoofed','假講師','teacher','A',NOW())",
    );
    await db.transaction((tx) => saveImmutableClassroomSession(sqlFor(tx), review, "student"));
    await db.transaction((tx) =>
      saveImmutableClassroomSession(
        sqlFor(tx),
        { ...review, rec: { ...review.rec, id: "other-session" } },
        "other",
      ),
    );
    const sql = sqlFor(db);
    const originalSessions = await sql.query("SELECT * FROM classroom_sessions ORDER BY id");
    const originalTrades = await sql.query("SELECT * FROM classroom_trades ORDER BY id");

    await t.test(
      "original student can read an empty page and teacher writes server-authored feedback",
      async () => {
        assert.deepEqual(await read(), { items: [], nextCursor: null });
        const now = Date.now();
        originalFeedback = await add({
          ...originalInput,
          observation: "  " + originalInput.observation + " \n",
        });
        assert.equal(originalFeedback.authorName, "第一位講師");
        assert.equal(originalFeedback.observation, originalInput.observation);
        assert.match(originalFeedback.id, /^[a-f0-9-]{36}$/);
        assert.match(originalFeedback.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
        assert.ok(Math.abs(Date.parse(originalFeedback.createdAt) - now) < 5000);
        assert.deepEqual((await read()).items, [originalFeedback]);
        assert.deepEqual((await read({ sessionId: review.rec.id }, teacher)).items, [
          originalFeedback,
        ]);
        assert.deepEqual(
          Object.keys(originalFeedback).sort(),
          ["id", "sessionId", "authorName", "observation", "nextStep", "createdAt"].sort(),
        );
      },
    );
    await t.test(
      "anonymous, another student, spoofed role and unverified teacher cannot read or write",
      async () => {
        for (const user of [null, other, spoofed, { ...teacher, emailVerified: false }]) {
          await assert.rejects(read({ sessionId: review.rec.id }, user), /無權/);
          await assert.rejects(add(validInput(), user), /無權/);
        }
        await assert.rejects(add(validInput(), student), /無權/);
        await assert.rejects(read({ sessionId: "unknown" }, teacher), /無權/);
        await assert.rejects(add({ ...validInput(), sessionId: "unknown" }), /無權/);
      },
    );
    await t.test(
      "cross-class, blank class and either missing consent deny teacher reads and writes",
      async () => {
        await assert.rejects(read({ sessionId: review.rec.id }, teacherB), /無權/);
        await assert.rejects(add(validInput(), teacherB), /無權/);
        await sql`UPDATE classroom_profiles SET class_code = '' WHERE user_id IN ('teacher', 'student')`;
        await assert.rejects(read({ sessionId: review.rec.id }, teacher), /無權/);
        await assert.rejects(add(), /無權/);
        await sql`UPDATE classroom_profiles SET class_code = 'A' WHERE user_id IN ('teacher', 'student')`;
        for (const id of ["teacher", "student"]) {
          await sql`UPDATE classroom_profiles SET tos_accepted_at = NULL WHERE user_id = ${id}`;
          await assert.rejects(read({ sessionId: review.rec.id }, teacher), /無權/);
          await assert.rejects(add(), /無權/);
          await sql`UPDATE classroom_profiles SET tos_accepted_at = NOW() WHERE user_id = ${id}`;
        }
      },
    );
    await t.test(
      "same author request retries return the unchanged original; changed content or session is rejected",
      async () => {
        await sql`UPDATE classroom_profiles SET display_name = '講師的新名稱' WHERE user_id = 'teacher'`;
        assert.deepEqual(await add(originalInput), originalFeedback);
        const repeated = await Promise.all([add(originalInput), add(originalInput)]);
        assert.deepEqual(repeated, [originalFeedback, originalFeedback]);
        await assert.rejects(add({ ...originalInput, observation: "改寫原評語" }), /內容不一致/);
        await assert.rejects(add({ ...originalInput, nextStep: "改寫下次重點" }), /內容不一致/);
        await assert.rejects(add({ ...originalInput, sessionId: "other-session" }), /內容不一致/);
        assert.equal(
          (await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM classroom_session_feedback`)[0]
            .n,
          1,
        );
      },
    );
    await t.test(
      "another authorized teacher adds a separate entry even with the same request UUID",
      async () => {
        const second = await add(
          { ...originalInput, observation: "第二位講師的獨立觀察" },
          teacher2,
        );
        assert.notEqual(second.id, originalFeedback.id);
        assert.equal(second.authorName, "第二位講師");
        assert.deepEqual(
          (await read()).items.find((item) => item.id === originalFeedback.id),
          originalFeedback,
        );
      },
    );
    await t.test("database blocks rewriting or removing published feedback", async () => {
      await assert.rejects(
        sql`UPDATE classroom_session_feedback SET observation = '覆寫' WHERE id = ${originalFeedback.id}::uuid`,
        /append-only/,
      );
      await assert.rejects(
        sql`DELETE FROM classroom_session_feedback WHERE id = ${originalFeedback.id}::uuid`,
        /append-only/,
      );
      assert.deepEqual(
        (await read()).items.find((item) => item.id === originalFeedback.id),
        originalFeedback,
      );
    });
    await t.test(
      "keyset pagination preserves every row with equal and submillisecond timestamps",
      async () => {
        const pageReview = { ...review, rec: { ...review.rec, id: "pagination-session" } };
        await db.transaction((tx) =>
          saveImmutableClassroomSession(sqlFor(tx), pageReview, "student"),
        );
        for (let i = 0; i < 23; i++) {
          const stamp = i < 13 ? "2026-10-02T08:00:00.123456Z" : "2026-10-02T08:00:00.123457Z";
          await sql`INSERT INTO classroom_session_feedback (id,session_id,author_user_id,author_name,observation,next_step,created_at,request_id)
          VALUES (${randomUUID()}::uuid, 'pagination-session', 'teacher', '分頁測試講師', ${`觀察 ${i}`}, '下一次重點', ${stamp}::timestamptz, ${randomUUID()}::uuid)`;
        }
        const first = await read({ sessionId: "pagination-session" });
        assert.equal(first.items.length, 10);
        assert.ok(first.nextCursor);
        assert.equal(first.nextCursor.createdAt, "2026-10-02T08:00:00.123457Z");
        const second = await read({ sessionId: "pagination-session", before: first.nextCursor });
        assert.equal(second.items.length, 10);
        assert.ok(second.nextCursor);
        const third = await read({ sessionId: "pagination-session", before: second.nextCursor });
        assert.equal(third.items.length, 3);
        assert.equal(third.nextCursor, null);
        const received = [...first.items, ...second.items, ...third.items].map((item) => item.id);
        assert.equal(new Set(received).size, 23);
        const expected = await sql<{
          id: string;
        }>`SELECT id FROM classroom_session_feedback WHERE session_id = 'pagination-session' ORDER BY created_at DESC, id DESC`;
        assert.deepEqual(
          received,
          expected.map((item) => item.id),
        );
        assert.deepEqual(
          await read({
            sessionId: "pagination-session",
            before: { createdAt: third.items.at(-1)!.createdAt, id: third.items.at(-1)!.id },
          }),
          { items: [], nextCursor: null },
        );
      },
    );
    await t.test(
      "after transfer the original learner retains access while the former teacher loses it",
      async () => {
        await sql`UPDATE classroom_profiles SET class_code = 'B' WHERE user_id = 'student'`;
        assert.ok((await read()).items.some((item) => item.id === originalFeedback.id));
        await assert.rejects(read({ sessionId: review.rec.id }, teacher), /無權/);
        await assert.rejects(
          add(originalInput),
          /無權/,
          "idempotency cannot bypass current class permission",
        );
        assert.ok(
          (await read({ sessionId: review.rec.id }, teacherB)).items.some(
            (item) => item.id === originalFeedback.id,
          ),
        );
        const next = await add({ ...validInput(), observation: "新班講師觀察" }, teacherB);
        assert.equal(next.authorName, "B班講師");
        await sql`UPDATE classroom_profiles SET class_code = 'A' WHERE user_id = 'student'`;
      },
    );
    await t.test("feedback never rewrites original sessions, grades, plans or trades", async () => {
      assert.deepEqual(
        await sql.query(
          "SELECT * FROM classroom_sessions WHERE id <> 'pagination-session' ORDER BY id",
        ),
        originalSessions,
      );
      assert.deepEqual(
        await sql.query(
          "SELECT * FROM classroom_trades WHERE session_id <> 'pagination-session' ORDER BY id",
        ),
        originalTrades,
      );
    });
  } finally {
    await db.close();
  }
});
