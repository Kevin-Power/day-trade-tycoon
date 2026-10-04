import assert from "node:assert/strict";
import { test } from "node:test";
import { buy, gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const ledger = (engine) => plain({
  cash: engine.cash,
  orders: engine.orders,
  fills: engine.fills,
  positions: [...engine.positions],
});

test("a rejected ordinary submission replaces the prior success receipt without inventing an order or fill", () => {
  const { store } = gameStoreFixture();
  buy(store);
  const accepted = store.getState().lastSubmitResult;
  assert.equal(accepted.ok, true);
  const engine = store.getState().engine;
  const originalPlanOrder = store.getState().firstPlannedOrder;
  const before = ledger(engine);
  store.getState().setTicket({ type: "market", side: "buy", lots: 200 });
  const ack = store.getState().submit();
  assert.equal(ack.ok, false);
  assert.match(ack.reason, /可用餘額不足/);
  const rejected = store.getState().lastSubmitResult;
  assert.deepEqual(plain(rejected), {
    ok: false, code: "2317", side: "buy", lots: 200, simTime: engine.t, reason: ack.reason,
  });
  assert.equal("orderId" in rejected, false);
  assert.deepEqual(ledger(engine), before);
  assert.equal(store.getState().firstPlannedOrder, originalPlanOrder);
  assert.equal(engine.orders[0].id, accepted.orderId);

  store.getState().setMobileTab("pos");
  store.getState().setRightTab("orders");
  store.getState().setOrderScope("all");
  store.getState().setMobileTab("trade");
  store.getState().select("2882");
  store.getState().setTicket({ side: "sell", lots: 1 });
  assert.equal(store.getState().lastSubmitResult, rejected, "navigation and editing cannot relabel the previous attempt");
  assert.equal(rejected.code, "2317");
  assert.equal(rejected.side, "buy");
  assert.equal(rejected.lots, 200);
});

test("an unfinished quantity is recorded as incomplete instead of reusing the prior numeric ticket", () => {
  const { store } = gameStoreFixture();
  store.getState().setTicket({ lots: 5, type: "market" });
  store.getState().editTicketDraft("lots", "");
  const rejected = store.getState().submit();
  assert.equal(rejected.ok, false);
  assert.equal(store.getState().lastSubmitResult.lots, null);
  assert.match(store.getState().lastSubmitResult.reason, /請完成張數/);
  assert.equal(store.getState().engine.orders.length, 0);
  store.getState().setTicket({ lots: 1 });
  const accepted = store.getState().submit();
  assert.equal(accepted.ok, true);
  assert.equal(store.getState().lastSubmitResult.ok, true);
  assert.equal(store.getState().lastSubmitResult.lots, 1);
  assert.equal(store.getState().lastSubmitResult.orderId, accepted.order.id);
});

test("an accepted receipt identifies its actual order through later matching and other engine orders", () => {
  const { store, load } = gameStoreFixture();
  const engine = store.getState().engine;
  const price = load("@/lib/market/ticks").limitDown(engine.quote("2317").prevClose);
  store.getState().setTicket({ type: "limit", lots: 1, price, tif: "ROD" });
  const ack = store.getState().submit();
  assert.equal(ack.ok, true);
  assert.equal(ack.order.status, "pending");
  const receipt = store.getState().lastSubmitResult;
  const presentation = load("@/lib/game/order-presentation").orderPresentation;
  assert.equal(presentation(engine.orders.find((order) => order.id === receipt.orderId)).waitingLots, 1);

  engine.stocks.get("2317").asks = [{ price, lots: 1 }];
  engine.matchResting();
  store.getState().bump();
  assert.equal(store.getState().lastSubmitResult, receipt);
  const filled = engine.orders.find((order) => order.id === receipt.orderId);
  assert.equal(filled.filled, 1);
  assert.equal(presentation(filled).statusLabel, "全部成交");
  store.getState().flattenSelected();
  assert.notEqual(engine.orders[0].id, receipt.orderId);
  assert.equal(store.getState().lastSubmitResult.orderId, filled.id, "a flatten order must not be substituted for the user's latest submitted order");
});

test("an accepted FOK cancellation remains an accepted order receipt, not an invented rejection", () => {
  const { store } = gameStoreFixture();
  const engine = store.getState().engine;
  const quote = engine.quote("2317");
  engine.stocks.get("2317").asks = [{ price: quote.ask, lots: 2 }];
  store.getState().setTicket({ type: "market", side: "buy", lots: 3, tif: "FOK" });
  const ack = store.getState().submit();
  assert.equal(ack.ok, true);
  assert.equal(ack.order.status, "cancelled");
  assert.equal(ack.order.filled, 0);
  assert.equal(store.getState().lastSubmitResult.ok, true);
  assert.equal(store.getState().lastSubmitResult.orderId, ack.order.id);
  assert.equal(engine.orders.length, 1);
  assert.equal(engine.fills.length, 0);
});

test("the receipt clears on a new lesson and leaving, and never enters a saved review", () => {
  const { store, persistence } = gameStoreFixture();
  buy(store);
  store.getState().settle();
  const review = persistence.loadReviewState(store.getState().lastResult.id).bundle;
  assert.equal("lastSubmitResult" in review, false);
  store.getState().start("wed-open");
  assert.equal(store.getState().lastSubmitResult, null);
  store.getState().dismissBeat();
  buy(store);
  assert.ok(store.getState().lastSubmitResult);
  store.getState().leave();
  assert.equal(store.getState().lastSubmitResult, null);
});

test("an account switch clears the prior receipt before an attempted submission can reach that account's engine", () => {
  const { store, persistence } = gameStoreFixture({ userId: "receipt-owner-a" });
  buy(store);
  const originalEngine = store.getState().engine;
  const before = ledger(originalEngine);
  persistence.setProfileIdentity("receipt-owner-b");
  const result = store.getState().submit();
  assert.equal(result.ok, false);
  assert.match(result.reason, /登入帳號已變更/);
  assert.equal(store.getState().lastSubmitResult, null);
  assert.equal(store.getState().engine, null);
  assert.equal(store.getState().phase, "lobby");
  assert.deepEqual(ledger(originalEngine), before);
});

test("every guide step records why sending was blocked without reaching the broker or locking a plan", () => {
  const { store } = gameStoreFixture();
  const engine = store.getState().engine;
  const before = ledger(engine);
  store.getState().openLearnerGuide();
  for (let step = 0; step < 4; step++) {
    store.getState().setLearnerGuideStep(step);
    assert.equal(store.getState().submit(), undefined);
    assert.equal(store.getState().lastSubmitResult.ok, false);
    assert.match(store.getState().lastSubmitResult.reason, /操作導覽中/);
    assert.equal(store.getState().learnerGuideStep, step);
    assert.equal(store.getState().paused, true);
    assert.equal(store.getState().firstPlannedOrder, null);
    assert.deepEqual(ledger(engine), before);
  }
  store.getState().finishLearnerGuide();
  store.getState().dismissBeat();
  buy(store);
  assert.equal(store.getState().lastSubmitResult.ok, true);
});

test("the exam pause guard still blocks orders and leaves a readable rejection", () => {
  const { store } = gameStoreFixture();
  store.getState().start("tycoon");
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().submit(), undefined);
  assert.equal(store.getState().lastSubmitResult.ok, false);
  assert.match(store.getState().lastSubmitResult.reason, /測驗不可在暫停中下單/);
  assert.equal(store.getState().engine.orders.length, 0);
  assert.equal(store.getState().engine.fills.length, 0);
});

test("flash submission retains its receipt and rapid-repeat guard while sharing actual broker acceptance", () => {
  const { store } = gameStoreFixture();
  store.getState().setFlashOrder(true);
  const input = {
    code: "2317", side: "buy", price: store.getState().engine.quote("2317").ask,
    activationId: store.getState().flashActivation.id,
  };
  const ack = store.getState().submitLightning(input);
  assert.equal(ack.ok, true);
  assert.equal(store.getState().lastSubmitResult.orderId, ack.order.id);
  assert.equal(store.getState().flashLastResult.orderId, ack.order.id);
  const regularReceipt = store.getState().lastSubmitResult;
  const flashReceipt = store.getState().flashLastResult;
  const before = ledger(store.getState().engine);
  const repeat = store.getState().submitLightning({ ...input, repeat: true });
  assert.equal(repeat.ok, false);
  assert.match(repeat.reason, /長按或快速連點/);
  assert.equal(store.getState().lastSubmitResult, regularReceipt);
  assert.equal(store.getState().flashLastResult, flashReceipt);
  assert.deepEqual(ledger(store.getState().engine), before);
});
