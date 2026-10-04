import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialTrialPractice,
  trialPracticeReducer,
  type TrialPractice,
} from "./trial-practice.ts";

function finishTrial(state: TrialPractice): TrialPractice {
  let next = trialPracticeReducer(state, { type: "answer", stage: "review", choice: "lot" });
  next = trialPracticeReducer(next, { type: "answer", stage: "waiting", choice: "check" });
  next = trialPracticeReducer(next, { type: "close-position" });
  return trialPracticeReducer(next, { type: "answer", stage: "closed", choice: "loss" });
}

test("the fixed example requires the order, fill, close and cost steps before completion", () => {
  let state = initialTrialPractice();
  assert.equal(trialPracticeReducer(state, { type: "close-position" }), state);
  assert.equal(
    trialPracticeReducer(state, { type: "answer", stage: "closed", choice: "loss" }),
    state,
  );
  state = trialPracticeReducer(state, { type: "answer", stage: "review", choice: "lot" });
  assert.equal(state.stage, "waiting");
  state = trialPracticeReducer(state, { type: "answer", stage: "waiting", choice: "check" });
  assert.equal(state.stage, "filled");
  state = trialPracticeReducer(state, { type: "close-position" });
  assert.equal(state.stage, "closed");
  state = trialPracticeReducer(state, { type: "answer", stage: "closed", choice: "loss" });
  assert.equal(state.stage, "complete");
  assert.deepEqual(state.hintedTopics, []);
});

test("an empty submission neither advances nor records a teaching hint", () => {
  const state = initialTrialPractice();
  const empty = trialPracticeReducer(state, { type: "answer", stage: "review", choice: "" });
  assert.equal(empty, state);
  assert.deepEqual(empty.hintedTopics, []);
  assert.equal(empty.stage, "review");
});

test("repeated incorrect answers record one prompt and a later correction retains that history", () => {
  const initial = initialTrialPractice();
  const prompted = trialPracticeReducer(initial, {
    type: "answer",
    stage: "review",
    choice: "share",
  });
  assert.equal(prompted.stage, "review");
  assert.deepEqual(prompted.hintedTopics, ["review"]);
  assert.equal(
    trialPracticeReducer(prompted, { type: "answer", stage: "review", choice: "share" }),
    prompted,
  );
  const corrected = trialPracticeReducer(prompted, {
    type: "answer",
    stage: "review",
    choice: "lot",
  });
  assert.equal(corrected.stage, "waiting");
  assert.deepEqual(corrected.hintedTopics, ["review"]);
  assert.deepEqual(initial.hintedTopics, []);
  assert.equal(
    trialPracticeReducer(corrected, { type: "answer", stage: "review", choice: "share" }),
    corrected,
  );
});

test("retrying a shown topic after completion retains earlier prompts and continues that example", () => {
  let state = initialTrialPractice();
  state = trialPracticeReducer(state, { type: "answer", stage: "review", choice: "share" });
  state = trialPracticeReducer(state, { type: "answer", stage: "review", choice: "lot" });
  state = trialPracticeReducer(state, { type: "answer", stage: "waiting", choice: "repeat" });
  state = finishTrial(state);
  assert.equal(state.stage, "complete");
  assert.deepEqual(state.hintedTopics, ["review", "waiting"]);
  state = trialPracticeReducer(state, { type: "retry-topic", stage: "waiting" });
  assert.equal(state.stage, "waiting");
  assert.equal(state.restartedFrom, "waiting");
  assert.deepEqual(state.hintedTopics, ["review", "waiting"]);
  state = trialPracticeReducer(state, { type: "answer", stage: "waiting", choice: "check" });
  assert.equal(state.stage, "filled");
  state = trialPracticeReducer(state, { type: "close-position" });
  state = trialPracticeReducer(state, { type: "answer", stage: "closed", choice: "zero" });
  state = trialPracticeReducer(state, { type: "answer", stage: "closed", choice: "loss" });
  assert.equal(state.stage, "complete");
  assert.deepEqual(state.hintedTopics, ["review", "waiting", "closed"]);
});

test("topic retry cannot skip the first round or invent a prompt, and a new round clears history", () => {
  const initial = initialTrialPractice();
  assert.equal(trialPracticeReducer(initial, { type: "retry-topic", stage: "closed" }), initial);
  const clean = finishTrial(initial);
  assert.equal(trialPracticeReducer(clean, { type: "retry-topic", stage: "closed" }), clean);
  const prompted = trialPracticeReducer(initial, {
    type: "answer",
    stage: "review",
    choice: "share",
  });
  const complete = finishTrial(prompted);
  const retry = trialPracticeReducer(complete, { type: "retry-topic", stage: "review" });
  const restarted = trialPracticeReducer(retry, { type: "restart" });
  assert.deepEqual(restarted, { stage: "review", hintedTopics: [], restartedFrom: null });
  assert.deepEqual(complete.hintedTopics, ["review"]);
  assert.notEqual(restarted.hintedTopics, initialTrialPractice().hintedTopics);
});
