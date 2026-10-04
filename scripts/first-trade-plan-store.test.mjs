import assert from "node:assert/strict";
import { test } from "node:test";
import { buy, flushStorePromises, gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

const notes = {
  entryCondition: "  看懂自己的進場理由  ",
  exitCondition: "  理由不成立就退出  ",
  maxLoss: 1000,
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("saving a plan captures current context, and later ticket changes require an explicit resave", () => {
  const { store } = gameStoreFixture();
  const original = { ...notes };
  const state = store.getState();
  assert.equal(state.saveTradePlan(original).ok, true);
  const plan = store.getState().tradePlan;
  assert.equal(plan.code, "2317");
  assert.equal(plan.side, "buy");
  assert.equal(plan.lots, 1);
  assert.equal(plan.simTime, state.engine.t);
  assert.equal(plan.entryCondition, notes.entryCondition.trim());
  original.entryCondition = "改掉輸入物件";
  state.select("2882");
  store.getState().setTicket({ side: "sell", lots: 2 });
  state.engine.step(1);
  assert.equal(store.getState().tradePlan, plan);
  assert.equal(plan.code, "2317");
  assert.equal(plan.side, "buy");
  assert.equal(plan.lots, 1);
  assert.equal(plan.entryCondition, notes.entryCondition.trim());
  assert.equal(store.getState().saveTradePlan(notes).ok, true);
  const revised = store.getState().tradePlan;
  assert.equal(revised.code, "2882");
  assert.equal(revised.side, "sell");
  assert.equal(revised.lots, 2);
  assert.equal(revised.simTime, state.engine.t);
  assert.notEqual(revised, plan);
  store.getState().removeTradePlan();
  assert.equal(store.getState().tradePlan, null);
});

test("invalid plans do not overwrite a valid plan, and lobby or result cannot save or remove it", () => {
  const { store } = gameStoreFixture();
  assert.equal(store.getState().saveTradePlan(notes).ok, true);
  const valid = store.getState().tradePlan;
  for (const patch of [{ maxLoss: 0 }, { maxLoss: Infinity }, { entryCondition: " " }, { exitCondition: "a".repeat(201) }]) {
    assert.equal(store.getState().saveTradePlan({ ...notes, ...patch }).ok, false);
    assert.equal(store.getState().tradePlan, valid);
  }
  store.getState().settle();
  assert.equal(store.getState().saveTradePlan(notes).ok, false);
  store.getState().removeTradePlan();
  assert.equal(store.getState().tradePlan, valid);
  store.getState().leave();
  assert.equal(store.getState().saveTradePlan(notes).ok, false);
  assert.equal(store.getState().tradePlan, null);
});

test("a broker rejection does not lock the plan; the first successful regular order does", () => {
  const { store } = gameStoreFixture();
  assert.equal(store.getState().saveTradePlan(notes).ok, true);
  store.getState().setTicket({ lots: 200, type: "market" });
  store.getState().submit();
  assert.equal(store.getState().firstPlannedOrder, null);
  assert.equal(store.getState().engine.fills.length, 0);
  store.getState().setTicket({ lots: 1 });
  assert.equal(store.getState().saveTradePlan({ ...notes, maxLoss: 2000 }).ok, true);
  buy(store);
  const state = store.getState();
  const first = state.firstPlannedOrder;
  const order = state.engine.orders[0];
  assert.equal(first.id, order.id);
  assert.equal(first.code, order.code);
  assert.equal(first.time, order.time);
  assert.equal(first.price, order.price);
  assert.notEqual(first, order);
  assert.ok(Object.isFrozen(first));
  assert.equal(state.tradePlan.maxLoss, 2000);
  assert.equal(state.saveTradePlan({ ...notes, maxLoss: 3000 }).ok, false);
  state.removeTradePlan();
  assert.equal(store.getState().tradePlan.maxLoss, 2000);
  store.getState().flattenSelected();
  buy(store);
  assert.equal(store.getState().firstPlannedOrder, first, "later entries or closing orders cannot replace first intent");
});

test("an accepted waiting order locks the first intent before any fill and remains locked after cancellation", () => {
  const { store, load } = gameStoreFixture();
  store.getState().saveTradePlan(notes);
  const engine = store.getState().engine;
  const price = load("@/lib/market/ticks").limitDown(engine.quote("2317").prevClose);
  store.getState().setTicket({ type: "limit", price, lots: 1 });
  store.getState().submit();
  const first = store.getState().firstPlannedOrder;
  assert.ok(first);
  assert.equal(engine.fills.length, 0);
  assert.equal(engine.orders[0].status, "pending");
  store.getState().cancelOrder(first.id);
  assert.equal(engine.orders[0].status, "cancelled");
  assert.equal(store.getState().firstPlannedOrder, first);
  assert.equal(store.getState().saveTradePlan(notes).ok, false);
  store.getState().removeTradePlan();
  assert.ok(store.getState().tradePlan);
});

test("flash orders use the same first-order lock", () => {
  const { store } = gameStoreFixture();
  store.getState().saveTradePlan(notes);
  store.getState().setFlashOrder(true);
  const quote = store.getState().engine.quote("2317");
  store.getState().clickPrice(quote.ask, "buy");
  const state = store.getState();
  assert.ok(state.firstPlannedOrder);
  assert.equal(state.firstPlannedOrder.id, state.engine.orders[0].id);
  assert.equal(state.firstPlannedOrder.type, "limit");
  assert.equal(state.engine.fills.length, 1);
  assert.equal(state.saveTradePlan(notes).ok, false);
});

test("trading without a plan stays available but a successful first order prevents backfilling", () => {
  const { store } = gameStoreFixture();
  buy(store);
  assert.equal(store.getState().tradePlan, null);
  assert.ok(store.getState().firstPlannedOrder);
  assert.equal(store.getState().saveTradePlan(notes).ok, false);
  store.getState().flattenAll();
  assert.equal(store.getState().engine.positions.get("2317").lots, 0);
  assert.equal(store.getState().tradePlan, null);
});

test("restarting and leaving clear both plan and first intent without changing the previous snapshot", () => {
  const { store } = gameStoreFixture();
  store.getState().saveTradePlan(notes);
  buy(store);
  const plan = store.getState().tradePlan;
  const first = store.getState().firstPlannedOrder;
  store.getState().start("wed-open");
  assert.equal(store.getState().tradePlan, null);
  assert.equal(store.getState().firstPlannedOrder, null);
  assert.equal(plan.entryCondition, notes.entryCondition.trim());
  assert.equal(first.code, "2317");
  store.getState().dismissBeat();
  store.getState().saveTradePlan(notes);
  buy(store);
  store.getState().leave();
  assert.equal(store.getState().tradePlan, null);
  assert.equal(store.getState().firstPlannedOrder, null);
});

test("settlement preserves the accepted plan and first intent through local reload and server payload", async () => {
  const { store, persistence, values, requests } = gameStoreFixture({ userId: "student-a" });
  store.getState().saveTradePlan(notes);
  buy(store);
  const expected = plain({ plan: store.getState().tradePlan, order: store.getState().firstPlannedOrder });
  store.getState().flattenSelected();
  store.getState().settle();
  await flushStorePromises();
  const id = store.getState().lastResult.id;
  const saved = persistence.loadReview(id);
  assert.deepEqual(plain(saved.firstTradePlan), expected);
  assert.notEqual(saved.firstTradePlan.plan, store.getState().tradePlan);
  assert.notEqual(saved.firstTradePlan.order, store.getState().firstPlannedOrder);
  assert.equal(store.getState().localReviewSaved, true);
  assert.equal(store.getState().syncStatus, "saved");
  assert.equal(requests.length, 1);
  assert.deepEqual(plain(requests[0].firstTradePlan), expected);
  store.getState().start("wed-open");
  store.getState().saveTradePlan({ ...notes, maxLoss: 9999 });
  const reloaded = gameStoreFixture({ userId: "student-a", values }).persistence.loadReview(id);
  assert.deepEqual(plain(reloaded.firstTradePlan), expected);
});

test("settlement honestly records a missing plan and never invents one for old saved reviews", () => {
  const { store, persistence, values } = gameStoreFixture();
  buy(store);
  store.getState().flattenSelected();
  store.getState().settle();
  const id = store.getState().lastResult.id;
  const bundle = persistence.loadReview(id);
  assert.equal(bundle.firstTradePlan.plan, null);
  assert.ok(bundle.firstTradePlan.order);
  const legacy = { ...bundle };
  delete legacy.firstTradePlan;
  assert.equal(persistence.saveReview(legacy), true);
  const reloaded = gameStoreFixture({ values }).persistence.loadReview(id);
  assert.equal("firstTradePlan" in reloaded, false);
});

function enterDraft(store, input = notes) {
  const edit = store.getState().editTradePlanDraft;
  edit("entryCondition", input.entryCondition);
  edit("exitCondition", input.exitCondition);
  edit("maxLoss", String(input.maxLoss));
}
function saveDraft(store) {
  const draft = store.getState().tradePlanDraft;
  return store.getState().saveTradePlan({
    entryCondition: draft.entryCondition,
    exitCondition: draft.exitCondition,
    maxLoss: Number(draft.maxLoss),
  });
}

test("an unfinished quantity rejects saving without losing plan text across pane changes; correcting it permits explicit save", () => {
  const { store } = gameStoreFixture();
  store.getState().editTicketDraft("lots", "");
  enterDraft(store);
  const draft = store.getState().tradePlanDraft;
  assert.equal(draft.lots, null, "draft context must not silently reuse the previous valid quantity");
  assert.equal(saveDraft(store).ok, false);
  assert.equal(store.getState().tradePlan, null);
  assert.equal(store.getState().tradePlanDraft, draft);
  store.getState().setMobileTab("chart");
  store.getState().setMobileTab("trade");
  assert.equal(store.getState().tradePlanDraft, draft, "pane remounts read the same central draft");
  store.getState().editTicketDraft("lots", "1");
  assert.equal(store.getState().tradePlanDraft, draft);
  assert.equal(saveDraft(store).ok, true);
  assert.equal(store.getState().tradePlanDraft, null);
  assert.equal(store.getState().tradePlan.entryCondition, notes.entryCondition.trim());
  assert.equal(store.getState().tradePlan.exitCondition, notes.exitCondition.trim());
  assert.equal(store.getState().tradePlan.maxLoss, notes.maxLoss);
  assert.equal(store.getState().tradePlan.lots, 1);
  assert.equal(store.getState().engine.orders.length, 0);
});

test("draft editing keeps the saved plan unchanged, preserves its original draft context, and clears only after a valid save", () => {
  const { store } = gameStoreFixture();
  store.getState().saveTradePlan(notes);
  const saved = store.getState().tradePlan;
  store.getState().editTradePlanDraft("maxLoss", "");
  assert.equal(store.getState().tradePlanDraft.entryCondition, saved.entryCondition);
  assert.equal(store.getState().tradePlanDraft.exitCondition, saved.exitCondition);
  const draft = store.getState().tradePlanDraft;
  assert.equal(saveDraft(store).ok, false);
  assert.equal(store.getState().tradePlan, saved);
  assert.equal(store.getState().tradePlanDraft, draft);
  store.getState().select("2882");
  store.getState().setTicket({ side: "sell", lots: 2 });
  assert.equal(store.getState().tradePlanDraft.code, "2317");
  assert.equal(store.getState().tradePlanDraft.side, "buy");
  assert.equal(store.getState().tradePlanDraft.lots, 1);
  assert.equal(store.getState().tradePlan, saved);
  store.getState().editTradePlanDraft("maxLoss", "2000");
  assert.equal(saveDraft(store).ok, true);
  assert.equal(store.getState().tradePlanDraft, null);
  assert.equal(store.getState().tradePlan.code, "2882");
  assert.equal(store.getState().tradePlan.side, "sell");
  assert.equal(store.getState().tradePlan.lots, 2);
});

test("clearing, a new practice and leaving discard unsaved draft text", () => {
  const { store } = gameStoreFixture();
  for (const action of [
    () => store.getState().removeTradePlan(),
    () => store.getState().start("wed-open"),
    () => store.getState().leave(),
  ]) {
    enterDraft(store);
    assert.ok(store.getState().tradePlanDraft);
    action();
    assert.equal(store.getState().tradePlanDraft, null);
    assert.equal(store.getState().tradePlan, null);
  }
  store.getState().editTradePlanDraft("entryCondition", "cannot edit in lobby");
  assert.equal(store.getState().tradePlanDraft, null);
});

test("a rejected order retains draft text; the first accepted waiting order clears it and forbids later edits", () => {
  const { store, load } = gameStoreFixture();
  enterDraft(store);
  const draft = store.getState().tradePlanDraft;
  store.getState().setTicket({ lots: 200, type: "market" });
  assert.equal(store.getState().submit().ok, false);
  assert.equal(store.getState().tradePlanDraft, draft);
  assert.equal(store.getState().firstPlannedOrder, null);
  const price = load("@/lib/market/ticks").limitDown(store.getState().engine.quote("2317").prevClose);
  store.getState().setTicket({ lots: 1, type: "limit", price });
  assert.equal(store.getState().submit().ok, true);
  assert.equal(store.getState().engine.fills.length, 0);
  assert.equal(store.getState().tradePlanDraft, null);
  assert.equal(store.getState().tradePlan, null, "unsaved text cannot become the locked plan");
  store.getState().cancelOrder(store.getState().firstPlannedOrder.id);
  store.getState().editTradePlanDraft("entryCondition", "cannot backfill after cancellation");
  assert.equal(store.getState().tradePlanDraft, null);
});

test("the first accepted flash order clears unsaved draft text through the same first-order lock", () => {
  const { store } = gameStoreFixture();
  enterDraft(store);
  store.getState().setFlashOrder(true);
  const quote = store.getState().engine.quote("2317");
  store.getState().clickPrice(quote.ask, "buy");
  assert.ok(store.getState().firstPlannedOrder);
  assert.equal(store.getState().tradePlanDraft, null);
  assert.equal(store.getState().tradePlan, null);
});

test("settlement clears unsaved text without including it in local reviews, profile storage or server payloads", async () => {
  for (const withSavedPlan of [false, true]) {
    const { store, persistence, requests, values } = gameStoreFixture({ userId: "student-a" });
    if (withSavedPlan) store.getState().saveTradePlan(notes);
    const saved = store.getState().tradePlan;
    const unsaved = "UNSAVED_PLAN_DRAFT_MUST_NOT_BE_PERSISTED";
    enterDraft(store, { ...notes, entryCondition: unsaved });
    assert.equal([...values.values()].some((value) => value.includes(unsaved)), false);
    store.getState().settle();
    await flushStorePromises();
    assert.equal(store.getState().tradePlanDraft, null);
    const review = persistence.loadReview(store.getState().lastResult.id);
    assert.deepEqual(plain(review.firstTradePlan.plan), plain(saved));
    assert.equal(JSON.stringify(review).includes(unsaved), false);
    assert.equal(JSON.stringify(requests).includes(unsaved), false);
    assert.equal([...values.values()].some((value) => value.includes(unsaved)), false);
    store.getState().editTradePlanDraft("entryCondition", unsaved);
    assert.equal(store.getState().tradePlanDraft, null);
  }
});

test("identity changes clear drafts before edit, save or clear can act, and do not carry them into the new account", () => {
  for (const action of [
    (store) => store.getState().editTradePlanDraft("entryCondition", "stale edit"),
    (store) => store.getState().saveTradePlan(notes),
    (store) => store.getState().removeTradePlan(),
  ]) {
    const { store, persistence } = gameStoreFixture({ userId: "student-a" });
    store.getState().saveTradePlan(notes);
    enterDraft(store, { ...notes, maxLoss: 3210 });
    persistence.setProfileIdentity("student-b");
    action(store);
    assert.equal(store.getState().phase, "lobby");
    assert.equal(store.getState().tradePlanDraft, null);
    assert.equal(store.getState().tradePlan, null);
    store.getState().start("wed-open");
    assert.equal(store.getState().sessionIdentity, "student-b");
    assert.equal(store.getState().tradePlanDraft, null);
  }
});
