import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { linkGuestRecords, purgeStaleGuests } from "./guest-link.server.ts";
import type { Sql } from "./db.ts";

function sqlFor(db: { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (await db.query<T>(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) => (await db.query<T>(query, params)).rows;
  return sql;
}

async function fixture(run: (tools: {
  db: PGlite;
  link: (guest: string, account: string) => Promise<Awaited<ReturnType<typeof linkGuestRecords>>>;
  addUser: (id: string, anonymous: boolean, createdAt?: Date) => Promise<void>;
  addRun: (userId: string, lessonId: string, completed: boolean) => Promise<string>;
  addRequest: (userId: string, sessionId: string) => Promise<void>;
  count: (query: string, params?: unknown[]) => Promise<number>;
  owner: (sessionId: string) => Promise<string | undefined>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "guest-link-test-"));
  const db = new PGlite({ dataDir: join(directory, "pglite") });
  try {
    for (const migration of ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql", "0008_anonymous_users.sql", "0009_daily_questions.sql"])
      await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    await run({
      db,
      link: (guest, account) => db.transaction(tx => linkGuestRecords(sqlFor(tx), guest, account)),
      addUser: async (id, anonymous, createdAt = new Date()) => {
        await db.query('INSERT INTO "user"(id,name,email,"emailVerified","isAnonymous","createdAt") VALUES($1,$1,$2,FALSE,$3,$4)',
          [id, id + "@example.invalid", anonymous, createdAt]);
      },
      addRun: async (userId, lessonId, completed) => {
        const id = randomUUID();
        await db.query("INSERT INTO morning_sessions(id,user_id,lesson_id,state_json,completed) VALUES($1,$2,$3,'{}'::jsonb,$4)",
          [id, userId, lessonId, completed]);
        return id;
      },
      addRequest: async (userId, sessionId) => {
        await db.query("INSERT INTO morning_requests(user_id,request_id,session_id,action_hash) VALUES($1,$2,$3,'hash')",
          [userId, randomUUID(), sessionId]);
      },
      count: async (query, params = []) => Number((await db.query<{ count: number }>(query, params)).rows[0].count),
      owner: async sessionId => (await db.query<{ user_id: string }>("SELECT user_id FROM morning_sessions WHERE id = $1", [sessionId])).rows[0]?.user_id,
    });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("moves a guest's runs to the account and deletes the guest", () => fixture(async ({ link, addUser, addRun, addRequest, count, owner, db }) => {
  await addUser("guest", true);
  await addUser("acct", false);
  const done = await addRun("guest", "L1", true);
  const active = await addRun("guest", "L2", false);
  await addRequest("guest", done);
  await addRequest("guest", active);
  await db.query("INSERT INTO guest_consents(user_id) VALUES('guest')");
  assert.deepEqual(await link("guest", "acct"), { linked: true, moved: 2, skipped: false });
  assert.equal(await owner(done), "acct");
  assert.equal(await owner(active), "acct");
  assert.equal(await count("SELECT count(*) FROM morning_requests WHERE user_id = 'guest'"), 0);
  assert.equal(await count(`SELECT count(*) FROM "user" WHERE id = 'guest'`), 0);
  assert.equal(await count("SELECT count(*) FROM guest_consents WHERE user_id = 'guest'"), 0);
}));

test("keeps the account's active run when both have one for the same lesson", () => fixture(async ({ link, addUser, addRun, owner }) => {
  await addUser("guest", true);
  await addUser("acct", false);
  const accountRun = await addRun("acct", "L1", false);
  const guestActive = await addRun("guest", "L1", false);
  const guestDone = await addRun("guest", "L1", true);
  assert.deepEqual(await link("guest", "acct"), { linked: true, moved: 1, skipped: true });
  assert.equal(await owner(accountRun), "acct");
  assert.equal(await owner(guestActive), undefined);
  assert.equal(await owner(guestDone), "acct");
}));

test("completed runs on both sides are all kept", () => fixture(async ({ link, addUser, addRun, count }) => {
  await addUser("guest", true);
  await addUser("acct", false);
  await addRun("acct", "L1", true);
  await addRun("guest", "L1", true);
  assert.deepEqual(await link("guest", "acct"), { linked: true, moved: 1, skipped: false });
  assert.equal(await count("SELECT count(*) FROM morning_sessions WHERE user_id = 'acct' AND lesson_id = 'L1'"), 2);
}));

test("never links into itself or another guest and never deletes a member", () => fixture(async ({ link, addUser, addRun, count, owner }) => {
  await addUser("guest", true);
  await addUser("guest2", true);
  await addUser("member", false);
  await addUser("acct", false);
  const guestRun = await addRun("guest", "L1", false);
  const memberRun = await addRun("member", "L1", false);
  assert.equal((await link("guest", "guest")).linked, false);
  assert.equal((await link("guest", "guest2")).linked, false);
  assert.equal((await link("member", "acct")).linked, false);
  assert.equal((await link("guest", "missing")).linked, false);
  assert.equal(await count(`SELECT count(*) FROM "user" WHERE id IN ('guest','guest2','member')`), 3);
  assert.equal(await owner(guestRun), "guest");
  assert.equal(await owner(memberRun), "member");
}));

test("a failure later in the caller's transaction leaves the guest untouched", () => fixture(async ({ db, addUser, addRun, addRequest, count, owner }) => {
  await addUser("guest", true);
  await addUser("acct", false);
  const run = await addRun("guest", "L1", false);
  await addRequest("guest", run);
  await db.query("INSERT INTO guest_consents(user_id) VALUES('guest')");
  await assert.rejects(db.transaction(async tx => {
    await linkGuestRecords(sqlFor(tx), "guest", "acct");
    throw new Error("later step failed");
  }), /later step failed/);
  assert.equal(await owner(run), "guest");
  assert.equal(await count("SELECT count(*) FROM morning_requests WHERE user_id = 'guest'"), 1);
  assert.equal(await count("SELECT count(*) FROM guest_consents WHERE user_id = 'guest'"), 1);
  assert.equal(await count(`SELECT count(*) FROM "user" WHERE id = 'guest'`), 1);
}));

test("purges only anonymous users older than 30 days, at most the limit", () => fixture(async ({ db, addUser, addRun, count }) => {
  const now = new Date("2026-10-16T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  await addUser("old1", true, daysAgo(31));
  await addUser("old2", true, daysAgo(40));
  await addUser("fresh", true, daysAgo(1));
  await addUser("oldMember", false, daysAgo(90));
  await addRun("old1", "L1", false);
  await addRun("old2", "L1", true);
  const sql = sqlFor(db);
  assert.equal(await purgeStaleGuests(sql, now, 1), 1);
  assert.equal(await purgeStaleGuests(sql, now), 1);
  assert.equal(await purgeStaleGuests(sql, now), 0);
  assert.equal(await count(`SELECT count(*) FROM "user" WHERE id IN ('fresh','oldMember')`), 2);
  assert.equal(await count(`SELECT count(*) FROM "user" WHERE id IN ('old1','old2')`), 0);
  assert.equal(await count("SELECT count(*) FROM morning_sessions WHERE user_id IN ('old1','old2')"), 0);
}));

test("guest daily answers move to the account unless it already answered", () => fixture(async ({ db, link, addUser }) => {
  await addUser("guest", true);
  await addUser("acct", false);
  await db.exec(`INSERT INTO daily_questions(id, issue_date, payload) VALUES
    ('2026-10-14', '2026-10-19', '{}'::jsonb), ('2026-10-15', '2026-10-20', '{}'::jsonb)`);
  await db.exec(`INSERT INTO daily_answers(user_id, question_id, choice) VALUES
    ('guest', '2026-10-14', 'watch'), ('guest', '2026-10-15', 'skip'), ('acct', '2026-10-15', 'watch')`);
  assert.equal((await link("guest", "acct")).linked, true);
  const rows = (await db.query<{ question_id: string; choice: string }>(
    "SELECT question_id, choice FROM daily_answers WHERE user_id = 'acct' ORDER BY question_id")).rows;
  assert.deepEqual(rows.map((row) => [row.question_id, row.choice]), [["2026-10-14", "watch"], ["2026-10-15", "watch"]]);
}));
