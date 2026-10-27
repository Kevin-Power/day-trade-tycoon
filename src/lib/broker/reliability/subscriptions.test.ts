import { test } from "node:test";
import assert from "node:assert/strict";
import { SubscriptionRegistry, reconnectDelayMs } from "./subscriptions.ts";

test("two pages viewing the same symbol share a single acknowledged subscription", () => {
  const registry = new SubscriptionRegistry("a", 3);
  registry.replace("desktop", ["fubon:TWSE:regular:2330:trades"]);
  registry.replace("phone", ["fubon:TWSE:regular:2330:trades"]);
  const [key] = registry.plan().subscribe;
  assert.equal(registry.plan().subscribe.length, 1);
  registry.markRequested("a", "subscribe", key);
  assert.equal(registry.isReady(key), false);
  assert.deepEqual(registry.plan().subscribe, []);
  registry.acknowledge("a", "subscribe", key);
  registry.remove("desktop");
  assert.deepEqual(registry.plan().unsubscribe, []);
  registry.remove("phone");
  assert.deepEqual(registry.plan().unsubscribe, [key]);
});

test("watchlist changes cannot silently exceed subscription capacity", () => {
  const registry = new SubscriptionRegistry("a", 2);
  registry.replace("desktop", ["2330:trades", "2330:books"]);
  assert.throws(() => registry.replace("phone", ["2317:trades"]), /CAPACITY/);
  assert.deepEqual(registry.plan().subscribe, ["2330:books", "2330:trades"]);
});

test("a full connection unsubscribes and waits for ACK before replacing a symbol", () => {
  const registry = new SubscriptionRegistry("a", 1);
  registry.replace("desktop", ["2330"]);
  registry.markRequested("a", "subscribe", "2330");
  registry.acknowledge("a", "subscribe", "2330");
  registry.replace("desktop", ["2317"]);
  assert.deepEqual(registry.plan().subscribe, []);
  registry.markRequested("a", "unsubscribe", "2330");
  assert.deepEqual(registry.plan().subscribe, []);
  registry.acknowledge("a", "unsubscribe", "2330");
  assert.deepEqual(registry.plan().subscribe, ["2317"]);
});

test("late subscription ACK after a stock is removed is followed by unsubscribe", () => {
  const registry = new SubscriptionRegistry("a", 2);
  registry.replace("desktop", ["2330"]);
  registry.markRequested("a", "subscribe", "2330");
  registry.remove("desktop");
  registry.acknowledge("a", "subscribe", "2330");
  assert.deepEqual(registry.plan().unsubscribe, ["2330"]);
});

test("reconnect keeps desired stocks but discards old acknowledgements and pending work", () => {
  const registry = new SubscriptionRegistry("a", 2);
  registry.replace("desktop", ["2330"]);
  registry.markRequested("a", "subscribe", "2330");
  registry.reset("b");
  assert.equal(registry.acknowledge("a", "subscribe", "2330"), false);
  assert.equal(registry.acknowledge("b", "subscribe", "2330"), false);
  assert.deepEqual(registry.plan().subscribe, ["2330"]);
  assert.equal(registry.isReady("2330"), false);
});

test("reconnect attempts are bounded and jittered, with explicit exhaustion", () => {
  assert.equal(reconnectDelayMs(0, 0.5), 500);
  assert.equal(reconnectDelayMs(3, 0.5), 4000);
  assert.equal(reconnectDelayMs(7, 1), 30_000);
  assert.equal(reconnectDelayMs(8, 0.5), null);
  assert.throws(() => reconnectDelayMs(-1, 0.5), /INVALID/);
  assert.throws(() => reconnectDelayMs(1, NaN), /INVALID/);
});
