import test from "node:test";
import assert from "node:assert/strict";
import { FubonQuoteStore, watchRequest } from "./fubon-feed.ts";

const now = Date.parse("2026-10-23T01:10:00Z");
const us = now * 1000;
const base = { symbol: "2330", type: "EQUITY", exchange: "TWSE", name: "測試商品", date: "2026-10-23",
  referencePrice: 100, lastUpdated: us, lastTrade: { price: 101, time: us, serial: 5 },
  bids: [{ price: 100, size: 20 }], asks: [{ price: 101, size: 3 }], isContinuous: true };
function setup() { const s = new FubonQuoteStore(); s.reset(1); s.ack(1, "books", "2330"); s.ack(1, "trades", "2330"); return s; }
function row(s: FubonQuoteStore, at = now, connected = true) { return s.view(["2330"], at, connected)[0]; }

test("real source times survive heartbeat/reconnect; stale prices never become fresh", () => {
  const s = setup(); assert.equal(s.receive(1, "snapshot", base, now), "ACCEPTED");
  assert.equal(row(s).tradeFresh, true); assert.equal(row(s, now + 16000).tradeFresh, false);
  assert.equal(row(s, now, false).bookFresh, false);
  s.reset(2); assert.equal(row(s).acknowledged, false); assert.equal(row(s).price, 101);
  s.ack(1, "books", "2330"); s.ack(2, "books", "2330"); s.ack(2, "trades", "2330");
  assert.equal(row(s).tradeFresh, false);
  assert.equal(s.receive(1, "snapshot", { ...base, lastTrade: { price: 90, time: us + 1 } }, now), "OLD_EPOCH");
  s.receive(2, "snapshot", base, now + 16000); assert.equal(row(s, now + 16000).bookFresh, false);
});
test("out of order frames and serial regressions do not rewind price or book", () => {
  const s = setup(); s.receive(1, "snapshot", base, now);
  s.receive(1, "trades", { ...base, time: us - 1000, price: 90, serial: 4 }, now);
  s.receive(1, "trades", { ...base, time: us + 1000, price: 90, serial: 4 }, now);
  s.receive(1, "books", { ...base, time: us - 1000, bids: [{ price: 99, size: 1 }] }, now);
  assert.equal(row(s).price, 101); assert.equal(row(s).bids[0].price, 100);
});
test("trial price never replaces last real trade; crossed trial book stays visibly trial", () => {
  const s = setup(); s.receive(1, "snapshot", base, now);
  s.receive(1, "trades", { ...base, time: us + 100, price: 107, serial: 6, isTrial: true }, now);
  s.receive(1, "books", { ...base, time: us + 100, isTrial: true, bids: [{ price: 102, size: 4 }] }, now);
  assert.equal(row(s).price, 101); assert.equal(row(s).bookPhase, "trial");
});
test("crossed continuous books quarantine until newer full snapshot; no fabricated levels", () => {
  const s = setup(); s.receive(1, "snapshot", base, now);
  assert.equal(s.receive(1, "books", { ...base, time: us + 100, bids: [{ price: 102, size: 4 }] }, now), "INVALID_BOOK");
  assert.equal(row(s).bookFresh, false); assert.equal(row(s).bids[0].price, 100);
  s.receive(1, "snapshot", base, now); assert.equal(row(s).issue, "INVALID_BOOK");
  s.receive(1, "snapshot", { ...base, lastUpdated: us + 200, bids: [], asks: [] }, now);
  assert.equal(row(s).issue, null); assert.deepEqual(row(s).bids, []); assert.deepEqual(row(s).asks, []);
});
test("same timestamp changed value is held, including across reconnect", () => {
  const s = setup(); s.receive(1, "snapshot", base, now); s.reset(2); s.ack(2, "trades", "2330"); s.ack(2, "books", "2330");
  s.receive(2, "snapshot", { ...base, lastTrade: { price: 110, time: us } }, now);
  assert.equal(row(s).price, 101); assert.equal(row(s).issue, "VALUE_CONFLICT");
  assert.equal(row(s).tradeFresh, false);
});
test("yesterday is retained as old data, future timestamps and wrong segment are rejected", () => {
  const s = setup(); s.receive(1, "snapshot", base, now + 86400000);
  assert.equal(row(s, now + 86400000).tradeFresh, false);
  assert.equal(s.receive(1, "snapshot", { ...base, lastUpdated: us + 9e6 }, now), "INVALID_TIME");
  assert.equal(s.receive(1, "snapshot", { ...base, type: "ODDLOT" }, now), "INVALID_QUOTE");
});
test("subscription acknowledgement and symbol capacity are required", () => {
  const s = new FubonQuoteStore(); s.reset(1);
  assert.equal(s.receive(1, "snapshot", base, now), "UNSUBSCRIBED");
  const client = "00000000-0000-4000-8000-000000000001";
  assert.equal(watchRequest.safeParse({ client, symbols: ["2330"] }).success, true);
  assert.equal(watchRequest.safeParse({ client, symbols: ["2330"], order: "buy" }).success, false);
  assert.equal(watchRequest.safeParse({ client, symbols: Array(21).fill("2330") }).success, false);
});
test("serial resets next day and old reference cannot contaminate today's change", () => {
  const s = setup(); s.receive(1, "snapshot", base, now);
  s.receive(1, "trades", { symbol: "2330", type: "EQUITY", exchange: "TWSE", time: us + 86400e6, price: 102, serial: 1 }, now + 86400e3);
  const today = row(s, now + 86400e3);
  assert.equal(today.price, 102); assert.equal(today.reference, null);
  assert.equal(today.tradeFresh, true); assert.equal(today.bookFresh, false);
});
test("malformed numeric feed marks held prices untrusted without losing them", () => {
  const s = setup(); s.receive(1, "snapshot", base, now);
  s.receive(1, "books", { ...base, time: us + 1, bids: [{ price: NaN, size: -1 }] }, now);
  assert.equal(row(s).issue, "INVALID_QUOTE"); assert.equal(row(s).bookFresh, false); assert.equal(row(s).price, 101);
});
test("one missing symbol does not invalidate other symbol data", () => {
  const s = setup(); s.receive(1, "snapshot", base, now); s.symbolError("9999", "SNAPSHOT_FAILED");
  assert.equal(row(s).tradeFresh, true);
  assert.equal(s.view(["9999"], now, true)[0].issue, "SNAPSHOT_FAILED");
  s.retain(["2330"]); assert.equal(s.view(["9999"], now, true)[0].issue, null);
});
test("broker daily price bounds reject scale errors without guessing a ten percent rule", () => {
  const s = setup(); s.setBounds({ symbol: "2330", date: "2026-10-23", limitUpPrice: 110, limitDownPrice: 90 });
  s.receive(1, "snapshot", base, now);
  assert.equal(s.receive(1, "trades", { ...base, price: 1010, time: us + 1000, serial: 6 }, now), "PRICE_OUT_OF_BAND");
  assert.equal(row(s).price, 101); assert.equal(row(s).tradeFresh, false);
});
