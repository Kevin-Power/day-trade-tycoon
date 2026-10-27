import { test } from "node:test";
import assert from "node:assert/strict";
import { QuoteGuard, type QuoteFrame, type QuotePolicy } from "./quote-guard.ts";

const now = Date.UTC(2026, 9, 23, 1);
const micros = (ms: number) => String(BigInt(ms) * 1000n);
const lane = {
  provider: "fubon",
  source: "broker-live",
  exchange: "TWSE",
  symbol: "2330",
  segment: "regular",
  tradingDate: "2026-10-23",
} as const;
const policy: QuotePolicy = {
  tradeMaxAgeMs: 5000,
  bookMaxAgeMs: 3000,
  transportMaxAgeMs: 65_000,
  futureToleranceMs: 1000,
  lowerPrice4: 900_000,
  upperPrice4: 1_100_000,
  sequence: { trades: "monotonic", books: "timestamp" },
};
const trade = (overrides: Partial<QuoteFrame> = {}) => ({
  ...lane,
  epoch: "socket-1",
  kind: "snapshot",
  phase: "continuous",
  marketTimeUs: micros(now),
  sequence: "10",
  channel: "trades",
  price4: 1_000_000,
  shares: 1000,
  ...overrides,
});
const book = (overrides: Partial<QuoteFrame> = {}) => ({
  ...lane,
  epoch: "socket-1",
  kind: "snapshot",
  phase: "continuous",
  marketTimeUs: micros(now),
  sequence: null,
  channel: "books",
  bids: [{ price4: 995_000, shares: 1000 }],
  asks: [{ price4: 1_005_000, shares: 1000 }],
  ...overrides,
});
function ready() {
  const guard = new QuoteGuard(lane, "socket-1", policy);
  guard.receive(trade(), now);
  guard.receive(book(), now);
  return guard;
}

test("initial streams require snapshots before becoming suitable quote inputs", () => {
  const guard = new QuoteGuard(lane, "socket-1", policy);
  assert.equal(guard.receive(trade({ kind: "update" }), now).reason, "SNAPSHOT_REQUIRED");
  guard.receive(trade(), now);
  assert.equal(guard.summary(now).quoteUsable, false);
  guard.receive(book(), now);
  assert.equal(guard.summary(now).quoteUsable, true);
});

test("wrong stock, broker, source, exchange and trading date cannot overwrite a self-selected quote", () => {
  const guard = ready();
  for (const change of [
    { symbol: "2317" },
    { provider: "ibfs" },
    { source: "synthetic" },
    { source: "historical" },
    { exchange: "TPEX" },
    { tradingDate: "2026-10-22" },
  ])
    assert.equal(guard.receive({ ...trade(), ...change }, now).reason, "WRONG_LANE");
  assert.equal(guard.summary(now).quoteUsable, true);
  assert.equal(guard.summary(now).trades.frame?.symbol, "2330");
});

test("duplicates and heartbeat traffic never refresh an old trade or book", () => {
  const guard = ready();
  guard.heartbeat("socket-1", now + 6000);
  assert.equal(guard.receive(trade(), now + 6000).reason, "DUPLICATE");
  const summary = guard.summary(now + 6000);
  assert.equal(summary.transportHealthy, true);
  assert.equal(summary.trades.ageMs, 6000);
  assert.equal(summary.quoteUsable, false);
});

test("trade and book freshness are independent", () => {
  const guard = ready();
  guard.receive(
    trade({ sequence: "11", kind: "update", marketTimeUs: micros(now + 4000) }),
    now + 4000,
  );
  const result = guard.summary(now + 4000);
  assert.equal(result.trades.fresh, true);
  assert.equal(result.books.fresh, false);
  assert.equal(result.quoteUsable, false);
});

test("out-of-order quotes cannot make prices jump backwards", () => {
  const guard = ready();
  assert.equal(
    guard.receive(trade({ sequence: "9", price4: 950_000, marketTimeUs: micros(now - 1) }), now)
      .reason,
    "OUT_OF_ORDER",
  );
  const latest = guard.summary(now).trades.frame;
  assert.ok(latest?.channel === "trades");
  assert.equal(latest.price4, 1_000_000);
});

test("microsecond ordering survives normalization and same-ID conflicts quarantine the lane", () => {
  const guard = ready();
  assert.equal(
    guard.receive(book({ kind: "update", marketTimeUs: String(BigInt(micros(now)) + 1n) }), now)
      .action,
    "accepted",
  );
  assert.equal(guard.receive(trade({ price4: 1_010_000 }), now).reason, "QUOTE_ID_CONFLICT");
  assert.equal(guard.summary(now).quoteUsable, false);
  assert.equal(
    guard.receive(trade({ sequence: "11", kind: "update", marketTimeUs: micros(now + 1) }), now + 1)
      .reason,
    "SNAPSHOT_REQUIRED",
  );
  guard.receive(trade({ sequence: "11", marketTimeUs: micros(now + 1) }), now + 1);
  assert.equal(guard.summary(now + 1).quoteUsable, true);
});

test("Fubon monotonic serial does not assume consecutive sequence numbers", () => {
  const guard = ready();
  assert.equal(
    guard.receive(
      trade({ sequence: "2000", kind: "update", marketTimeUs: micros(now + 1) }),
      now + 1,
    ).action,
    "accepted",
  );
});

test("a verified contiguous feed freezes on a gap until a newer snapshot", () => {
  const guard = new QuoteGuard(lane, "socket-1", {
    ...policy,
    sequence: { ...policy.sequence, trades: "contiguous" },
  });
  guard.receive(trade(), now);
  guard.receive(book(), now);
  assert.equal(
    guard.receive(trade({ sequence: "12", kind: "update", marketTimeUs: micros(now + 1) }), now + 1)
      .reason,
    "SEQUENCE_GAP",
  );
  assert.equal(guard.summary(now + 1).quoteUsable, false);
  guard.receive(trade({ sequence: "12", marketTimeUs: micros(now + 2) }), now + 2);
  assert.equal(guard.summary(now + 2).quoteUsable, true);
});

test("old-socket events and new-socket deltas cannot bypass reconnect snapshots", () => {
  const guard = ready();
  guard.reset("socket-2");
  assert.equal(guard.receive(trade(), now).reason, "OLD_EPOCH");
  assert.equal(
    guard.receive(trade({ epoch: "socket-2", kind: "update" }), now).reason,
    "SNAPSHOT_REQUIRED",
  );
  guard.receive(trade({ epoch: "socket-2" }), now);
  assert.equal(guard.summary(now).quoteUsable, false);
  guard.receive(book({ epoch: "socket-2" }), now);
  assert.equal(guard.summary(now).quoteUsable, true);
});

test("crossed/unsorted books, future timestamps, NaN and price-band violations are held", () => {
  const cases: [unknown, string][] = [
    [book({ bids: [{ price4: 1_010_000, shares: 1000 }] }), "CROSSED_OR_LOCKED_BOOK"],
    [
      book({
        bids: [
          { price4: 990_000, shares: 1000 },
          { price4: 995_000, shares: 1000 },
        ],
      }),
      "UNSORTED_BOOK",
    ],
    [trade({ marketTimeUs: micros(now + 60_000) }), "FUTURE_TIMESTAMP"],
    [trade({ price4: NaN }), "INVALID_FRAME"],
    [trade({ price4: 1_200_000 }), "PRICE_OUT_OF_BAND"],
    [trade({ marketTimeUs: micros(now - 86_400_000) }), "WRONG_EVENT_DATE"],
  ];
  for (const [input, reason] of cases) {
    const guard = ready();
    assert.equal(guard.receive(input, now).reason, reason);
    assert.equal(guard.summary(now).quoteUsable, false);
  }
});

test("trial prices never replace actual trades, while valid large price moves remain visible", () => {
  const guard = ready();
  assert.equal(
    guard.receive(trade({ phase: "auction", price4: 1_090_000 }), now).reason,
    "NON_CONTINUOUS_PHASE",
  );
  const old = guard.summary(now).trades.frame;
  assert.ok(old?.channel === "trades");
  assert.equal(old.price4, 1_000_000);
  assert.equal(
    guard.receive(
      trade({ sequence: "11", price4: 1_090_000, marketTimeUs: micros(now + 1) }),
      now + 1,
    ).action,
    "accepted",
  );
});

test("a one-sided book is retained honestly without inventing the missing side", () => {
  const guard = ready();
  guard.receive(book({ asks: [], marketTimeUs: micros(now + 1) }), now + 1);
  const result = guard.summary(now + 1);
  assert.equal(result.books.fresh, true);
  assert.equal(result.twoSidedBook, false);
  assert.equal(result.quoteUsable, false);
});

test("clock rollback or a silent transport cannot appear healthy", () => {
  const guard = ready();
  assert.equal(guard.summary(now - 1).quoteUsable, false);
  assert.equal(guard.receive(trade(), now - 1).reason, "CLOCK_REGRESSION");
  assert.equal(guard.summary(now + 70_000).transportHealthy, false);
});

test("returned snapshots cannot be mutated to corrupt the guard", () => {
  const guard = ready();
  const copy = guard.summary(now).trades.frame;
  if (copy?.channel === "trades") copy.price4 = 1;
  const retained = guard.summary(now).trades.frame;
  assert.ok(retained?.channel === "trades");
  assert.equal(retained.price4, 1_000_000);
});

test("a stale snapshot cannot erase a known gap or same-ID conflict", () => {
  const guard = new QuoteGuard(lane, "socket-1", {
    ...policy,
    sequence: { ...policy.sequence, trades: "contiguous" },
  });
  guard.receive(trade(), now);
  guard.receive(book(), now);
  guard.receive(trade({ sequence: "12", kind: "update", marketTimeUs: micros(now + 2) }), now + 2);
  assert.equal(
    guard.receive(trade({ sequence: "11", marketTimeUs: micros(now + 1) }), now + 2).reason,
    "SNAPSHOT_BEHIND_WATERMARK",
  );
  guard.reset("socket-2");
  assert.equal(
    guard.receive(
      trade({ epoch: "socket-2", sequence: "1", marketTimeUs: micros(now + 1) }),
      now + 2,
    ).reason,
    "SNAPSHOT_BEHIND_WATERMARK",
  );
  assert.equal(
    guard.receive(
      trade({ epoch: "socket-2", sequence: "1", marketTimeUs: micros(now + 3) }),
      now + 3,
    ).action,
    "accepted",
  );
  const conflict = ready();
  conflict.receive(trade({ price4: 1_010_000 }), now);
  assert.equal(conflict.receive(trade(), now).reason, "SNAPSHOT_BEHIND_WATERMARK");
});

test("a reconnect may reset sequence numbers but must advance event time; old heartbeat is ignored", () => {
  const guard = ready();
  guard.reset("socket-2");
  assert.equal(guard.heartbeat("socket-1", now + 1), false);
  assert.equal(guard.summary(now + 1).transportHealthy, false);
  assert.equal(
    guard.receive(
      trade({ epoch: "socket-2", sequence: "1", marketTimeUs: micros(now + 1) }),
      now + 1,
    ).action,
    "accepted",
  );
});

test("a reconnect cannot replace an equal-timestamp trade with a different price", () => {
  const guard = ready();
  guard.reset("socket-2");
  assert.equal(
    guard.receive(trade({ epoch: "socket-2", sequence: "1", price4: 1_010_000 }), now).reason,
    "RECONNECT_VALUE_CONFLICT",
  );
  assert.equal(guard.summary(now).quoteUsable, false);
});
