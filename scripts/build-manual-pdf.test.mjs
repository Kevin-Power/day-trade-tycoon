import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePdfArgs } from "./build-manual-pdf.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = join(root, "public", "daytrade-tycoon-manual.pdf");
const script = readFileSync(join(root, "scripts/build-manual-pdf.mjs"), "utf8");

test("parsePdfArgs defaults to local /manual print", () => {
  assert.deepEqual(parsePdfArgs([]), { start: false, url: "http://127.0.0.1:8080" });
  assert.equal(parsePdfArgs(["--start"]).start, true);
  assert.equal(parsePdfArgs(["--url", "http://127.0.0.1:8081"]).url, "http://127.0.0.1:8081");
});

test("PDF build script is the documented source of the static file", () => {
  assert.match(script, /\/manual/);
  assert.match(script, /daytrade-tycoon-manual\.pdf/);
  assert.match(script, /day-tycoon-gate-v1/);
});

test("static PDF exists for /manual download", () => {
  assert.equal(existsSync(pdf), true);
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
  assert.ok(statSync(pdf).size > 20_000);
});
