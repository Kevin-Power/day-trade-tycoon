import assert from "node:assert/strict";
import { test } from "node:test";
import { gameStoreFixture } from "./fixtures/game-store-fixture.mjs";

const fixture = gameStoreFixture();
const { DayMarket } = fixture.load("@/lib/market/engine");
const { scenarioById } = fixture.load("@/lib/game/scenarios");
const { estimateExecution } = fixture.load("@/lib/market/execution");
const { roundToTick, stepTick, limitUp, limitDown } = fixture.load("@/lib/market/ticks");
const { getBroker, SIM_ACCOUNT } = fixture.load("@/lib/broker");
const code = "2317";
function market(options = {}) {
  const engine = new DayMarket({ ...scenarioById("wed-open"), ...options });
  book(engine);
  return engine;
}
function book(engine, { asks = [{ price: 100, lots: 20 }], bids = [{ price: 99.9, lots: 20 }], last = 100, prev = 100 } = {}) {
  // Synthetic quote data only; use production placement, matching and accounting.
  const stock = engine.stocks.get(code);
  stock.asks = asks.map((level) => ({ ...level }));
  stock.bids = bids.map((level) => ({ ...level }));
  stock.last = last;
  stock.prev = prev;
  return stock;
}
const place = (engine, patch = {}) => engine.place({ code, side: "buy", type: "limit", lots: 1, price: 100, ...patch });
const active = (engine) => engine.orders.filter((order) => order.status === "pending" || order.status === "partial");

test("consumed or zero-lot depth never supplies another fill, on either side", () => {
  const engine = market();
  book(engine, { asks: [{ price: 100, lots: 1 }], bids: [{ price: 100, lots: 0 }] });
  assert.equal(place(engine).order.filled, 1);
  assert.equal(engine.quote(code).askLots, 0);
  assert.equal(place(engine).order.filled, 0);
  assert.equal(place(engine, { side: "sell", tif: "IOC" }).order.filled, 0);
  assert.equal(engine.fills.length, 1);
  assert.equal(engine.positions.get(code).lots, 1);
});

test("resting buys honor better price first and FIFO at equal price and simulation time", () => {
  const engine = market();
  book(engine, { asks: [{ price: 101, lots: 1 }] });
  const cheaper = place(engine, { price: 99 }).order;
  const older = place(engine, { price: 100 }).order;
  const newer = place(engine, { price: 100 }).order;
  book(engine, { asks: [{ price: 100, lots: 1 }] });
  engine.matchResting();
  assert.equal(older.filled, 1);
  assert.equal(newer.filled, 0);
  assert.equal(cheaper.filled, 0);
  book(engine, { asks: [{ price: 99, lots: 1 }] });
  engine.matchResting();
  assert.equal(newer.filled, 1);
  assert.equal(cheaper.filled, 0);
});

test("resting sells honor lower price first and FIFO without overcommitting inventory", () => {
  const engine = market();
  place(engine, { lots: 3 });
  const dearer = place(engine, { side: "sell", price: 101 }).order;
  const older = place(engine, { side: "sell", price: 100.5 }).order;
  const newer = place(engine, { side: "sell", price: 100.5 }).order;
  assert.equal(place(engine, { side: "sell", price: 101 }).ok, false);
  book(engine, { bids: [{ price: 100.5, lots: 1 }] });
  engine.matchResting();
  assert.equal(older.filled, 1);
  assert.equal(newer.filled, 0);
  assert.equal(dearer.filled, 0);
});

test("resting market order has priority over a limit and later fills at the new market price", () => {
  const engine = market();
  book(engine, { asks: [] });
  const limit = place(engine).order;
  const marketOrder = place(engine, { type: "market", lots: 2 }).order;
  book(engine, { asks: [{ price: 100, lots: 1 }] });
  engine.matchResting();
  assert.equal(marketOrder.filled, 1);
  assert.equal(limit.filled, 0);
  book(engine, { asks: [{ price: 102, lots: 1 }] });
  engine.matchResting();
  assert.equal(marketOrder.filled, 2);
  assert.equal(marketOrder.status, "filled");
  assert.equal(engine.fills[0].price, 102);
  assert.equal(limit.filled, 0);
});

test("pending buy reservations prevent duplicate use of cash and release after cancellation", () => {
  const engine = market({ capital: 200200 });
  book(engine, { asks: [{ price: 101, lots: 20 }] });
  const first = place(engine);
  const second = place(engine);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(place(engine).ok, false);
  assert.equal(engine.stats().reservedCash, 200172);
  assert.equal(engine.stats().availableCash, 28);
  assert.equal(engine.cancel(first.order.id), true);
  assert.equal(engine.stats().reservedCash, 100086);
  assert.equal(engine.stats().availableCash, 100114);
  book(engine);
  engine.matchResting();
  assert.equal(second.order.filled, 1);
  assert.equal(engine.stats().reservedCash, 0);
  assert.ok(engine.cash >= 0);
});

test("matching rechecks cash and cancels an unfunded remainder without a negative balance", () => {
  const engine = market();
  book(engine, { asks: [] });
  const order = place(engine).order;
  engine.cash = 50000; // Simulate a changed account balance before the resting fill.
  book(engine);
  engine.matchResting();
  assert.equal(order.filled, 0);
  assert.equal(order.status, "cancelled");
  assert.match(order.cancelReason, /餘額不足/);
  assert.equal(engine.cash, 50000);
  assert.equal(engine.stats().reservedCash, 0);
});

test("long-only inventory cannot be oversold by one order or multiple pending orders", () => {
  const engine = market();
  place(engine);
  const before = engine.fills.length;
  assert.equal(place(engine, { side: "sell", type: "market", lots: 2 }).ok, false);
  const waiting = place(engine, { side: "sell", price: 105 }).order;
  assert.equal(place(engine, { side: "sell", price: 105 }).ok, false);
  assert.equal(engine.fills.length, before);
  assert.equal(engine.positions.get(code).lots, 1);
  engine.cancel(waiting.id);
  assert.equal(place(engine, { side: "sell", type: "market" }).order.filled, 1);
  assert.equal(engine.positions.get(code).lots, 0);
});

test("IOC fills available depth and cancels only its remainder, which never fills later", () => {
  const engine = market();
  book(engine, { asks: [{ price: 100, lots: 1 }] });
  const order = place(engine, { lots: 3, tif: "IOC" }).order;
  assert.equal(order.filled, 1);
  assert.equal(order.status, "cancelled");
  assert.match(order.cancelReason, /IOC/);
  assert.equal(engine.stats().reservedCash, 0);
  book(engine);
  engine.matchResting();
  assert.equal(order.filled, 1);
});

test("FOK insufficient depth never partially fills or changes the book/account", () => {
  const engine = market();
  book(engine, { asks: [{ price: 100, lots: 1 }, { price: 100.5, lots: 1 }] });
  const before = JSON.stringify(engine.quote(code).asks);
  const order = place(engine, { type: "market", lots: 3, tif: "FOK" }).order;
  assert.equal(order.status, "cancelled");
  assert.equal(order.filled, 0);
  assert.match(order.cancelReason, /全筆取消/);
  assert.equal(engine.cash, engine.capital);
  assert.equal(engine.fills.length, 0);
  assert.equal(JSON.stringify(engine.quote(code).asks), before);
});

test("FOK preflights every level's cash, inventory and exposure before any fill", () => {
  const cash = market({ capital: 200000 });
  book(cash, { asks: [{ price: 100, lots: 1 }, { price: 100.5, lots: 1 }] });
  assert.equal(place(cash, { type: "market", lots: 2, tif: "FOK" }).ok, false);
  assert.equal(cash.fills.length, 0);
  const inventory = market();
  place(inventory);
  assert.equal(place(inventory, { side: "sell", lots: 2, type: "market", tif: "FOK" }).ok, false);
  assert.equal(inventory.fills.length, 1);
  const exposure = market({ capital: 100000, allowShort: true });
  book(exposure, { bids: [{ price: 100, lots: 1 }, { price: 99.9, lots: 1 }] });
  const order = place(exposure, { side: "sell", type: "market", lots: 2, tif: "FOK" }).order;
  assert.equal(order.status, "cancelled");
  assert.equal(order.filled, 0);
  assert.match(order.cancelReason, /FOK.*額度/);
  assert.equal(exposure.fills.length, 0);
  assert.equal(exposure.positions.size, 0);
});

test("successful FOK execution and preview agree on lots, price, fees and tax", () => {
  const engine = market({ allowShort: true });
  book(engine, { bids: [{ price: 100, lots: 1 }, { price: 99.9, lots: 2 }] });
  const input = { code, side: "sell", type: "market", lots: 3, tif: "FOK" };
  const estimate = estimateExecution(engine.quote(code), input);
  const result = engine.place(input);
  assert.equal(result.order.status, "filled");
  assert.equal(result.order.filled, estimate.filledLots);
  assert.equal(result.fills.reduce((sum, fill) => sum + fill.fee, 0), estimate.fee);
  assert.equal(result.fills.reduce((sum, fill) => sum + fill.tax, 0), estimate.tax);
  assert.equal(result.fills.reduce((sum, fill) => sum + fill.price * fill.lots * 1000, 0), estimate.notional);
  assert.equal(estimate.averagePrice, estimate.notional / 3000);
});

test("nonfinite/fractional quantities, invalid side/type/TIF and off-tick limits are rejected unchanged", () => {
  const engine = market();
  for (const patch of [
    { lots: NaN }, { lots: Infinity }, { lots: 1.5 }, { lots: 0 }, { lots: 201 },
    { price: NaN }, { price: Infinity }, { price: 0 }, { price: 1e-9 }, { price: 100.1 },
    { side: "hold" }, { type: "stop" }, { tif: "other" },
  ]) assert.equal(place(engine, patch).ok, false, JSON.stringify(patch));
  assert.equal(engine.orders.length, 0);
  assert.equal(engine.fills.length, 0);
  assert.equal(engine.cash, engine.capital);
});

test("sim broker rejects mismatched account, venue and product intent", () => {
  const engine = market();
  const broker = getBroker("sim", engine);
  const input = { venue: "sim", accountId: SIM_ACCOUNT, kind: "daytrade", code, side: "buy", type: "market", tif: "IOC", lots: 1 };
  for (const patch of [{ venue: "live" }, { accountId: "OTHER" }, { kind: "futures" }]) assert.equal(broker.place({ ...input, ...patch }).ok, false);
  assert.equal(engine.orders.length, 0);
  assert.equal(broker.place(input).ok, true);
  assert.equal(getBroker("live", engine).place(input).ok, false);
});

test("flatten cancels same-symbol orders first and leaves insufficient-depth inventory without a pending reversal", () => {
  const engine = market();
  place(engine, { lots: 2 });
  const buy = place(engine, { price: 95 }).order;
  const sell = place(engine, { side: "sell", price: 105 }).order;
  book(engine, { bids: [{ price: 100, lots: 1 }] });
  const result = engine.flatten(code);
  assert.equal(buy.status, "cancelled");
  assert.equal(sell.status, "cancelled");
  assert.equal(result.order.tif, "IOC");
  assert.equal(result.order.filled, 1);
  assert.equal(engine.positions.get(code).lots, 1);
  assert.equal(active(engine).length, 0);
  book(engine, { bids: [{ price: 100, lots: 1 }] });
  engine.flatten(code);
  assert.equal(engine.positions.get(code).lots, 0);
});

test("manual finish keeps the current time and exposes any inventory it cannot close", () => {
  const engine = market();
  place(engine, { lots: 2 });
  place(engine, { price: 95 });
  book(engine, { bids: [{ price: 100, lots: 1 }] });
  const beforeTime = engine.t;
  engine.finish();
  assert.equal(engine.t, beforeTime);
  assert.equal(engine.ended, true);
  assert.equal(engine.forcedClose, true);
  assert.equal(engine.positions.get(code).lots, 1);
  assert.equal(active(engine).length, 0);
  assert.match(engine.warning, /仍有 1 檔未能全部平倉/);
  const count = engine.fills.length;
  engine.finish();
  assert.equal(engine.fills.length, count);
});

test("automatic close also retains insufficient-depth inventory and does not claim full liquidation", () => {
  const engine = market({ capital: 100000000, minutes: 1 / 60 });
  const stock = book(engine, { asks: [{ price: 100, lots: 200 }] });
  stock.def = { ...stock.def, liquidity: 1 }; // At most 120 displayed bid lots after the next quote refresh.
  assert.equal(place(engine, { lots: 200 }).order.filled, 200);
  engine.step(1);
  assert.equal(engine.ended, true);
  assert.ok(engine.positions.get(code).lots > 0);
  assert.equal(active(engine).length, 0);
  assert.match(engine.warning, /仍有 1 檔未能全部平倉/);
});

test("partial and reversing closes allocate both opening and closing costs and reconcile account PnL", () => {
  for (const reverse of [false, true]) {
    const engine = market({ allowShort: reverse });
    place(engine, { lots: reverse ? 1 : 2 });
    book(engine, { bids: [{ price: 100, lots: 20 }] });
    place(engine, { side: "sell", type: "market", lots: reverse ? 2 : 1 });
    let stats = engine.stats();
    assert.ok(Math.abs(stats.realized + stats.unrealized - stats.pnl) < 1e-8);
    assert.ok(engine.positions.get(code).openCost > 0);
    engine.flatten(code);
    stats = engine.stats();
    assert.equal(engine.positions.get(code).lots, 0);
    assert.ok(Math.abs(stats.realized - stats.pnl) < 1e-8);
    assert.equal(engine.positions.get(code).openCost, 0);
  }
});

test("a price gain smaller than complete costs is not counted as an engine win", () => {
  const engine = market();
  book(engine, { asks: [{ price: 14, lots: 1 }], prev: 14, last: 14 });
  place(engine, { price: 14 });
  book(engine, { bids: [{ price: 14.05, lots: 1 }], prev: 14, last: 14.05 });
  place(engine, { side: "sell", type: "market" });
  assert.equal(engine.stats().pnl, -11);
  assert.ok(Math.abs(engine.stats().realized + 11) < 1e-8);
  assert.equal(engine.stats().wins, 0);
});

test("reservation bounds aggregate commission rounding instead of underfunding a later fill", () => {
  const engine = market({ capital: 299955 });
  book(engine, { asks: [{ price: 101, lots: 10 }] });
  assert.equal(place(engine, { price: 99.9, lots: 3 }).ok, false);
  engine.cash = 299958;
  const order = place(engine, { price: 99.9, lots: 3 }).order;
  assert.equal(engine.stats().reservedCash, 299958);
  book(engine, { asks: [{ price: 99.9, lots: 3 }] });
  engine.matchResting();
  assert.equal(order.filled, 3);
  assert.equal(order.status, "filled");
  assert.ok(Math.abs(engine.cash - 2) < 1e-8);
});

test("generated depth stays on a continuous tick grid, inside daily limits, and never crosses", () => {
  const engine = market();
  for (const last of [0.01, 9.99, 10, 49.95, 50, 99.9, 100, 499.5, 500, 999, 1000]) {
    const stock = book(engine, { last, prev: last });
    for (const random of [0.1, 0.5, 0.9]) {
      engine.rng = () => random;
      engine.rebuildBook(stock);
      for (const [side, direction] of [[stock.bids, -1], [stock.asks, 1]]) {
        for (let i = 0; i < side.length; i++) {
          assert.equal(roundToTick(side[i].price), side[i].price);
          assert.ok(side[i].price >= limitDown(last) && side[i].price <= limitUp(last));
          if (i) assert.equal(side[i].price, stepTick(side[i - 1].price, direction));
        }
      }
      if (stock.bids.length && stock.asks.length) assert.ok(stock.bids[0].price < stock.asks[0].price);
    }
  }
});

test("limit-boundary depth can be one-sided and does not invent a clamped counterparty", () => {
  const engine = market();
  engine.rng = () => 0.5; // One tick spread, no ask at last.
  let stock = book(engine, { last: limitUp(100), prev: 100 });
  engine.rebuildBook(stock);
  assert.equal(stock.asks.length, 0);
  assert.ok(stock.bids.length > 0);
  assert.equal(place(engine, { type: "market", tif: "IOC" }).order.filled, 0);
  stock = book(engine, { last: limitDown(100), prev: 100 });
  engine.rebuildBook(stock);
  assert.equal(stock.bids.length, 0);
  assert.ok(stock.asks.length > 0);
  assert.equal(engine.quote(code).bidLots, 0);
});

test("flattenAll sells longs before covering shorts regardless of entry order", () => {
  const engine = market({ capital: 5000000, leverage: 2, allowShort: true });
  book(engine, { asks: [{ price: 100.5, lots: 100 }], bids: [{ price: 100, lots: 100 }] });
  const other = engine.stocks.get("2330");
  Object.assign(other, {
    last: 100, prev: 100,
    asks: [{ price: 100.5, lots: 100 }], bids: [{ price: 100, lots: 100 }],
  });
  assert.equal(place(engine, { side: "sell", type: "market", lots: 25 }).order.filled, 25);
  assert.equal(place(engine, { code: "2330", type: "market", lots: 74 }).order.filled, 74);
  assert.ok(engine.cash < 25 * 100.5 * 1000);
  engine.finish();
  assert.equal(engine.openPositions().length, 0);
  assert.equal(engine.ended, true);
  assert.equal(active(engine).length, 0);
  assert.match(engine.warning, /已無未平倉部位/);
  assert.equal(engine.fills[0].code, code);
  assert.equal(engine.fills[0].side, "buy");
});
