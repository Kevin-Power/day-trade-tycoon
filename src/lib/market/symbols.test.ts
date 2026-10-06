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
  CATALOGUE_COUNT,
  searchStocks,
  lookupStock,
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
  it("preserves searchable catalogue identity and rejects nonexistent symbols", () => {
    assert.equal(CATALOGUE_COUNT, 1979);
    assert.ok(searchStocks("友達").some(s => s.code === "2409"));
    assert.ok(searchStocks("0050").some(s => s.name === "元大台灣50"));
    assert.equal(lookupStock("not-a-stock"), undefined);
    assert.ok((lookupStock("0050")?.prevClose ?? 0) > 0);
  });
  it("preserves the recovered live 24-name classroom set", () => {
    assert.equal(pack.symbols.length, 24);
    assert.equal(UNIVERSE.length, 24);
    assert.equal(TEACHING_SYMBOL_COUNT, 24);
    assert.equal(teachingSymbolsByMarket("tse").length, 22);
    assert.equal(teachingSymbolsByMarket("otc").length, 2);
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

  it("keeps archived counts without advertising those daily-only names as active minute data", () => {
    assert.equal(teachingOhlcNote(), "釘在當日 O/H/L/C。24 檔權值與觀察股");
    assert.equal(teachingUniverseLine(), "自選 24 檔（上市 22、上櫃 2）");
    assert.match(lobby, /teachingUniverseLine/);
    assert.doesNotMatch(manual, /teachingOhlcNote/);
    assert.match(manual, /待補.*真實個股分鐘行情/);
    assert.equal(manual.includes("17 檔權值與觀察股"), false);
  });
});
