import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("check:symbols exits 0 on the current teaching set", () => {
  const r = spawnSync(process.execPath, [join(root, "scripts/check-symbols.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /17 檔/);
});
