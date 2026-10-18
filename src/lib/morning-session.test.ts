import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { loadMorningSession, mutateMorningSession } from "./morning-session.server.ts";
import type { MorningSource } from "./morning-engine.ts";
import type { Sql } from "./db.ts";
import { summarizeMorningLesson } from "./morning.ts";

function sqlFor(db: { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (await db.query<T>(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) => (await db.query<T>(query, params)).rows;
  return sql;
}
const source: MorningSource = {
  catalog: { lessonId: "test-source-v1", title: "fixture", date: "2026-10-06", start: "09:00", end: "10:30", maxCursor: 90,
    symbols: [{ code: "2330", name: "fixture", previousClose: 100, previous5CloseMean: 99 }], context: [], strategy: [], notices: [], videoUrl: null },
  bars: { "2330": Array.from({ length: 90 }, (_, index) => ({ t: index * 60, o: 100 + index, h: 102 + index, l: 99 + index, c: 101 + index, v: 100 })) },
};
test("real SQL replay: owner, consent, atomic revisions, request idempotence, persistence and no stored future bars", async () => {
  const directory = await mkdtemp(join(tmpdir(), "morning-sql-test-"));
  let db = new PGlite({ dataDir: join(directory, "pglite") });
  try {
    for (const migration of ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql", "0008_anonymous_users.sql", "0009_daily_questions.sql"])
      await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    for (const id of ["alice", "bob", "unconsented"])
      await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$1,$2,FALSE)', [id, id + "@example.invalid"]);
    await db.exec("INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('alice','A','student','A',NOW()),('bob','B','student','B',NOW()),('unconsented','U','student','A',NULL)");
    const otherSource = structuredClone(source);
    otherSource.catalog.lessonId = "test-source-another-date-and-hash";
    otherSource.catalog.date = "2026-10-05";
    for (const bar of otherSource.bars["2330"]) { bar.o += 10; bar.h += 10; bar.l += 10; bar.c += 10; }
    const lessons = [source, otherSource].map(value => summarizeMorningLesson(value.catalog));
    const read = (user = "alice", selectedSource = source) => db.transaction(tx => loadMorningSession(sqlFor(tx), user, selectedSource, lessons));
    const act = (input: unknown, now = 0, user = "alice", selectedSource = source) =>
      db.transaction(tx => mutateMorningSession(sqlFor(tx), user, input, selectedSource, now, lessons));
    const start = { action: "start", requestId: randomUUID(), plan: { exerciseId: "first-order", bias: "observe", focusCode: "2330", reason: "先觀察", entry: "條件成立再進場", stop: "理由消失時離場" } };
    await assert.rejects(read("unconsented"), { status: 403 });
    await assert.rejects(act(start, 0, "unconsented"), { status: 403 });
    assert.equal((await read()).state, null);
    assert.deepEqual((await read()).lessons, lessons);
    await assert.rejects(act({ ...start, plan: { ...start.plan, exerciseId: "unapproved" } }), { status: 400 });
    const first = (await act(start)).state!;
    assert.equal(first.cursor, 0); assert.deepEqual(first.bars["2330"], []);
    const duplicates = await Promise.all([act(start), act(start)]);
    assert.ok(duplicates.every(value => value.state!.id === first.id));
    assert.deepEqual((await act({ ...start, requestId: randomUUID(), plan: { ...start.plan, exerciseId: "review", reason: "不可以覆寫原判斷" } })).state!.plan, start.plan);
    assert.equal((await read("bob")).state, null);
    const advance = { action: "advance", requestId: randomUUID(), id: first.id, expectedRevision: 0 };
    await assert.rejects(act(advance, 1000, "bob"), { status: 404 });
    await assert.rejects(act(advance, 999), { status: 429 });
    const concurrent = await Promise.all([act(advance, 1000), act(advance, 1000)]);
    assert.ok(concurrent.every(value => value.state!.cursor === 1 && value.state!.revision === 1));
    assert.equal((await act(advance, 1000)).state!.revision, 1);
    await assert.rejects(act({ ...advance, expectedRevision: 1 }, 2000), { status: 409 });
    await assert.rejects(act({ ...advance, requestId: randomUUID() }, 2000), { status: 409 });
    const different = await Promise.allSettled([1, 2].map(() => act({ ...advance, requestId: randomUUID(), expectedRevision: 1 }, 2000)));
    assert.equal(different.filter(result => result.status === "fulfilled").length, 1);
    let state = (await read()).state!;
    assert.equal(state.cursor, 2); assert.equal(state.revision, 2); assert.equal(state.bars["2330"].length, 2);
    const saved = (await db.query<{ state_json: object }>("SELECT state_json FROM morning_sessions")).rows;
    assert.equal(saved.length, 1); assert.equal(Object.hasOwn(saved[0].state_json, "bars"), false);
    const finish = { action: "finish", requestId: randomUUID(), id: first.id, expectedRevision: state.revision, reflection: "我選擇提早結束並記錄觀察。" };
    state = (await act(finish, 2100)).state!;
    assert.equal(state.completed, true);
    assert.deepEqual((await act(finish, 2200)).state, state);
    await assert.rejects(act({ ...finish, requestId: randomUUID(), expectedRevision: state.revision }, 2300), { status: 409 });
    await db.close();
    db = new PGlite({ dataDir: join(directory, "pglite") });
    assert.deepEqual((await read()).state, state);
    assert.deepEqual((await act(finish, 2500)).state, state);
    const second = (await act({ ...start, requestId: randomUUID() }, 3000)).state!;
    assert.notEqual(second.id, first.id); assert.equal(second.cursor, 0);
    // An old request must neither create a third run nor mutate the new active one.
    assert.equal((await act(start, 3100)).state!.id, first.id);
    assert.equal((await read()).state!.id, second.id);
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM morning_sessions")).rows[0].count, 2);

    // Each approved source has its own active run; a known request ID must never
    // become authorization to apply that request to another date/source hash.
    assert.equal((await read("alice", otherSource)).state, null);
    await assert.rejects(act(start, 3200, "alice", otherSource), { status: 409 });
    const otherStart = { ...start, requestId: randomUUID(), plan: { ...start.plan, exerciseId: "patience" } };
    let otherState = (await act(otherStart, 3200, "alice", otherSource)).state!;
    assert.notEqual(otherState.id, second.id);
    assert.equal(otherState.lessonId, otherSource.catalog.lessonId);
    assert.equal(otherState.plan.exerciseId, "patience");
    await assert.rejects(act({ action: "advance", requestId: randomUUID(), id: second.id, expectedRevision: 0 }, 4200, "alice", otherSource), { status: 404 });
    const otherAdvance = { action: "advance", requestId: randomUUID(), id: otherState.id, expectedRevision: 0 };
    await assert.rejects(act(otherAdvance, 4200, "alice"), { status: 404 });
    await assert.rejects(act(otherAdvance, 4200, "bob", otherSource), { status: 404 });
    otherState = (await act(otherAdvance, 4200, "alice", otherSource)).state!;
    assert.deepEqual(otherState.bars["2330"], otherSource.bars["2330"].slice(0, 1));
    assert.deepEqual((await read()).state, second);
    assert.equal((await read("bob", otherSource)).state, null);
    await assert.rejects(act(otherAdvance, 5000), { status: 409 });
    await db.close();
    db = new PGlite({ dataDir: join(directory, "pglite") });
    assert.deepEqual((await read()).state, second);
    assert.deepEqual((await read("alice", otherSource)).state, otherState);
    assert.deepEqual((await act(otherAdvance, 6000, "alice", otherSource)).state, otherState);
    assert.equal((await act(start, 6100)).state!.id, first.id, "Legacy/default lesson retries retain the original run");
  } finally {
    await db.close();
    const target = resolve(directory);
    const temporaryRoot = resolve(tmpdir());
    const relativeTarget = relative(temporaryRoot, target);
    assert.ok(relativeTarget && !relativeTarget.startsWith("..") && !isAbsolute(relativeTarget)
      && dirname(target) === temporaryRoot && basename(target).startsWith("morning-sql-test-"),
    "Refuse to remove a path outside this test's temporary directory");
    await rm(target, { recursive: true, force: true });
  }
});

async function guestFixture(run: (tools: {
  read: (user: string) => Promise<Awaited<ReturnType<typeof loadMorningSession>>>;
  act: (input: unknown, now: number, user: string) => Promise<Awaited<ReturnType<typeof mutateMorningSession>>>;
  count: (query: string) => Promise<number>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "morning-sql-test-"));
  const db = new PGlite({ dataDir: join(directory, "pglite") });
  try {
    for (const migration of ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql", "0008_anonymous_users.sql", "0009_daily_questions.sql"])
      await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    for (const [id, anonymous] of [["guest", true], ["guest2", true], ["member", false], ["stranger", false]] as const)
      await db.query('INSERT INTO "user"(id,name,email,"emailVerified","isAnonymous") VALUES($1,$1,$2,FALSE,$3)', [id, id + "@example.invalid", anonymous]);
    await db.exec("INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('member','M','student','A',NOW())");
    await run({
      read: user => db.transaction(tx => loadMorningSession(sqlFor(tx), user, source)),
      act: (input, now, user) => db.transaction(tx => mutateMorningSession(sqlFor(tx), user, input, source, now)),
      count: async query => Number((await db.query<{ count: number }>(query)).rows[0].count),
    });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const guestStart = () => ({ action: "start", requestId: randomUUID(), plan: { exerciseId: "first-order", bias: "bullish", focusCode: "2330",
  reason: "開盤後走強，想等它站上前高", entry: "價格站上前高（圖上標「前高」的虛線）再買", stop: "跌回前高下方就賣出" } });

test("guests can read freely but start only with the teaching statement", () => guestFixture(async ({ read, act, count }) => {
  const start = guestStart();
  assert.equal((await read("guest")).state, null);
  await assert.rejects(act(start, 0, "guest"), { status: 403, message: "請先確認教學聲明" });
  const began = (await act({ ...start, guestTerms: true }, 0, "guest")).state!;
  assert.equal(began.cursor, 0);
  assert.equal(await count("SELECT count(*)::int AS count FROM guest_consents WHERE user_id='guest'"), 1);
  assert.equal(await count("SELECT count(*)::int AS count FROM classroom_profiles WHERE user_id='guest'"), 0);
  await assert.rejects(act({ ...guestStart(), guestTerms: true }, 0, "member"), { status: 400, message: "這個帳號不需要訪客聲明" });
  await assert.rejects(read("stranger"), { status: 403, message: "請先完成學員資料與教學聲明" });
  const advanced = (await act({ action: "advance", requestId: randomUUID(), id: began.id, expectedRevision: 0 }, 1000, "guest")).state!;
  assert.equal(advanced.cursor, 1);
}));

test("guest start is idempotent under a double tap", () => guestFixture(async ({ act, count }) => {
  const start = { ...guestStart(), guestTerms: true };
  // allSettled: a rejected first call must not leave the second transaction pending at close.
  const settled = await Promise.allSettled([act(start, 0, "guest2"), act(start, 0, "guest2")]);
  const [first, second] = settled.map(result => {
    assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason?.message) : "");
    return (result as PromiseFulfilledResult<Awaited<ReturnType<typeof mutateMorningSession>>>).value;
  });
  assert.equal(first.state!.id, second.state!.id);
  assert.equal(await count("SELECT count(*)::int AS count FROM guest_consents WHERE user_id='guest2'"), 1);
  assert.equal((await act({ ...guestStart(), guestTerms: true }, 10, "guest2")).state!.id, first.state!.id);
}));

test("finishing a round celebrates its points once; a second round that day adds nothing", () => guestFixture(async ({ act }) => {
  const run = (await act(guestStart(), 0, "member")).state!;
  const finish = { action: "finish", requestId: randomUUID(), id: run.id, expectedRevision: run.revision, reflection: "條件沒有成立，不交易。" };
  const done = await act(finish, 100, "member");
  assert.equal(done.celebration!.source, "practice");
  assert.deepEqual([done.celebration!.points, done.celebration!.beforeTotal, done.celebration!.total], [25, 0, 25]);
  assert.deepEqual(done.celebration!.newBadges.map((badge) => badge.id), ["first-practice"]);
  assert.equal((await act(finish, 200, "member")).celebration ?? null, null, "a retried finish does not celebrate again");
  const second = (await act(guestStart(), 300, "member")).state!;
  const again = await act({ action: "finish", requestId: randomUUID(), id: second.id, expectedRevision: second.revision, reflection: "再練一輪。" }, 400, "member");
  assert.deepEqual([again.celebration!.points, again.celebration!.alreadyCounted], [0, true]);
  const advanced = (await act({ action: "advance", requestId: randomUUID(), id: (await act(guestStart(), 500, "member")).state!.id, expectedRevision: 0 }, 1500, "member"));
  assert.equal(advanced.celebration ?? null, null, "only finishing celebrates");
}));
