import test from "node:test";
import assert from "node:assert/strict";
import { parsePracticeGoal, practiceGoalKey } from "./practice-goal.ts";

test("guest and signed-in practice goals have separate storage keys", () => {
  assert.notEqual(practiceGoalKey(null), practiceGoalKey("guest"));
  assert.notEqual(practiceGoalKey("learner-one"), practiceGoalKey("learner-two"));
});

test("invalid or future practice goal records do not break review rendering", () => {
  for (const value of [null, "{", "null", "[]", '{"version":2}', '{"version":1,"focus":"profit"}'])
    assert.equal(parsePracticeGoal(value), null);
});

test("saved practice goal keeps the selected action and rejects oversized notes", () => {
  const goal = { version: 1, focus: "check-fill", note: "先確認成交", scenarioId: "lesson-1", scenarioName: "第一課", updatedAt: "2026-10-02T11:30:00.000Z" };
  assert.deepEqual(parsePracticeGoal(JSON.stringify(goal)), goal);
  assert.equal(parsePracticeGoal(JSON.stringify({ ...goal, note: "字".repeat(141) })), null);
});
