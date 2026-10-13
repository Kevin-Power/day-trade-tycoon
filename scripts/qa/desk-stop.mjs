// Asks a running desk-server to close its database cleanly.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = process.argv[2] ?? "18811";
const project = fileURLToPath(new URL("../..", import.meta.url));
const { runtime } = JSON.parse(
  readFileSync(join(project, `artifacts/trading-desk-qa/server-${port}.json`), "utf8"),
);
writeFileSync(join(runtime, "stop-request"), "");
console.log(`Stop requested for ${runtime}`);
