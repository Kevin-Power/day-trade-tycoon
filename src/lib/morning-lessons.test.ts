import assert from "node:assert/strict";
import test from "node:test";
import {
  RETIRED_LESSONS,
  dayPicker,
  lessonSummaries,
  requestedLesson,
  resolveMorningSource,
} from "./morning-data.server.ts";
import { SIX, SIX_ALL_MORNING, putRadar, withMarket, writeDay } from "./morning-fixtures.ts";

const noOpenRun = { openLessonIds: async () => [] };

test("lesson selection accepts exactly one lesson id: a daily lesson or a retired one", () => {
  assert.deepEqual(RETIRED_LESSONS, {
    "morning-20261005-v1-bd566804b809": "2026-10-05",
    "morning-20261006-v1-ce4a95ce69f1": "2026-10-06",
  });
  assert.equal(requestedLesson(new URLSearchParams()), null);
  assert.deepEqual(requestedLesson(new URLSearchParams({ lesson: "fubon-20261028-am" })), { lessonId: "fubon-20261028-am", date: "2026-10-28" });
  // A retired lesson is named (its runs open as text, see morning-retired.test.ts); it is never a daily lesson.
  assert.deepEqual(requestedLesson(new URLSearchParams({ lesson: "morning-20261005-v1-bd566804b809" })),
    { lessonId: "morning-20261005-v1-bd566804b809", date: "2026-10-05", retired: true });
  assert.deepEqual(requestedLesson(new URLSearchParams({ lesson: "morning-20261006-v1-ce4a95ce69f1" })),
    { lessonId: "morning-20261006-v1-ce4a95ce69f1", date: "2026-10-06", retired: true });
  for (const value of ["", "2026-10-28", "fubon-20261028", "fubon-20261028-day", "fubon-20261332-am", "morning-20261007-v1-000000000000",
    "__proto__", "constructor", "hasOwnProperty", "../../server/data/morning-2026-10-06.json", " fubon-20261028-am"])
    assert.throws(() => requestedLesson(new URLSearchParams({ lesson: value })), { status: 400 }, value);
  for (const query of ["lesson=", "date=2026-10-28", "lesson=x&lesson=x", "lesson=x&cursor=90", "cursor=90",
    "lesson=fubon-20261028-am&lesson=fubon-20261028-am", "lesson=fubon-20261028-am&cursor=90"])
    assert.throws(() => requestedLesson(new URLSearchParams(query)), { status: 400 }, query);
});

test("the lesson served: the one asked for, else the latest open run's day, else the newest day", () => withMarket(async (dir) => {
  assert.deepEqual(await resolveMorningSource(new URLSearchParams(), noOpenRun, ""), { kind: "unavailable", unavailable: "此教室沒有每日教材" });
  for (const folder of ["", dir])
    assert.deepEqual(await resolveMorningSource(new URLSearchParams({ lesson: "morning-20261006-v1-ce4a95ce69f1" }), noOpenRun, folder),
      { kind: "retired", lessonId: "morning-20261006-v1-ce4a95ce69f1", date: "2026-10-06" },
      "a retired lesson is known whether or not the classroom has daily lessons or days");
  assert.deepEqual(await resolveMorningSource(new URLSearchParams(), noOpenRun, dir), { kind: "unavailable", unavailable: "目前還沒有每日教材" });
  await writeDay(dir, "2026-10-20", SIX); // before the first lesson day
  await writeDay(dir, "2026-10-27", SIX);
  await writeDay(dir, "2026-10-28", SIX);
  const days = ["2026-10-28", "2026-10-27"];
  const lesson = (date: string, from: string) =>
    ({ kind: "lesson", dir, days, lessonId: `fubon-${date.replaceAll("-", "")}-am`, date, from });

  assert.deepEqual(await resolveMorningSource(new URLSearchParams(), noOpenRun, dir), lesson("2026-10-28", "newest"));
  assert.deepEqual(await resolveMorningSource(new URLSearchParams({ lesson: "fubon-20261027-am" }), noOpenRun, dir), lesson("2026-10-27", "query"));
  for (const id of ["fubon-20261020-am", "fubon-20261026-am", "fubon-20261029-am"])
    await assert.rejects(resolveMorningSource(new URLSearchParams({ lesson: id }), noOpenRun, dir), { status: 400, message: "請選擇已提供真實行情的練習日期" }, id);
  // Open runs come newest first; one on a day that is not open (or not a daily lesson at all) is passed over.
  let asked = 0;
  const openRuns = (ids: string[]) => ({ openLessonIds: async () => { asked += 1; return ids; } });
  assert.deepEqual(await resolveMorningSource(new URLSearchParams(), openRuns(["fubon-20261020-am", "old", "fubon-20261027-am", "fubon-20261028-am"]), dir),
    lesson("2026-10-27", "open-run"));
  assert.deepEqual(await resolveMorningSource(new URLSearchParams(), openRuns(["fubon-20261020-am"]), dir), lesson("2026-10-28", "newest"));
  asked = 0;
  await resolveMorningSource(new URLSearchParams({ lesson: "fubon-20261028-am" }), openRuns(["fubon-20261027-am"]), dir);
  assert.equal(asked, 0, "a lesson in the query never looks up open runs");
}));

test("lesson summaries disclose metadata only, never stocks, prices or market context", () => {
  const summaries = lessonSummaries(["2026-10-28", "2026-10-21"]);
  assert.deepEqual(summaries, [
    { lessonId: "fubon-20261028-am", date: "2026-10-28", title: "10/28 早盤" },
    { lessonId: "fubon-20261021-am", date: "2026-10-21", title: "10/21 早盤" },
  ]);
  for (const summary of summaries) assert.deepEqual(Object.keys(summary).sort(), ["date", "lessonId", "title"]);
});

test("a day's picker is kept for a minute per audience, then read again", () => withMarket(async (dir) => {
  await writeDay(dir, "2026-10-27", SIX);
  await writeDay(dir, "2026-10-28", SIX_ALL_MORNING);
  const first = await dayPicker(dir, "2026-10-28", false, 0);
  assert.equal(first!.note.title, "前一交易日沒有熱門當沖名單，改用成交值前 5 名");
  await putRadar(dir, "2026-10-27", ["2454", "2330"]); // the list arrives late
  assert.equal(await dayPicker(dir, "2026-10-28", false, 59_999), first);
  const later = await dayPicker(dir, "2026-10-28", false, 60_000);
  assert.equal(later!.note.title, "預設：前一交易日熱門當沖股（10/27 盤後）");
  assert.deepEqual(later!.defaults, ["2330", "2454"]);
  const guest = await dayPicker(dir, "2026-10-28", true, 60_000);
  assert.deepEqual(guest!.note, { title: "預設：成交值前 5 名", detail: null });
  assert.equal(await dayPicker(dir, "2026-10-26", false, 0), null);
}));
