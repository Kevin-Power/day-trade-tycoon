import assert from 'node:assert/strict';
import test from 'node:test';
import { gameStoreFixture } from './fixtures/game-store-fixture.mjs';

function thinMarket() {
  const fixture = gameStoreFixture();
  const engine = fixture.store.getState().engine;
  const stock = engine.stocks.get('2317');
  const quote = engine.quote('2317');
  stock.asks = [{ price: quote.ask, lots: 2 }];
  stock.bids = [{ price: quote.bid, lots: 1 }];
  return { ...fixture, engine, stock, quote };
}

test('IOC submission preserves the accepted TIF and reports a cancelled remainder instead of a waiting order', () => {
  const { store, engine, messages, load } = thinMarket();
  store.getState().setTicket({ type: 'market', side: 'buy', lots: 3, tif: 'IOC' });
  store.getState().submit();
  const order = engine.orders[0];
  assert.equal(order.status, 'cancelled');
  assert.equal(order.filled, 2);
  assert.equal(store.getState().firstPlannedOrder.tif, 'IOC');
  assert.match(messages.at(-1), /部分成交.*取消/);
  assert.equal(load('@/lib/game/order-presentation').orderPresentation(order).waitingLots, 0);
});

test('FOK with insufficient depth creates a visible cancelled order without changing cash or inventory', () => {
  const { store, engine, messages } = thinMarket();
  const cash = engine.cash;
  store.getState().setTicket({ type: 'market', side: 'buy', lots: 3, tif: 'FOK' });
  store.getState().submit();
  assert.equal(engine.orders[0].status, 'cancelled');
  assert.equal(engine.orders[0].filled, 0);
  assert.equal(engine.fills.length, 0);
  assert.equal(engine.cash, cash);
  assert.match(messages.at(-1), /未成交/);
});

test('partial flatten reports remaining inventory and does not leave a second pending reverse order', () => {
  const { store, engine, messages } = thinMarket();
  store.getState().setTicket({ type: 'market', side: 'buy', lots: 2, tif: 'IOC' });
  store.getState().submit();
  store.getState().flattenSelected();
  assert.equal(engine.positions.get('2317').lots, 1);
  assert.match(messages.at(-1), /尚有 1 張庫存/);
  store.getState().flattenSelected();
  assert.equal(engine.positions.get('2317').lots, 1);
  assert.equal(engine.orders.filter(order => ['pending', 'partial'].includes(order.status)).length, 0);
});

test('manual settlement ends at the current simulation time, cancels waiting orders and preserves incomplete flattening', () => {
  const { store, engine, stock, quote } = thinMarket();
  store.getState().setTicket({ type: 'market', side: 'buy', lots: 2, tif: 'IOC' });
  store.getState().submit();
  stock.bids = [];
  store.getState().setTicket({ type: 'limit', side: 'buy', lots: 1, price: quote.bid, tif: 'ROD' });
  store.getState().submit();
  const time = engine.t;
  store.getState().settle();
  assert.equal(engine.ended, true);
  assert.equal(engine.t, time);
  assert.equal(engine.positions.get('2317').lots, 2);
  assert.equal(engine.orders.filter(order => ['pending', 'partial'].includes(order.status)).length, 0);
  assert.match(engine.warning, /未能全部平倉/);
  assert.equal(store.getState().phase, 'result');
});

test('settled review reloads an ending-position snapshot and distinguishes zero inventory from legacy records', () => {
  const { store, engine, stock, persistence } = thinMarket();
  store.getState().setTicket({ type: 'market', side: 'buy', lots: 2, tif: 'IOC' });
  store.getState().submit();
  stock.bids = [];
  store.getState().settle();
  const rec = store.getState().lastResult;
  const saved = persistence.loadReviewState(rec.id);
  assert.equal(store.getState().localReviewSaved, true);
  assert.equal(saved.localSaved, true);
  const expected = [{ code: '2317', lots: 2, last: engine.quote('2317').last }];
  assert.deepEqual(JSON.parse(JSON.stringify(saved.bundle.openPositionsAtEnd)), expected);
  assert.equal(saved.bundle.rec.pnl, rec.pnl);
  assert.equal(saved.bundle.rec.grade, rec.grade);

  // A later lesson must not alter the prior ending inventory or recorded result.
  store.getState().start('wed-open');
  store.getState().dismissBeat();
  store.getState().settle();
  const empty = persistence.loadReviewState(store.getState().lastResult.id);
  assert.equal(empty.localSaved, true);
  assert.deepEqual(JSON.parse(JSON.stringify(empty.bundle.openPositionsAtEnd)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(persistence.loadReviewState(rec.id).bundle.openPositionsAtEnd)), expected);

  // Missing information in a historical record stays missing, never an invented [].
  const legacy = JSON.parse(JSON.stringify(saved.bundle));
  legacy.rec.id = 'legacy-ending-inventory';
  delete legacy.openPositionsAtEnd;
  assert.equal(persistence.saveReview(legacy), true);
  const legacyRead = persistence.loadReviewState(legacy.rec.id);
  assert.equal(legacyRead.localSaved, true);
  assert.equal(Object.hasOwn(legacyRead.bundle, 'openPositionsAtEnd'), false);
  assert.equal(legacyRead.bundle.rec.pnl, rec.pnl);
  assert.equal(legacyRead.bundle.rec.grade, rec.grade);
});

test('opening all orders from a receipt resets the history page and a new lesson resets the scope', () => {
  const { store } = gameStoreFixture();
  store.getState().setOrderScope('all');
  store.getState().setOrderPage(2);
  store.getState().setOrderScope('all');
  assert.equal(store.getState().orderPage, 0);
  store.getState().start('wed-open');
  assert.equal(store.getState().orderScope, 'working');
  assert.equal(store.getState().orderPage, 0);
});
