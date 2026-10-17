import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { answerDaily, dailyTeacherView, ensureCurrentQuestion, loadDaily } from "./daily-question.server.ts";
import type { Sql } from "./db.ts";

function sqlFor(db: { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (await db.query<T>(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) => (await db.query<T>(query, params)).rows;
  return sql;
}
const at = (iso: string) => Date.parse(iso);
const MON_0700 = at("2026-10-19T07:00:00+08:00");
const TUE_0601 = at("2026-10-20T06:01:00+08:00");
const WED_0601 = at("2026-10-21T06:01:00+08:00");

/** Rows [t, o, h, l, c, v, a]: a confirmed high of 100 at 09:07, pullback to 99, return to 99.8 at 09:12, then quiet. */
function retestRows(): number[][] {
  const rows: [number, number, number][] = [
    [98.1, 97.9, 98], [98.3, 98, 98.2], [98.5, 98.2, 98.4], [98.7, 98.4, 98.6], [98.9, 98.6, 98.8], [99.1, 98.8, 99],
    [99.6, 99, 99.5], [100, 99.5, 99.8], [99.7, 99.4, 99.5], [99.4, 99.1, 99.2], [99.2, 99, 99], [99.3, 99, 99.2],
    [99.85, 99.2, 99.8],
    ...Array.from({ length: 40 }, (_, index) => [99.6 - (index % 3) * 0.1, 99.1, 99.3] as [number, number, number]),
  ];
  return rows.map(([h, l, c], index) => [index * 60, index ? rows[index - 1]![2] : c, h, l, c, 10, c]);
}
const flatRows = () => Array.from({ length: 60 }, (_, index) => [index * 60, 50, 50, 50, 50, 1, 50]);

async function writeDay(dir: string, date: string, rows: number[][]) {
  await mkdir(join(dir, "days", date, "symbols"), { recursive: true });
  const symbol = { code: "2330", name: "台積電", referencePrice: 98, close: 99.3, change: 1, tradeVolume: 900, tradeValue: 9e9, disposition: false, bars: 200 };
  await writeFile(join(dir, "days", date, "index.json"), JSON.stringify({ schema: 1, date, coverage: "full-market", symbols: [symbol] }));
  await writeFile(join(dir, "days", date, "symbols", "2330.json.gz"), gzipSync(JSON.stringify({ schema: 1, code: "2330", bars: rows })));
}

async function fixture(run: (tools: { db: PGlite; sql: Sql; dir: string; tx: <T>(work: (sql: Sql) => Promise<T>) => Promise<T> }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "daily-sql-test-"));
  const dir = join(root, "market-data");
  const db = new PGlite({ dataDir: join(root, "pglite") });
  try {
    for (const migration of ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql", "0008_anonymous_users.sql", "0009_daily_questions.sql"])
      await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    for (const [id, anonymous] of [["alice", false], ["bob", false], ["teacher", false], ["guest", true]] as const)
      await db.query('INSERT INTO "user"(id,name,email,"emailVerified","isAnonymous") VALUES($1,$1,$2,FALSE,$3)', [id, id + "@example.invalid", anonymous]);
    await db.exec(`INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES
      ('alice','小安','student','A',NOW()),('bob','小柏','student','A',NOW()),('teacher','老師','teacher','A',NOW())`);
    await writeDay(dir, "2026-10-14", retestRows());
    await writeDay(dir, "2026-10-19", retestRows());
    await writeDay(dir, "2026-10-20", flatRows());
    await writeFile(join(dir, "index.json"), JSON.stringify({ schema: 1, days: [
      { date: "2026-10-14", coverage: "full-market", symbols: 1, publishedAt: "2026-10-14T18:00:00+08:00" },
      { date: "2026-10-19", coverage: "full-market", symbols: 1, publishedAt: "2026-10-19T18:00:00+08:00" },
      { date: "2026-10-20", coverage: "full-market", symbols: 1, publishedAt: "2026-10-20T18:00:00+08:00" },
    ] }));
    await run({ db, dir, sql: sqlFor(db), tx: (work) => db.transaction((t) => work(sqlFor(t))) });
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
}
const count = async (db: PGlite, query: string) => Number((await db.query<{ count: number }>(query)).rows[0]!.count);

test("two first requests at once create one question", () => fixture(async ({ db, dir, tx }) => {
  const settled = await Promise.allSettled([tx((sql) => ensureCurrentQuestion(sql, dir, MON_0700)), tx((sql) => ensureCurrentQuestion(sql, dir, MON_0700))]);
  assert.ok(settled.every((result) => result.status === "fulfilled"));
  assert.equal(await count(db, "SELECT count(*)::int AS count FROM daily_questions"), 1);
  const current = (settled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof ensureCurrentQuestion>>>).value!;
  assert.deepEqual([current.id, current.issueDate], ["2026-10-14", "2026-10-19"]);
}));

test("before answering only bars up to the question minute are sent", () => fixture(async ({ dir, tx }) => {
  const response = await tx((sql) => loadDaily(sql, "alice", dir, MON_0700));
  assert.equal(response.question!.questionT, 720);
  assert.ok(response.question!.bars.length > 0 && response.question!.bars.every((bar) => bar.t <= 720));
  assert.equal(response.reveal, null);
  assert.equal(JSON.stringify(response).includes("higherHigh"), false);
  assert.equal(response.needsTerms, false);
}));

test("answering reveals the day, the entry result and class counts", () => fixture(async ({ dir, tx }) => {
  const response = await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "enter", stopPrice: 99, reason: "volume" }, dir, MON_0700));
  assert.equal(response.answer!.choice, "enter");
  assert.equal(response.answer!.stopPrice, 99);
  assert.ok(response.reveal!.bars.some((bar) => bar.t > 720));
  assert.equal(response.reveal!.entry!.entryT, 780);
  assert.deepEqual(response.reveal!.counts, { enter: 1, watch: 0, skip: 0, total: 1 });
  assert.equal(response.progress.streak, 1);
}));

test("one answer per learner; a resend returns the first answer", () => fixture(async ({ db, dir, tx }) => {
  await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "watch" }, dir, MON_0700));
  const again = await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "enter" }, dir, MON_0700));
  assert.equal(again.answer!.choice, "watch");
  assert.equal(await count(db, "SELECT count(*)::int AS count FROM daily_answers"), 1);
}));

test("an answer for a question that is no longer current is refused", () => fixture(async ({ dir, tx }) => {
  await tx((sql) => loadDaily(sql, "alice", dir, MON_0700));
  await assert.rejects(tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "watch" }, dir, TUE_0601)),
    { status: 409, message: "題目已更新，請重新載入" });
  assert.equal((await tx((sql) => loadDaily(sql, "alice", dir, TUE_0601))).question!.dataDate, "2026-10-19");
}));

test("stops are checked and members cannot send the guest statement", () => fixture(async ({ dir, tx }) => {
  await assert.rejects(tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "enter" }, dir, MON_0700)),
    { status: 400, message: "選進場要先設停損" });
  await assert.rejects(tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "watch", guestTerms: true }, dir, MON_0700)),
    { status: 400 });
}));

test("guests answer after accepting the statement once", () => fixture(async ({ db, dir, tx }) => {
  assert.equal((await tx((sql) => loadDaily(sql, "guest", dir, MON_0700))).needsTerms, true);
  await assert.rejects(tx((sql) => answerDaily(sql, "guest", { questionId: "2026-10-14", choice: "skip" }, dir, MON_0700)),
    { status: 403, message: "請先確認教學聲明" });
  const answered = await tx((sql) => answerDaily(sql, "guest", { questionId: "2026-10-14", choice: "skip", guestTerms: true }, dir, MON_0700));
  assert.equal(answered.needsTerms, false);
  assert.equal(await count(db, "SELECT count(*)::int AS count FROM guest_consents WHERE user_id = 'guest'"), 1);
}));

test("teachers can see the reveal without answering, with the class list", () => fixture(async ({ dir, tx }) => {
  await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "watch", reason: "unclear" }, dir, MON_0700));
  await tx((sql) => answerDaily(sql, "guest", { questionId: "2026-10-14", choice: "skip", guestTerms: true }, dir, MON_0700));
  const teacher = await tx((sql) => loadDaily(sql, "teacher", dir, MON_0700, { teacherReveal: true }));
  assert.ok(teacher.reveal);
  assert.equal(teacher.answer, null);
  const view = await tx((sql) => dailyTeacherView(sql, "A", dir, MON_0700));
  assert.deepEqual(view.rows.map((row) => [row.name, row.choice, row.reason]), [["小安", "watch", "unclear"], ["小柏", null, null]]);
  assert.equal(view.guests, 1);
  assert.equal(view.reveal!.counts.total, 2);
}));

test("a data day without a candidate is remembered and never retried", () => fixture(async ({ db, dir, tx }) => {
  await tx((sql) => ensureCurrentQuestion(sql, dir, TUE_0601));
  const first = await tx((sql) => ensureCurrentQuestion(sql, dir, WED_0601));
  await tx((sql) => ensureCurrentQuestion(sql, dir, WED_0601));
  assert.equal(first!.id, "2026-10-19");
  assert.equal(await count(db, "SELECT count(*)::int AS count FROM daily_questions WHERE id = '2026-10-20' AND payload IS NULL AND issue_date IS NULL"), 1);
}));

test("one malformed bars file is skipped and the question comes from the other symbols", () => fixture(async ({ db, dir, tx }) => {
  const day = join(dir, "days", "2026-10-14");
  const index = JSON.parse(await readFile(join(day, "index.json"), "utf8"));
  index.symbols.push({ ...index.symbols[0], code: "2317", name: "鴻海", tradeValue: 9.5e9 });
  await writeFile(join(day, "index.json"), JSON.stringify(index));
  // Valid gzip, wrong shape: densifying it used to throw and fail every request.
  await writeFile(join(day, "symbols", "2317.json.gz"), gzipSync(JSON.stringify({ schema: 1, code: "2317", bars: [null, { t: 0 }] })));
  const current = await tx((sql) => ensureCurrentQuestion(sql, dir, MON_0700));
  assert.deepEqual([current!.id, current!.payload.code], ["2026-10-14", "2330"]);
  assert.equal(await count(db, "SELECT count(*)::int AS count FROM daily_questions WHERE payload IS NOT NULL"), 1);
}));

test("a data day that cannot be read is never stored as no question and is retried after a pause", () => fixture(async ({ db, dir, tx }) => {
  await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "watch" }, dir, MON_0700));
  const dayIndex = join(dir, "days", "2026-10-19", "index.json");
  const saved = await readFile(dayIndex, "utf8");
  await writeFile(dayIndex, "{ not json");
  const tuesday = await tx((sql) => loadDaily(sql, "alice", dir, TUE_0601));
  // Served as if nothing was issued yet today: the previous question, its answer and the streak.
  assert.equal(tuesday.question!.dataDate, "2026-10-14");
  assert.equal(tuesday.answer!.choice, "watch");
  assert.equal(tuesday.progress.streak, 1);
  const stored = "SELECT count(*)::int AS count FROM daily_questions WHERE id = '2026-10-19'";
  assert.equal(await count(db, stored), 0);
  await writeFile(dayIndex, saved);
  // At most one attempt per ten minutes: the repaired file is not read again right away.
  assert.equal((await tx((sql) => ensureCurrentQuestion(sql, dir, TUE_0601 + 5 * 60_000)))!.id, "2026-10-14");
  assert.equal(await count(db, stored), 0);
  assert.equal((await tx((sql) => ensureCurrentQuestion(sql, dir, TUE_0601 + 10 * 60_000)))!.id, "2026-10-19");
}));

test("a day whose bars files are all unreadable is a read failure, not a day without a question", () => fixture(async ({ db, dir, tx }) => {
  await writeFile(join(dir, "days", "2026-10-14", "symbols", "2330.json.gz"), "not gzip");
  assert.equal(await tx((sql) => ensureCurrentQuestion(sql, dir, MON_0700)), null);
  assert.equal(await count(db, "SELECT count(*)::int AS count FROM daily_questions"), 0);
}));

test("progress counts by issue day", () => fixture(async ({ dir, tx }) => {
  await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-14", choice: "watch" }, dir, MON_0700));
  const tuesday = await tx((sql) => loadDaily(sql, "alice", dir, TUE_0601));
  assert.equal(tuesday.progress.streak, 1);
  assert.deepEqual(tuesday.progress.week.days.slice(0, 2).map((day) => day.state), ["done", "todo"]);
  await tx((sql) => answerDaily(sql, "alice", { questionId: "2026-10-19", choice: "skip" }, dir, TUE_0601));
  const wednesday = await tx((sql) => loadDaily(sql, "alice", dir, WED_0601));
  assert.equal(wednesday.progress.streak, 2);
  assert.deepEqual(wednesday.progress.week.days.slice(0, 3).map((day) => day.state), ["done", "done", "off"]);
}));
