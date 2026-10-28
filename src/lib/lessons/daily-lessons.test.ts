import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import type { MarketBarRow } from "../market-days.server.ts";
import { MorningError } from "../morning-engine.ts";
import {
  FIRST_LESSON_DAY,
  TRADE_CACHE_LIMIT,
  buildRunSource,
  cachedTradeCount,
  clearLessonCaches,
  lessonIdFor,
  lessonPicker,
  listLessonDays,
  parseLessonId,
  runBookCell,
  setTradeCacheLimit,
} from "./daily-lessons.server.ts";
import type { TradeRow } from "./trades.ts";

// A small market-data folder made in code: root index.json, days/ (index, 1-minute bars, manifest), ticks/
// (manifest, trades), taiex/, radar/ and books/, in the formats tools/fubon-daily writes.

async function fixture(run: (dir: string) => Promise<void>) {
  clearLessonCaches();
  const dir = await mkdtemp(join(tmpdir(), "daily-lessons-test-"));
  try {
    await run(dir);
  } finally {
    clearLessonCaches();
    await rm(dir, { recursive: true, force: true });
  }
}
const put = async (dir: string, path: string, content: string | Buffer) => {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), content);
};
const putGz = (dir: string, path: string, value: unknown) => put(dir, path, gzipSync(JSON.stringify(value)));
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const NAMES: Record<string, string> = {
  "2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2603": "長榮", "1101": "台泥", "2002": "中鋼", "2881": "富邦金",
  "2882": "國泰金", "2883": "凱基金", "2886": "兆豐金", "2891": "中信金", "6488": "環球晶", "00878": "國泰永續高股息",
};

type Stock = {
  code: string;
  name?: string;
  referencePrice?: number;
  close?: number;
  change?: number;
  tradeValue?: number;
  disposition?: boolean;
  /** Morning trades; by default two, in the first two minutes. */
  trades?: TradeRow[];
  /** The 1-minute bars; by default made from the trades, so the two agree. */
  bars?: MarketBarRow[];
  /** The ticks manifest's flag (the trades file is written either way). */
  complete?: boolean;
};

const defaultTrades = (price: number): TradeRow[] => [
  [1_000, price, 2, price - 0.5, price],
  [61_000, price + 0.5, 3, price, price + 0.5],
];

function barsFrom(trades: readonly TradeRow[]): MarketBarRow[] {
  const minutes = new Map<number, TradeRow[]>();
  for (const trade of trades) {
    const minute = Math.floor(trade[0] / 60_000);
    minutes.set(minute, [...(minutes.get(minute) ?? []), trade]);
  }
  return [...minutes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, rows]) => {
      const prices = rows.map((row) => row[1]);
      const volume = rows.reduce((sum, row) => sum + row[2], 0);
      const value = rows.reduce((sum, row) => sum + row[1] * row[2], 0);
      return [minute * 60, prices[0], Math.max(...prices), Math.min(...prices), prices[prices.length - 1], volume, value / volume];
    });
}

const taiexPoints = () => Array.from({ length: 1081 }, (_, step) => [step * 5, 20_000 + step]);

async function addToIndex(dir: string, entry: Record<string, unknown>) {
  let index: { schema: number; days: Record<string, unknown>[] } = { schema: 1, days: [] };
  try {
    index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
  } catch {
    // first day of the folder
  }
  index.days = [...index.days.filter((day) => day.date !== entry.date), entry];
  await put(dir, "index.json", JSON.stringify(index));
}

async function writeDay(dir: string, date: string, stocks: Stock[], options: { coverage?: string; ticks?: boolean; taiex?: boolean } = {}) {
  const coverage = options.coverage ?? "full-market";
  const symbols = stocks.map((stock) => {
    const referencePrice = stock.referencePrice ?? 100;
    const close = stock.close ?? referencePrice + 1;
    return {
      code: stock.code,
      name: stock.name ?? NAMES[stock.code] ?? `股${stock.code}`,
      referencePrice,
      close,
      change: stock.change ?? close - referencePrice,
      tradeVolume: 10,
      tradeValue: stock.tradeValue ?? 1_000_000,
      disposition: stock.disposition ?? false,
      bars: 2,
    };
  });
  await put(dir, `days/${date}/index.json`, JSON.stringify({ schema: 1, date, coverage, volumeUnit: "lot", symbols }));
  for (const stock of stocks) {
    const trades = stock.trades ?? defaultTrades(stock.referencePrice ?? 100);
    const afternoonBar: MarketBarRow = [7_200, 1, 1, 1, 1, 1, 1];
    await putGz(dir, `days/${date}/symbols/${stock.code}.json.gz`, {
      schema: 1, code: stock.code, date, volumeUnit: "lot", bars: [...(stock.bars ?? barsFrom(trades)), afternoonBar],
    });
    if (options.ticks === false) continue;
    await putGz(dir, `ticks/${date}/symbols/${stock.code}.json.gz`, {
      schema: 1, code: stock.code, date, sizeUnit: "lot", fields: ["msAfter0900", "price", "size", "bid", "ask"],
      trades: [...trades, [7_200_000, 1, 1, null, null]], afterHours: [],
    });
  }
  if (options.ticks !== false) {
    await put(dir, `ticks/${date}/manifest.json`, JSON.stringify({
      schema: 1, date, sizeUnit: "lot", symbols: stocks.map((stock) => ({ code: stock.code, complete: stock.complete !== false })),
    }));
  }
  if (options.taiex) await put(dir, `taiex/${date}/points.json`, JSON.stringify({ schema: 1, date, previousClose: 20_000, points: taiexPoints() }));
  const manifest = JSON.stringify({ schema: 1, date, coverage, codes: stocks.map((stock) => stock.code) });
  await put(dir, `days/${date}/manifest.json`, manifest);
  await addToIndex(dir, { date, coverage, symbols: stocks.length, manifestSha256: sha256(manifest), publishedAt: `${date}T17:10:00+08:00` });
}

const putRadar = (dir: string, date: string, codes: string[]) =>
  put(dir, `radar/${date}.json`, JSON.stringify({
    schema: 1, date, kind: "當沖", fetchedAt: `${date}T19:00:00+08:00`, sha256: "x",
    symbols: codes.map((code) => ({ code, name: NAMES[code] ?? `股${code}` })),
  }));

async function putBooks(dir: string, date: string, sizeUnit: string, files: Record<string, { rows: unknown[]; gaps: unknown[] }>) {
  await put(dir, `books/${date}/manifest.json`, JSON.stringify({ schema: 1, date, sizeUnit, symbols: Object.keys(files).map((code) => ({ code })) }));
  for (const [code, file] of Object.entries(files)) {
    await putGz(dir, `books/${date}/symbols/${code}.json.gz`, { schema: 1, code, date, sizeUnit: "unverified", keyEvery: 60_000, ...file });
  }
}

const SIX: Stock[] = [
  { code: "2330", referencePrice: 1000, tradeValue: 9_000_000 },
  { code: "2317", referencePrice: 200, tradeValue: 8_000_000 },
  { code: "2454", referencePrice: 1200, tradeValue: 7_000_000 },
  { code: "2603", referencePrice: 180, tradeValue: 6_000_000 },
  { code: "1101", referencePrice: 30, tradeValue: 5_000_000 },
  { code: "2002", referencePrice: 20, tradeValue: 4_000_000 },
];
const NO_LIST = "前一交易日沒有熱門當沖名單，改用成交值前 5 名";
const isConflict = (code: string) => (error: unknown) =>
  error instanceof MorningError && error.status === 409 && error.message.includes(code);

test("lesson ids are fubon-YYYYMMDD-am and nothing else parses", () => {
  assert.equal(FIRST_LESSON_DAY, "2026-10-21");
  assert.equal(lessonIdFor("2026-10-27"), "fubon-20261027-am");
  assert.equal(parseLessonId("fubon-20261027-am"), "2026-10-27");
  for (const id of [
    "fubon-20261027-day", "fubon-2026102-am", "morning-20261006-v1-ce4a95ce69f1", "fubon-20261332-am", "fubon-20260230-am",
    " fubon-20261027-am", "fubon-20261027-am ", "", "fubon--am",
  ]) {
    assert.equal(parseLessonId(id), null, id);
  }
});

test("listLessonDays excludes days before 10/21, selected coverage, missing ticks, fewer than 5 stocks", () => fixture(async (dir) => {
  const five = SIX.slice(0, 5);
  await writeDay(dir, "2026-10-20", five); // before the first lesson day
  await writeDay(dir, "2026-10-21", five);
  await writeDay(dir, "2026-10-22", five, { coverage: "selected" });
  await writeDay(dir, "2026-10-26", five, { ticks: false });
  // Four practisable: each other stock fails one rule, so any rule left out would make it five.
  await writeDay(dir, "2026-10-27", [
    ...SIX.slice(0, 4),
    { ...SIX[4], complete: false },
    { code: "6488", tradeValue: 9_500_000 }, // 上櫃
    { code: "2002", trades: [] }, // no trade in the morning
    { code: "00878" }, // not a 4-digit code
  ]);
  await writeDay(dir, "2026-10-28", SIX);
  assert.deepEqual(await listLessonDays(dir), ["2026-10-28", "2026-10-21"]);
  assert.deepEqual(await listLessonDays(dir), ["2026-10-28", "2026-10-21"]); // cached answers are the same
  assert.deepEqual(await listLessonDays(""), []);
  for (const date of ["2026-10-20", "2026-10-22", "2026-10-26", "2026-10-27", "2026-10-29", "../2026-10-28"]) {
    assert.equal(await lessonPicker(dir, date, { guest: false }), null, date);
  }
  assert.equal(await lessonPicker("", "2026-10-28", { guest: false }), null);
  await assert.rejects(buildRunSource(dir, "2026-10-27", ["2330"]), (error) => error instanceof MorningError && error.status === 400);
}));

test("picker never includes close, change or tradeValue of the lesson day", () => fixture(async (dir) => {
  await writeDay(dir, "2026-10-27", SIX.map((stock, index) => ({ ...stock, tradeValue: 111_000_000 + index })));
  await writeDay(dir, "2026-10-28", [
    ...SIX.slice(1),
    { code: "2330", referencePrice: 1000, close: 1234.5, change: 234.5, tradeValue: 987_654_321 },
    { code: "2881", referencePrice: 60, close: 61.25, change: 1.25, tradeValue: 55_555_555 }, // not traded the day before
  ]);
  const picker = (await lessonPicker(dir, "2026-10-28", { guest: false }))!;
  const json = JSON.stringify(picker);
  for (const hidden of ["1234.5", "234.5", "987654321", "61.25", "55555555", '"close"', '"change"', '"tradeValue"', '"rank"']) {
    assert.equal(json.includes(hidden), false, hidden);
  }
  assert.deepEqual(Object.keys(picker).sort(), ["booksAvailable", "date", "defaults", "lessonId", "note", "symbols", "taiexAvailable"]);
  assert.equal(picker.lessonId, "fubon-20261028-am");
  assert.equal(picker.date, "2026-10-28");
  assert.deepEqual(picker.symbols.map((symbol) => symbol.code), ["1101", "2002", "2317", "2330", "2454", "2603", "2881"]);
  for (const symbol of picker.symbols) {
    assert.deepEqual(Object.keys(symbol).sort(), ["code", "disposition", "name", "previousValue", "referencePrice"]);
  }
  assert.deepEqual(picker.symbols.find((symbol) => symbol.code === "2330"), {
    code: "2330", name: "台積電", referencePrice: 1000, previousValue: 111_000_000, disposition: false,
  });
  assert.equal(picker.symbols.find((symbol) => symbol.code === "2881")!.previousValue, null);
  // The top 5 by the day's turnover go out as codes in code order: no rank, no amount.
  assert.deepEqual(picker.defaults, ["2317", "2330", "2454", "2603", "2881"]);
  assert.deepEqual(picker.note, { title: NO_LIST, detail: null });
  assert.equal(picker.taiexAvailable, false);
  assert.equal(picker.booksAvailable, false);
  await put(dir, "taiex/2026-10-28/points.json", JSON.stringify({ schema: 1, date: "2026-10-28", previousClose: 20_000, points: taiexPoints() }));
  assert.equal((await lessonPicker(dir, "2026-10-28", { guest: false }))!.taiexAvailable, true);
}));

test("picker defaults: radar list, OTC counted, guest gets top5 without radar fields", () => fixture(async (dir) => {
  await writeDay(dir, "2026-10-27", SIX);
  await writeDay(dir, "2026-10-28", [...SIX.slice(0, 5), { ...SIX[5], complete: false }]); // 2002 not practisable
  await putRadar(dir, "2026-10-22", ["1101"]); // older
  await putRadar(dir, "2026-10-27", ["2454", "6488", "2330", "2454", "2002", "9999"]);
  await putRadar(dir, "2026-10-28", ["2603"]); // the lesson day's own list is never used

  const member = (await lessonPicker(dir, "2026-10-28", { guest: false }))!;
  assert.deepEqual(member.defaults, ["2330", "2454"]);
  assert.deepEqual(member.note, {
    title: "預設：前一交易日熱門當沖股（10/27 盤後）",
    detail: "名單 5 檔：上櫃 1 檔不在教材範圍，另 2 檔這天沒有可練習的資料",
  });

  const guest = (await lessonPicker(dir, "2026-10-28", { guest: true }))!;
  assert.deepEqual(guest.defaults, ["1101", "2317", "2330", "2454", "2603"]);
  assert.deepEqual(guest.note, { title: "預設：成交值前 5 名", detail: null });
  assert.deepEqual(guest.symbols, member.symbols);
  const json = JSON.stringify(guest);
  for (const hidden of ["radar", "Radar", "2026-10-27", "10/27", "20261027", "名單", "當沖", "盤後", "檔", "6488", "9999"]) {
    assert.equal(json.includes(hidden), false, hidden);
  }

  // A list with another full-market day between it and the lesson is stale: the top 5 again.
  await rm(join(dir, "radar/2026-10-28.json"));
  await writeDay(dir, "2026-10-29", SIX);
  const stale = (await lessonPicker(dir, "2026-10-29", { guest: false }))!;
  assert.deepEqual(stale.note, { title: NO_LIST, detail: null });
  assert.deepEqual(stale.defaults, ["1101", "2317", "2330", "2454", "2603"]);
}));

test("top5 skips disposition and unpractisable", () => fixture(async (dir) => {
  const trades = defaultTrades(100);
  const wrongBars = barsFrom(trades).map((bar): MarketBarRow => [bar[0], bar[1], bar[2], bar[3], bar[4], bar[5] + 4, bar[6]]);
  await writeDay(dir, "2026-10-28", [
    { code: "2330", tradeValue: 90, disposition: true },
    { code: "2317", tradeValue: 80, complete: false },
    { code: "2454", tradeValue: 70, trades: [] }, // no trade in the morning
    { code: "2603", tradeValue: 65, trades, bars: wrongBars }, // bars and trades disagree
    { code: "6488", tradeValue: 60 }, // 上櫃
    { code: "1101", tradeValue: 50 },
    { code: "2002", tradeValue: 40 },
    { code: "2881", tradeValue: 30 },
    { code: "2882", tradeValue: 20 },
    { code: "2886", tradeValue: 15 },
    { code: "2891", tradeValue: 10 },
  ]);
  const picker = (await lessonPicker(dir, "2026-10-28", { guest: false }))!;
  assert.deepEqual(picker.defaults, ["1101", "2002", "2881", "2882", "2886"]);
  assert.deepEqual(picker.note, { title: NO_LIST, detail: null });
  // A 處置 stock can still be picked by hand; one whose data turned out not to agree is no longer offered.
  assert.deepEqual(picker.symbols.map((symbol) => symbol.code), ["1101", "2002", "2330", "2881", "2882", "2886", "2891"]);
  assert.equal(picker.symbols.find((symbol) => symbol.code === "2330")!.disposition, true);
}));

test("buildRunSource rejects a code whose ticks disagree with bars", () => fixture(async (dir) => {
  const trades = defaultTrades(50);
  const wrongVolume = barsFrom(trades).map((bar, index): MarketBarRow => (index === 1 ? [bar[0], bar[1], bar[2], bar[3], bar[4], bar[5] + 1, bar[6]] : bar));
  const wrongPrice = barsFrom(trades).map((bar, index): MarketBarRow => (index === 0 ? [bar[0], bar[1], bar[2] + 0.5, bar[3], bar[4], bar[5], bar[6]] : bar));
  await writeDay(dir, "2026-10-28", [
    ...SIX,
    { code: "2882", referencePrice: 50, tradeValue: 2, trades, bars: wrongVolume },
    { code: "2883", referencePrice: 50, tradeValue: 1, trades, bars: wrongPrice },
    { code: "6488", tradeValue: 3 },
  ]);
  // The picker's quick check (bars with volume in the morning) offers them; the strict one at the start does not.
  const before = (await lessonPicker(dir, "2026-10-28", { guest: false }))!;
  assert.ok(before.symbols.some((symbol) => symbol.code === "2882"));
  await assert.rejects(buildRunSource(dir, "2026-10-28", ["2330", "2882"]), (error: unknown) => {
    assert.ok(error instanceof MorningError);
    assert.equal(error.status, 409);
    assert.equal(error.message, "這幾檔這天的資料對不起來：2882，請改選其他股票");
    return true;
  });
  await assert.rejects(buildRunSource(dir, "2026-10-28", ["2883", "2330", "2882"]), (error: unknown) => {
    assert.ok(error instanceof MorningError);
    assert.equal(error.message, "這幾檔這天的資料對不起來：2883、2882，請改選其他股票");
    return true;
  });
  await assert.rejects(buildRunSource(dir, "2026-10-28", ["6488"]), isConflict("6488")); // 上櫃 is never practisable
  const after = (await lessonPicker(dir, "2026-10-28", { guest: false }))!;
  assert.equal(after.symbols.some((symbol) => symbol.code === "2882" || symbol.code === "2883"), false);
  // The code list itself: 1 to 80 distinct 4-digit codes.
  for (const codes of [[], ["2330", "2330"], Array.from({ length: 81 }, (_, index) => String(1000 + index)), ["../2330"]]) {
    await assert.rejects(buildRunSource(dir, "2026-10-28", codes), (error) => error instanceof MorningError && error.status === 400);
  }
}));

test("buildRunSource bars start at first trade; previous5CloseMean null with <5 days", () => fixture(async (dir) => {
  const lateTrades: TradeRow[] = [[750_000, 60.5, 4, 60, 60.5], [751_000, 60.6, 1, 60.5, 60.6], [2_000_000, 61, 2, 60.9, 61]];
  const late: Stock = { code: "2881", referencePrice: 60, tradeValue: 1, trades: lateTrades };
  for (const [date, close] of [["2026-10-16", 10], ["2026-10-19", 20], ["2026-10-20", 30]] as const) {
    await writeDay(dir, date, SIX.map((stock) => ({ ...stock, close })));
  }
  await writeDay(dir, "2026-10-21", [...SIX.map((stock) => ({ ...stock, close: 40 })), late], { taiex: true });

  const source = await buildRunSource(dir, "2026-10-21", ["2881", "2330"]);
  assert.deepEqual(source.catalog, {
    lessonId: "fubon-20261021-am",
    title: "10/21 早盤",
    date: "2026-10-21",
    start: "09:00",
    end: "10:30",
    maxCursor: 90,
    symbols: [
      { code: "2881", name: "富邦金", previousClose: 60, previous5CloseMean: null },
      { code: "2330", name: "台積電", previousClose: 1000, previous5CloseMean: null },
    ],
    context: [],
    strategy: [],
    notices: [],
    videoUrl: null,
    volumeUnit: "lot",
    booksAvailable: false,
  });
  // Nothing before the first trade (09:12:30); a quiet minute after it is flat at the last price with volume 0.
  const bars = source.bars["2881"];
  const average = barsFrom(lateTrades)[0][6];
  assert.equal(bars.length, 90 - 12);
  assert.deepEqual(bars[0], { t: 720, o: 60.5, h: 60.6, l: 60.5, c: 60.6, v: 5, a: average });
  assert.deepEqual(bars[1], { t: 780, o: 60.6, h: 60.6, l: 60.6, c: 60.6, v: 0, a: average });
  assert.equal(bars.at(-1)!.t, 89 * 60);
  assert.deepEqual(source.trades["2881"], lateTrades); // the morning only
  assert.equal(source.bars["2330"][0].t, 0);
  assert.equal(source.booksAvailable, false);
  assert.match(source.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(source.index!.bars.length, 90);
  assert.equal(source.index!.previousClose, 20_000);

  // 10/22 is a selected day, so 10/27 has four full-market days before it: still no mean.
  await writeDay(dir, "2026-10-22", SIX, { coverage: "selected" });
  await writeDay(dir, "2026-10-27", [...SIX, late]);
  let later = await buildRunSource(dir, "2026-10-27", ["2330", "2881"]);
  assert.deepEqual(later.catalog.symbols.map((symbol) => symbol.previous5CloseMean), [null, null]);
  assert.equal("index" in later, false); // no TAIEX that day
  // A fifth earlier full-market day: the mean of the five closes; 2881 was not in all five, so none.
  await writeDay(dir, "2026-10-15", SIX.map((stock) => ({ ...stock, close: 50 })));
  later = await buildRunSource(dir, "2026-10-27", ["2330", "2881"]);
  assert.deepEqual(later.catalog.symbols.map((symbol) => symbol.previous5CloseMean), [30, null]);
  assert.equal(later.catalog.title, "10/27 早盤");
}));

test("sourceHash changes when the ticks manifest changes", () => fixture(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX);
  const manifestPath = join(dir, "ticks/2026-10-28/manifest.json");
  const daySha = JSON.parse(await readFile(join(dir, "index.json"), "utf8")).days[0].manifestSha256 as string;
  const before = await buildRunSource(dir, "2026-10-28", ["2330"]);
  assert.equal(before.sourceHash, sha256(`${daySha}\n${sha256(await readFile(manifestPath))}`));
  assert.equal((await buildRunSource(dir, "2026-10-28", ["2330"])).sourceHash, before.sourceHash);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.symbols.push({ code: "2881", complete: false });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const after = await buildRunSource(dir, "2026-10-28", ["2330"]);
  assert.notEqual(after.sourceHash, before.sourceHash);
  assert.equal(after.sourceHash, sha256(`${daySha}\n${sha256(await readFile(manifestPath))}`));
}));

test("trade cache stays under limit", () => fixture(async (dir) => {
  assert.equal(TRADE_CACHE_LIMIT, 3_000_000);
  const four = (price: number): TradeRow[] => [[1_000, price, 1, null, null], [2_000, price, 1, null, null], [61_000, price, 1, null, null], [62_000, price, 1, null, null]];
  await writeDay(dir, "2026-10-28", SIX.map((stock) => ({ ...stock, trades: four(stock.referencePrice!) })));
  setTradeCacheLimit(10);
  try {
    await buildRunSource(dir, "2026-10-28", ["2330", "2317"]);
    assert.equal(cachedTradeCount(), 8);
    // Cached trades are not read again: the files can go and the run still has them.
    for (const code of ["2330", "2317"]) await rm(join(dir, `ticks/2026-10-28/symbols/${code}.json.gz`));
    const again = await buildRunSource(dir, "2026-10-28", ["2330", "2317"]);
    assert.equal(again.trades["2330"].length, 4);
    // Over the limit, the least recently used go first.
    await buildRunSource(dir, "2026-10-28", ["2454", "2603"]);
    assert.ok(cachedTradeCount() <= 10, String(cachedTradeCount()));
    await assert.rejects(buildRunSource(dir, "2026-10-28", ["2330"]), isConflict("2330")); // read again: gone
    const all = await buildRunSource(dir, "2026-10-28", ["2454", "2603", "1101", "2002"]);
    assert.equal(Object.keys(all.trades).length, 4);
    assert.ok(cachedTradeCount() <= 10, String(cachedTradeCount()));
    setTradeCacheLimit(3); // one stock is more than the whole cache: used, never kept
    assert.equal((await buildRunSource(dir, "2026-10-28", ["1101"])).trades["1101"].length, 4);
    assert.ok(cachedTradeCount() <= 3, String(cachedTradeCount()));
  } finally {
    setTradeCacheLimit(TRADE_CACHE_LIMIT);
  }
}));

test("runBookCell: null without books, sizes only when the books manifest says lot, gaps passed through", () => fixture(async (dir) => {
  await writeDay(dir, "2026-10-28", SIX);
  assert.equal(await runBookCell(dir, "2026-10-28", "2330", 0), null);
  assert.equal(await runBookCell("", "2026-10-28", "2330", 0), null);
  const rows = [[1000, 4, [[[100, 10]], [[101, 5]]]], [500, 8, [[0, 100, 11]]], [61_000, 8, [[5, 101, 7]]]];
  await putBooks(dir, "2026-10-28", "unverified", { "2330": { rows, gaps: [[30_000, 40_000]] } });
  assert.deepEqual(await runBookCell(dir, "2026-10-28", "2330", 0), {
    start: null,
    frames: [
      [1000, { bids: [[100, 10]], asks: [[101, 5]] }],
      [1500, { bids: [[100, 11]], asks: [[101, 5]] }],
    ],
    gaps: [[30_000, 40_000]],
    sizes: false,
  });
  // The gap began after the last book before 09:01, so the book at 09:01 is unknown.
  assert.deepEqual(await runBookCell(dir, "2026-10-28", "2330", 1), {
    start: null,
    frames: [[62_500, { bids: [[100, 11]], asks: [[101, 7]] }]],
    gaps: [],
    sizes: false,
  });
  assert.equal(await runBookCell(dir, "2026-10-28", "2317", 0), null); // no books for that stock
  assert.equal((await lessonPicker(dir, "2026-10-28", { guest: false }))!.booksAvailable, true);
  assert.equal((await buildRunSource(dir, "2026-10-28", ["2330"])).booksAvailable, true);
  await putBooks(dir, "2026-10-28", "lot", { "2330": { rows, gaps: [] } });
  const lot = (await runBookCell(dir, "2026-10-28", "2330", 1))!;
  assert.equal(lot.sizes, true);
  assert.deepEqual(lot.start, { bids: [[100, 11]], asks: [[101, 5]] }); // the new file, not the cached one
}));
