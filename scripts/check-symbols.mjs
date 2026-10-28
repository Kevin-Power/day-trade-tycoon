#!/usr/bin/env node
/**
 * Check the preserved archive symbols (the online classroom's 24 stocks). The daily lessons carry their own stocks,
 * read at run time from the Fubon market-data folder; the retired Yahoo lessons are not read any more.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(readFileSync(join(root, "src/lib/market/symbols.json"), "utf8"));
const paths = JSON.parse(readFileSync(join(root, "src/lib/market/real-paths.json"), "utf8"));
const manual = readFileSync(join(root, "src/components/manual-page.tsx"), "utf8");

const errors = [];
const symbols = pack.symbols ?? [];
const codes = symbols.map((s) => s.code);

if (codes.length !== 24) {
  errors.push(`symbols.json 應保留線上教室 24 檔，實際 ${codes.length}`);
}
if (new Set(codes).size !== codes.length) errors.push("symbols.json 代號重複");

const pathCodes = Object.keys(paths.stocks ?? {}).sort();
const ssot = [...codes].sort();
if (pathCodes.join(",") !== ssot.join(",")) {
  errors.push(`real-paths.json 代號與 symbols.json 不一致\n  SSOT ${ssot.join(" ")}\n  PATH ${pathCodes.join(" ")}`);
}

const otc = symbols.filter((s) => s.market === "otc");
if (otc.map(s => s.code).sort().join(',') !== '6223,6488') {
  errors.push("教學上櫃名單應包含 6223 旺矽與 6488 環球晶");
}

if (manual.includes("17 檔權值與觀察股")) {
  errors.push("manual-page.tsx 仍寫死 17 檔，應改讀 SSOT");
}

if (errors.length) {
  console.error("標的 SSOT 自檢失敗：");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log(`標的 SSOT 通過：歷史封存 ${codes.length} 檔`);
