import assert from "node:assert/strict";
import { test } from "node:test";
import { buy, gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

function assertNotSubmitted(store) {
  const state = store.getState();
  assert.equal(state.engine.orders.length, 0);
  assert.equal(state.engine.fills.length, 0);
  assert.equal(state.firstPlannedOrder, null);
}

test("quantity can stay empty while typing; submission and plan saving cannot reuse the last quantity", () => {
  const { store, messages } = gameStoreFixture();
  store.getState().setTicket({ lots: 2, type: "market" });
  store.getState().editTicketDraft("lots", "");
  assert.equal(store.getState().ticketDraft.lots, "");
  assert.equal(store.getState().ticket.lots, 2, "numeric compatibility state must not become the submitted quantity");
  store.getState().submit();
  assertNotSubmitted(store);
  assert.match(messages.at(-1), /請完成張數/);
  assert.equal(store.getState().saveTradePlan({ entryCondition: "先看", exitCondition: "再退出", maxLoss: 1000 }).ok, false);
  store.getState().editTicketDraft("lots", "1");
  store.getState().submit();
  assert.equal(store.getState().engine.orders[0].lots, 1);
  assert.equal(store.getState().firstPlannedOrder.lots, 1);
});

test("cleared or incomplete limit prices cannot silently fall back to the old number", () => {
  const { store, messages } = gameStoreFixture();
  const ask = store.getState().engine.quote("2317").ask;
  store.getState().setTicket({ price: ask, type: "limit" });
  for (const text of ["", ".", `${Math.floor(ask)}.`]) {
    store.getState().editTicketDraft("price", text);
    assert.equal(store.getState().ticketDraft.price, text);
    store.getState().submit();
    assertNotSubmitted(store);
    assert.match(messages.at(-1), /請完成限價/);
  }
  store.getState().editTicketDraft("price", String(ask));
  store.getState().submit();
  assert.equal(store.getState().engine.orders[0].price, ask);
  assert.equal(store.getState().firstPlannedOrder.price, ask);
});

test("flash price selection updates the visible price but cannot repair or bypass an empty quantity", () => {
  const { store, messages } = gameStoreFixture();
  store.getState().setFlashOrder(true);
  store.getState().editTicketDraft("lots", "");
  store.getState().editTicketDraft("price", "");
  const ask = store.getState().engine.quote("2317").ask;
  store.getState().clickPrice(ask, "buy");
  assert.equal(store.getState().ticketDraft.lots, "");
  assert.equal(store.getState().ticketDraft.price, String(ask));
  assertNotSubmitted(store);
  assert.match(messages.at(-1), /請完成張數/);
  store.getState().editTicketDraft("lots", "1");
  store.getState().clickPrice(ask, "buy");
  assert.equal(store.getState().engine.fills.length, 1);
  assert.equal(store.getState().firstPlannedOrder.lots, 1);
});

test("flash remains unable to submit an invalid price, including when a price selection is nonfinite", () => {
  const { store } = gameStoreFixture();
  store.getState().setFlashOrder(true);
  store.getState().editTicketDraft("price", "");
  store.getState().submit();
  assertNotSubmitted(store);
  store.getState().clickPrice(NaN, "buy");
  assert.equal(store.getState().ticketDraft.price, "0", "the existing tick function normalizes nonfinite input to zero");
  assertNotSubmitted(store);
});

test("switching to market ignores an unfinished limit price, and switching back preserves its unfinished state", () => {
  const { store } = gameStoreFixture();
  store.getState().editTicketDraft("price", "");
  store.getState().setTicket({ type: "market" });
  assert.equal(store.getState().ticketDraft.price, "");
  store.getState().submit();
  assert.equal(store.getState().engine.orders.length, 1);
  assert.equal(store.getState().engine.orders[0].type, "market");
  const first = store.getState().firstPlannedOrder;
  store.getState().setTicket({ type: "limit" });
  assert.equal(store.getState().ticketDraft.price, "");
  store.getState().submit();
  assert.equal(store.getState().engine.orders.length, 1);
  assert.equal(store.getState().firstPlannedOrder, first);
});

test("market mode never bypasses an invalid quantity", () => {
  const { store } = gameStoreFixture();
  for (const text of ["", "0", "1.5", "201", "1e2"]) {
    store.getState().editTicketDraft("lots", text);
    store.getState().setTicket({ type: "market" });
    store.getState().submit();
    assertNotSubmitted(store);
  }
});

test("preset and price adjustments replace their own draft fields without silently fixing another incomplete field", () => {
  const { store } = gameStoreFixture();
  store.getState().editTicketDraft("lots", "");
  store.getState().editTicketDraft("price", "");
  // The same central setter handles the preset and plus/minus controls.
  store.getState().setTicket({ lots: 2 });
  assert.equal(store.getState().ticketDraft.lots, "2");
  assert.equal(store.getState().ticketDraft.price, "");
  store.getState().submit();
  assertNotSubmitted(store);
  const ask = store.getState().engine.quote("2317").ask;
  store.getState().setTicket({ price: ask, type: "limit" });
  assert.equal(store.getState().ticketDraft.price, String(ask));
  store.getState().submit();
  assert.equal(store.getState().engine.orders[0].lots, 2);
  assert.equal(store.getState().engine.orders[0].price, ask);
});

test("symbol and side selection synchronize quote prices but preserve an incomplete quantity", () => {
  const { store } = gameStoreFixture();
  store.getState().editTicketDraft("lots", "");
  store.getState().editTicketDraft("price", "");
  store.getState().select("2882");
  assert.equal(store.getState().ticketDraft.price, String(store.getState().engine.quote("2882").ask));
  assert.equal(store.getState().ticketDraft.lots, "");
  store.getState().setTicket({ side: "sell" });
  assert.equal(store.getState().ticketDraft.price, String(store.getState().engine.quote("2882").bid));
  assert.equal(store.getState().ticketDraft.lots, "");
  store.getState().submit();
  assertNotSubmitted(store);
});

test("leaving or starting a new lesson clears unfinished drafts and initializes the new quote", () => {
  const { store } = gameStoreFixture();
  store.getState().editTicketDraft("lots", "");
  store.getState().editTicketDraft("price", ".");
  store.getState().start("wed-open");
  assert.equal(store.getState().ticketDraft.lots, "1");
  assert.equal(store.getState().ticketDraft.price, String(store.getState().engine.quote("2317").ask));
  store.getState().editTicketDraft("lots", "");
  store.getState().leave();
  assert.equal(store.getState().ticketDraft.lots, "1");
  assert.equal(store.getState().ticketDraft.price, "");
  assert.equal(store.getState().ticket.lots, 1);
  assert.equal(store.getState().ticket.price, 0);
});

test("an unfinished ticket does not prevent flattening an existing position", () => {
  const { store } = gameStoreFixture();
  buy(store);
  const first = store.getState().firstPlannedOrder;
  store.getState().editTicketDraft("lots", "");
  store.getState().editTicketDraft("price", "");
  store.getState().flattenSelected();
  assert.equal(store.getState().engine.positions.get("2317").lots, 0);
  assert.equal(store.getState().engine.fills.length, 2);
  assert.equal(store.getState().ticketDraft.lots, "");
  assert.equal(store.getState().firstPlannedOrder, first);
});
