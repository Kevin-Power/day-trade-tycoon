import test from "node:test";
import assert from "node:assert/strict";
import { dailyProgress } from "./progress.ts";

const at = (iso: string) => Date.parse(iso);

test("the streak survives the morning before today's question is answered", () => {
  const progress = dailyProgress({ issued: ["2026-10-15", "2026-10-16", "2026-10-19"], answered: new Set(["2026-10-15", "2026-10-16"]),
    currentIssue: "2026-10-19", now: at("2026-10-19T07:00:00+08:00") });
  assert.equal(progress.streak, 2);
});

test("a missed question breaks the streak; a weekday without a question does not", () => {
  assert.equal(dailyProgress({ issued: ["2026-10-14", "2026-10-15", "2026-10-16"], answered: new Set(["2026-10-14", "2026-10-16"]),
    currentIssue: "2026-10-16", now: at("2026-10-16T08:00:00+08:00") }).streak, 1);
  assert.equal(dailyProgress({ issued: ["2026-10-14", "2026-10-16"], answered: new Set(["2026-10-14", "2026-10-16"]),
    currentIssue: "2026-10-16", now: at("2026-10-16T08:00:00+08:00") }).streak, 2);
  assert.equal(dailyProgress({ issued: [], answered: new Set(), currentIssue: null, now: at("2026-10-16T08:00:00+08:00") }).streak, 0);
});

test("a holiday week counts out of four and shows 休", () => {
  const progress = dailyProgress({ issued: ["2026-10-19", "2026-10-20", "2026-10-22"], answered: new Set(["2026-10-19", "2026-10-22"]),
    currentIssue: "2026-10-22", now: at("2026-10-22T07:00:00+08:00") });
  assert.deepEqual(progress.week.days.map((value) => value.state), ["done", "missed", "off", "done", "todo"]);
  assert.deepEqual([progress.week.done, progress.week.total], [2, 4]);
});

test("Friday's question answered on Saturday fills Friday", () => {
  const progress = dailyProgress({ issued: ["2026-10-16"], answered: new Set(["2026-10-16"]), currentIssue: "2026-10-16",
    now: at("2026-10-17T10:00:00+08:00") });
  assert.equal(progress.week.days[4]!.date, "2026-10-16");
  assert.equal(progress.week.days[4]!.state, "done");
});

test("today before 06:00 is still to do, not off; today's open question is to do", () => {
  const early = dailyProgress({ issued: ["2026-10-16"], answered: new Set(), currentIssue: "2026-10-16", now: at("2026-10-19T05:30:00+08:00") });
  assert.equal(early.week.days[0]!.state, "todo");
  assert.equal(early.week.total, 5);
  const open = dailyProgress({ issued: ["2026-10-19"], answered: new Set(), currentIssue: "2026-10-19", now: at("2026-10-19T09:00:00+08:00") });
  assert.equal(open.week.days[0]!.state, "todo");
});

test("today after 06:00 without a new question is off", () => {
  const progress = dailyProgress({ issued: ["2026-10-19"], answered: new Set(["2026-10-19"]), currentIssue: "2026-10-19",
    now: at("2026-10-20T09:00:00+08:00") });
  assert.deepEqual(progress.week.days.slice(0, 2).map((value) => value.state), ["done", "off"]);
});
