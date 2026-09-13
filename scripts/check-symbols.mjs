#!/usr/bin/env node
/**
 * P0-1 boot check: every K-line file's code is in symbols.json,
 * and the first session close is within ±50% of refPrice.
 * data/symbols.json and src/lib/market/symbols.json must match (SSOT).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataPack = JSON.parse(readFileSync(join(root, "data/symbols.json"), "utf8"));
const srcPack = JSON.parse(readFileSync(join(root, "src/lib/market/symbols.json"), "utf8"));
const paths = JSON.parse(readFileSync(join(root, "src/lib/market/real-paths.json"), "utf8"));

function keyOf(s) {
  return [s.code, s.name, s.sector, s.sectorLabel, s.market, Number(s.refPrice)].join("|");
}

const dataKeys = (dataPack.symbols ?? []).map(keyOf).sort();
const srcKeys = (srcPack.symbols ?? []).map(keyOf).sort();
const errors = [];

if (dataKeys.length !== 22) errors.push(`data/symbols.json 應為 22 檔，實際 ${dataKeys.length}`);
if (srcKeys.join("\n") !== dataKeys.join("\n")) {
  errors.push("data/symbols.json 與 src/lib/market/symbols.json 不一致（名稱／族群／量級必須同一來源）");
}

const byCode = new Map(dataPack.symbols.map((s) => [s.code, s]));
const qiHong = byCode.get("3017");
if (!qiHong || qiHong.name !== "奇鋐") errors.push("3017 必須是奇鋐");
if (qiHong && Number(qiHong.refPrice) < 500) errors.push("3017 奇鋐 refPrice 應為千元級，不是 48 元");
const xinxing = byCode.get("2605");
if (!xinxing || xinxing.name !== "新興") errors.push("2605 必須是新興");
if (xinxing && Math.abs(Number(xinxing.refPrice) - 48.2) > 5) errors.push("48.20 量級應屬於 2605 新興");

for (const [code, days] of Object.entries(paths.stocks ?? {})) {
  const sym = byCode.get(code);
  if (!sym) {
    errors.push(`K 線 ${code} 不在 symbols.json`);
    continue;
  }
  const first = days.wed ?? days.tue ?? days.mon;
  const close = first?.close ?? first?.open ?? 0;
  const ref = Number(sym.refPrice);
  if (!(ref > 0) || !(close > 0)) {
    errors.push(`${code} ${sym.name} 缺收盤或 refPrice`);
    continue;
  }
  const ratio = close / ref;
  if (ratio < 0.5 || ratio > 1.5) {
    errors.push(
      `${code} ${sym.name} 教材收盤 ${close} 與 refPrice ${ref} 差距超過 ±50%（可能貼錯代號）`,
    );
  }
}

for (const s of dataPack.symbols) {
  if (!paths.stocks?.[s.code]) {
    errors.push(`symbols.json ${s.code} ${s.name} 沒有對應 K 線`);
  }
}

if (errors.length) {
  console.error("P0-1 資料自檢失敗：");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log(`P0-1 通過：${dataPack.symbols.length} 檔名稱／量級一致`);
