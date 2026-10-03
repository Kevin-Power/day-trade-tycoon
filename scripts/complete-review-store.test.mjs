import assert from "node:assert/strict";
import { test } from "node:test";
import { buy, flushStorePromises, gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

test("a real 83-fill session keeps its early averaging-down evidence and paused fill through settlement and reload", async () => {
  const fixture = gameStoreFixture({ userId: "student-a" });
  const { store, persistence, values, load, requests } = fixture;
  const engine = store.getState().engine;
  store.getState().togglePause();
  buy(store);
  const first = engine.fills[0];
  store.getState().togglePause();
  // The seeded teaching tape falls shortly after the open. Use real quotes and
  // matching, rather than inserting test fills or changing the engine's ledger.
  for (let i = 0; i < 120 && engine.quote("2317").ask >= first.price * 0.998; i++) engine.step(1);
  assert.ok(engine.quote("2317").ask < first.price * 0.998);
  store.getState().submit();
  assert.equal(engine.positions.get("2317").lots, 2);
  engine.step(1);
  store.getState().flattenAll();
  engine.step(1);
  for (let i = 0; i < 40; i++) {
    buy(store);
    engine.step(1);
    store.getState().flattenSelected();
    engine.step(1);
  }
  assert.equal(engine.fills.length, 83);
  assert.equal(engine.fills.at(-1), first);
  store.getState().settle();
  await flushStorePromises();
  const state = store.getState();
  const review = persistence.loadReviewState(state.lastResult.id);
  assert.equal(review.localSaved, true);
  assert.equal(review.bundle.fills.length, 83);
  assert.equal(state.lastResult.pausedFills, 1);
  assert.equal(state.lastVerdicts.find((item) => item.rule.code === "no_average_down").passed, false);
  assert.equal(load("@/lib/game/pass-rules").analyzeFills(engine.fills.slice(0, 80)).averageDownAt, undefined);
  assert.equal(state.syncStatus, "saved");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].fills.length, 83);
  assert.equal(requests[0].expectedUserId, "student-a");
  const reloaded = gameStoreFixture({ userId: "student-a", values }).persistence.loadReview(state.lastResult.id);
  assert.equal(reloaded.fills.length, 83);
  assert.equal(reloaded.fills.at(-1).filledWhilePaused, true);
  assert.equal(reloaded.verdicts.find((item) => item.rule.code === "no_average_down").passed, false);
});

test("5001 fills remain complete locally and after reload while the server's 5000 limit is retained", async () => {
  const { store, persistence, values, requests, load } = gameStoreFixture({ userId: "student-a" });
  buy(store);
  store.getState().flattenSelected();
  const engine = store.getState().engine;
  // This fixture only exercises the serialization boundary; genuine >80-fill
  // trading and pass-rule regression are covered by the preceding test.
  while (engine.fills.length < 5001) engine.fills.push({ ...engine.fills[0], id: `earlier-${engine.fills.length}` });
  store.getState().settle();
  await flushStorePromises();
  const state = store.getState();
  const review = persistence.loadReviewState(state.lastResult.id);
  assert.equal(review.bundle.fills.length, 5001);
  assert.equal(review.localSaved, true);
  assert.equal(state.localReviewSaved, true);
  assert.equal(state.syncStatus, "too-large");
  assert.equal(requests.length, 0, "oversized data must not be sent or truncated for the server");
  const schemas = load("@/lib/game/review-schema");
  assert.equal(schemas.localReviewBundleSchema.safeParse(review.bundle).success, true);
  assert.equal(schemas.reviewBundleSchema.safeParse(review.bundle).success, false);
  assert.equal(schemas.reviewBundleSchema.safeParse({ ...review.bundle, fills: review.bundle.fills.slice(0, 5000) }).success, true);
  const reloaded = gameStoreFixture({ userId: "student-a", values }).persistence.loadReviewState(state.lastResult.id);
  assert.equal(reloaded.bundle.fills.length, 5001);
  assert.equal(reloaded.localSaved, true);
});

test("quota failure retains the current complete review only in identity-scoped memory and reports unsaved", () => {
  // Start as a guest so the whole session has one owner and no server fallback.
  const { store, persistence, values, messages, load } = gameStoreFixture({ failWrites: true });
  buy(store);
  store.getState().flattenSelected();
  store.getState().settle();
  const state = store.getState();
  const id = state.lastResult.id;
  assert.equal(state.localReviewSaved, false);
  assert.equal(persistence.loadReviewState(id).localSaved, false);
  assert.equal(persistence.loadReview(id).fills.length, 2);
  const message = load("@/lib/game/review-storage-status").reviewSaveMessage(state.syncStatus, state.localReviewSaved);
  assert.match(message, /尚未保存/);
  assert.match(message, /重新整理或關閉/);
  assert.ok(messages.includes(message));
  persistence.setProfileIdentity("another-student");
  assert.equal(persistence.loadReview(id), null);
  persistence.setProfileIdentity(null);
  assert.equal(persistence.loadReview(id).fills.length, 2);
  assert.equal(gameStoreFixture({ values }).persistence.loadReview(id), null, "transient copies must not pretend to survive reload");
});

test("identity hydration removes the old live engine and settled result while retaining each profile", async () => {
  for (const phase of ["live", "result"]) {
    const { store, persistence, requests } = gameStoreFixture({ userId: "student-a" });
    buy(store);
    const oldEngine = store.getState().engine;
    if (phase === "result") {
      store.getState().settle();
      await flushStorePromises();
    } else {
      store.getState().setFlashOrder(true);
      assert.equal(store.getState().flashOrder, true);
    }
    // A same-identity hydration must not reset an active practice.
    store.getState().hydrate();
    assert.equal(store.getState().engine, oldEngine);
    const savedId = store.getState().lastResult?.id;
    persistence.setProfileIdentity("student-b");
    persistence.saveProfile({ ...persistence.loadProfile(), sessions: 7 });
    store.getState().hydrate();
    const state = store.getState();
    assert.equal(state.phase, "lobby");
    assert.equal(state.engine, null);
    assert.equal(state.scenario, null);
    assert.equal(state.lastResult, null);
    assert.equal(state.lastVerdicts.length, 0);
    assert.equal(state.tradePlan, null);
    assert.equal(state.firstPlannedOrder, null);
    assert.equal(state.flashOrder, false);
    assert.equal(state.flashActivation, null);
    assert.equal(state.profileIdentity, "student-b");
    assert.equal(state.profile.sessions, 7);
    assert.equal(state.profile.history.length, 0);
    assert.equal(requests.length, phase === "result" ? 1 : 0);
    if (savedId) {
      assert.equal(persistence.loadReview(savedId), null);
      persistence.setProfileIdentity("student-a");
      store.getState().hydrate();
      assert.equal(persistence.loadReview(savedId).rec.id, savedId);
      assert.equal(store.getState().profile.history[0].id, savedId);
      assert.equal(store.getState().phase, "lobby");
    }
  }
});

test("account changes block settlement and order mutations before a hydration effect runs", async () => {
  const actions = ["settle", "submit", "submitLightning", "flattenSelected", "flattenAll", "cancelOrder"];
  for (const action of actions) {
    const { store, persistence, values, requests } = gameStoreFixture({ userId: "student-a" });
    buy(store);
    const engine = store.getState().engine;
    store.getState().setTicket({ side: "buy", type: "limit", price: engine.quote("2317").bid - 1 });
    const pendingAck = store.getState().submit();
    assert.equal(pendingAck.ok, true);
    const pendingId = engine.orders[0].id;
    store.getState().setFlashOrder(true);
    const activationId = store.getState().flashActivation.id;
    const before = JSON.stringify({ fills: engine.fills, orders: engine.orders, positions: [...engine.positions], ended: engine.ended });
    persistence.setProfileIdentity("student-b");
    if (action === "submitLightning") {
      store.getState().submitLightning({ code: "2317", side: "buy", price: engine.quote("2317").ask, activationId });
    } else if (action === "cancelOrder") {
      store.getState().cancelOrder(pendingId);
    } else {
      store.getState()[action]();
    }
    await flushStorePromises();
    assert.equal(JSON.stringify({ fills: engine.fills, orders: engine.orders, positions: [...engine.positions], ended: engine.ended }), before, `${action} must not mutate the prior owner's engine`);
    assert.equal(store.getState().phase, "lobby", action);
    assert.equal(store.getState().engine, null, action);
    assert.equal(store.getState().lastResult, null, action);
    assert.equal(store.getState().profileIdentity, "student-b", action);
    assert.equal(requests.length, 0, action);
    assert.equal([...values.keys()].some((key) => key.includes("review") || key.includes("day-tycoon-v1")), false, `${action} must not save an old-owner result under either identity`);
  }
});

test("switching identities before the asynchronous server import prevents sending A's result as B", async () => {
  const { store, persistence, requests } = gameStoreFixture({ userId: "student-a" });
  buy(store);
  store.getState().settle();
  const id = store.getState().lastResult.id;
  assert.equal(store.getState().syncStatus, "saving");
  assert.equal(requests.length, 0, "the dynamic import has not resolved in the same turn");
  persistence.setProfileIdentity("student-b");
  store.getState().hydrate();
  await flushStorePromises();
  assert.equal(requests.length, 0);
  assert.equal(store.getState().syncStatus, "local");
  assert.equal(store.getState().profile.history.length, 0);
  assert.equal(persistence.loadReview(id), null);
  persistence.setProfileIdentity("student-a");
  assert.equal(persistence.loadReviewState(id).localSaved, true);
  assert.equal(persistence.loadReview(id).rec.id, id);
});

test("late remote success or failure for A cannot change B's active practice or surface an A error", async () => {
  for (const outcome of ["resolve", "reject"]) {
    let release;
    let fail;
    const remoteGate = new Promise((resolve, reject) => { release = resolve; fail = reject; });
    const { store, persistence, requests, messages } = gameStoreFixture({ userId: "student-a", remoteGate });
    buy(store);
    store.getState().settle();
    const savedId = store.getState().lastResult.id;
    await flushStorePromises();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].expectedUserId, "student-a");
    assert.equal(store.getState().syncStatus, "saving");
    persistence.setProfileIdentity("student-b");
    persistence.saveProfile({ ...persistence.loadProfile(), sessions: 1 });
    store.getState().hydrate();
    store.getState().start("wed-open");
    store.getState().dismissBeat();
    buy(store);
    const bEngine = store.getState().engine;
    const bProfile = JSON.stringify(store.getState().profile);
    const messageCount = messages.length;
    if (outcome === "resolve") release();
    else fail(new Error("A's delayed server response failed"));
    await flushStorePromises();
    assert.equal(store.getState().engine, bEngine);
    assert.equal(store.getState().phase, "live");
    assert.equal(store.getState().syncStatus, "local");
    assert.equal(store.getState().localReviewSaved, false);
    assert.equal(store.getState().lastResult, null);
    assert.equal(JSON.stringify(store.getState().profile), bProfile);
    assert.equal(messages.length, messageCount);
    assert.equal(persistence.loadReview(savedId), null);
    persistence.setProfileIdentity("student-a");
    assert.equal(persistence.loadReviewState(savedId).localSaved, true);
  }
});

test("persistOnHide does not save a stale profile into the newly selected identity", () => {
  const { store, persistence, values, load } = gameStoreFixture({ userId: "student-a" });
  const persistOnHide = load("@/lib/game/store").persistOnHide;
  persistence.saveProfile({ ...persistence.loadProfile(), sessions: 3 });
  const savedA = values.get("day-tycoon-v1:user:student-a");
  store.setState({ profile: { ...store.getState().profile, sessions: 99 } });
  store.getState().setFlashOrder(true);
  persistence.setProfileIdentity("student-b");
  persistence.saveProfile({ ...persistence.loadProfile(), sessions: 7 });
  const savedB = values.get("day-tycoon-v1:user:student-b");
  persistOnHide();
  assert.equal(store.getState().flashOrder, false);
  assert.equal(values.get("day-tycoon-v1:user:student-a"), savedA);
  assert.equal(values.get("day-tycoon-v1:user:student-b"), savedB);
  store.getState().hydrate();
  assert.equal(store.getState().profile.sessions, 7);
  store.setState({ profile: { ...store.getState().profile, sessions: 8 } });
  persistOnHide();
  assert.equal(persistence.loadProfile().sessions, 8, "matching identity should still save its own profile");
  persistence.setProfileIdentity("student-a");
  store.getState().hydrate();
  assert.equal(store.getState().profile.sessions, 3);
});

test("starting a new lesson immediately after an account change cannot carry A's profile into B", async () => {
  const { store, persistence, requests } = gameStoreFixture({ userId: "student-a" });
  buy(store);
  store.getState().settle();
  await flushStorePromises();
  const aId = store.getState().lastResult.id;
  const aProfile = JSON.stringify(persistence.loadProfile());
  assert.equal(store.getState().profile.history.length, 1);
  persistence.setProfileIdentity("student-b");
  // The user action arrives before React's identity hydration effect.
  store.getState().start("mon");
  store.getState().dismissBeat();
  assert.equal(store.getState().profileIdentity, "student-b");
  assert.equal(store.getState().profile.history.length, 0);
  assert.equal(store.getState().profile.sessions, 0);
  store.getState().settle();
  await flushStorePromises();
  const bId = store.getState().lastResult.id;
  assert.notEqual(aId, bId);
  assert.equal(persistence.loadProfile().history.length, 1);
  assert.equal(persistence.loadProfile().history[0].id, bId);
  assert.equal(persistence.loadProfile().sessions, 1);
  assert.equal(persistence.loadReview(aId), null);
  assert.equal(requests.at(-1).expectedUserId, "student-b");
  persistence.setProfileIdentity("student-a");
  assert.equal(JSON.stringify(persistence.loadProfile()), aProfile);
  assert.equal(persistence.loadReview(aId).rec.id, aId);
});

test("a rejected server write plus failed local storage never claims the review was saved", async () => {
  const { store, persistence, messages, load } = gameStoreFixture({ userId: "student-a", failWrites: true, rejectRemote: true });
  buy(store);
  store.getState().flattenSelected();
  store.getState().settle();
  assert.equal(store.getState().syncStatus, "saving");
  await flushStorePromises();
  const state = store.getState();
  assert.equal(state.syncStatus, "failed");
  assert.equal(state.localReviewSaved, false);
  assert.equal(persistence.loadReviewState(state.lastResult.id).localSaved, false);
  const message = load("@/lib/game/review-storage-status").reviewSaveMessage(state.syncStatus, state.localReviewSaved);
  assert.match(message, /主機尚未保存/);
  assert.match(message, /尚未保存，僅暫存/);
  assert.ok(messages.includes(message));
  persistence.setProfileIdentity("student-b");
  assert.equal(persistence.loadReview(state.lastResult.id), null);
  persistence.setProfileIdentity("student-a");
  assert.equal(persistence.loadReview(state.lastResult.id).fills.length, 2);
});

test("retrying local storage preserves the same complete review without recomputing its historical result", () => {
  const { store, persistence, storage } = gameStoreFixture({ failWrites: true });
  buy(store);
  store.getState().flattenSelected();
  store.getState().settle();
  const id = store.getState().lastResult.id;
  const review = persistence.loadReview(id);
  const original = JSON.parse(JSON.stringify(review));
  storage.failWrites = false;
  assert.equal(persistence.saveReview(review), true);
  assert.equal(persistence.loadReviewState(id).localSaved, true);
  // Schema parsing can reorder object keys; every stored value and array order
  // must still match the original snapshot, and retrying must not mutate it.
  assert.deepEqual(JSON.parse(JSON.stringify(review)), original);
  assert.deepEqual(JSON.parse(JSON.stringify(persistence.loadReview(id))), original);
});
