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
  const { store, persistence, values, messages, load } = gameStoreFixture({ userId: "student-a", failWrites: true });
  buy(store);
  store.getState().flattenSelected();
  // Use guest settlement so this test cannot be rescued by a server write.
  persistence.setProfileIdentity(null);
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
  const original = JSON.stringify(review);
  storage.failWrites = false;
  assert.equal(persistence.saveReview(review), true);
  assert.equal(persistence.loadReviewState(id).localSaved, true);
  assert.equal(JSON.stringify(persistence.loadReview(id)), original);
});
