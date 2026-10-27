import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { installBrokerJournal, OrderJournal } from "./order-journal.server.ts";
import type { DurableIntent } from "./contracts.ts";

const now = Date.UTC(2026, 9, 23, 1);
let db: PGlite;
let journal: OrderJournal;
before(async () => {
  db = new PGlite();
  await installBrokerJournal(db);
  journal = new OrderJournal(db);
});
after(async () => {
  await db.close();
});
const intent = (overrides: Partial<DurableIntent> = {}): DurableIntent => ({
  scope: {
    broker: "fubon",
    environment: "sandbox",
    accountRef: randomUUID(),
    tradingDate: "2026-10-23",
  },
  ownerRef: "self",
  idempotencyKey: randomUUID(),
  exchange: "TWSE",
  symbol: "2330",
  side: "buy",
  shares: 2000,
  limitPrice4: 1_000_000,
  tif: "ROD",
  expiresAtMs: now + 30_000,
  ...overrides,
});
async function sending(input = intent()) {
  const row = await journal.register(input);
  const claim = await journal.claimSandboxDispatch(row.id, input.scope, now);
  assert.equal(claim.claimed, true);
  return claim.order;
}

test("concurrent identical button retries persist one intent and claim only once", async () => {
  const input = intent();
  const rows = await Promise.all(Array.from({ length: 8 }, () => journal.register(input)));
  assert.equal(new Set(rows.map((r) => r.id)).size, 1);
  const anotherJournal = new OrderJournal(db);
  const results = await Promise.all(
    [journal, anotherJournal].map((j) => j.claimSandboxDispatch(rows[0].id, input.scope, now)),
  );
  assert.equal(results.filter((r) => r.claimed).length, 1);
  assert.equal((await journal.read(rows[0].id, input.scope)).state.status, "sending");
});

test("reusing an idempotency key with a different price, side or owner is rejected", async () => {
  const input = intent();
  const original = await journal.register(input);
  for (const change of [
    { limitPrice4: input.limitPrice4 + 1000 },
    { side: "sell" },
    { ownerRef: "another" },
  ])
    await assert.rejects(journal.register({ ...input, ...change }), /IDEMPOTENCY_CONFLICT/);
  assert.deepEqual((await journal.read(original.id, input.scope)).intent, input);
});

test("broker, account, environment and trading date cannot read one another's intents", async () => {
  const row = await journal.register(intent());
  for (const change of [
    { broker: "ibfs" as const },
    { accountRef: "other" },
    { environment: "live" as const },
    { tradingDate: "2026-10-26" },
  ])
    await assert.rejects(
      journal.read(row.id, { ...row.intent.scope, ...change }),
      /ORDER_NOT_FOUND_IN_SCOPE/,
    );
});

test("expired intents never become dispatchable", async () => {
  const row = await journal.register(intent({ expiresAtMs: now }));
  const result = await journal.claimSandboxDispatch(row.id, row.intent.scope, now);
  assert.equal(result.claimed, false);
  assert.equal(result.order.state.status, "expired");
});

test("live intents cannot be claimed even when all their fields are valid", async () => {
  const input = intent();
  input.scope.environment = "live";
  const row = await journal.register(input);
  await assert.rejects(journal.claimSandboxDispatch(row.id, input.scope, now), /LIVE_LOCKED/);
  assert.equal((await journal.read(row.id, input.scope)).state.status, "pending");
});

test("SDK timeout stays unknown, and neither retries nor late ACKs cause resubmission", async () => {
  const row = await sending();
  await journal.apply(
    row.id,
    row.intent.scope,
    "timeout",
    { kind: "uncertain", reasonCode: "SEND_TIMEOUT" },
    now,
  );
  const ack = await journal.apply(
    row.id,
    row.intent.scope,
    "ack",
    { kind: "ack", brokerOrderId: "A1" },
    now,
  );
  assert.equal(ack.state.status, "unknown");
  assert.equal((await journal.register(row.intent)).id, row.id);
  assert.equal((await journal.claimSandboxDispatch(row.id, row.intent.scope, now)).claimed, false);
  const confirmed = await journal.apply(
    row.id,
    row.intent.scope,
    "query",
    {
      kind: "reconciled",
      brokerOrderId: "A1",
      disposition: "working",
      cumulativeFilledShares: 0,
      evidenceRef: "query-1",
    },
    now,
  );
  assert.equal(confirmed.state.status, "working");
  assert.equal((await journal.claimSandboxDispatch(row.id, row.intent.scope, now)).claimed, false);
});

test("fill before ACK and duplicate callback/query delivery count the execution once", async () => {
  const row = await sending();
  const fill = {
    kind: "fill",
    brokerOrderId: "A1",
    executionId: "EXEC1",
    shares: 1000,
    price4: 1_000_000,
  };
  await journal.apply(row.id, row.intent.scope, "callback", fill, now);
  await journal.apply(row.id, row.intent.scope, "query-replay", fill, now);
  const ack = await journal.apply(
    row.id,
    row.intent.scope,
    "ack",
    { kind: "ack", brokerOrderId: "A1" },
    now,
  );
  assert.equal(ack.state.filledShares, 1000);
  assert.equal(ack.state.status, "partially_filled");
});

test("same execution ID with altered contents is an auditable conflict", async () => {
  const row = await sending();
  const fill = {
    kind: "fill",
    brokerOrderId: "A1",
    executionId: "EXEC1",
    shares: 1000,
    price4: 1_000_000,
  };
  await journal.apply(row.id, row.intent.scope, "first", fill, now);
  const conflict = await journal.apply(
    row.id,
    row.intent.scope,
    "altered",
    { ...fill, shares: 2000 },
    now,
  );
  assert.equal(conflict.state.status, "unknown");
  assert.equal(conflict.state.filledShares, 1000);
  assert.equal(conflict.state.lastIssue, "REPORT_ID_CONFLICT");
});

test("an execution cannot be assigned to two orders in the same account and day", async () => {
  const input = intent();
  const first = await sending(input);
  const second = await sending({ ...input, idempotencyKey: "second" });
  const fill = {
    kind: "fill",
    brokerOrderId: "A1",
    executionId: "EXEC1",
    shares: 1000,
    price4: 1_000_000,
  };
  await journal.apply(first.id, input.scope, "first", fill, now);
  const wrong = await journal.apply(second.id, input.scope, "second", fill, now);
  assert.equal(wrong.state.filledShares, 0);
  assert.equal(wrong.state.status, "unknown");
});

test("cancel request, concurrent fill, cancel ACK and late fill preserve actual quantity", async () => {
  const row = await sending();
  const apply = (key: string, event: unknown) =>
    journal.apply(row.id, row.intent.scope, key, event, now);
  await apply("ack", { kind: "ack", brokerOrderId: "A1" });
  assert.equal(
    (await journal.recordCancelRequest(row.id, row.intent.scope, now)).state.status,
    "cancel_pending",
  );
  await apply("cancel", { kind: "canceled", brokerOrderId: "A1", cumulativeFilledShares: 1000 });
  const late = await apply("fill", {
    kind: "fill",
    brokerOrderId: "A1",
    executionId: "EXEC1",
    shares: 1000,
    price4: 1_000_000,
  });
  assert.equal(late.state.status, "unknown");
  assert.equal(late.state.filledShares, 1000);
  const reconciled = await apply("query", {
    kind: "reconciled",
    brokerOrderId: "A1",
    disposition: "canceled",
    cumulativeFilledShares: 1000,
    evidenceRef: "query-1",
  });
  assert.equal(reconciled.state.status, "canceled");
  assert.equal(
    (await apply("late-ack", { kind: "ack", brokerOrderId: "A1" })).state.status,
    "canceled",
  );
});

test("a failed cancel leaves the original order working", async () => {
  const row = await sending();
  await journal.apply(row.id, row.intent.scope, "ack", { kind: "ack", brokerOrderId: "A1" }, now);
  await journal.recordCancelRequest(row.id, row.intent.scope, now);
  const result = await journal.apply(
    row.id,
    row.intent.scope,
    "cancel-error",
    { kind: "cancel_rejected", brokerOrderId: "A1", reasonCode: "TOO_LATE" },
    now,
  );
  assert.equal(result.state.status, "working");
});

test("overfills, contradictory broker IDs and absent execution detail hold the order", async () => {
  const row = await sending();
  await journal.apply(row.id, row.intent.scope, "ack", { kind: "ack", brokerOrderId: "A1" }, now);
  const conflict = await journal.apply(
    row.id,
    row.intent.scope,
    "wrong",
    { kind: "ack", brokerOrderId: "A2" },
    now,
  );
  assert.equal(conflict.state.brokerOrderId, "A1");
  assert.equal(conflict.state.status, "unknown");
  const overflow = await journal.apply(
    row.id,
    row.intent.scope,
    "overflow",
    { kind: "fill", brokerOrderId: "A1", executionId: "EXEC1", shares: 3000, price4: 1_000_000 },
    now,
  );
  assert.equal(overflow.state.filledShares, 0);
  const aggregate = await journal.apply(
    row.id,
    row.intent.scope,
    "aggregate",
    {
      kind: "reconciled",
      brokerOrderId: "A1",
      disposition: "filled",
      cumulativeFilledShares: 2000,
      evidenceRef: "query-1",
    },
    now,
  );
  assert.equal(aggregate.state.status, "unknown");
  assert.equal(aggregate.state.filledShares, 0);
});

test("a fully filled order never regresses to working on a late ACK", async () => {
  const row = await sending();
  await journal.apply(
    row.id,
    row.intent.scope,
    "fill",
    { kind: "fill", brokerOrderId: "A1", executionId: "EXEC1", shares: 2000, price4: 1_000_000 },
    now,
  );
  const result = await journal.apply(
    row.id,
    row.intent.scope,
    "late",
    { kind: "ack", brokerOrderId: "A1" },
    now,
  );
  assert.equal(result.state.status, "filled");
  assert.equal(await journal.holdOpenOrders(row.intent.scope, now, "DISCONNECTED"), 0);
});

test("unsafe numbers, odd lots, market orders and unimplemented TIFs are rejected", async () => {
  for (const change of [
    { shares: 1 },
    { shares: -1000 },
    { shares: NaN },
    { limitPrice4: Infinity },
    { limitPrice4: 1.1 },
    { tif: "IOC" },
    { type: "market" },
  ])
    await assert.rejects(journal.register({ ...intent(), ...change }));
});

test("a failed database transaction cannot produce a dispatch claim", async () => {
  const failed = new OrderJournal({
    transaction: async () => {
      throw new Error("DISK_FULL");
    },
  });
  const input = intent();
  await assert.rejects(failed.register(input), /DISK_FULL/);
  await assert.rejects(failed.claimSandboxDispatch("x", input.scope, now), /DISK_FULL/);
});

test("malformed broker reports put the account on hold without logging arbitrary fields", async () => {
  const row = await sending();
  const result = await journal.apply(
    row.id,
    row.intent.scope,
    "bad",
    { kind: "fill", shares: -1, secret: "do-not-store" },
    now,
  );
  assert.equal(result.state.status, "unknown");
  assert.equal(result.state.lastIssue, "INVALID_BROKER_EVENT");
  const events = await db.query<{ payload: unknown }>(
    "SELECT payload FROM broker_safety_events WHERE order_id=$1",
    [row.id],
  );
  assert.equal(JSON.stringify(events.rows).includes("do-not-store"), false);
});

test("changing the client key or trading date cannot bypass an unresolved order in the account", async () => {
  const row = await sending();
  await journal.apply(
    row.id,
    row.intent.scope,
    "timeout",
    { kind: "uncertain", reasonCode: "SEND_TIMEOUT" },
    now,
  );
  for (const date of ["2026-10-23", "2026-10-26"]) {
    const another = await journal.register({
      ...row.intent,
      idempotencyKey: randomUUID(),
      scope: { ...row.intent.scope, tradingDate: date },
    });
    const result = await journal.claimSandboxDispatch(another.id, another.intent.scope, now);
    assert.equal(result.claimed, false);
    assert.equal(result.blockedBy, "ACCOUNT_RECONCILIATION_REQUIRED");
  }
  const unrelated = await journal.register(intent());
  assert.equal(
    (await journal.claimSandboxDispatch(unrelated.id, unrelated.intent.scope, now)).claimed,
    true,
  );
});

test("a committed send survives disk close/reopen and restart holds it instead of replaying it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "broker-journal-"));
  let disk: PGlite | undefined;
  try {
    disk = new PGlite(directory);
    await installBrokerJournal(disk);
    let persisted = new OrderJournal(disk);
    const row = await persisted.register(intent());
    await persisted.claimSandboxDispatch(row.id, row.intent.scope, now);
    await disk.close();
    disk = undefined;
    disk = new PGlite(directory);
    persisted = new OrderJournal(disk);
    assert.equal((await persisted.read(row.id, row.intent.scope)).state.status, "sending");
    assert.equal(await persisted.holdOpenOrders(row.intent.scope, now, "PROCESS_RESTART"), 1);
    assert.equal(
      (await persisted.claimSandboxDispatch(row.id, row.intent.scope, now)).claimed,
      false,
    );
    assert.equal((await persisted.read(row.id, row.intent.scope)).state.status, "unknown");
  } finally {
    if (disk) await disk.close();
    // Delete only the unique test directory, never a runtime or project database.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("broker-journal-"));
    await rm(directory, { recursive: true, force: true });
  }
});
