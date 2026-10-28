import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MorningReply, MorningResponse } from "./morning.ts";
import { RETIRED_LESSONS } from "./morning-data.server.ts";
import { loadMorningSession, mutateMorningSession, serveMorningRequest, type MorningDb } from "./morning-session.server.ts";
import { SIX_ALL_MORNING, sqlFor, withClassroom, withMarket, writeDay, type Classroom } from "./morning-fixtures.ts";

// The two Yahoo lessons (10/05, 10/06) are retired: their runs stay readable as text and can still be finished or
// abandoned (decision R), with no lesson data at all; nothing can move them forward and no new run starts on them.
const [[OLD_ID, OLD_DATE], [OLD_ID_2]] = Object.entries(RETIRED_LESSONS);
const STOPPED = "這堂舊課已停用，只能完成或放棄";
const plan = { exerciseId: "first-order", bias: "bullish", focusCode: "2330", reason: "開盤量能放大", entry: "突破前高再進場", stop: "跌破開盤價離場" };
/** The plan of a new run (the picker's, never an old lesson's). */
const startPlan = { bias: "observe", focusCode: "2330", reason: "先觀察開盤", entry: "條件成立再進場", stop: "理由消失時離場" };

/** An unfinished run as the Yahoo lessons saved it: no `codes`, no source hash, one holding, one filled and one waiting order. */
function oldState(id: string, lessonId = OLD_ID) {
  return {
    id, lessonId, cursor: 30, revision: 12, plan,
    startingCash: 10_000_000, cash: 8_000_000, equity: 10_012_345,
    positions: [{ code: "2330", shares: 2_000, averageCost: 1_000 }],
    orders: [
      { id: randomUUID(), code: "2330", side: "buy", shares: 2_000, status: "filled", submittedCursor: 5, price: 1_000 },
      { id: randomUUID(), code: "2317", side: "buy", shares: 1_000, status: "pending", submittedCursor: 29, limitPrice: 200 },
    ],
    fills: [{ id: randomUUID(), code: "2330", side: "buy", shares: 2_000, price: 1_000, fee: 285, tax: 0, t: 360 }],
    completed: false, reflection: "", nextAdvanceAt: 0, startedAt: 0,
  };
}
async function seed(classroom: Classroom, user: string, lessonId = OLD_ID, extra: object = {}): Promise<string> {
  const id = randomUUID();
  await classroom.db.query("INSERT INTO morning_sessions(id,user_id,lesson_id,state_json,completed) VALUES($1,$2,$3,$4::jsonb,FALSE)",
    [id, user, lessonId, JSON.stringify({ ...oldState(id, lessonId), ...extra })]);
  return id;
}
const stateOf = async (classroom: Classroom, id: string) =>
  (await classroom.db.query<{ state_json: Record<string, unknown>; completed: boolean }>("SELECT state_json, completed FROM morning_sessions WHERE id = $1", [id])).rows[0];

const params = (lesson?: string) => new URLSearchParams(lesson === undefined ? {} : { lesson });
/** The API as the route calls it, on a market folder (or "": no daily lessons, on-prem). */
function api(classroom: Classroom, dir: string) {
  return {
    get: (user: string, lesson?: string) => classroom.tx((sql) => loadMorningSession(sql, user, { dir, params: params(lesson) })),
    post: (user: string, input: unknown, now = 5_000, lesson?: string) =>
      classroom.tx((sql) => mutateMorningSession(sql, user, input, { dir, params: params(lesson), clock: now })),
  };
}
function served(reply: MorningReply): MorningResponse {
  assert.ok(!("unavailable" in reply), "the run is served");
  return reply as MorningResponse;
}
const stepOf = (action: string, run: { id: string; revision: number }, extra: object = {}) =>
  ({ action, requestId: randomUUID(), id: run.id, expectedRevision: run.revision, ...extra });
const REFLECTION = "舊課這局守住了停損，之後要等量縮再進場。";

test("old run opens text-only", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    const id = await seed(classroom, "alice");
    // The same on a folder with lesson days, on an empty folder and with no daily lessons at all (on-prem).
    const empty = join(dir, "no-lessons-here");
    await mkdir(empty);
    for (const folder of [dir, empty, ""]) {
      const { get } = api(classroom, folder);
      const reply = served(await get("alice", OLD_ID));
      assert.equal(reply.retired, true);
      assert.deepEqual(Object.keys(reply.catalog).sort(), ["context", "date", "end", "lessonId", "maxCursor", "notices", "start", "strategy", "symbols", "title", "videoUrl"]);
      assert.equal(reply.catalog.lessonId, OLD_ID);
      assert.equal(reply.catalog.title, "舊課（已停用）");
      assert.equal(reply.catalog.date, OLD_DATE);
      assert.equal(reply.catalog.maxCursor, 90);
      assert.deepEqual(reply.catalog.symbols.map((symbol) => [symbol.code, symbol.name]),
        [["2330", "台積電"], ["2317", "鴻海"], ["2454", "聯發科"], ["2382", "廣達"], ["2308", "台達電"]]);
      assert.ok(reply.catalog.symbols.every((symbol) => symbol.previousClose === 0 && symbol.previous5CloseMean === null));
      assert.deepEqual([reply.catalog.context, reply.catalog.strategy, reply.catalog.notices], [[], [], []]);
      // The run as saved: plan, orders, fills and P/L; never a bar, the TAIEX, a tape, a book or a picker.
      assert.equal(reply.state!.id, id);
      assert.deepEqual(reply.state!.bars, {});
      assert.equal(reply.state!.index, undefined);
      assert.equal(reply.state!.cursor, 30);
      assert.equal(reply.state!.equity, 10_012_345);
      assert.deepEqual(reply.state!.plan, plan);
      assert.equal(reply.state!.orders.length, 2);
      assert.equal(reply.state!.fills.length, 1);
      for (const key of ["tape", "delta", "picker", "book", "lessons", "blockedRun"] as const) assert.equal(reply[key], undefined, key);
      assert.deepEqual(reply.records!.map((record) => [record.id, record.lessonId, record.date, record.retired, record.completed, record.pnl]),
        [[id, OLD_ID, OLD_DATE, true, false, 12_345]]);
    }
    // The other retired lesson, and a finished run, open the same way.
    const finished = await seed(classroom, "alice", OLD_ID_2, { completed: true, reflection: "完成", revision: 20 });
    await classroom.db.query("UPDATE morning_sessions SET completed = TRUE WHERE id = $1", [finished]);
    const other = served(await api(classroom, "").get("alice", OLD_ID_2));
    assert.deepEqual([other.retired, other.state!.id, other.state!.completed, other.state!.reflection, other.catalog.date], [true, finished, true, "完成", "2026-10-06"]);
    // Nobody else's run, and no run at all, is served.
    await assert.rejects(api(classroom, dir).get("bob", OLD_ID), { status: 404, message: "這堂舊課已停用" });
    await assert.rejects(api(classroom, dir).get("guest", OLD_ID), { status: 404 });
    // A run saved without its id still opens, under the id it is stored with.
    const bare = await seed(classroom, "bob", OLD_ID, { id: undefined });
    assert.equal(served(await api(classroom, "").get("bob", OLD_ID)).state!.id, bare);
  });
}));

test("old unfinished run can finish with reflection and keeps its P/L", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    // Once on a folder with days, once on-prem: it needs no lesson data either way.
    for (const folder of [dir, ""]) {
      const user = folder ? "alice" : "bob";
      const id = await seed(classroom, user);
      const { post, get } = api(classroom, folder);
      const finish = stepOf("finish", { id, revision: 12 }, { reflection: REFLECTION });
      // Without ?lesson= (found by its id) and with it, the same.
      const done = served(await post(user, finish, 7_000));
      assert.equal(done.retired, true);
      assert.deepEqual(done.state!.bars, {});
      assert.equal(done.state!.index, undefined);
      assert.equal(done.state!.completed, true);
      assert.equal(done.state!.reflection, REFLECTION);
      assert.equal(done.state!.revision, 13);
      assert.equal(done.state!.equity, 10_012_345, "the P/L is the last saved equity");
      assert.equal(done.state!.abandoned, undefined);
      assert.deepEqual(done.state!.orders.map((order) => order.status), ["filled", "cancelled"]);
      assert.equal(done.state!.orders[1].reason, "結束練習時取消尚未成交委託");
      assert.equal(done.catalog.title, "舊課（已停用）");
      assert.equal(done.catalog.maxCursor, 90);
      assert.ok(done.celebration === null || typeof done.celebration === "object", "the discipline rules run as for any finished run");
      const saved = await stateOf(classroom, id);
      assert.equal(saved.completed, true);
      assert.equal(saved.state_json.reflection, REFLECTION);
      assert.equal(saved.state_json.equity, 10_012_345);
      // A retry gives the same answer; a second finish is refused as for any finished run.
      assert.deepEqual(served(await post(user, finish, 8_000, OLD_ID)).state, done.state);
      await assert.rejects(post(user, stepOf("finish", { id, revision: 13 }, { reflection: REFLECTION }), 9_000, OLD_ID), { status: 409 });
      const opened = served(await get(user, OLD_ID));
      assert.deepEqual([opened.retired, opened.state!.completed, opened.state!.reflection], [true, true, REFLECTION]);
      const record = opened.records!.find((entry) => entry.id === id)!;
      assert.deepEqual([record.pnl, record.reflected, record.abandoned, record.completed, record.retired], [12_345, true, false, true, true]);
    }
    // The reflection is required, as ever.
    const id = await seed(classroom, "member");
    await assert.rejects(api(classroom, dir).post("member", stepOf("finish", { id, revision: 12 }, { reflection: "  " })), { status: 400 });
    assert.equal((await stateOf(classroom, id)).completed, false);
    // A finish sent with a stale revision is refused and changes nothing.
    await assert.rejects(api(classroom, "").post("member", stepOf("finish", { id, revision: 11 }, { reflection: REFLECTION })), { status: 409 });
    assert.equal((await stateOf(classroom, id)).state_json.revision, 12);
  });
}));

test("old run can be abandoned", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    for (const folder of [dir, ""]) {
      const user = folder ? "alice" : "bob";
      const id = await seed(classroom, user);
      const { post, get } = api(classroom, folder);
      const abandon = stepOf("abandon", { id, revision: 12 });
      const done = served(await post(user, abandon, 7_000, OLD_ID));
      assert.equal(done.retired, true);
      assert.deepEqual(done.state!.bars, {});
      assert.deepEqual([done.state!.completed, done.state!.abandoned, done.state!.reflection, done.state!.equity], [true, true, "", 10_012_345]);
      assert.deepEqual(done.state!.orders.map((order) => [order.status, order.reason]), [["filled", undefined], ["cancelled", "放棄這局時取消尚未成交委託"]]);
      assert.equal(done.celebration, undefined, "abandoning never counts");
      assert.equal((await stateOf(classroom, id)).completed, true);
      assert.deepEqual(served(await post(user, abandon, 8_000)).state, done.state, "a retry answers the same");
      await assert.rejects(post(user, stepOf("abandon", { id, revision: 13 }), 9_000), { status: 409 });
      const record = served(await get(user, OLD_ID)).records!.find((entry) => entry.id === id)!;
      assert.deepEqual([record.abandoned, record.completed, record.pnl, record.retired], [true, true, 12_345, true]);
    }
  });
}));

test("advance and order on an old run → 409", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    const id = await seed(classroom, "alice");
    const run = { id, revision: 12 };
    const orders = (await stateOf(classroom, id)).state_json.orders as { id: string }[];
    const refused: [string, object][] = [
      ["advance", stepOf("advance", run)],
      ["advance with a view", stepOf("advance", run, { view: "2330" })],
      ["order", stepOf("order", run, { code: "2330", side: "sell", lots: 1 })],
      ["limit order", stepOf("order", run, { code: "2330", side: "sell", lots: 1, limitPrice: 1_100 })],
      ["cancel", stepOf("cancel", run, { orderId: orders[1].id })],
    ];
    const before = await stateOf(classroom, id);
    for (const folder of [dir, ""])
      for (const lesson of [undefined, OLD_ID])
        for (const [label, action] of refused)
          await assert.rejects(api(classroom, folder).post("alice", action, 9_000_000, lesson), { status: 409, message: STOPPED }, `${label} ${folder ? "dir" : "on-prem"} ${lesson ?? "by id"}`);
    // Not even with a stale revision: it is the lesson that is closed.
    await assert.rejects(api(classroom, dir).post("alice", stepOf("advance", { id, revision: 3 })), { status: 409, message: STOPPED });
    // Nothing changed or was recorded; another learner's id is still not found.
    assert.deepEqual(await stateOf(classroom, id), before);
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM morning_requests"), 0);
    await assert.rejects(api(classroom, dir).post("bob", stepOf("advance", run)), { status: 404 });
    assert.deepEqual(await api(classroom, "").post("bob", stepOf("advance", run)), { unavailable: "此教室沒有每日教材" }, "on-prem, an id that is not the learner's old run is just no lesson");
    // The run can still be ended afterwards.
    assert.equal(served(await api(classroom, "").post("alice", stepOf("abandon", run), 10_000)).state!.abandoned, true);
    // A finished old run is refused the same way (it cannot be moved either).
    await assert.rejects(api(classroom, dir).post("alice", stepOf("advance", { id, revision: 13 })), { status: 409 });
  });
}));

test("no new run can start on an old lesson", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-27", SIX_ALL_MORNING);
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    const start = () => ({ action: "start", requestId: randomUUID(), plan: startPlan, codes: ["2330"] });
    for (const folder of [dir, ""])
      for (const lesson of Object.keys(RETIRED_LESSONS))
        for (const user of ["alice", "guest"])
          await assert.rejects(api(classroom, folder).post(user, { ...start(), ...(user === "guest" ? { guestTerms: true } : {}) }, 1_000, lesson),
            (error: { status?: number; message?: string }) => error.status === 404 && error.message === "這堂舊課已停用", `${lesson} ${user}`);
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM morning_sessions"), 0);
    // With an unfinished old run, a start on its lesson does not give it back either.
    const id = await seed(classroom, "alice");
    await assert.rejects(api(classroom, dir).post("alice", start(), 2_000, OLD_ID), { status: 404 });
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM morning_sessions"), 1);
    // "Back to the latest run" never goes back to an old one, even when it was touched last.
    await classroom.db.query("UPDATE morning_sessions SET updated_at = NOW() + interval '1 hour' WHERE id = $1", [id]);
    const resumed = served(await api(classroom, dir).get("alice"));
    assert.equal(resumed.retired, undefined);
    assert.equal(resumed.state, null);
    assert.equal(resumed.picker!.date, "2026-10-28");
    // A start without a lesson opens a run on the newest day, not on the old lesson.
    const fresh = served(await api(classroom, dir).post("alice", start(), 3_000));
    assert.equal(fresh.state!.lessonId, "fubon-20261028-am");
    assert.equal(fresh.retired, undefined);
    assert.equal(served(await api(classroom, dir).get("alice")).state!.id, fresh.state!.id);
    // On-prem, with no daily lessons, a read of the lists still tells the learner what runs there are.
    const onPrem = await api(classroom, "").get("alice");
    assert.equal("unavailable" in onPrem && onPrem.unavailable, "此教室沒有每日教材");
    assert.deepEqual("records" in onPrem ? onPrem.records!.map((record) => [record.lessonId, record.retired]) : null,
      [["fubon-20261028-am", false], [OLD_ID, true]]);
  });
}));

test("old runs through the route's path (market sealed in the transaction)", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    let transactions = 0;
    const db: MorningDb = {
      read: () => sqlFor(classroom.db),
      transaction: (run) => {
        transactions += 1;
        return classroom.db.transaction((tx) => run(sqlFor(tx)));
      },
    };
    for (const folder of [dir, ""]) {
      const user = folder ? "alice" : "bob";
      const id = await seed(classroom, user);
      const get = (lesson?: string) => serveMorningRequest(db, user, { method: "GET", params: params(lesson) }, { dir: folder });
      const post = (input: unknown, lesson?: string) => serveMorningRequest(db, user, { method: "POST", params: params(lesson), input }, { dir: folder, clock: 5_000 });
      transactions = 0;
      const opened = served(await get(OLD_ID));
      assert.deepEqual([opened.retired, opened.state!.id, opened.state!.bars], [true, id, {}]);
      assert.equal(transactions, 1, "no market data was missed inside the transaction");
      await assert.rejects(post(stepOf("advance", { id, revision: 12 }), OLD_ID), { status: 409, message: STOPPED });
      await assert.rejects(post(stepOf("order", { id, revision: 12 }, { code: "2330", side: "sell", lots: 1 })), { status: 409, message: STOPPED });
      await assert.rejects(post({ action: "start", requestId: randomUUID(), plan: startPlan, codes: ["2330"] }, OLD_ID), { status: 404 });
      const done = served(await post(stepOf("finish", { id, revision: 12 }, { reflection: REFLECTION })));
      assert.deepEqual([done.retired, done.state!.completed, done.state!.equity], [true, true, 10_012_345]);
    }
  });
}));
