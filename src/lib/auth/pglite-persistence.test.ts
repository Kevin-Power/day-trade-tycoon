import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { pgliteDialect } from "./pglite-dialect.ts";

test("disk PGlite survives close/reopen and auth transactions do not leak failed writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "classroom-db-test-"));
  const dataDir = join(root, "database");
  let pg: PGlite | undefined;
  let db: Kysely<Record<string, never>> | undefined;
  try {
    pg = new PGlite({ dataDir });
    await pg.waitReady;
    await pg.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)");
    const first = pg;
    db = new Kysely({ dialect: pgliteDialect(() => first) });
    await db.transaction().execute(async tx => {
      await sql`INSERT INTO evidence VALUES (1, 'committed')`.execute(tx);
    });
    await assert.rejects(db.transaction().execute(async tx => {
      await sql`INSERT INTO evidence VALUES (2, 'must rollback')`.execute(tx);
      throw new Error("reject transaction");
    }), /reject transaction/);
    assert.equal((await pg.query("SELECT * FROM evidence WHERE id=2")).rows.length, 0);
    await db.destroy(); db = undefined;
    await pg.close(); pg = undefined;
    pg = new PGlite({ dataDir });
    await pg.waitReady;
    const rows = (await pg.query<{ marker: string }>("SELECT marker FROM evidence ORDER BY id")).rows;
    assert.deepEqual(rows, [{ marker: "committed" }]);
  } finally {
    await db?.destroy();
    await pg?.close();
    if (resolve(root).startsWith(resolve(tmpdir()) + sep)) await rm(root, { recursive: true, force: true });
  }
});
