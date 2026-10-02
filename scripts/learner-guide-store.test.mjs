import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as guide from "../src/lib/game/learner-guide.ts";

// Run the production store actions with a tiny engine and storage fixture. A guide
// action must never reach the engine, even when a normal teaching pause allows it.
function storeFixture(completedSessions = 0) {
  const unexpectedEngineCall = () => {
    throw new Error("Guide reached a trading or clock operation");
  };
  const dependencies = {
    zustand: {
      create: (initialize) => {
        let state;
        const get = () => state;
        const set = (patch) => {
          state = { ...state, ...patch };
        };
        state = initialize(set, get);
        return { getState: get };
      },
    },
    "@/lib/game/scenarios": { scenarioById: (id) => ({ id, speed: 4, startMinute: 0 }) },
    "@/lib/game/persist": {
      getProfileIdentity: () => null,
      saveTeachMode: () => {},
      saveFlashOrder: () => {},
    },
    "@/lib/game/pass-rules": {},
    "@/lib/game/review-schema": { SERVER_REVIEW_FILL_LIMIT: 5000 },
    "@/lib/game/review-storage-status": {},
    "@/lib/game/flash-order": { isExamScenario: (id) => id === "tycoon" },
    "@/lib/game/learner-guide": guide,
    "@/lib/game/audio": { unlockAudio: () => {}, playError: () => {}, playFill: () => {} },
    "@/lib/market/engine": {
      DayMarket: class {
        t = 0;
        fills = [];
        quote() {
          return { code: "2317", ask: 200 };
        }
        step = unexpectedEngineCall;
        stats = unexpectedEngineCall;
        flattenAll = unexpectedEngineCall;
      },
    },
    "@/lib/market/universe": { STOCK_BY_CODE: {} },
    "@/lib/game/types": { EMPTY_PROFILE: { sessions: completedSessions } },
    "@/lib/market/ticks": { roundToTick: (price) => price },
    sonner: { toast: Object.assign(() => {}, { error: () => {} }) },
    "@/lib/game/curriculum": {
      openingBeat: () => ({ atMinute: 0, title: "Opening" }),
      beatKey: (scenarioId, minute) => `${scenarioId}:${minute}`,
    },
    "@/lib/broker": { SIM_ACCOUNT: "test", getBroker: unexpectedEngineCall },
  };
  const source = readFileSync(new URL("../src/lib/game/store.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected store dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports.useGame;
}

test("the actual store keeps every tour step paused despite resume, settings, or trade actions", () => {
  const store = storeFixture();
  store.getState().start("wed-open");
  assert.equal(store.getState().speed, 1);
  for (let step = 0; step < guide.LEARNER_GUIDE_STEPS.length; step++) {
    store.getState().setLearnerGuideStep(step);
    const engine = store.getState().engine;
    for (const action of [
      "togglePause",
      "dismissBeat",
      "settle",
      "submit",
      "flattenSelected",
      "flattenAll",
    ]) {
      store.getState()[action]();
      assert.equal(store.getState().paused, true, `${action} resumed guide step ${step}`);
      assert.equal(store.getState().learnerGuideStep, step);
    }
    store.getState().setTeachMode(false);
    store.getState().setFlashOrder(true);
    assert.equal(store.getState().paused, true);
    assert.equal(store.getState().flashOrder, false);
    assert.equal(store.getState().engine, engine);
    assert.equal(engine.t, 0);
    assert.equal(engine.fills.length, 0);
  }
  store.getState().finishLearnerGuide();
  assert.equal(store.getState().learnerGuideStep, null);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().learnerGuideReady, true);
  store.getState().dismissBeat();
  assert.equal(store.getState().paused, false);
  assert.equal(store.getState().learnerGuideReady, false);
});

test("an existing learner keeps the scenario speed and reopening only pauses their current practice", () => {
  const store = storeFixture(1);
  store.getState().start("wed-open");
  assert.equal(store.getState().learnerGuideStep, null);
  assert.equal(store.getState().speed, 4);
  store.getState().setSpeed(8);
  const engine = store.getState().engine;
  store.getState().openLearnerGuide();
  assert.equal(store.getState().speed, 8);
  assert.equal(store.getState().engine, engine);
  assert.equal(store.getState().paused, true);
  store.getState().finishLearnerGuide();
  assert.equal(store.getState().speed, 8);
  assert.equal(store.getState().paused, true);
});
