import assert from "node:assert/strict";
import { test } from "node:test";
import { coachSteps, readCoachSeen, resetCoachSeen, writeCoachSeen } from "./coach-steps.ts";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};
const blocked = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

test("every layout gets the same three steps in order", () => {
  for (const layout of ["phone", "tablet", "desktop", "senior"] as const)
    assert.deepEqual(coachSteps(layout).map((step) => step.id), ["chart", "play", "fills"]);
});

test("phones point at the order and holdings tabs", () => {
  assert.deepEqual(coachSteps("phone")[1].targets, ['[data-coach="play"]', '[data-coach="tab-trade"]']);
  assert.deepEqual(coachSteps("senior")[2].targets, ['[data-coach="tab-positions"]']);
  assert.deepEqual(coachSteps("desktop")[1].targets, ['[data-coach="play"]', '[data-coach="ticket"]']);
  assert.deepEqual(coachSteps("desktop")[2].targets, ['[data-coach="ledger"]']);
  assert.deepEqual(coachSteps("tablet")[2].targets, ['[data-coach="ledger"]']);
});

test("the chart step names the labelled previous-close line", () => {
  assert.equal(coachSteps("desktop")[0].body, "這是走勢圖。標「昨」的虛線是昨天收盤價，比它高是漲、低是跌。");
  assert.equal(coachSteps("phone")[1].body, "按「播放」讓行情動起來；想買，先點「下單」分頁再按「買進」。");
  assert.equal(coachSteps("desktop")[1].body, "按「播放」讓行情動起來；想買就按「買進」。");
  assert.deepEqual(coachSteps("tablet").map((step) => step.title), ["看走勢圖", "讓行情動起來", "成交與庫存"]);
});

test("seen state survives only where storage works", () => {
  const storage = memory();
  assert.equal(readCoachSeen(storage), false);
  writeCoachSeen(storage);
  assert.equal(readCoachSeen(storage), true);
  resetCoachSeen(storage);
  assert.equal(readCoachSeen(storage), false);
  assert.equal(readCoachSeen(blocked), false);
  assert.doesNotThrow(() => writeCoachSeen(blocked));
  assert.doesNotThrow(() => resetCoachSeen(blocked));
});
