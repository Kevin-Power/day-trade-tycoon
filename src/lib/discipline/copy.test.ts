import assert from "node:assert/strict";
import { test } from "node:test";
import { celebrationHeadline, celebrationSpeech, cheerFor, levelProgress, progressText } from "./copy.ts";
import { levelFor, type Celebration } from "./score.ts";

const celebration = (over: Partial<Celebration>): Celebration => ({
  source: "daily", gained: [], points: 18, beforeTotal: 0, total: 18, before: levelFor(0), after: levelFor(18),
  newBadges: [], alreadyCounted: false, ...over,
});

test("progress names the points still needed and the next title", () => {
  assert.equal(progressText(levelFor(118), 118), "再 42 分升到 Lv4 停損守門員");
  assert.equal(progressText(levelFor(1800), 2100), "已是最高等級");
});

test("the bar fills inside the current level and is full at the top", () => {
  assert.equal(levelProgress(levelFor(0), 0), 0);
  assert.equal(levelProgress(levelFor(80), 120), 0.5);
  assert.equal(levelProgress(levelFor(2000), 2000), 1);
});

test("the headline gives the points, or says the day was already counted", () => {
  assert.equal(celebrationHeadline(celebration({})), "這次拿到 +18 分");
  assert.equal(celebrationHeadline(celebration({ source: "practice", points: 0, alreadyCounted: true })), "今天的練習分已經算過了");
});

test("read-aloud says the points and, on a level-up, the new level", () => {
  assert.equal(celebrationSpeech(celebration({})), "拿到 18 分。");
  assert.equal(celebrationSpeech(celebration({ points: 25, beforeTotal: 18, total: 43, after: levelFor(43) })), "拿到 25 分。升級了，第 2 級，準時報到。");
  assert.equal(celebrationSpeech(celebration({ source: "practice", points: 0, alreadyCounted: true })), "今天的練習分已經算過了。");
});

test("every level has its own encouragement", () => {
  assert.equal(cheerFor(4), "每一筆都先想好停損，這就是守門員。");
  assert.equal(new Set(Array.from({ length: 10 }, (_, index) => cheerFor(index + 1))).size, 10);
});
