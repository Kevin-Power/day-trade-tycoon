import test from "node:test";
import assert from "node:assert/strict";
import {
  taipeiDate,
  TODAY_ACTION_LABELS,
  todayFromReply,
  todayLink,
  TODAY_START,
  TODAY_STEP_LABELS,
  todaySteps,
} from "./today-steps.ts";

// Taipei is UTC+8 all year.
const at = (y: number, m: number, d: number, h: number, min: number) => Date.UTC(y, m - 1, d, h - 8, min);

test("no run, an old run without a start time, or another day means start", () => {
  assert.deepEqual(todaySteps(null, 90, at(2026, 10, 16, 9, 0)), { steps: ["now", "todo", "todo"], action: "start" });
  assert.equal(todaySteps({ startedAt: at(2026, 10, 15, 20, 0), cursor: 3, completed: true }, 90, at(2026, 10, 16, 9, 0)).action, "start");
});

test("a round finished before Taipei midnight is yesterday", () => {
  const run = { startedAt: at(2026, 10, 16, 23, 59), cursor: 5, completed: true };
  assert.equal(todaySteps(run, 90, at(2026, 10, 16, 23, 59) + 30_000).action, "again");
  assert.equal(todaySteps(run, 90, at(2026, 10, 17, 0, 1)).action, "start");
  assert.equal(taipeiDate(at(2026, 10, 17, 0, 1)), "2026-10-17");
  assert.equal(taipeiDate(at(2026, 10, 16, 23, 59)), "2026-10-16");
});

test("an unfinished run continues whatever day it started", () => {
  const now = at(2026, 10, 17, 0, 1);
  assert.equal(todaySteps({ startedAt: at(2026, 10, 16, 23, 59), cursor: 5, completed: false }, 90, now).action, "continue");
  assert.equal(todaySteps({ startedAt: at(2026, 10, 15, 9, 0), cursor: 70, completed: false }, 90, now).action, "review");
  assert.equal(todaySteps({ cursor: 3, completed: false }, 90, now).action, "continue");
});

test("starting fresh or again asks the practice page for a new plan", () => {
  assert.deepEqual(todayLink("start"), { panel: "trade", new: "1" });
  assert.deepEqual(todayLink("again"), { panel: "trade", new: "1" });
  assert.deepEqual(todayLink("continue"), { panel: "trade" });
  assert.deepEqual(todayLink("review"), { panel: "trade" });
});

test("progress moves from practice to review to done", () => {
  const now = at(2026, 10, 16, 20, 0);
  const startedAt = at(2026, 10, 16, 19, 0);
  assert.deepEqual(todaySteps({ startedAt, cursor: 10, completed: false }, 90, now), { steps: ["done", "now", "todo"], action: "continue" });
  assert.deepEqual(todaySteps({ startedAt, cursor: 60, completed: false }, 90, now), { steps: ["done", "done", "now"], action: "review" });
  assert.equal(todaySteps({ startedAt, cursor: 45, completed: false }, 45, now).action, "review");
  assert.deepEqual(todaySteps({ startedAt, cursor: 30, completed: true }, 90, now), { steps: ["done", "done", "done"], action: "again" });
  assert.deepEqual([...TODAY_STEP_LABELS], ["選一個計畫", "模擬練習", "寫復盤"]);
});

// ── The card reads GET /api/morning with no lesson in the URL (Task 15) ───────────────────────────────────────────

const NEWEST = "2026-10-27";
const now = at(2026, 10, 27, 20, 0);
const record = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  lessonId: "fubon-20261027-am",
  date: NEWEST,
  codes: 5,
  pnl: 120,
  reflected: true,
  abandoned: false,
  retired: false,
  completed: true,
  ...over,
});
/** The bare GET when no run is open: the newest day's picker, no state, the open days and the learner's records. */
const pickerReply = (over: Record<string, unknown> = {}) => ({
  catalog: { lessonId: "fubon-20261027-am", date: NEWEST, maxCursor: 90 },
  state: null,
  lessons: [
    { lessonId: "fubon-20261027-am", date: NEWEST, title: "10/27 早盤" },
    { lessonId: "fubon-20261024-am", date: "2026-10-24", title: "10/24 早盤" },
  ],
  records: [],
  picker: { lessonId: "fubon-20261027-am", date: NEWEST },
  ...over,
});
const label = (view: ReturnType<typeof todayFromReply>) => (view?.action ? TODAY_ACTION_LABELS[view.action] : null);

test("unavailable morning hides the practice step action", () => {
  const none = todayFromReply({ unavailable: "此教室沒有每日教材" }, now);
  assert.deepEqual(none, { steps: ["todo", "todo", "todo"], action: null, note: "此教室沒有每日教材" });
  // The sentence is the server's; old runs in the records never bring the button back.
  const empty = todayFromReply({ unavailable: "目前還沒有每日教材", records: [record()] }, now);
  assert.deepEqual(empty, { steps: ["todo", "todo", "todo"], action: null, note: "目前還沒有每日教材" });
});

test("state null with picker → 開始今天的練習", () => {
  const view = todayFromReply(pickerReply(), now);
  assert.deepEqual(view, { steps: ["now", "todo", "todo"], action: "start", note: null });
  assert.equal(label(view), "開始今天的練習");
  assert.deepEqual(TODAY_START, view);
  // No lesson id: the practice page's own GET opens the newest day.
  assert.deepEqual(todayLink("start"), { panel: "trade", new: "1" });
});

test("a finished run of the newest lesson means today is done, and 再練一輪 is offered", () => {
  const view = todayFromReply(pickerReply({ records: [record()] }), now);
  assert.deepEqual(view, { steps: ["done", "done", "done"], action: "again", note: null });
  assert.equal(label(view), "再練一輪");
  // Older records come after the newest in the list; any finished one of the newest lesson counts.
  assert.equal(todayFromReply(pickerReply({ records: [record({ id: "r2", completed: false }), record({ id: "r3" })] }), now)?.action, "again");
});

test("only a finished, kept run of the newest lesson counts as today", () => {
  const start = (records: unknown[]) => todayFromReply(pickerReply({ records }), now)?.action;
  assert.equal(start([record({ abandoned: true })]), "start", "giving up is not finishing");
  assert.equal(start([record({ completed: false })]), "start");
  assert.equal(start([record({ retired: true })]), "start", "an old lesson's run is not today's");
  assert.equal(start([record({ date: "2026-10-24", lessonId: "fubon-20261024-am" })]), "start", "an older day is yesterday's");
  assert.equal(start([]), "start");
  // The newest day is the one the card opens: the open days list first, else the picker's day.
  const noList = pickerReply({ records: [record({ date: "2026-10-24" })], lessons: undefined, picker: { lessonId: "fubon-20261024-am", date: "2026-10-24" } });
  assert.equal(todayFromReply(noList, now)?.action, "again");
  assert.equal(todayFromReply(pickerReply({ records: [record()], lessons: undefined, picker: undefined, catalog: undefined }), now)?.action, "start");
});

test("an open run is continued whatever the records say, and needs no catalog", () => {
  const startedAt = at(2026, 10, 27, 19, 0);
  const open = (cursor: number, over: Record<string, unknown> = {}) => ({
    state: { startedAt, cursor, completed: false },
    records: [record()],
    ...over,
  });
  assert.deepEqual(todayFromReply(open(10), now), { steps: ["done", "now", "todo"], action: "continue", note: null });
  assert.deepEqual(todayFromReply(open(60), now), { steps: ["done", "done", "now"], action: "review", note: null });
  assert.equal(label(todayFromReply(open(89, { catalog: { maxCursor: 90 } }), now)), "寫復盤");
  assert.equal(label(todayFromReply(open(0), now)), "繼續練習");
  assert.deepEqual(todayLink("continue"), { panel: "trade" });
});

test("a reply the card cannot read changes nothing", () => {
  for (const reply of [null, undefined, "x", [], {}, { ok: false, message: "請先登入學員帳號" }, { unavailable: 3 }, { state: "run" }, { state: { cursor: "5", completed: false } }])
    assert.equal(todayFromReply(reply, now), null, JSON.stringify(reply));
});
