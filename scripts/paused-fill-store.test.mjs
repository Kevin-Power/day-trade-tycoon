import assert from "node:assert/strict";
import { test } from "node:test";
import { buy, gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

function assertOnlyNewFillsArePaused(engine, previous) {
  const old = new Set(previous);
  const added = engine.fills.filter((fill) => !old.has(fill));
  assert.ok(added.length > 0, "the closing action must create a fill");
  assert.ok(added.every((fill) => fill.filledWhilePaused === true));
  assert.ok(previous.every((fill) => fill.filledWhilePaused === undefined), "running fills must keep their original pause marker");
  return added;
}

for (const action of ["submit", "flattenSelected", "flattenAll"]) {
  test(`${action} marks only its new paused fill after a running entry`, () => {
    const { store } = gameStoreFixture();
    buy(store);
    const engine = store.getState().engine;
    const previous = [...engine.fills];
    assert.equal(previous.length, 1);
    store.getState().togglePause();
    assert.equal(store.getState().paused, true);
    if (action === "submit") store.getState().setTicket({ side: "sell", type: "market", lots: 1 });
    store.getState()[action]();
    assert.equal(engine.positions.get("2317")?.lots, 0);
    const added = assertOnlyNewFillsArePaused(engine, previous);
    assert.equal(added[0].side, "sell");
  });
}

test("paused flattenAll marks every new position close and keeps both running entries unmarked", () => {
  const { store } = gameStoreFixture();
  buy(store, "2317");
  buy(store, "2882");
  const engine = store.getState().engine;
  const previous = [...engine.fills];
  assert.equal(previous.length, 2);
  store.getState().togglePause();
  store.getState().flattenAll();
  const added = assertOnlyNewFillsArePaused(engine, previous);
  assert.deepEqual(new Set(added.map((fill) => fill.code)), new Set(["2317", "2882"]));
  assert.ok([...engine.positions.values()].every((position) => position.lots === 0));
});

test("paused flattenAll keeps prior fills when the session passes 80 fills", () => {
  const { store } = gameStoreFixture();
  buy(store);
  const engine = store.getState().engine;
  // Seed this disposable fixture with earlier running fills; close through the real engine.
  while (engine.fills.length < 80) {
    engine.fills.push({ ...engine.fills[0], id: `earlier-${engine.fills.length}` });
  }
  const previous = [...engine.fills];
  store.getState().togglePause();
  store.getState().flattenAll();
  assert.equal(engine.fills.length, 81);
  assertOnlyNewFillsArePaused(engine, previous);
});

test("running flattenAll leaves new close fills unmarked", () => {
  const { store } = gameStoreFixture();
  buy(store);
  const engine = store.getState().engine;
  store.getState().flattenAll();
  assert.equal(engine.positions.get("2317")?.lots, 0);
  assert.equal(engine.fills.length, 2);
  assert.ok(engine.fills.every((fill) => fill.filledWhilePaused === undefined));
});
