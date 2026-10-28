import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadMorningSession, mutateMorningSession } from "./morning-session.server.ts";
import type { MorningReply, MorningResponse, MorningState } from "./morning.ts";
import { SIX, twoTrades, withClassroom, withMarket, writeDay, type Classroom } from "./morning-fixtures.ts";

const MAIN = "fubon-20261028-am";
const OTHER = "fubon-20261027-am";

function served(reply: MorningReply): MorningResponse {
  assert.ok(!("unavailable" in reply), "the lesson is served");
  return reply as MorningResponse;
}
/** The run as a step reply shows it: everything but the bars (and the TAIEX), which only a snapshot carries. */
const withoutBars = (state: MorningState) => {
  const { bars, index, ...rest } = state;
  void bars;
  void index;
  return rest;
};

/** Two lesson days with different prices, so each has its own source hash. */
async function twoDays(dir: string) {
  await writeDay(dir, "2026-10-27", SIX.map((stock) => ({ ...stock, trades: twoTrades(stock.referencePrice! + 10) })));
  await writeDay(dir, "2026-10-28", SIX);
}
function tools(classroom: Classroom, dir: string) {
  // null: no lesson in the query.
  const params = (lesson: string | null) => new URLSearchParams(lesson === null ? {} : { lesson });
  return {
    read: async (user = "alice", lesson: string | null = MAIN) =>
      served(await classroom.tx((sql) => loadMorningSession(sql, user, { dir, params: params(lesson) }))),
    act: async (input: unknown, now = 0, user = "alice", lesson: string | null = MAIN) =>
      served(await classroom.tx((sql) => mutateMorningSession(sql, user, input, { dir, params: params(lesson), clock: now }))),
  };
}

test("real SQL replay: owner, consent, atomic revisions, request idempotence, persistence and no stored future bars", () => withMarket(async (dir) => {
  await twoDays(dir);
  await withClassroom(async (classroom) => {
    const { read, act } = tools(classroom, dir);
    const lessons = [
      { lessonId: MAIN, date: "2026-10-28", title: "10/28 早盤" },
      { lessonId: OTHER, date: "2026-10-27", title: "10/27 早盤" },
    ];
    const start = { action: "start", requestId: randomUUID(), codes: ["2330"], plan: { exerciseId: "first-order", bias: "observe", focusCode: "2330", reason: "先觀察", entry: "條件成立再進場", stop: "理由消失時離場" } };
    await assert.rejects(read("unconsented"), { status: 403 });
    await assert.rejects(act(start, 0, "unconsented"), { status: 403 });
    assert.equal((await read()).state, null);
    assert.deepEqual((await read()).lessons, lessons);
    await assert.rejects(act({ ...start, plan: { ...start.plan, exerciseId: "unapproved" } }), { status: 400 });
    const first = (await act(start)).state!;
    assert.equal(first.cursor, 0); assert.deepEqual(first.bars["2330"], []); assert.deepEqual(first.codes, ["2330"]);
    assert.match(first.sourceHash!, /^[0-9a-f]{64}$/);
    const duplicates = await Promise.all([act(start), act(start)]);
    assert.ok(duplicates.every(value => value.state!.id === first.id));
    assert.deepEqual((await act({ ...start, requestId: randomUUID(), plan: { ...start.plan, exerciseId: "review", reason: "不可以覆寫原判斷" } })).state!.plan, start.plan);
    assert.equal((await read("bob")).state, null);
    const advance = { action: "advance", requestId: randomUUID(), id: first.id, expectedRevision: 0 };
    await assert.rejects(act(advance, 1000, "bob"), { status: 404 });
    await assert.rejects(act(advance, 999), { status: 429 });
    const concurrent = await Promise.all([act(advance, 1000), act(advance, 1000)]);
    assert.ok(concurrent.every(value => value.state!.cursor === 1 && value.state!.revision === 1));
    assert.ok(concurrent.every(value => value.delta!.cell === 0), "a retried advance answers with the same step");
    assert.equal((await act(advance, 1000)).state!.revision, 1);
    await assert.rejects(act({ ...advance, expectedRevision: 1 }, 2000), { status: 409 });
    await assert.rejects(act({ ...advance, requestId: randomUUID() }, 2000), { status: 409 });
    const different = await Promise.allSettled([1, 2].map(() => act({ ...advance, requestId: randomUUID(), expectedRevision: 1 }, 2000)));
    assert.equal(different.filter(result => result.status === "fulfilled").length, 1);
    let state = (await read()).state!;
    assert.equal(state.cursor, 2); assert.equal(state.revision, 2); assert.equal(state.bars["2330"].length, 2);
    const saved = (await classroom.db.query<{ state_json: object }>("SELECT state_json FROM morning_sessions")).rows;
    assert.equal(saved.length, 1); assert.equal(Object.hasOwn(saved[0].state_json, "bars"), false);
    assert.equal(Object.hasOwn(saved[0].state_json, "index"), false);
    const finish = { action: "finish", requestId: randomUUID(), id: first.id, expectedRevision: state.revision, reflection: "我選擇提早結束並記錄觀察。" };
    state = (await act(finish, 2100)).state!;
    assert.equal(state.completed, true);
    assert.deepEqual((await act(finish, 2200)).state, state);
    await assert.rejects(act({ ...finish, requestId: randomUUID(), expectedRevision: state.revision }, 2300), { status: 409 });
    await classroom.reopen();
    assert.deepEqual(withoutBars((await read()).state!), withoutBars(state));
    assert.deepEqual((await act(finish, 2500)).state, state);
    const second = (await act({ ...start, requestId: randomUUID() }, 3000)).state!;
    assert.notEqual(second.id, first.id); assert.equal(second.cursor, 0);
    // An old request must neither create a third run nor mutate the new active one.
    assert.equal((await act(start, 3100)).state!.id, first.id);
    assert.equal((await read()).state!.id, second.id);
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM morning_sessions"), 2);

    // Each lesson day has its own active run; a known request ID must never
    // become authorization to apply that request to another day/source hash.
    assert.equal((await read("alice", OTHER)).state, null);
    await assert.rejects(act(start, 3200, "alice", OTHER), { status: 409 });
    const otherStart = { ...start, requestId: randomUUID(), plan: { ...start.plan, exerciseId: "patience" } };
    let otherState = (await act(otherStart, 3200, "alice", OTHER)).state!;
    assert.notEqual(otherState.id, second.id);
    assert.equal(otherState.lessonId, OTHER);
    assert.notEqual(otherState.sourceHash, second.sourceHash);
    assert.equal(otherState.plan.exerciseId, "patience");
    await assert.rejects(act({ action: "advance", requestId: randomUUID(), id: second.id, expectedRevision: 0 }, 4200, "alice", OTHER), { status: 404 });
    const otherAdvance = { action: "advance", requestId: randomUUID(), id: otherState.id, expectedRevision: 0 };
    await assert.rejects(act(otherAdvance, 4200, "alice"), { status: 404 });
    await assert.rejects(act(otherAdvance, 4200, "bob", OTHER), { status: 404 });
    otherState = (await act(otherAdvance, 4200, "alice", OTHER)).state!;
    assert.equal(otherState.cursor, 1);
    const otherOpened = (await read("alice", OTHER)).state!;
    assert.deepEqual(otherOpened.bars["2330"], [{ t: 0, o: 1010, h: 1010, l: 1010, c: 1010, v: 2, a: 1010 }]);
    assert.deepEqual((await read()).state!.bars["2330"], []);
    assert.equal((await read("bob", OTHER)).state, null);
    await assert.rejects(act(otherAdvance, 5000), { status: 409 });
    // Without a lesson in the query an action finds its run by id, and a retry is still the same request.
    assert.deepEqual((await act(otherAdvance, 5000, "alice", null)).state, otherState);
    await classroom.reopen();
    assert.equal((await read()).state!.id, second.id);
    assert.deepEqual((await read("alice", OTHER)).state, otherOpened);
    assert.deepEqual((await act(otherAdvance, 6000, "alice", OTHER)).state, otherState);
    assert.equal((await act(start, 6100)).state!.id, first.id, "a start retried on its lesson keeps the original run");
  });
}));

const guestStart = () => ({ action: "start", requestId: randomUUID(), codes: ["2330", "2317"], plan: { exerciseId: "first-order", bias: "bullish", focusCode: "2330",
  reason: "開盤後走強，想等它站上前高", entry: "價格站上前高（圖上標「前高」的虛線）再買", stop: "跌回前高下方就賣出" } });
function guestTools(classroom: Classroom, dir: string) {
  return {
    read: async (user: string) => served(await classroom.tx((sql) => loadMorningSession(sql, user, { dir }))),
    act: async (input: unknown, now: number, user: string) =>
      served(await classroom.tx((sql) => mutateMorningSession(sql, user, input, { dir, clock: now }))),
  };
}

test("guests can read freely but start only with the teaching statement", () => withMarket(async (dir) => {
  await twoDays(dir);
  await withClassroom(async (classroom) => {
    const { read, act } = guestTools(classroom, dir);
    const start = guestStart();
    assert.equal((await read("guest")).state, null);
    await assert.rejects(act(start, 0, "guest"), { status: 403, message: "請先確認教學聲明" });
    const began = (await act({ ...start, guestTerms: true }, 0, "guest")).state!;
    assert.equal(began.cursor, 0);
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM guest_consents WHERE user_id='guest'"), 1);
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM classroom_profiles WHERE user_id='guest'"), 0);
    await assert.rejects(act({ ...guestStart(), guestTerms: true }, 0, "member"), { status: 400, message: "這個帳號不需要訪客聲明" });
    await assert.rejects(read("stranger"), { status: 403, message: "請先完成學員資料與教學聲明" });
    const advanced = (await act({ action: "advance", requestId: randomUUID(), id: began.id, expectedRevision: 0 }, 1000, "guest")).state!;
    assert.equal(advanced.cursor, 1);
  });
}));

test("guest start is idempotent under a double tap", () => withMarket(async (dir) => {
  await twoDays(dir);
  await withClassroom(async (classroom) => {
    const { act } = guestTools(classroom, dir);
    const start = { ...guestStart(), guestTerms: true };
    // allSettled: a rejected first call must not leave the second transaction pending at close.
    const settled = await Promise.allSettled([act(start, 0, "guest2"), act(start, 0, "guest2")]);
    const [first, second] = settled.map(result => {
      assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason?.message) : "");
      return (result as PromiseFulfilledResult<MorningResponse>).value;
    });
    assert.equal(first.state!.id, second.state!.id);
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM guest_consents WHERE user_id='guest2'"), 1);
    assert.equal((await act({ ...guestStart(), guestTerms: true }, 10, "guest2")).state!.id, first.state!.id);
  });
}));

test("finishing a round celebrates its points once; a second round that day adds nothing", () => withMarket(async (dir) => {
  await twoDays(dir);
  await withClassroom(async (classroom) => {
    const { act } = guestTools(classroom, dir);
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
  });
}));

test("finishing still celebrates when an older record is unreadable", () => withMarket(async (dir) => {
  await twoDays(dir);
  await withClassroom(async (classroom) => {
    const { act } = guestTools(classroom, dir);
    await classroom.db.query("INSERT INTO daily_questions(id,issue_date,payload) VALUES('2026-10-09','2026-10-12','{\"level\":100}'::jsonb)");
    await classroom.db.query("INSERT INTO daily_answers(user_id,question_id,choice,stop_price,reason) VALUES('member','2026-10-09','watch',NULL,NULL)");
    await classroom.db.query(`INSERT INTO morning_sessions(id,user_id,lesson_id,state_json,completed,created_at)
      VALUES($1,'member','old','{"plan":{"focusCode":"2330"},"reflection":"舊紀錄","orders":"broken","positions":{"x":1}}'::jsonb,TRUE,'2026-10-01T01:00:00Z')`, [randomUUID()]);
    const run = (await act(guestStart(), 0, "member")).state!;
    const done = await act({ action: "finish", requestId: randomUUID(), id: run.id, expectedRevision: run.revision, reflection: "照計畫。" }, 100, "member");
    assert.equal(done.state!.completed, true);
    assert.equal(done.celebration!.points, 25);
  });
}));
