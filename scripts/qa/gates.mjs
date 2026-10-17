// Runs the release gates one by one and records command, seconds, exit code and the log tail.
// Usage: node scripts/qa/gates.mjs <outDir> [gate ...]   (default: every gate below, in order)
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const GATES = ["ci", "check:auth", "check:symbols", "test", "typecheck", "lint", "build", "build:offline"];
const [outArg, ...picked] = process.argv.slice(2);
if (!outArg) throw new Error("Usage: node scripts/qa/gates.mjs <outDir> [gate ...]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const rows = [];
for (const gate of picked.length ? picked : GATES) {
  const command = gate === "ci" ? "npm ci" : `npm run ${gate}`;
  const started = Date.now();
  const result = spawnSync(command, { shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const file = `${gate.replace(/[^a-z0-9]+/gi, "-")}.log`;
  writeFileSync(join(out, file), log);
  const tail = log.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
  rows.push({ command, seconds, exitCode: result.status, log: file, tail });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"}  ${command}  (${seconds}s, exit ${result.status})`);
}
writeFileSync(join(out, "gates.json"), JSON.stringify(rows, null, 2));
process.exitCode = rows.every((row) => row.exitCode === 0) ? 0 : 1;
