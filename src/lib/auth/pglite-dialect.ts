/** Kysely transactions use PGlite's mutex-backed transaction API, shared with app writes. */
import type { PGlite, Transaction } from "@electric-sql/pglite";
import {
  type DatabaseConnection, type DatabaseIntrospector, type Dialect, type Driver, type Kysely,
  PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type QueryCompiler,
  type QueryResult, type TransactionSettings, type CompiledQuery,
} from "kysely";
import { withDatabaseOperation } from "../db.ts";

export function pgliteDialect(getClient: () => Promise<PGlite> | PGlite): Dialect {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new LazyPGliteDriver(getClient),
    createQueryCompiler: (): QueryCompiler => new PostgresQueryCompiler(),
    createIntrospector: (db: Kysely<unknown>): DatabaseIntrospector => new PostgresIntrospector(db),
  };
}
class LazyPGliteDriver implements Driver {
  private connection?: PGliteConnection;
  private queue: Array<(connection: PGliteConnection) => void> = [];
  private readonly getClient: () => Promise<PGlite> | PGlite;
  constructor(getClient: () => Promise<PGlite> | PGlite) { this.getClient = getClient; }
  async init(): Promise<void> { await this.getClient(); }
  async acquireConnection(): Promise<DatabaseConnection> {
    if (this.connection) return new Promise(resolve => this.queue.push(resolve));
    // Reserve the connection before awaiting DB initialization.
    const connection = new PGliteConnection(this.getClient);
    this.connection = connection;
    return connection;
  }
  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    if (connection !== this.connection) throw new Error("Invalid database connection");
    const next = this.queue.shift();
    if (next) next(this.connection); else this.connection = undefined;
  }
  async beginTransaction(conn: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    await (conn as PGliteConnection).begin(settings);
  }
  async commitTransaction(conn: DatabaseConnection): Promise<void> { await (conn as PGliteConnection).finish(false); }
  async rollbackTransaction(conn: DatabaseConnection): Promise<void> { await (conn as PGliteConnection).finish(true); }
  async destroy(): Promise<void> { this.connection = undefined; this.queue = []; }
}
const ROLLBACK = new Error("PGlite transaction rollback");
class PGliteConnection implements DatabaseConnection {
  private transaction?: Transaction;
  private complete?: (rollback: boolean) => void;
  private pending?: Promise<void>;
  private readonly getClient: () => Promise<PGlite> | PGlite;
  constructor(getClient: () => Promise<PGlite> | PGlite) { this.getClient = getClient; }
  async begin(settings: TransactionSettings): Promise<void> {
    const client = await this.getClient();
    let ready!: () => void;
    let failed!: (error: unknown) => void;
    const acquired = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    const finished = new Promise<boolean>(resolve => { this.complete = resolve; });
    this.pending = withDatabaseOperation(() => client.transaction(async tx => {
      this.transaction = tx;
      if (settings.isolationLevel) await tx.query("SET TRANSACTION ISOLATION LEVEL " + settings.isolationLevel);
      ready();
      if (await finished) throw ROLLBACK;
    }));
    void this.pending.catch(failed);
    try { await acquired; }
    catch (error) {
      this.transaction = undefined; this.complete = undefined; this.pending = undefined;
      throw error;
    }
  }
  async finish(rollback: boolean): Promise<void> {
    if (!this.complete || !this.pending) throw new Error("No transaction is active");
    this.complete(rollback);
    try { await this.pending; }
    catch (error) { if (error !== ROLLBACK) throw error; }
    finally { this.transaction = undefined; this.complete = undefined; this.pending = undefined; }
  }
  async executeQuery<O>(query: CompiledQuery): Promise<QueryResult<O>> {
    const run = async () => {
      const client = this.transaction || await this.getClient();
      const result = await client.query<O>(query.sql, [...query.parameters]);
      return { rows: result.rows, ...(result.affectedRows ? { numAffectedRows: BigInt(result.affectedRows) } : {}) };
    };
    return this.transaction ? run() : withDatabaseOperation(run);
  }
  async *streamQuery<O>(query: CompiledQuery, chunkSize: number): AsyncIterableIterator<QueryResult<O>> {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("chunkSize must be positive");
    const result = await this.executeQuery<O>(query);
    for (let i = 0; i < result.rows.length; i += chunkSize) yield { rows: result.rows.slice(i, i + chunkSize) };
  }
}
