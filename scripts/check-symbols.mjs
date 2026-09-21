#!/usr/bin/env node
/**
 * Teaching-universe SSOT check.
 * Source of truth: src/lib/market/symbols.json (current 17 names).
 * Do not expand to the abandoned #2 22-name pack unless product decides so.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(readFileSync(join(root, "src/lib/market/symbols.json"), "utf8"));
const paths = JSON.parse(readFileSync(join(root, "src/lib/market/real-paths.json"), "utf8"));
const lobby = readFileSync(join(root, "src/components/lobby.tsx"), "utf8");
const manual = readFileSync(join(root, "src/components/manual-page.tsx"), "utf8");

const errors = [];
const symbols = pack.symbols ?? [];
const codes = symbols.map((s) => s.code);

if (codes.length !== 17) {
  errors.push(`symbols.json 應為教室現況 17 檔，實際 ${codes.length}（不要默默改成 #2 的 22）`);
}
if (new Set(codes).size !== codes.length) errors.push("symbols.json 代號重複");

const pathCodes = Object.keys(paths.stocks ?? {}).sort();
const ssot = [...codes].sort();
if (pathCodes.join(",") !== ssot.join(",")) {
  errors.push(`real-paths.json 代號與 symbols.json 不一致\n  SSOT ${ssot.join(" ")}\n  PATH ${pathCodes.join(" ")}`);
}

const otc = symbols.filter((s) => s.market === "otc");
if (otc.length !== 1 || otc[0]?.code !== "6488") {
  errors.push("上櫃應只有 6488 環球晶（現況 1 檔，不是缺表）");
}

if (!lobby.includes("teachingUniverseLine")) {
  errors.push("lobby.tsx 必須用 teachingUniverseLine()，不要寫死檔數");
}
if (!manual.includes("teachingOhlcNote")) {
  errors.push("manual-page.tsx 必須用 teachingOhlcNote()，不要寫死「17 檔」");
}
if (manual.includes("17 檔權值與觀察股")) {
  errors.push("manual-page.tsx 仍寫死 17 檔，應改讀 SSOT");
}

if (errors.length) {
  console.error("標的 SSOT 自檢失敗：");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log(`標的 SSOT 通過：${codes.length} 檔，大廳／說明書／real-paths 同一組代號`);
