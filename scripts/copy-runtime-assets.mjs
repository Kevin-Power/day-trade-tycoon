import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".output/server/_libs");
if (!existsSync(join(root, ".output/server/index.mjs"))) throw new Error("Build the Node server first");
mkdirSync(output, { recursive: true });
// Nitro bundles PGlite JS; its WASM loaders resolve these relative to that chunk.
for (const name of ["pglite.wasm", "initdb.wasm", "pglite.data"]) {
  copyFileSync(join(root, "node_modules/@electric-sql/pglite/dist", name), join(output, name));
}
if (existsSync(join(root, "downloads/daytrade-tycoon-offline.zip"))) {
  mkdirSync(join(root, ".output/downloads"), { recursive: true });
  copyFileSync(join(root, "downloads/daytrade-tycoon-offline.zip"), join(root, ".output/downloads/daytrade-tycoon-offline.zip"));
}
console.log("Standalone database runtime assets copied.");
// Market-data worker is source-only. SDK, certificate and login settings stay
// outside the release; it cannot import or dispatch any application order code.
const feedWorker = join(root, ".output/server/fubon-live");
mkdirSync(join(feedWorker, "credentials"), { recursive: true });
copyFileSync(join(root, "tools/fubon-live/worker.py"), join(feedWorker, "worker.py"));
copyFileSync(join(root, "tools/fubon-daily/fubon_daily/credentials.py"), join(feedWorker, "credentials/credentials.py"));
