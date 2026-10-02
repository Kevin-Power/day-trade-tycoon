import { Pool, types } from "pg";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";

export type DbSource = "neon" | "pglite";
export const dbSource: DbSource = process.env.DATABASE_URL?.trim() ? "neon" : "pglite";
export interface Sql {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;
function toSql(run: Run): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += "$" + (i + 1) + strings[i + 1];
    return run<T>(text, values);
  }) as Sql;
  sql.query = <T>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}
type Runtime = {
  pool?: Pool;
  pglite?: import("@electric-sql/pglite").PGlite;
  init?: Promise<void>;
  lockFile?: string;
  shuttingDown: boolean;
  active: number;
  idleWaiters: Array<() => void>;
  shutdownHook: boolean;
  close?: Promise<void>;
};
const globalDb = globalThis as typeof globalThis & { __classroomDatabase?: Runtime };
const runtime = globalDb.__classroomDatabase ??= {
  shuttingDown: false, active: 0, idleWaiters: [], shutdownHook: false,
};

export async function withDatabaseOperation<T>(run: () => Promise<T>): Promise<T> {
  if (runtime.shuttingDown) throw new Error("Database is shutting down");
  runtime.active++;
  try { return await run(); }
  finally {
    runtime.active--;
    if (!runtime.active) runtime.idleWaiters.splice(0).forEach(resolveIdle => resolveIdle());
  }
}

function installShutdownHook(): void {
  if (runtime.shutdownHook) return;
  runtime.shutdownHook = true;
  process.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || !("type" in message) || message.type !== "shutdown") return;
    void gracefulCloseDatabase().then(
      () => process.send?.({ type: "shutdown-complete" }),
      () => process.send?.({ type: "shutdown-error" }),
    );
  });
}
export function getPostgresPool(): Pool {
  if (runtime.shuttingDown) throw new Error("Database is shutting down");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!runtime.pool) {
    types.setTypeParser(20, Number);
    types.setTypeParser(1082, value => value);
    types.setTypeParser(1186, value => value);
    runtime.pool = new Pool({ connectionString: url, max: 10 });
    installShutdownHook();
  }
  return runtime.pool;
}

async function acquireFileLock(dataDir: string): Promise<void> {
  const path = dataDir + ".lock";
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      runtime.lockFile = path;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: number };
      try { owner = JSON.parse(await readFile(path, "utf8")); }
      catch { throw new Error("Database lock cannot be verified; inspect it before starting"); }
      if (!Number.isInteger(owner.pid) || !owner.pid || owner.pid <= 0)
        throw new Error("Invalid database lock; inspect it before starting");
      let alive = true;
      try { process.kill(owner.pid, 0); }
      catch (failure) { alive = (failure as NodeJS.ErrnoException).code !== "ESRCH"; }
      if (alive) throw new Error("Another process owns the database; stop it before starting");
      await unlink(path);
    }
  }
  throw new Error("Could not acquire database lock");
}

function configuredDataDir(): string {
  const configured = process.env.PGLITE_DATA_DIR?.trim();
  if (process.env.NODE_ENV === "production" && !configured)
    throw new Error("Production requires PGLITE_DATA_DIR or DATABASE_URL");
  if (configured && !isAbsolute(configured)) throw new Error("PGLITE_DATA_DIR must be an absolute path");
  return configured || resolve(".local-data", "pglite");
}

/** One ordered migration plan, shared by local disk Postgres and external Postgres. */
export function ensureDbReady(): Promise<void> {
  if (runtime.shuttingDown) return Promise.reject(new Error("Database is shutting down"));
  runtime.init ??= (async () => {
    if (typeof window !== "undefined") throw new Error("Database is server-only");
    installShutdownHook();
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw", import: "default", eager: true,
    }) as Record<string, string>;
    if (dbSource === "pglite") {
      const dataDir = configuredDataDir();
      await acquireFileLock(dataDir);
      const { PGlite } = await import("@electric-sql/pglite");
      const pg = new PGlite({
        dataDir,
        parsers: { 20: Number, 1082: value => value, 1186: value => value },
      });
      runtime.pglite = pg;
      await pg.waitReady;
      await pg.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const done = (await pg.query<{ name: string }>("SELECT name FROM _migrations")).rows.map(r => r.name);
      for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
        await pg.transaction(async tx => {
          await tx.exec(migrations[path]);
          await tx.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        });
      }
    } else {
      const client = await getPostgresPool().connect();
      try {
        await client.query("SELECT pg_advisory_lock(836105021)");
        await client.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        const done = (await client.query("SELECT name FROM _migrations")).rows.map(r => r.name);
        for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
          await client.query("BEGIN");
          try {
            await client.query(migrations[path]);
            await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK"); throw error; }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(836105021)").catch(() => undefined);
        client.release();
      }
    }
  })().catch(async error => {
    await runtime.pglite?.close().catch(() => undefined);
    runtime.pglite = undefined;
    if (runtime.lockFile) { await unlink(runtime.lockFile).catch(() => undefined); runtime.lockFile = undefined; }
    runtime.init = undefined;
    throw error;
  });
  return runtime.init;
}

export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (dbSource !== "pglite") throw new Error("PGlite is unavailable when DATABASE_URL is set");
  await ensureDbReady();
  if (!runtime.pglite) throw new Error("Database did not initialize");
  return runtime.pglite;
}

export async function getSql(): Promise<Sql> {
  await ensureDbReady();
  return toSql(<T>(text: string, params: unknown[]) => withDatabaseOperation(async () => {
    if (dbSource === "pglite") return (await runtime.pglite!.query<T>(text, params)).rows;
    return (await getPostgresPool().query(text, params)).rows as T[];
  }));
}

export async function withSqlTransaction<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  await ensureDbReady();
  return withDatabaseOperation(async () => {
    if (dbSource === "pglite") {
      return runtime.pglite!.transaction(tx => run(toSql(async <R>(text: string, params: unknown[]) =>
        (await tx.query<R>(text, params)).rows)));
    }
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const result = await run(toSql(async <R>(text: string, params: unknown[]) =>
        (await client.query(text, params)).rows as R[]));
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
}

/** The supervisor stops ingress, requests shutdown, then terminates after this flush acknowledges. */
export function gracefulCloseDatabase(): Promise<void> {
  runtime.close ??= (async () => {
    runtime.shuttingDown = true;
    await runtime.init;
    if (runtime.active) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>(resolveIdle => runtime.idleWaiters.push(resolveIdle)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Database drain timed out")), 20_000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    }
    await runtime.pglite?.close();
    await runtime.pool?.end();
    if (runtime.lockFile) { await unlink(runtime.lockFile); runtime.lockFile = undefined; }
  })();
  return runtime.close;
}
