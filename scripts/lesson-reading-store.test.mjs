import assert from "node:assert/strict";
import { test } from "node:test";
import { gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

test("closing and rereading a lesson preserves the same paused market until explicit resume", () => {
  const { store } = gameStoreFixture();
  store.getState().start("wed-open");
  const { engine, activeBeat, speed, dismissedBeats } = store.getState();
  const time = engine.t;
  store.getState().hideLessonCard();
  assert.equal(store.getState().lessonCardHidden, true);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().activeBeat, activeBeat);
  assert.equal(store.getState().dismissedBeats, dismissedBeats);
  store.getState().setMobileTab("chart");
  store.getState().checkBeats();
  assert.equal(store.getState().lessonCardHidden, true);
  store.getState().reopenLessonCard();
  assert.equal(store.getState().lessonCardHidden, false);
  assert.equal(store.getState().activeBeat, activeBeat);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().speed, speed);
  assert.equal(engine.t, time);
  assert.equal(engine.orders.length, 0);
  store.getState().hideLessonCard();
  store.getState().togglePause();
  assert.equal(store.getState().paused, false);
  assert.equal(store.getState().lessonCardHidden, false);
  assert.equal(store.getState().activeBeat, null);
  store.getState().checkBeats();
  assert.equal(store.getState().activeBeat, null, "the same opening card cannot immediately reopen");
  while (engine.t < 60) engine.step(Math.min(8, 60 - engine.t));
  store.getState().checkBeats();
  assert.equal(store.getState().activeBeat.atMinute, 1);
  assert.equal(store.getState().lessonCardHidden, false);
  assert.equal(store.getState().paused, true);
});

test("changing teaching preference never resumes an existing pause or pauses a running market", () => {
  const { store } = gameStoreFixture();
  assert.equal(store.getState().paused, false);
  store.getState().setTeachMode(false);
  assert.equal(store.getState().paused, false);
  store.getState().togglePause();
  store.getState().setTeachMode(true);
  store.getState().setTeachMode(false);
  assert.equal(store.getState().paused, true);
  store.getState().setTeachMode(true);
  store.getState().start("wed-open");
  store.getState().hideLessonCard();
  store.getState().setTeachMode(false);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().activeBeat, null);
  assert.equal(store.getState().lessonCardHidden, false);
});

test("reading controls cannot skip active tour steps and work when the ready card has no lesson beat", () => {
  const { store, load } = gameStoreFixture();
  store.getState().openLearnerGuide();
  for (let step = 0; step < load("@/lib/game/learner-guide").LEARNER_GUIDE_STEPS.length; step++) {
    store.getState().setLearnerGuideStep(step);
    for (const action of ["hideLessonCard", "reopenLessonCard", "dismissBeat", "togglePause"]) store.getState()[action]();
    assert.equal(store.getState().paused, true);
    assert.equal(store.getState().lessonCardHidden, false);
    assert.equal(store.getState().learnerGuideStep, step);
  }
  store.getState().setTeachMode(false);
  store.getState().finishLearnerGuide();
  assert.equal(store.getState().activeBeat, null);
  assert.equal(store.getState().learnerGuideReady, true);
  store.getState().hideLessonCard();
  assert.equal(store.getState().lessonCardHidden, true);
  assert.equal(store.getState().learnerGuideReady, true);
  store.getState().reopenLessonCard();
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().lessonCardHidden, false);
  store.getState().dismissBeat();
  assert.equal(store.getState().paused, false);
  assert.equal(store.getState().learnerGuideReady, false);
});

test("a collapsed exam prompt cannot bypass paused trading restrictions", () => {
  const { store } = gameStoreFixture();
  store.getState().start("tycoon");
  const engine = store.getState().engine;
  store.getState().hideLessonCard();
  assert.equal(store.getState().lessonCardHidden, true);
  store.getState().setTicket({ side: "buy", type: "market", lots: 1 });
  store.getState().submit();
  assert.equal(store.getState().lastSubmitResult.ok, false);
  assert.match(store.getState().lastSubmitResult.reason, /測驗不可在暫停中下單/);
  store.getState().flattenSelected();
  store.getState().flattenAll();
  assert.equal(engine.orders.length, 0);
  assert.equal(engine.fills.length, 0);
  store.getState().dismissBeat();
  assert.equal(store.getState().paused, false);
  assert.equal(store.getState().submit().ok, true);
});

test("leaving, restarting, settling or reopening the tour never carries a collapsed card forward", () => {
  const { store } = gameStoreFixture();
  for (const action of ["leave", "start", "settle", "openLearnerGuide"]) {
    store.getState().start("wed-open");
    store.getState().hideLessonCard();
    assert.equal(store.getState().lessonCardHidden, true);
    store.getState()[action](...(action === "start" ? ["wed-open"] : []));
    assert.equal(store.getState().lessonCardHidden, false, action);
  }
  store.getState().leave();
  store.getState().hideLessonCard();
  store.getState().reopenLessonCard();
  assert.equal(store.getState().lessonCardHidden, false);
  assert.equal(store.getState().paused, false);
});
