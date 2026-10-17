import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { listPublishedDays, readDaySymbols, readSymbolBars } from "./market-days.server.ts";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "market-days-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const day = { date: "2026-10-14", coverage: "full-market", symbols: 1, manifestSha256: "x", publishedAt: "2026-10-14T18:00:00+08:00" };
const symbol = { code: "2330", name: "台積電", referencePrice: 100, close: 101, change: 1, tradeVolume: 500, tradeValue: 50_000_000, disposition: false, bars: 2 };

test("published days, a day's symbols and one symbol's bars are read back", () => fixture(async (dir) => {
  await writeFile(join(dir, "index.json"), "﻿" + JSON.stringify({ schema: 1, days: [day, { ...day, date: "2026-10-13" }] }));
  await mkdir(join(dir, "days/2026-10-14/symbols"), { recursive: true });
  await writeFile(join(dir, "days/2026-10-14/index.json"), JSON.stringify({ schema: 1, date: "2026-10-14", symbols: [symbol] }));
  await writeFile(join(dir, "days/2026-10-14/symbols/2330.json.gz"),
    gzipSync(JSON.stringify({ schema: 1, code: "2330", bars: [[0, 100, 101, 99, 100.5, 10, 100.2], [60, 100.5, 101, 100, 101, 5, 100.6]] })));
  assert.deepEqual((await listPublishedDays(dir)).map((value) => value.date), ["2026-10-13", "2026-10-14"]);
  assert.equal((await readDaySymbols(dir, "2026-10-14"))![0].name, "台積電");
  assert.deepEqual((await readSymbolBars(dir, "2026-10-14", "2330"))![1], [60, 100.5, 101, 100, 101, 5, 100.6]);
}));

test("missing or broken files read as no data, never as an error", () => fixture(async (dir) => {
  assert.deepEqual(await listPublishedDays(dir), []);
  assert.equal(await readDaySymbols(dir, "2026-10-14"), null);
  await mkdir(join(dir, "days/2026-10-14/symbols"), { recursive: true });
  await writeFile(join(dir, "days/2026-10-14/symbols/2330.json.gz"), "not gzip");
  assert.equal(await readSymbolBars(dir, "2026-10-14", "2330"), null);
}));

test("dates and codes cannot step outside the data folder", () => fixture(async (dir) => {
  assert.equal(await readSymbolBars(dir, "2026-10-14", "../x"), null);
  assert.equal(await readDaySymbols(dir, "../../etc"), null);
}));
