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
    for (const migration of ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql"])
      await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    for (const id of ["alice", "bob", "unconsented"])
      await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$1,$2,FALSE)', [id, id + "@example.invalid"]);
    await db.exec("INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES ('alice','A','student','A',NOW()),('bob','B','student','B',NOW()),('unconsented','U','student','A',NULL)");
    const read = (user = "alice") => db.transaction(tx => loadMorningSession(sqlFor(tx), user, source));
    const act = (input: unknown, now = 0, user = "alice") => db.transaction(tx => mutateMorningSession(sqlFor(tx), user, input, source, now));
    const start = { action: "start", requestId: randomUUID(), plan: { bias: "observe", focusCode: "2330", reason: "先觀察", entry: "條件成立再進場", stop: "理由消失時離場" } };
    await assert.rejects(read("unconsented"), { status: 403 });
    await assert.rejects(act(start, 0, "unconsented"), { status: 403 });
    assert.equal((await read()).state, null);
    const first = (await act(start)).state!;
    assert.equal(first.cursor, 0); assert.deepEqual(first.bars["2330"], []);
    const duplicates = await Promise.all([act(start), act(start)]);
    assert.ok(duplicates.every(value => value.state!.id === first.id));
    assert.equal((await act({ ...start, requestId: randomUUID(), plan: { ...start.plan, reason: "不可以覆寫原判斷" } })).state!.plan.reason, "先觀察");
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
