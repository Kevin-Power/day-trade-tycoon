import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import {
  listRadarDates,
  marketDataDir,
  readBooks,
  readMorningTrades,
  readRadarList,
  readTaiexPoints,
  readTicksManifest,
  sha256File,
} from "./market-files.server.ts";
import { bookCell } from "./books.ts";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "lessons-files-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const put = async (dir: string, path: string, content: string | Buffer) => {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), content);
};
const putGz = (dir: string, path: string, value: unknown) => put(dir, path, gzipSync(JSON.stringify(value)));

const DAY = "2026-10-27";
const FIELDS = ["msAfter0900", "price", "size", "bid", "ask"];
const tickFile = (trades: unknown, extra: Record<string, unknown> = {}) => ({
  schema: 1,
  code: "2330",
  date: DAY,
  sizeUnit: "lot",
  fields: FIELDS,
  trades,
  afterHours: [[16_200_000, 1000, 9, null, null]],
  ...extra,
});

test("marketDataDir is MARKET_DATA_DIR trimmed, or empty", () => {
  const saved = process.env.MARKET_DATA_DIR;
  try {
    process.env.MARKET_DATA_DIR = "  /some/dir \n";
    assert.equal(marketDataDir(), "/some/dir");
    delete process.env.MARKET_DATA_DIR;
    assert.equal(marketDataDir(), "");
  } finally {
    if (saved === undefined) delete process.env.MARKET_DATA_DIR;
    else process.env.MARKET_DATA_DIR = saved;
  }
});

test("a day's morning trades are read, nothing from 10:30 on", () => fixture(async (dir) => {
  await putGz(dir, `ticks/${DAY}/symbols/2330.json.gz`, tickFile([
    [0, 100, 3, 99.5, 100],
    [59_999, 100.5, 1, null, 100.5],
    [5_399_999, 101, 2, 100.5, 101],
    [5_400_000, 102, 7, 101, 102],
    [8_000_000, 103, 1, null, null],
    ["junk after the morning"],
  ]));
  assert.deepEqual(await readMorningTrades(dir, DAY, "2330"), [
    [0, 100, 3, 99.5, 100],
    [59_999, 100.5, 1, null, 100.5],
    [5_399_999, 101, 2, 100.5, 101],
  ]);
  await putGz(dir, `ticks/${DAY}/symbols/2317.json.gz`, tickFile([[5_400_000, 102, 7, null, null]], { code: "2317" }));
  assert.deepEqual(await readMorningTrades(dir, DAY, "2317"), []);
}));

test("trades that break the rules read as no data", () => fixture(async (dir) => {
  const bad: [string, unknown[]][] = [
    ["2330", [[1000, 100, 1, null, null], [999, 100, 1, null, null]]], // time goes back
    ["2331", [[1000, 0, 1, null, null]]], // price
    ["2332", [[1000, -5, 1, null, null]]],
    ["2333", [[1000, 100, 0, null, null]]], // size
    ["2334", [[1000, 100, 1.5, null, null]]],
    ["2335", [[1000, 100, 1, 0, null]]], // bid
    ["2336", [[1000, 100, 1, null, "101"]]], // ask
    ["2337", [[1000, 100, 1]]], // a short row
    ["2338", [[-1, 100, 1, null, null]]], // before 09:00
    ["2339", [[1000.5, 100, 1, null, null]]],
    ["2340", ["x"]],
    ["2341", [null]],
  ];
  for (const [code, trades] of bad) {
    await putGz(dir, `ticks/${DAY}/symbols/${code}.json.gz`, tickFile(trades, { code }));
    assert.equal(await readMorningTrades(dir, DAY, code), null, code);
  }
  await putGz(dir, `ticks/${DAY}/symbols/2400.json.gz`, tickFile([[1000, 100, 1, null, null]], { code: "2400", sizeUnit: "share" }));
  await putGz(dir, `ticks/${DAY}/symbols/2401.json.gz`, tickFile([[1000, 100, 1, null, null]], { code: "2401", schema: 2 }));
  await putGz(dir, `ticks/${DAY}/symbols/2402.json.gz`, tickFile([[1000, 100, 1, null, null]], { code: "2402", fields: ["t", "p"] }));
  await putGz(dir, `ticks/${DAY}/symbols/2403.json.gz`, tickFile([[1000, 100, 1, null, null]], { code: "2330" })); // another stock's file
  await putGz(dir, `ticks/${DAY}/symbols/2404.json.gz`, tickFile([[1000, 100, 1, null, null]], { code: "2404", date: "2026-10-26" }));
  await putGz(dir, `ticks/${DAY}/symbols/2405.json.gz`, tickFile("many", { code: "2405" }));
  await putGz(dir, `ticks/${DAY}/symbols/2406.json.gz`, null);
  for (const code of ["2400", "2401", "2402", "2403", "2404", "2405", "2406"]) assert.equal(await readMorningTrades(dir, DAY, code), null, code);
}));

test("bad gzip → null", () => fixture(async (dir) => {
  await put(dir, `ticks/${DAY}/symbols/2330.json.gz`, "not gzip");
  await put(dir, `ticks/${DAY}/symbols/2317.json.gz`, gzipSync("{not json"));
  await put(dir, `ticks/${DAY}/symbols/2454.json.gz`, gzipSync(JSON.stringify(tickFile([[1000, 100, 1, null, null]]))).subarray(0, 20));
  await put(dir, `books/${DAY}/symbols/2330.json.gz`, "not gzip");
  await put(dir, `taiex/${DAY}/points.json`, "{not json");
  await put(dir, `ticks/${DAY}/manifest.json`, "{not json");
  await put(dir, `radar/${DAY}.json`, "{not json");
  for (const code of ["2330", "2317", "2454"]) assert.equal(await readMorningTrades(dir, DAY, code), null, code);
  assert.equal(await readBooks(dir, DAY, "2330"), null);
  assert.equal(await readTaiexPoints(dir, DAY), null);
  assert.equal(await readTicksManifest(dir, DAY), null);
  assert.equal(await readRadarList(dir, DAY), null);
}));

test("missing files read as no data", () => fixture(async (dir) => {
  assert.equal(await readMorningTrades(dir, DAY, "2330"), null);
  assert.equal(await readTicksManifest(dir, DAY), null);
  assert.equal(await readTaiexPoints(dir, DAY), null);
  assert.equal(await readRadarList(dir, DAY), null);
  assert.equal(await readBooks(dir, DAY, "2330"), null);
  assert.deepEqual(await listRadarDates(dir), []);
  assert.equal(await sha256File(join(dir, "nothing.json")), null);
  assert.equal(await sha256File(dir), null); // a folder
}));

test("bad date or code → null", () => fixture(async (dir) => {
  await putGz(dir, `ticks/${DAY}/symbols/2330.json.gz`, tickFile([[1000, 100, 1, null, null]]));
  await put(dir, `ticks/${DAY}/manifest.json`, JSON.stringify({ schema: 1, date: DAY, symbols: [{ code: "2330", complete: true }] }));
  await put(dir, `taiex/${DAY}/points.json`, JSON.stringify({ schema: 1, date: DAY, previousClose: 100, points: [[0, 100]] }));
  await put(dir, `radar/${DAY}.json`, JSON.stringify({ schema: 1, date: DAY, kind: "當沖", symbols: [] }));
  assert.notEqual(await readMorningTrades(dir, DAY, "2330"), null);
  for (const date of ["2026-10-2", "20261027", "../2026-10-27", `${DAY}/..`, "", "2026-10-27\0"]) {
    assert.equal(await readMorningTrades(dir, date, "2330"), null, date);
    assert.equal(await readTicksManifest(dir, date), null, date);
    assert.equal(await readTaiexPoints(dir, date), null, date);
    assert.equal(await readRadarList(dir, date), null, date);
    assert.equal(await readBooks(dir, date, "2330"), null, date);
  }
  for (const code of ["", "233", "../2330", "2330/../2330", "ABCD", "2330\0", "1234567"]) {
    assert.equal(await readMorningTrades(dir, DAY, code), null, code);
    assert.equal(await readBooks(dir, DAY, code), null, code);
  }
}));

test("the ticks manifest keeps each stock's code and whether it is complete", () => fixture(async (dir) => {
  await put(dir, `ticks/${DAY}/manifest.json`, String.fromCharCode(0xfeff) + JSON.stringify({
    schema: 1,
    date: DAY,
    createdAt: "2026-10-27T18:00:00+08:00",
    symbols: [
      { code: "2330", name: "台積電", trades: 100, volume: 500, close: 1000, complete: true, afterHours: { trades: 1, volume: 9 } },
      { code: "2317", name: "鴻海", trades: 10, volume: 50, close: 100, complete: false, note: "x" },
      { code: 5, complete: true }, // malformed entries are left out
      { code: "2454" },
      null,
    ],
    rejected: [{ code: "9999", error: "x" }],
    files: [],
  }));
  assert.deepEqual(await readTicksManifest(dir, DAY), {
    date: DAY,
    symbols: [{ code: "2330", complete: true }, { code: "2317", complete: false }],
  });
}));

test("a ticks manifest of another day, of the wrong shape or with no usable stock is no data", () => fixture(async (dir) => {
  const write = (name: string, value: unknown) => put(dir, `ticks/${name}/manifest.json`, JSON.stringify(value));
  await write("2026-10-26", { schema: 1, date: DAY, symbols: [] });
  await write("2026-10-25", { schema: 2, date: "2026-10-25", symbols: [] });
  await write("2026-10-24", { schema: 1, date: "2026-10-24", symbols: "x" });
  await write("2026-10-23", { schema: 1, date: "2026-10-23", symbols: [{ code: "x" }, null] });
  await write("2026-10-22", { schema: 1, date: "2026-10-22", symbols: [] });
  for (const date of ["2026-10-26", "2026-10-25", "2026-10-24", "2026-10-23"]) assert.equal(await readTicksManifest(dir, date), null, date);
  assert.deepEqual(await readTicksManifest(dir, "2026-10-22"), { date: "2026-10-22", symbols: [] });
}));

test("TAIEX points are read with the previous close", () => fixture(async (dir) => {
  const points = [[0, 20_000], [5, 20_010.5], [10, 20_011]];
  await put(dir, `taiex/${DAY}/points.json`, JSON.stringify({ schema: 1, date: DAY, source: "twse MI_5MINS_INDEX", previousClose: 20_000, points }));
  assert.deepEqual(await readTaiexPoints(dir, DAY), { previousClose: 20_000, points });
  const bad = (value: unknown) => put(dir, "taiex/2026-10-26/points.json", JSON.stringify(value));
  const base = { schema: 1, date: "2026-10-26", previousClose: 20_000, points };
  for (const value of [
    { ...base, schema: 2 },
    { ...base, date: DAY },
    { ...base, previousClose: 0 },
    { ...base, previousClose: "20000" },
    { ...base, points: "x" },
    { ...base, points: [[0, 20_000], [5]] },
    { ...base, points: [[0, 20_000], [5, 0]] },
    { ...base, points: [[0, 20_000], [5, null]] },
    { ...base, points: [[0, 20_000], ["5", 1]] },
    { ...base, points: [[0, 20_000], null] },
  ]) {
    await bad(value);
    assert.equal(await readTaiexPoints(dir, "2026-10-26"), null, JSON.stringify(value).slice(0, 80));
  }
}));

test("radar dates sorted ascending and invalid names ignored", () => fixture(async (dir) => {
  const list = (date: string) => JSON.stringify({ schema: 1, date, kind: "當沖", symbols: [] });
  for (const name of ["2026-10-27", "2026-10-20", "2026-10-26"]) await put(dir, `radar/${name}.json`, list(name));
  for (const name of ["notes.txt", "2026-10-21.json.tmp", ".2026-10-22.json", "2026-1-22.json", "20261022.json", "2026-10-22.JSON", "x2026-10-22.json", "2026-10-22.json.bak"]) {
    await put(dir, `radar/${name}`, "{}");
  }
  await mkdir(join(dir, "radar/2026-10-24.json"), { recursive: true }); // a folder is not a list
  assert.deepEqual(await listRadarDates(dir), ["2026-10-20", "2026-10-26", "2026-10-27"]);
}));

test("a radar list is code and name per stock", () => fixture(async (dir) => {
  const symbols = [{ code: "2330", name: "台積電" }, { code: "6488", name: "環球晶" }, { code: "2330", name: "台積電" }];
  await put(dir, `radar/${DAY}.json`, JSON.stringify({
    schema: 1,
    date: DAY,
    kind: "當沖",
    fetchedAt: "2026-10-27T19:00:00+08:00",
    sha256: "abc",
    symbols,
  }));
  // Duplicates and unknown codes are for the caller to judge; the file is read as it is.
  assert.deepEqual(await readRadarList(dir, DAY), { date: DAY, symbols });
  const write = (value: unknown) => put(dir, "radar/2026-10-26.json", JSON.stringify(value));
  const base = { schema: 1, date: "2026-10-26", kind: "當沖", symbols };
  for (const value of [
    { ...base, schema: 2 },
    { ...base, kind: "其他" },
    { ...base, date: DAY },
    { ...base, symbols: "x" },
    { ...base, symbols: [{ code: "2330" }] },
    { ...base, symbols: [{ code: 2330, name: "台積電" }] },
    { ...base, symbols: [null] },
    [],
    null,
  ]) {
    await write(value);
    assert.equal(await readRadarList(dir, "2026-10-26"), null, JSON.stringify(value)?.slice(0, 80));
  }
}));

test("recorded books are read with their size unit", () => fixture(async (dir) => {
  await putGz(dir, `books/${DAY}/symbols/2330.json.gz`, {
    schema: 1,
    code: "2330",
    date: DAY,
    sizeUnit: "unverified",
    keyEvery: 60_000,
    rows: [[1000, 4, [[[100, 10]], [[101, 5]]]], [500, 8, [[0, 100, 11]]]],
    gaps: [],
  });
  const books = (await readBooks(dir, DAY, "2330"))!;
  assert.equal(books.sizeUnit, "unverified");
  assert.deepEqual(bookCell(books.timeline, 0).frames, [
    [1000, { bids: [[100, 10]], asks: [[101, 5]] }],
    [1500, { bids: [[100, 11]], asks: [[101, 5]] }],
  ]);
  // Another stock's or another day's file, a bad row or a missing unit are no books.
  await putGz(dir, `books/${DAY}/symbols/2317.json.gz`, { schema: 1, code: "2330", date: DAY, sizeUnit: "lot", rows: [], gaps: [] });
  await putGz(dir, `books/${DAY}/symbols/2454.json.gz`, { schema: 1, code: "2454", date: "2026-10-26", sizeUnit: "lot", rows: [], gaps: [] });
  await putGz(dir, `books/${DAY}/symbols/2412.json.gz`, { schema: 1, code: "2412", date: DAY, sizeUnit: "lot", rows: [[1, 0, [[10, 100, 1]]]], gaps: [] });
  await putGz(dir, `books/${DAY}/symbols/2303.json.gz`, { schema: 1, code: "2303", date: DAY, rows: [], gaps: [] });
  for (const code of ["2317", "2454", "2412", "2303"]) assert.equal(await readBooks(dir, DAY, code), null, code);
}));

test("sha256File is the hex digest of the file", () => fixture(async (dir) => {
  await put(dir, "manifest.json", "abc");
  assert.equal(await sha256File(join(dir, "manifest.json")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  await put(dir, "empty", "");
  assert.equal(await sha256File(join(dir, "empty")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}));
