import test from "node:test";
import assert from "node:assert/strict";
import { taipeiDate, todayLink, TODAY_STEP_LABELS, todaySteps } from "./today-steps.ts";

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
