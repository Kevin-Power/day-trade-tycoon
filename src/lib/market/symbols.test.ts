import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TEACHING_SYMBOL_CODES,
  TEACHING_SYMBOL_COUNT,
  UNIVERSE,
  teachingOhlcNote,
  teachingSymbolsByMarket,
  teachingUniverseLine,
} from "./universe.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..", "..");
const pack = JSON.parse(readFileSync(join(root, "src/lib/market/symbols.json"), "utf8")) as {
  symbols: Array<{ code: string; market: string }>;
};
const paths = JSON.parse(readFileSync(join(root, "src/lib/market/real-paths.json"), "utf8")) as {
  stocks: Record<string, unknown>;
};
const lobby = readFileSync(join(root, "src/components/lobby.tsx"), "utf8");
const manual = readFileSync(join(root, "src/components/manual-page.tsx"), "utf8");

describe("teaching symbol SSOT", () => {
  it("keeps the current 17-name classroom set (not abandoned #2's 22)", () => {
    assert.equal(pack.symbols.length, 17);
    assert.equal(UNIVERSE.length, 17);
    assert.equal(TEACHING_SYMBOL_COUNT, 17);
    assert.equal(teachingSymbolsByMarket("tse").length, 16);
    assert.equal(teachingSymbolsByMarket("otc").length, 1);
    assert.equal(teachingSymbolsByMarket("otc")[0]?.code, "6488");
  });

  it("matches universe codes to real-paths.json 1:1", () => {
    const fromJson = pack.symbols.map((s) => s.code).sort();
    const fromUniverse = [...TEACHING_SYMBOL_CODES].sort();
    const fromPaths = Object.keys(paths.stocks).sort();
    assert.deepEqual(fromUniverse, fromJson);
    assert.deepEqual(fromPaths, fromJson);
    assert.equal(new Set(fromJson).size, fromJson.length);
  });

  it("derives lobby and manual copy from the same count", () => {
    assert.equal(teachingOhlcNote(), "釘在當日 O/H/L/C。17 檔權值與觀察股");
    assert.equal(teachingUniverseLine(), "自選 17 檔（上市 16、上櫃 1）");
    assert.match(lobby, /teachingUniverseLine/);
    assert.match(manual, /teachingOhlcNote/);
    assert.equal(manual.includes("17 檔權值與觀察股"), false);
  });
});
