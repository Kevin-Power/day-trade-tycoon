import assert from "node:assert/strict";
import { test } from "node:test";
import { gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

function arm(store) {
  store.getState().setMobileTab("flash");
  store.getState().setFlashOrder(true);
  const state = store.getState();
  assert.equal(state.flashOrder, true);
  return {
    code: state.selected,
    side: "buy",
    price: state.engine.quote(state.selected).ask,
    activationId: state.flashActivation.id,
  };
}
function nothingSent(store) {
  assert.equal(store.getState().engine.orders.length, 0);
  assert.equal(store.getState().engine.fills.length, 0);
  assert.equal(store.getState().firstPlannedOrder, null);
}

test("stored preference, hydration and new lessons never automatically arm lightning", () => {
  const { store, storage } = gameStoreFixture({ values: new Map([["day-tycoon-flash", "1"]]) });
  assert.equal(storage.getItem("day-tycoon-flash"), "1");
  assert.equal(store.getState().flashOrder, false);
  arm(store);
  store.getState().hydrate();
  assert.equal(store.getState().flashOrder, false);
  assert.equal(store.getState().flashActivation, null);
  store.getState().start("wed-open");
  assert.equal(store.getState().flashOrder, false);
  nothingSent(store);
});

test("activation confirms exact code/lots/TIF and does not submit or resume a teaching pause", () => {
  const { store } = gameStoreFixture();
  store.getState().start("wed-open");
  const beat = store.getState().activeBeat;
  const time = store.getState().engine.t;
  store.getState().setTicket({ lots: 2, tif: "IOC" });
  store.getState().setFlashOrder(true, { code: "2330", lots: 2, tif: "IOC" });
  assert.equal(store.getState().flashOrder, false);
  store.getState().setFlashOrder(true, { code: "2317", lots: 2, tif: "IOC" });
  assert.equal(store.getState().flashActivation.code, "2317");
  assert.equal(store.getState().flashActivation.lots, 2);
  assert.equal(store.getState().flashActivation.tif, "IOC");
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().activeBeat, beat);
  assert.equal(store.getState().engine.t, time);
  nothingSent(store);
});

test("symbol, quantities, TIF, type and navigation changes all require a fresh activation", () => {
  const { store } = gameStoreFixture();
  const actions = [
    () => store.getState().select("2882"),
    () => store.getState().editTicketDraft("lots", ""),
    () => store.getState().setTicket({ lots: 2 }),
    () => store.getState().setTicket({ tif: "IOC" }),
    () => store.getState().setTicket({ type: "market" }),
    () => store.getState().setMobileTab("trade"),
    () => store.getState().setVenue("live"),
  ];
  for (const action of actions) {
    store.getState().setTicket({ lots: 1, tif: "ROD", type: "limit" });
    const input = arm(store);
    action();
    assert.equal(store.getState().flashOrder, false);
    assert.equal(store.getState().flashActivation, null);
    assert.equal(store.getState().submitLightning(input).ok, false);
    nothingSent(store);
  }
});

test("real submission locks the first intent, ignores duplicate bursts, and allows a later deliberate order", () => {
  const { store } = gameStoreFixture();
  const input = arm(store);
  assert.equal(store.getState().submitLightning(input).ok, true);
  const first = store.getState().firstPlannedOrder;
  const result = store.getState().flashLastResult;
  assert.equal(result.orderId, first.id);
  assert.match(result.message, /全部成交/);
  assert.equal(store.getState().submitLightning(input).ok, false);
  assert.equal(store.getState().engine.orders.length, 1);
  assert.equal(
    store.getState().flashLastResult,
    result,
    "a duplicate must not hide the original accepted result",
  );
  store.setState({ flashLastAttemptAt: Date.now() - 1000 });
  assert.equal(store.getState().submitLightning({ ...input, repeat: true }).ok, false);
  assert.equal(store.getState().engine.orders.length, 1);
  assert.equal(store.getState().submitLightning(input).ok, true);
  assert.equal(store.getState().engine.orders.length, 2);
  assert.equal(store.getState().firstPlannedOrder, first);
});

test("a stale activation id cannot be reused after rearming even with the same product and lots", () => {
  const { store } = gameStoreFixture();
  const old = arm(store);
  store.getState().setFlashOrder(false);
  const next = arm(store);
  assert.notEqual(next.activationId, old.activationId);
  assert.equal(store.getState().submitLightning(old).ok, false);
  assert.equal(store.getState().flashOrder, false);
  nothingSent(store);
});

test("runtime guard rejects invalid or changed quantities even if the activation flag was not cleared", () => {
  const { store } = gameStoreFixture();
  for (const text of ["", "0", "1.5", "201", "1e2", "2"]) {
    store.getState().setTicket({ lots: 1 });
    const input = arm(store);
    store.setState({ ticketDraft: { ...store.getState().ticketDraft, lots: text } });
    assert.equal(store.getState().submitLightning(input).ok, false);
    assert.equal(store.getState().flashOrder, false);
    nothingSent(store);
  }
});

test("invalid and off-tick limit prices still fail through the actual submit and broker guards", () => {
  const { store } = gameStoreFixture();
  const input = arm(store);
  for (const price of [NaN, Infinity, 0, input.price + 0.01]) {
    store.setState({ flashLastAttemptAt: null });
    const result = store.getState().submitLightning({ ...input, price });
    assert.equal(result.ok, false);
    assert.equal(store.getState().flashLastResult.ok, false);
    nothingSent(store);
  }
});

test("teaching pause remains paused and accepted fills keep the paused-fill evidence", () => {
  const { store } = gameStoreFixture();
  store.getState().start("wed-open");
  const beat = store.getState().activeBeat;
  const input = arm(store);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().submitLightning(input).ok, true);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().activeBeat, beat);
  assert.equal(store.getState().engine.fills[0].filledWhilePaused, true);
});

test("exam pauses and teaching beats block activation and are rechecked at the instant of submission", () => {
  const { store } = gameStoreFixture();
  store.getState().start("tycoon");
  const beat = store.getState().activeBeat;
  store.getState().setFlashOrder(true);
  assert.equal(store.getState().flashOrder, false);
  assert.equal(store.getState().activeBeat, beat);
  assert.equal(store.getState().paused, true);
  store.getState().dismissBeat();
  const input = arm(store);
  store.getState().togglePause();
  assert.equal(store.getState().submitLightning(input).ok, false);
  assert.match(store.getState().flashLastResult.message, /測驗不可/);
  nothingSent(store);
  store.getState().togglePause();
  assert.equal(store.getState().submitLightning(input).ok, true);
});

test("learner guide cannot be bypassed through either lightning or the legacy clickPrice entry", () => {
  const { store } = gameStoreFixture();
  const input = arm(store);
  const activation = store.getState().flashActivation;
  store.getState().openLearnerGuide();
  assert.equal(store.getState().flashOrder, false);
  store.getState().setFlashOrder(true);
  assert.equal(store.getState().flashOrder, false);
  store.setState({ flashOrder: true, flashActivation: activation });
  assert.equal(store.getState().submitLightning(input).ok, false);
  store.setState({ flashOrder: true, flashActivation: activation });
  store.getState().clickPrice(input.price, "buy");
  nothingSent(store);
  assert.equal(store.getState().paused, true);
  assert.equal(store.getState().engine.t, 0);
});

test("live venue and wrong-account state cannot reach simulated fills", () => {
  const { store, load } = gameStoreFixture();
  const { SIM_ACCOUNT } = load("@/lib/broker");
  for (const patch of [{ venue: "live" }, { accountId: "WRONG" }]) {
    store.setState({ venue: "sim", accountId: SIM_ACCOUNT });
    const input = arm(store);
    store.setState(patch);
    assert.equal(store.getState().submitLightning(input).ok, false);
    nothingSent(store);
  }
});

test("legacy clickPrice shares burst protection and an unarmed click only prepares the ticket", () => {
  const { store } = gameStoreFixture();
  const input = arm(store);
  store.getState().clickPrice(input.price, "buy");
  store.getState().clickPrice(input.price, "buy");
  assert.equal(store.getState().engine.orders.length, 1);
  assert.ok(store.getState().flashLastResult.orderId);
  store.getState().setFlashOrder(false);
  store.getState().clickPrice(input.price, "sell");
  assert.equal(store.getState().engine.orders.length, 1);
  assert.equal(store.getState().ticket.side, "sell");
});

test("hide disarms immediately; results survive navigation but never leak to a new lesson", () => {
  const { store, load } = gameStoreFixture();
  const input = arm(store);
  store.getState().submitLightning(input);
  const result = store.getState().flashLastResult;
  load("@/lib/game/store").persistOnHide();
  assert.equal(store.getState().flashOrder, false);
  assert.equal(store.getState().flashLastResult, result);
  store.getState().setMobileTab("pos");
  assert.equal(store.getState().flashLastResult, result);
  store.getState().start("wed-open");
  assert.equal(store.getState().flashOrder, false);
  assert.equal(store.getState().flashLastResult, null);
  assert.equal(store.getState().flashLastAttemptAt, null);
  store.getState().dismissBeat();
  arm(store);
  store.getState().leave();
  assert.equal(store.getState().flashOrder, false);
  assert.equal(store.getState().flashLastResult, null);
});

test("accepted FOK cancellation stays visible as unfilled, never as a successful fill", () => {
  const { store } = gameStoreFixture();
  const stock = store.getState().engine.stocks.get("2317");
  stock.asks = [{ price: stock.asks[0].price, lots: 1 }];
  store.getState().setTicket({ lots: 2, tif: "FOK" });
  const input = arm(store);
  const result = store.getState().submitLightning(input);
  assert.equal(result.ok, true);
  assert.equal(result.order.status, "cancelled");
  assert.equal(result.order.filled, 0);
  assert.match(store.getState().flashLastResult.message, /已取消，未成交.*0／2/);
  assert.equal(store.getState().engine.fills.length, 0);
});
