import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishedLearnerGuideState,
  hasSeenLearnerGuide,
  initialPracticeSpeed,
  learnerGuideStepState,
  LEARNER_GUIDE_STEPS,
  rememberLearnerGuide,
  shouldAutoOpenLearnerGuide,
} from "./learner-guide.ts";

test("only a learner without completed practice or seen guide is automatically introduced", () => {
  assert.equal(shouldAutoOpenLearnerGuide("wed-open", 0, false), true);
  assert.equal(shouldAutoOpenLearnerGuide("wed-open", 1, false), false);
  assert.equal(shouldAutoOpenLearnerGuide("wed-open", 0, true), false);
  assert.equal(shouldAutoOpenLearnerGuide("tycoon", 0, false), false);
});

test("every guide step only chooses a screen and leaves the simulation paused", () => {
  for (const [step, item] of LEARNER_GUIDE_STEPS.entries()) {
    assert.deepEqual(learnerGuideStepState(step), {
      learnerGuideStep: step,
      learnerGuideReady: false,
      mobileTab: item.tab,
      paused: true,
    });
  }
  assert.equal(learnerGuideStepState(-1).learnerGuideStep, 0);
  assert.equal(learnerGuideStepState(100).learnerGuideStep, 3);
  assert.equal(learnerGuideStepState(Number.NaN).learnerGuideStep, 0);
});

test("only an automatically introduced new learner starts at normal speed", () => {
  assert.equal(initialPracticeSpeed(4, true), 1);
  assert.equal(initialPracticeSpeed(4, false), 4);
  assert.equal(initialPracticeSpeed(8, false), 8);
  assert.equal("speed" in learnerGuideStepState(0), false);
});

test("finishing or skipping the guide requires a separate explicit resume", () => {
  assert.deepEqual(finishedLearnerGuideState(), {
    learnerGuideStep: null,
    learnerGuideReady: true,
    paused: true,
  });
});

test("seen preference belongs to the current browser identity and tolerates unavailable storage", () => {
  const previous = (globalThis as { window?: unknown }).window;
  const entries = new Map<string, string>();
  try {
    delete (globalThis as { window?: unknown }).window;
    assert.equal(hasSeenLearnerGuide(null), false);
    rememberLearnerGuide(null);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
      },
    };
    rememberLearnerGuide("student-a");
    assert.equal(hasSeenLearnerGuide("student-a"), true);
    assert.equal(hasSeenLearnerGuide("student-b"), false);
    assert.equal(hasSeenLearnerGuide(null), false);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };
    assert.equal(hasSeenLearnerGuide("student-a"), false);
    assert.doesNotThrow(() => rememberLearnerGuide("student-a"));
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  }
});
