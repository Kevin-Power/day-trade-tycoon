import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePracticeGoal,
  practiceGoalForScenario,
  practiceGoalKey,
  savePracticeGoal,
  type PracticeGoal,
} from "./practice-goal.ts";

const sampleGoal: PracticeGoal = {
  version: 1,
  focus: "check-fill",
  note: "先確認成交",
  scenarioId: "lesson-1",
  scenarioName: "第一課",
  updatedAt: "2026-10-02T11:30:00.000Z",
};

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

test("a practice goal is available only in its original scenario", () => {
  const goal = Object.freeze({ ...sampleGoal });
  assert.equal(practiceGoalForScenario(goal, "lesson-1"), goal);
  assert.equal(practiceGoalForScenario(goal, "lesson-2"), null);
  assert.equal(practiceGoalForScenario(null, "lesson-1"), null);
  assert.deepEqual(goal, sampleGoal);
});

test("saving validates v1, keeps the 140-character limit and does not write invalid input", () => {
  let writes = 0;
  const storage = { getItem: () => null, setItem: () => { writes += 1; } };
  for (const patch of [{ version: 2 }, { focus: "profit" }, { note: "字".repeat(141) }, { updatedAt: "invalid" }]) {
    assert.equal(savePracticeGoal(storage, practiceGoalKey("learner-one"), { ...sampleGoal, ...patch } as PracticeGoal), false);
  }
  assert.equal(writes, 0);
});

test("a successful save verifies the exact stored JSON without modifying the input", () => {
  const goal = Object.freeze({ ...sampleGoal, note: "字".repeat(140) });
  const original = JSON.stringify(goal);
  const key = practiceGoalKey("learner-one");
  const values = new Map<string, string>();
  const calls: string[] = [];
  const storage = {
    getItem: (requestedKey: string) => { calls.push(`read:${requestedKey}`); return values.get(requestedKey) ?? null; },
    setItem: (requestedKey: string, value: string) => { calls.push(`write:${requestedKey}`); values.set(requestedKey, value); },
  };
  assert.equal(savePracticeGoal(storage, key, goal), true);
  assert.deepEqual(calls, [`write:${key}`, `read:${key}`]);
  assert.equal(values.get(key), original);
  assert.deepEqual(parsePracticeGoal(values.get(key) ?? null), goal);
  assert.equal(JSON.stringify(goal), original);
});

test("write or read exceptions cannot be reported as a successful save", () => {
  let reads = 0;
  const quotaStorage = {
    getItem: () => { reads += 1; return null; },
    setItem: () => { throw new Error("Storage quota exceeded"); },
  };
  assert.equal(savePracticeGoal(quotaStorage, practiceGoalKey(null), sampleGoal), false);
  assert.equal(reads, 0);
  const blockedReadStorage = {
    getItem: () => { throw new Error("Storage access denied"); },
    setItem: () => {},
  };
  assert.equal(savePracticeGoal(blockedReadStorage, practiceGoalKey(null), sampleGoal), false);
});

test("missing, corrupt or different readback cannot be reported as a successful save", () => {
  const otherGoal = JSON.stringify({ ...sampleGoal, scenarioId: "lesson-2" });
  const { note, ...otherFields } = sampleGoal;
  const reorderedGoal = JSON.stringify({ note, ...otherFields });
  for (const readback of [null, "{", "null", otherGoal, reorderedGoal]) {
    const storage = { getItem: () => readback, setItem: () => {} };
    assert.equal(savePracticeGoal(storage, practiceGoalKey(null), sampleGoal), false);
  }
});
