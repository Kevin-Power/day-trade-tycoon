import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readDisciplineInput } from "./discipline/records.server.ts";
import type { MarketBarRow } from "./market-days.server.ts";
import type { MorningBookCell, MorningReply, MorningResponse } from "./morning.ts";
import { MORNING_LIMITS, MorningTraffic } from "./morning-traffic.server.ts";
import { RETIRED_LESSONS } from "./morning-data.server.ts";
import { loadMorningSession, mutateMorningSession } from "./morning-session.server.ts";
import {
  SIX,
  SIX_ALL_MORNING,
  barsFrom,
  everyMinute,
  minuteBook,
  putBooks,
  putRadar,
  withClassroom,
  withMarket,
  writeDay,
  type Classroom,
} from "./morning-fixtures.ts";

const lessonOf = (date: string) => `fubon-${date.replaceAll("-", "")}-am`;
const plan = (focusCode: string) => ({ bias: "observe", focusCode, reason: "先觀察開盤", entry: "條件成立再進場", stop: "理由消失時離場" });
const startOf = (codes: string[], focus = codes[0], extra: object = {}) =>
  ({ action: "start", requestId: randomUUID(), plan: plan(focus), codes, ...extra });

/** The API as the route calls it: one transaction per request, the user from the session, the query as sent. */
function api(classroom: Classroom, dir: string) {
  const params = (lesson?: string) => new URLSearchParams(lesson === undefined ? {} : { lesson });
  return {
    get: (user: string, lesson?: string) =>
      classroom.tx((sql) => loadMorningSession(sql, user, { dir, params: params(lesson) })),
    post: (user: string, input: unknown, now: number, lesson?: string) =>
      classroom.tx((sql) => mutateMorningSession(sql, user, input, { dir, params: params(lesson), clock: now })),
  };
}
function served(reply: MorningReply): MorningResponse {
  assert.ok(!("unavailable" in reply), "the lesson is served");
  return reply as MorningResponse;
}
const advanceOf = (state: { id: string; revision: number }, extra: object = {}) =>
  ({ action: "advance", requestId: randomUUID(), id: state.id, expectedRevision: state.revision, ...extra });
const abandonOf = (state: { id: string; revision: number }) =>
  ({ action: "abandon", requestId: randomUUID(), id: state.id, expectedRevision: state.revision });

test("start validates codes (0, 81, duplicate, not in picker) and focusCode", () => withMarket(async (dir) => {
  const trades = everyMinute(50);
  const disagree = barsFrom(trades).map((bar, index): MarketBarRow => (index === 3 ? [bar[0], bar[1], bar[2], bar[3], bar[4], bar[5] + 1, bar[6]] : bar));
  const many = Array.from({ length: 80 }, (_, index) => ({ code: String(7001 + index), referencePrice: 50, tradeValue: 100 - index }));
  await writeDay(dir, "2026-10-28", [
    ...SIX_ALL_MORNING,
    ...many,
    { code: "6488", tradeValue: 9 }, // 上櫃: never in the picker
    { code: "2881", tradeValue: 8, complete: false }, // trades incomplete
    { code: "00878", tradeValue: 7 }, // not a 4-digit code
    { code: "2882", referencePrice: 50, tradeValue: 6, trades, bars: disagree }, // in the picker, fails the strict check
  ]);
  await withClassroom(async (classroom) => {
    const { get, post } = api(classroom, dir);
    const picker = served(await get("alice")).picker!;
    const offered = picker.symbols.map((symbol) => symbol.code);
    assert.ok(offered.includes("2882") && offered.includes("7080"));
    for (const code of ["6488", "2881", "00878"]) assert.equal(offered.includes(code), false, code);

    const refused = async (input: object, message?: string) =>
      assert.rejects(post("alice", input, 0), (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 400);
        if (message) assert.equal(error.message, message);
        return true;
      });
    await refused(startOf([], "2330"));
    await refused(startOf([...many.map((stock) => stock.code), "2330"], "2330")); // 81
    await refused(startOf(["2330", "2330"]), "請選 1 到 80 檔不重複的上市股票");
    for (const code of ["6488", "2881", "00878", "9999", "1234"])
      await refused(startOf(["2330", code]), "請從這天可練習的股票中選擇");
    await refused(startOf(["2330", "2317"], "2454"), "請從選的股票挑主角股");
    // In the picker but its trades and bars do not agree: the strict check at the start names it.
    await assert.rejects(post("alice", startOf(["2330", "2882"]), 0), {
      status: 409, message: "這幾檔這天的資料對不起來：2882，請改選其他股票",
    });
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM morning_sessions"), 0, "no refused start makes a run");

    // 1 to 80 stocks in the order chosen; the plan's 主角股 is one of them.
    const one = served(await post("alice", startOf(["2454", "2330"], "2330"), 0)).state!;
    assert.deepEqual(one.codes, ["2454", "2330"]);
    await post("alice", abandonOf(one), 10);
    const eighty = served(await post("alice", startOf(many.map((stock) => stock.code), "7042"), 20));
    assert.equal(eighty.state!.codes!.length, 80);
    assert.deepEqual(eighty.catalog.symbols.map((symbol) => symbol.code), many.map((stock) => stock.code));
  });
}));

test("guest responses never contain radar data", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-20", SIX); // the list's day: before the first lesson day, so never a lesson itself
  await writeDay(dir, "2026-10-21", SIX_ALL_MORNING, { taiex: true });
  await putRadar(dir, "2026-10-20", ["2454", "6488", "2330", "9999"]);
  await withClassroom(async (classroom) => {
    const { get, post } = api(classroom, dir);
    // A member's picker uses the list, so the fixture really has one.
    const member = served(await get("alice"));
    assert.deepEqual(member.picker!.defaults, ["2330", "2454"]);
    assert.deepEqual(member.picker!.note, {
      title: "預設：前一交易日熱門當沖股（10/20 盤後）",
      detail: "名單 4 檔：上櫃 1 檔不在教材範圍，另 1 檔這天沒有可練習的資料",
    });
    assert.deepEqual(member.catalog.note, member.picker!.note);

    const hidden = ["radar", "Radar", "2026-10-20", "10/20", "20261020", "名單", "當沖", "盤後", "檔"];
    const clean = (label: string, reply: MorningReply) => {
      const json = JSON.stringify(reply);
      for (const text of hidden) assert.equal(json.includes(text), false, `${label}: ${text}`);
    };
    const first = served(await get("guest"));
    clean("guest GET", first);
    assert.deepEqual(first.picker!.defaults, ["1101", "2317", "2330", "2454", "2603"]);
    assert.deepEqual(first.picker!.note, { title: "預設：成交值前 5 名", detail: null });
    assert.deepEqual(first.catalog.symbols.map((symbol) => symbol.code), first.picker!.defaults);
    assert.deepEqual(first.catalog.note, first.picker!.note);

    const started = served(await post("guest", startOf(first.picker!.defaults, "2330", { guestTerms: true }), 0));
    clean("guest start", started);
    let state = started.state!;
    for (let step = 1; step <= 3; step += 1) {
      const advanced = served(await post("guest", advanceOf(state, { view: "2330" }), step * 1_000));
      clean(`guest advance ${step}`, advanced);
      state = advanced.state!;
    }
    clean("guest order", await post("guest", {
      action: "order", requestId: randomUUID(), id: state.id, expectedRevision: state.revision, code: "2330", side: "buy", lots: 1,
    }, 4_000));
    clean("guest GET with a run", await get("guest"));
    clean("guest GET by lesson", await get("guest", lessonOf("2026-10-21")));
    clean("guest abandon", await post("guest", abandonOf(served(await get("guest")).state!), 5_000));
    clean("guest GET after", await get("guest"));
  });
}));

test("GET resumes the latest unfinished run, else newest day picker", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-27", SIX_ALL_MORNING);
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    const { get, post } = api(classroom, dir);
    const fresh = served(await get("alice"));
    assert.equal(fresh.state, null);
    assert.equal(fresh.picker!.date, "2026-10-28");
    assert.equal(fresh.catalog.lessonId, lessonOf("2026-10-28"));
    assert.equal(fresh.catalog.maxCursor, 90);
    assert.deepEqual(fresh.catalog.symbols.map((symbol) => symbol.code), fresh.picker!.defaults);
    assert.deepEqual(fresh.lessons, [
      { lessonId: lessonOf("2026-10-28"), date: "2026-10-28", title: "10/28 早盤" },
      { lessonId: lessonOf("2026-10-27"), date: "2026-10-27", title: "10/27 早盤" },
    ]);
    assert.deepEqual(fresh.records, []);
    assert.equal(fresh.tape, undefined);

    const older = served(await post("alice", startOf(["2330", "2317"]), 0, lessonOf("2026-10-27"))).state!;
    let resumed = served(await get("alice"));
    assert.equal(resumed.state!.id, older.id);
    assert.equal(resumed.catalog.lessonId, lessonOf("2026-10-27"));
    assert.equal(resumed.picker, undefined);
    assert.deepEqual(Object.keys(resumed.tape!).sort(), ["2317", "2330"]);

    // Without a lesson, start goes to the open run's lesson and gives that run back.
    assert.equal(served(await post("alice", startOf(["2454"]), 10)).state!.id, older.id);

    const newer = served(await post("alice", startOf(["2454"]), 20, lessonOf("2026-10-28"))).state!;
    assert.equal(served(await get("alice")).state!.id, newer.id);
    // The run touched last is the one to go back to.
    const moved = served(await post("alice", advanceOf(older), 1_000)).state!;
    resumed = served(await get("alice"));
    assert.equal(resumed.state!.id, older.id);
    assert.equal(resumed.state!.cursor, 1);
    assert.equal(resumed.state!.bars["2330"].length, 1);

    // An unfinished run of a retired lesson is never resumed (it only shows in the records).
    const [retiredId, retiredDate] = Object.entries(RETIRED_LESSONS)[0];
    await classroom.db.query(`INSERT INTO morning_sessions(id,user_id,lesson_id,state_json,completed,updated_at)
      VALUES($1,'alice',$2,$3::jsonb,FALSE,NOW() + interval '1 hour')`, [randomUUID(), retiredId,
      JSON.stringify({ lessonId: retiredId, cursor: 30, revision: 30, startingCash: 10_000_000, cash: 9_000_000, equity: 10_000_500,
        plan: plan("2330"), positions: [], orders: [], fills: [], completed: false, reflection: "", nextAdvanceAt: 0 })]);
    assert.equal(served(await get("alice")).state!.id, older.id);

    await post("alice", abandonOf(moved), 2_000);
    await post("alice", abandonOf(newer), 2_000);
    const after = served(await get("alice"));
    assert.equal(after.state, null, "finished runs are not resumed: the newest day's picker opens");
    assert.equal(after.picker!.date, "2026-10-28");
    // The latest 20 runs, newest first, the retired lesson's included.
    assert.deepEqual(after.records!.map((record) => [record.lessonId, record.date, record.abandoned, record.retired, record.completed]), [
      [retiredId, retiredDate, false, true, false],
      [lessonOf("2026-10-28"), "2026-10-28", true, false, true],
      [lessonOf("2026-10-27"), "2026-10-27", true, false, true],
    ]);
    const retiredRecord = after.records!.find((record) => record.retired)!;
    assert.deepEqual([retiredRecord.codes, retiredRecord.pnl, retiredRecord.reflected], [5, 500, false]);
    assert.deepEqual(after.records!.find((record) => record.id === older.id)!.codes, 2);

    // A lesson asked for by id shows its latest run, finished or not, and the picker for another run.
    const byId = served(await get("alice", lessonOf("2026-10-27")));
    assert.equal(byId.state!.id, older.id);
    assert.equal(byId.state!.abandoned, true);
    assert.equal(byId.picker!.date, "2026-10-27");
    assert.equal(served(await get("bob", lessonOf("2026-10-27"))).state, null);

    await assert.rejects(get("alice", retiredId), { status: 404, message: "這堂舊課已停用" });
    await assert.rejects(post("alice", startOf(["2330"]), 3_000, retiredId), { status: 404, message: "這堂舊課已停用" });
    for (const lesson of [lessonOf("2026-10-20"), lessonOf("2026-10-29"), "fubon-20261027-day", "morning-20261007-v1-000000000000", "__proto__", ""])
      await assert.rejects(get("alice", lesson), { status: 400 }, lesson);
    for (const query of ["date=2026-10-27", `lesson=${lessonOf("2026-10-27")}&lesson=${lessonOf("2026-10-27")}`, `lesson=${lessonOf("2026-10-27")}&cursor=90`])
      await assert.rejects(classroom.tx((sql) => loadMorningSession(sql, "alice", { dir, params: new URLSearchParams(query) })), { status: 400 }, query);
  });
}));

test("lessons only on GET, not on POST", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    const { get, post } = api(classroom, dir);
    const opened = served(await get("alice"));
    assert.ok(opened.lessons!.length === 1 && opened.records && opened.picker);
    const started = served(await post("alice", startOf(["2330", "1101"]), 0));
    let state = started.state!;
    const replies: [string, MorningResponse][] = [["start", started]];
    const advanced = served(await post("alice", advanceOf(state), 1_000));
    replies.push(["advance", advanced]);
    state = advanced.state!;
    const ordered = served(await post("alice", {
      action: "order", requestId: randomUUID(), id: state.id, expectedRevision: state.revision, code: "1101", side: "buy", lots: 1,
    }, 1_100));
    replies.push(["order", ordered]);
    state = ordered.state!;
    replies.push(["cancel", served(await post("alice", {
      action: "cancel", requestId: randomUUID(), id: state.id, expectedRevision: state.revision, orderId: state.orders[0].id,
    }, 1_200))]);
    state = replies.at(-1)![1].state!;
    replies.push(["finish", served(await post("alice", {
      action: "finish", requestId: randomUUID(), id: state.id, expectedRevision: state.revision, reflection: "看完第一分鐘就收手。",
    }, 1_300))]);
    for (const [label, reply] of replies) {
      for (const key of ["lessons", "records", "picker"] as const) assert.equal(key in reply, false, `${label}: ${key}`);
      assert.equal(reply.catalog.lessonId, lessonOf("2026-10-28"), label);
    }
    // A step (anything but start) carries no bars: the desk keeps what it has and adds each advance's delta.
    for (const [label, reply] of replies.slice(1)) assert.deepEqual(reply.state!.bars, {}, label);
    assert.deepEqual(started.state!.bars, { "2330": [], "1101": [] });
    assert.deepEqual(started.tape, { "2330": [], "1101": [] });
    assert.equal(advanced.delta!.cell, 0);
    assert.deepEqual(Object.keys(advanced.delta!.bars).sort(), ["1101", "2330"]);
    assert.ok(served(await get("alice")).lessons);
  });
}));

test("unavailable when MARKET_DATA_DIR empty", () => withMarket(async (dir) => {
  await withClassroom(async (classroom) => {
    const none = api(classroom, "");
    assert.deepEqual(await none.get("alice"), { unavailable: "此教室沒有每日教材" });
    assert.deepEqual(await none.get("guest", lessonOf("2026-10-28")), { unavailable: "此教室沒有每日教材" });
    assert.deepEqual(await none.post("alice", startOf(["2330"]), 0), { unavailable: "此教室沒有每日教材" });
    assert.deepEqual(await none.post("alice", advanceOf({ id: randomUUID(), revision: 0 }), 0), { unavailable: "此教室沒有每日教材" });
    await assert.rejects(none.get("stranger"), { status: 403 }, "access is checked first");
    // The default is MARKET_DATA_DIR itself.
    const saved = process.env.MARKET_DATA_DIR;
    process.env.MARKET_DATA_DIR = "  ";
    try {
      assert.deepEqual(await classroom.tx((sql) => loadMorningSession(sql, "alice")), { unavailable: "此教室沒有每日教材" });
    } finally {
      if (saved === undefined) delete process.env.MARKET_DATA_DIR;
      else process.env.MARKET_DATA_DIR = saved;
    }
    // Set, but no lesson day yet: an empty folder, then only a day before the first lesson day.
    const empty = api(classroom, dir);
    assert.deepEqual(await empty.get("alice"), { unavailable: "目前還沒有每日教材" });
    await writeDay(dir, "2026-10-20", SIX);
    assert.deepEqual(await empty.get("alice"), { unavailable: "目前還沒有每日教材" });
    assert.deepEqual(await empty.post("guest", startOf(["2330"], "2330", { guestTerms: true }), 0), { unavailable: "目前還沒有每日教材" });
    assert.equal(await classroom.count("SELECT count(*)::int AS count FROM morning_sessions"), 0);
  });
}));

test("30 practisers behind one IP at 2× are not rate-limited", () => {
  assert.deepEqual(MORNING_LIMITS, { perSourcePerMinute: 2_400, perPractiserPerMinute: 180, concurrent: 40 });
  const traffic = new MorningTraffic();
  const classroomIp = "203.0.113.7";
  // 2×: one advance every 1 s, i.e. 60 requests a minute each, all 30 practisers through one classroom IP.
  let admitted = 0;
  for (let second = 0; second < 60; second += 1) {
    for (let practiser = 0; practiser < 30; practiser += 1) {
      const now = 1_000_000 + second * 1_000 + practiser * 10;
      assert.ok(traffic.enter(classroomIp, now), `${practiser} at ${second}s`);
      try {
        assert.ok(traffic.practiser(`user-${practiser}`, now), `${practiser} at ${second}s`);
        admitted += 1;
      } finally {
        traffic.leave();
      }
    }
  }
  assert.equal(admitted, 1_800);
  assert.equal(traffic.active, 0);

  // Each practiser keeps 180 a minute, the IP 2,400 a minute, and at most 40 run at once.
  const one = new MorningTraffic();
  for (let request = 0; request < 180; request += 1) assert.ok(one.practiser("busy", 5_000 + request));
  assert.equal(one.practiser("busy", 5_500), false);
  assert.ok(one.practiser("busy", 5_000 + 60_001), "a minute later the practiser may go on");
  const ip = new MorningTraffic();
  for (let request = 0; request < 2_400; request += 1) {
    assert.ok(ip.enter("198.51.100.1", 9_000));
    ip.leave();
  }
  assert.equal(ip.enter("198.51.100.1", 9_001), false);
  assert.ok(ip.enter("198.51.100.2", 9_001), "another IP has its own budget");
  ip.leave();
  const busy = new MorningTraffic();
  for (let request = 0; request < 40; request += 1) assert.ok(busy.enter(`10.0.0.${request}`, 0));
  assert.equal(busy.enter("10.0.1.1", 0), false);
  busy.leave();
  assert.ok(busy.enter("10.0.1.1", 0));
});

test("abandoned rounds are not counted in discipline records", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await withClassroom(async (classroom) => {
    const { post } = api(classroom, dir);
    const given = served(await post("member", startOf(["2330"]), 0)).state!;
    const abandoned = served(await post("member", abandonOf(given), 100));
    assert.equal(abandoned.state!.abandoned, true);
    assert.equal(abandoned.state!.completed, true);
    assert.equal(abandoned.celebration ?? null, null, "abandoning never celebrates");
    await assert.rejects(post("member", abandonOf(abandoned.state!), 150), { status: 409, message: "這局已經結束" });
    const kept = served(await post("member", startOf(["2330"]), 200)).state!;
    assert.notEqual(kept.id, given.id, "after abandoning, a new run can start");
    const finished = served(await post("member", {
      action: "finish", requestId: randomUUID(), id: kept.id, expectedRevision: kept.revision, reflection: "照計畫觀察。",
    }, 300));
    assert.equal(finished.celebration!.source, "practice");
    const input = await classroom.tx((sql) => readDisciplineInput(sql, "member", Date.now()));
    assert.deepEqual(input.practice.map((record) => record.id), [kept.id]);
  });
}));

test("advance with view returns only that code's book cell", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-27", SIX_ALL_MORNING);
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  await putBooks(dir, "2026-10-28", "lot", { "2330": minuteBook(1000), "2317": minuteBook(200) });
  await withClassroom(async (classroom) => {
    const { get, post } = api(classroom, dir);
    let state = served(await post("alice", startOf(["2330", "2317", "2454"], "2317"), 0)).state!;
    const inCell = (ms: number, cell: number) => ms >= cell * 60_000 && ms < (cell + 1) * 60_000;

    let reply: MorningResponse = served(await post("alice", advanceOf(state, { view: "2330" }), 1_000));
    assert.equal(reply.delta!.cell, 0);
    assert.deepEqual(reply.delta!.book, {
      code: "2330", start: null, frames: [[2_000, { bids: [[999.5, 10]], asks: [[1000, 5]] }]], gaps: [], sizes: true,
    });
    state = reply.state!;
    for (let cell = 1; cell < 6; cell += 1) {
      const view = cell % 2 ? "2317" : "2330";
      reply = served(await post("alice", advanceOf(state, { view }), (cell + 1) * 1_000));
      state = reply.state!;
      const book: MorningBookCell = reply.delta!.book!;
      assert.equal(reply.delta!.cell, cell);
      assert.equal(book.code, view);
      assert.ok(book.frames.length > 0 && book.frames.every(([ms]) => inCell(ms, cell)), `cell ${cell}`);
      assert.ok(book.start, "the book as the cell starts is the last one before it");
      // Nothing of the cells not yet revealed: no trade, bar or book at or after the cursor.
      for (const rows of Object.values(reply.delta!.trades)) assert.ok(rows.every(([ms]) => inCell(ms, cell)));
      for (const bar of Object.values(reply.delta!.bars)) assert.ok(!bar || bar.t === cell * 60);
    }
    // No view, a stock without books, or a view outside the run: no book; the last is refused before anything moves.
    assert.equal(served(await post("alice", advanceOf(state), 7_000)).delta!.book, undefined);
    state = served(await get("alice")).state!;
    assert.equal(served(await post("alice", advanceOf(state, { view: "2454" }), 8_000)).delta!.book, undefined);
    state = served(await get("alice")).state!;
    await assert.rejects(post("alice", advanceOf(state, { view: "2603" }), 9_000), { status: 400 });
    assert.equal(served(await get("alice")).state!.cursor, 8);

    // A run opened again shows the 主角股's book of the last revealed cell, and a tape that stops at the cursor.
    const opened = served(await get("alice"));
    assert.equal(opened.book!.code, "2317");
    assert.ok(opened.book!.frames.every(([ms]) => inCell(ms, 7)));
    for (const rows of Object.values(opened.tape!)) assert.ok(rows.every(([ms]) => ms < 8 * 60_000));
    for (const bars of Object.values(opened.state!.bars)) assert.ok(bars.every((bar) => bar.t < 8 * 60));

    // A day without books never sends one.
    const other = served(await post("bob", startOf(["2330"], "2330"), 0, lessonOf("2026-10-27"))).state!;
    assert.equal(served(await post("bob", advanceOf(other, { view: "2330" }), 1_000)).delta!.book, undefined);
    assert.equal(served(await get("bob")).book, undefined);
  });
}));
