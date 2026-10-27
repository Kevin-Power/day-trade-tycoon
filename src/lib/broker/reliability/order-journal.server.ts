import { createHash, randomUUID } from "node:crypto";
import {
  accountKey,
  eventSchema,
  initialOrderState,
  intentSchema,
  reduceBrokerEvent,
  scopeKey,
  scopeSchema,
  uncertain,
  type BrokerScope,
  type DurableIntent,
  type OrderState,
} from "./contracts.ts";

if (typeof window !== "undefined") throw new Error("BROKER_JOURNAL_SERVER_ONLY");

export interface JournalTransaction {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface JournalDatabase {
  transaction<T>(run: (tx: JournalTransaction) => Promise<T>): Promise<T>;
}
export type JournalOrder = { id: string; intent: DurableIntent; state: OrderState };
type EventRow = { order_id: string; digest: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = (state: OrderState) =>
  ["canceled", "filled", "rejected", "expired"].includes(state.status) &&
  !state.needsReconciliation;

// This schema is intentionally NOT in the classroom migration chain. Installation
// requires an explicit, isolated database. Importing this file opens no database.
export async function installBrokerJournal(db: JournalDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      "CREATE TABLE IF NOT EXISTS broker_safety_accounts (account_key TEXT PRIMARY KEY)",
    );
    await tx.query(`CREATE TABLE IF NOT EXISTS broker_safety_orders (
      id TEXT PRIMARY KEY, account_key TEXT NOT NULL REFERENCES broker_safety_accounts(account_key),
      scope_key TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      intent JSONB NOT NULL, digest TEXT NOT NULL, state JSONB NOT NULL,
      UNIQUE(scope_key, idempotency_key)
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS broker_safety_events (
      event_key TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES broker_safety_orders(id),
      digest TEXT NOT NULL, payload JSONB NOT NULL, received_at_ms BIGINT NOT NULL
    )`);
  });
}

function validNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("INVALID_CLOCK");
}

/** Persistence and fault-injection foundation only. There is no network/SDK send. */
export class OrderJournal {
  private readonly db: JournalDatabase;
  constructor(db: JournalDatabase) {
    this.db = db;
  }

  async register(input: unknown): Promise<JournalOrder> {
    const intent = intentSchema.parse(input); // Zod constructs a canonical property order.
    return this.db.transaction(async (tx) => {
      const hash = digest(intent);
      await tx.query(
        "INSERT INTO broker_safety_accounts (account_key) VALUES ($1) ON CONFLICT DO NOTHING",
        [accountKey(intent.scope)],
      );
      await this.lockAccount(tx, intent.scope);
      await tx.query(
        `INSERT INTO broker_safety_orders (id, account_key, scope_key, idempotency_key, intent, digest, state)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (scope_key,idempotency_key) DO NOTHING`,
        [
          randomUUID(),
          accountKey(intent.scope),
          scopeKey(intent.scope),
          intent.idempotencyKey,
          intent,
          hash,
          initialOrderState(),
        ],
      );
      const { rows } = await tx.query<JournalOrder & { digest: string }>(
        "SELECT id,intent,state,digest FROM broker_safety_orders WHERE scope_key=$1 AND idempotency_key=$2 FOR UPDATE",
        [scopeKey(intent.scope), intent.idempotencyKey],
      );
      if (rows[0].digest !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
      const { id, state } = rows[0];
      return { id, intent: rows[0].intent, state };
    });
  }

  private async lockAccount(tx: JournalTransaction, scope: BrokerScope): Promise<void> {
    await tx.query(
      "SELECT account_key FROM broker_safety_accounts WHERE account_key=$1 FOR UPDATE",
      [accountKey(scopeSchema.parse(scope))],
    );
  }

  private async locked(
    tx: JournalTransaction,
    id: string,
    scope: BrokerScope,
  ): Promise<JournalOrder> {
    await this.lockAccount(tx, scope);
    const { rows } = await tx.query<JournalOrder>(
      "SELECT id,intent,state FROM broker_safety_orders WHERE id=$1 AND scope_key=$2 FOR UPDATE",
      [id, scopeKey(scopeSchema.parse(scope))],
    );
    if (!rows[0]) throw new Error("ORDER_NOT_FOUND_IN_SCOPE");
    return rows[0];
  }

  private async write(
    tx: JournalTransaction,
    row: JournalOrder,
    state: OrderState,
    nowMs: number,
    payload: unknown,
  ): Promise<JournalOrder> {
    await tx.query("UPDATE broker_safety_orders SET state=$2 WHERE id=$1", [row.id, state]);
    await tx.query(
      "INSERT INTO broker_safety_events (event_key,order_id,digest,payload,received_at_ms) VALUES ($1,$2,$3,$4,$5)",
      [`local:${randomUUID()}`, row.id, digest(payload), payload, nowMs],
    );
    return { ...row, state };
  }

  async read(id: string, scope: BrokerScope): Promise<JournalOrder> {
    return this.db.transaction((tx) => this.locked(tx, id, scope));
  }

  /** Claims at most once, and commits BEFORE a future adapter could be invoked.
   * Live claims are hard-disabled. Sandbox still needs auth/risk/quote checks in
   * the future orchestrator; this method alone is not permission to send an order.
   */
  async claimSandboxDispatch(
    id: string,
    scope: BrokerScope,
    nowMs: number,
  ): Promise<{ claimed: boolean; order: JournalOrder; blockedBy?: string }> {
    validNow(nowMs);
    return this.db.transaction(async (tx) => {
      const row = await this.locked(tx, id, scope);
      if (row.intent.scope.environment !== "sandbox") throw new Error("LIVE_LOCKED");
      if (row.state.status !== "pending") return { claimed: false, order: row };
      const unresolved = await tx.query<{ id: string }>(
        "SELECT id FROM broker_safety_orders WHERE account_key=$1 AND state->>'needsReconciliation'='true' LIMIT 1",
        [accountKey(scope)],
      );
      if (unresolved.rows.length)
        return { claimed: false, order: row, blockedBy: "ACCOUNT_RECONCILIATION_REQUIRED" };
      if (nowMs >= row.intent.expiresAtMs) {
        const order = await this.write(
          tx,
          row,
          { ...row.state, status: "expired", lastIssue: "INTENT_EXPIRED" },
          nowMs,
          { kind: "expired" },
        );
        return { claimed: false, order };
      }
      const order = await this.write(tx, row, { ...row.state, status: "sending" }, nowMs, {
        kind: "dispatch_claimed",
      });
      return { claimed: true, order };
    });
  }

  async apply(
    id: string,
    scope: BrokerScope,
    eventKey: string,
    input: unknown,
    nowMs: number,
  ): Promise<JournalOrder> {
    validNow(nowMs);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(eventKey)) throw new Error("INVALID_EVENT_KEY");
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) {
      return this.db.transaction(async (tx) => {
        const row = await this.locked(tx, id, scope);
        // Do not log arbitrary malformed input: it may contain account secrets.
        return this.write(tx, row, uncertain(row.state, "INVALID_BROKER_EVENT"), nowMs, {
          kind: "invalid_report",
          issues: parsed.error.issues.map(({ code, path }) => ({ code, path })),
        });
      });
    }
    const event = parsed.data;
    // Fills are deduplicated across the whole account/day, independently of the
    // caller's event key and delivery channel (callback vs query replay).
    const key = digest(
      event.kind === "fill"
        ? [scopeKey(scopeSchema.parse(scope)), "fill", event.executionId]
        : [scopeKey(scopeSchema.parse(scope)), id, eventKey],
    );
    const hash = digest(event);
    return this.db.transaction(async (tx) => {
      const row = await this.locked(tx, id, scope);
      const inserted = await tx.query<EventRow>(
        `INSERT INTO broker_safety_events (event_key,order_id,digest,payload,received_at_ms)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_key) DO NOTHING RETURNING order_id,digest`,
        [key, id, hash, event, nowMs],
      );
      if (!inserted.rows.length) {
        const prior = await tx.query<EventRow>(
          "SELECT order_id,digest FROM broker_safety_events WHERE event_key=$1",
          [key],
        );
        if (prior.rows[0].order_id === id && prior.rows[0].digest === hash) return row;
        return this.write(tx, row, uncertain(row.state, "REPORT_ID_CONFLICT"), nowMs, {
          kind: "report_conflict",
          event,
        });
      }
      const state = reduceBrokerEvent(row.state, event, row.intent.shares);
      await tx.query("UPDATE broker_safety_orders SET state=$2 WHERE id=$1", [id, state]);
      return { ...row, state };
    });
  }

  /** A cancel REQUEST is never a cancel acknowledgement. No network send occurs. */
  async recordCancelRequest(id: string, scope: BrokerScope, nowMs: number): Promise<JournalOrder> {
    validNow(nowMs);
    return this.db.transaction(async (tx) => {
      const row = await this.locked(tx, id, scope);
      if (terminal(row.state) || row.state.cancelPending || !row.state.brokerOrderId) return row;
      return this.write(
        tx,
        row,
        {
          ...row.state,
          cancelPending: true,
          status: row.state.needsReconciliation ? "unknown" : "cancel_pending",
        },
        nowMs,
        { kind: "cancel_requested" },
      );
    });
  }

  /** Run after disconnect/restart, before considering any further entry. Even
   * pending intents are held: recovery must never flush an old queue to a broker.
   * Call only with exclusive worker ownership; multi-host fencing is not supplied.
   */
  async holdOpenOrders(
    scope: BrokerScope,
    nowMs: number,
    reason: "DISCONNECTED" | "PROCESS_RESTART",
  ): Promise<number> {
    validNow(nowMs);
    return this.db.transaction(async (tx) => {
      await this.lockAccount(tx, scope);
      const { rows } = await tx.query<JournalOrder>(
        "SELECT id,intent,state FROM broker_safety_orders WHERE account_key=$1 ORDER BY id FOR UPDATE",
        [accountKey(scope)],
      );
      let held = 0;
      for (const row of rows) {
        if (terminal(row.state)) continue;
        await this.write(tx, row, uncertain(row.state, reason), nowMs, { kind: "hold", reason });
        held++;
      }
      return held;
    });
  }
}
