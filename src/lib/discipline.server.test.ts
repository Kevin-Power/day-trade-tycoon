import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { loadDiscipline, readDisciplineInput } from "./discipline.server.ts";
import { linkGuestRecords } from "./guest-link.server.ts";
import type { Sql } from "./db.ts";

function sqlFor(db: { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (await db.query<T>(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) => (await db.query<T>(query, params)).rows;
  return sql;
}
const TUE_0900 = Date.parse("2026-10-20T09:00:00+08:00");
const outcome = (broke: boolean) => broke
  ? { higherHigh: true, higherHighT: 900, firstBreakT: 840, firstBreakPrice: 100.5, maxAfter: 102, close: 101.5 }
  : { higherHigh: false, higherHighT: null, firstBreakT: null, firstBreakPrice: null, maxAfter: 100, close: 99 };

async function fixture(run: (tools: { db: PGlite; tx: <T>(work: (sql: Sql) => Promise<T>) => Promise<T> }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "discipline-sql-test-"));
  const db = new PGlite({ dataDir: join(root, "pglite") });
  try {
    for (const migration of ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql", "0008_anonymous_users.sql", "0009_daily_questions.sql"])
      await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    for (const [id, anonymous] of [["alice", false], ["guest", true]] as const)
      await db.query('INSERT INTO "user"(id,name,email,"emailVerified","isAnonymous") VALUES($1,$1,$2,FALSE,$3)', [id, id + "@example.invalid", anonymous]);
    await db.exec(`INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('alice','小安','student','A',NOW())`);
    // Two issued questions (10/19 broke out, 10/20 did not) and a later one not issued yet at TUE_0900.
    for (const [id, issue, broke] of [["2026-10-16", "2026-10-19", true], ["2026-10-19", "2026-10-20", false], ["2026-10-20", "2026-10-21", false]] as const)
      await db.query("INSERT INTO daily_questions(id,issue_date,payload) VALUES($1,$2,$3::jsonb)",
        [id, issue, JSON.stringify({ level: 100, bars: [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }], outcome: outcome(broke) })]);
    await run({ db, tx: (work) => db.transaction((t) => work(sqlFor(t))) });
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function answer(db: PGlite, userId: string, questionId: string, choice: "enter" | "watch" | "skip", reason: string | null) {
  await db.query("INSERT INTO daily_answers(user_id,question_id,choice,stop_price,reason) VALUES($1,$2,$3,$4,$5)",
    [userId, questionId, choice, choice === "enter" ? 99 : null, reason]);
}
async function round(db: PGlite, userId: string, startedAt: string, completed: boolean, state: {
  focusCode?: string; reflection?: string; orders?: { code: string }[]; positions?: { code: string; shares: number }[];
}) {
  const json = {
    plan: { focusCode: state.focusCode ?? "2330" },
    reflection: state.reflection ?? "照計畫等待，沒有追高。",
    orders: state.orders ?? [],
    positions: state.positions ?? [],
  };
  await db.query("INSERT INTO morning_sessions(id,user_id,lesson_id,state_json,completed,created_at) VALUES($1,$2,'lesson',$3::jsonb,$4,$5)",
    [randomUUID(), userId, JSON.stringify(json), completed, startedAt]);
}

test("the summary is read from saved answers and finished rounds", () => fixture(async ({ db, tx }) => {
  await answer(db, "alice", "2026-10-16", "enter", "volume"); // 10 + 5 + read 3
  await answer(db, "alice", "2026-10-19", "enter", null); // 10, wrong read
  // 10/19 Taipei: an on-plan flat round (25) beats an off-plan one (20) started the same day.
  await round(db, "alice", "2026-10-19T01:00:00Z", true, { orders: [{ code: "2330" }] });
  await round(db, "alice", "2026-10-19T08:00:00Z", true, { orders: [{ code: "2317" }] });
  // 23:30 UTC on 10/19 is 07:30 on 10/20 in Taipei: a second practice day, still holding (20).
  await round(db, "alice", "2026-10-19T23:30:00Z", true, { orders: [{ code: "2330" }], positions: [{ code: "2330", shares: 1000 }] });
  await round(db, "alice", "2026-10-20T00:30:00Z", false, {}); // unfinished: ignored
  const summary = await tx((sql) => loadDiscipline(sql, "alice", TUE_0900));
  assert.deepEqual([summary.total, summary.discipline, summary.eye], [73, 70, 3]);
  assert.equal(summary.level.no, 2);
  assert.deepEqual(summary.recent.map((event) => `${event.key}=${event.points}`), [
    "daily:2026-10-19=10", "practice:2026-10-20=20", "daily:2026-10-16=18", "practice:2026-10-19=25",
  ]);
  const input = await tx((sql) => readDisciplineInput(sql, "alice", TUE_0900));
  assert.deepEqual(input.issued, ["2026-10-19", "2026-10-20"]);
}));

test("a blank reflection or a round without one earns nothing", () => fixture(async ({ db, tx }) => {
  await round(db, "alice", "2026-10-19T01:00:00Z", true, { reflection: "   " });
  const summary = await tx((sql) => loadDiscipline(sql, "alice", TUE_0900));
  assert.equal(summary.total, 0);
  assert.equal(summary.badges.find((badge) => badge.id === "first-practice")!.earned, false);
}));

test("a guest who signs up keeps every point", () => fixture(async ({ db, tx }) => {
  await answer(db, "guest", "2026-10-16", "watch", "unclear");
  await round(db, "guest", "2026-10-19T01:00:00Z", true, {});
  const asGuest = await tx((sql) => loadDiscipline(sql, "guest", TUE_0900));
  assert.equal(asGuest.total, 40);
  await tx((sql) => linkGuestRecords(sql, "guest", "alice"));
  const asMember = await tx((sql) => loadDiscipline(sql, "alice", TUE_0900));
  assert.equal(asMember.total, 40);
  assert.deepEqual(asMember.badges.filter((badge) => badge.earned).map((badge) => badge.id), ["first-daily", "first-practice"]);
}));

test("someone without a profile or guest account cannot read a summary", () => fixture(async ({ db, tx }) => {
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified","isAnonymous") VALUES($1,$1,$2,FALSE,FALSE)', ["stranger", "s@example.invalid"]);
  await assert.rejects(tx((sql) => loadDiscipline(sql, "stranger", TUE_0900)), /學員資料/);
}));

test("a question saved without an outcome still counts the answer, without a read", () => fixture(async ({ db, tx }) => {
  await db.query("INSERT INTO daily_questions(id,issue_date,payload) VALUES($1,$2,$3::jsonb)",
    ["2026-10-09", "2026-10-12", JSON.stringify({ level: 100, bars: [] })]);
  await answer(db, "alice", "2026-10-09", "watch", "unclear");
  const summary = await tx((sql) => loadDiscipline(sql, "alice", TUE_0900));
  assert.deepEqual([summary.total, summary.eye], [15, 0]);
}));
