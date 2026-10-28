// The daily lessons made from the Fubon data under MARKET_DATA_DIR (③ §1, §3, §7, §8; 當沖 list design A–E, H, L):
// which days are open, the picker shown before a run (only what is known before 09:00 that day), and the data of
// one run: bars checked against the real trades, the TAIEX and the recorded books.
//
// Published files are write-once, so what is read is cached. A day's cached data is tagged with a version made of
// the day's manifest hash (root index.json), the ticks manifest's size and time and the five previous days' hashes:
// a day published again is read again. Callers check marketDataDir() first; an empty dir is "no lessons" here.
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Bar } from "../game/types.ts";
import {
  listPublishedDays,
  readDaySymbols,
  readSymbolBars,
  type DaySymbol,
  type MarketBarRow,
  type PublishedDay,
} from "../market-days.server.ts";
import { STOCK_CATALOGUE } from "../market/universe.ts";
import { MorningError, type MorningSource } from "../morning-engine.ts";
import type { MorningCatalog, MorningIndexSeries } from "../morning.ts";
import { bookCell, type BookLevels, type BookTimeline } from "./books.ts";
import { MAX_RUN_CODES, chooseDefaultCodes, defaultNote } from "./default-codes.ts";
import {
  listRadarDates,
  readBooks,
  readMorningTrades,
  readRadarList,
  readTaiexPoints,
  readTicksManifest,
  sha256File,
} from "./market-files.server.ts";
import { taiexMorningSeries } from "./taiex.ts";
import { MORNING_CELLS, MORNING_END_MS, morningBars, type TradeRow } from "./trades.ts";
import type { LessonPicker, PickerSymbol, RadarList } from "./types.ts";

export const FIRST_LESSON_DAY = "2026-10-21";
/** Trades kept in memory at most, over every (day, stock); the least recently used go first. */
export const TRADE_CACHE_LIMIT = 3_000_000;
/** Recorded book rows (twenty numbers each) kept in memory at most. */
const BOOK_CACHE_ROWS = 500_000;
/** Days whose stock lists, pickers, TAIEX and books manifests stay cached. */
const DAYS_KEPT = 8;
/** (day, stock) results of the strict check. */
const VERDICTS_KEPT = 50_000;
const MIN_STOCKS = 5;
const TOP = 5;
const READ_CONCURRENCY = 16;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LISTED_CODE = /^\d{4}$/;
const LESSON_ID = /^fubon-(\d{4})(\d{2})(\d{2})-am$/;
const MORNING_SECONDS = MORNING_END_MS / 1000;
/** 上櫃 is not in the course (list decision 10): never practisable, and counted apart in the list wording. */
const OTC: ReadonlySet<string> = new Set(STOCK_CATALOGUE.filter((stock) => stock.market === "otc").map((stock) => stock.code));

export const lessonIdFor = (date: string): string => `fubon-${date.replaceAll("-", "")}-am`;

/** "fubon-20261027-am" → "2026-10-27"; anything else (an old lesson's id, a date that does not exist) → null. */
export function parseLessonId(id: string): string | null {
  const match = LESSON_ID.exec(id);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month}-${day}`;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

/** "2026-10-27" → "10/27 早盤". */
function lessonTitle(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)} 早盤`;
}

const compareCodes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byValue = (a: DaySymbol, b: DaySymbol): number => b.tradeValue - a.tradeValue || compareCodes(a.code, b.code);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Least recently used first out; an entry heavier than the whole limit is used by its caller but never kept. */
class Lru<V> {
  readonly #entries = new Map<string, { value: V; weight: number }>();
  #weight = 0;
  limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, weight = 1): void {
    this.delete(key);
    if (weight > this.limit) return;
    this.#entries.set(key, { value, weight });
    this.#weight += weight;
    this.trim();
  }

  delete(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    this.#weight -= entry.weight;
  }

  trim(): void {
    for (const [key, entry] of this.#entries) {
      if (this.#weight <= this.limit) return;
      this.#entries.delete(key);
      this.#weight -= entry.weight;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#weight = 0;
  }

  get weight(): number {
    return this.#weight;
  }
}

type Versioned<T> = { version: string; value: T };

async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Size and time of a file: enough to notice it was written again. Null when it is not there. */
async function fileVersion(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? `${info.size}:${info.mtimeMs}` : null;
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
}

// ── Days ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The full-market days of the root index.json, oldest first, each date once. */
async function fullMarketDays(dir: string): Promise<PublishedDay[]> {
  const seen = new Set<string>();
  const days: PublishedDay[] = [];
  for (const day of await listPublishedDays(dir)) {
    if (day.coverage !== "full-market" || seen.has(day.date)) continue;
    seen.add(day.date);
    days.push(day);
  }
  return days;
}

/** A full-market day from FIRST_LESSON_DAY on that has a ticks manifest, and the version its cached data carries. */
type DayRef = {
  date: string;
  manifestSha256: string;
  /** Every full-market day, oldest first (a list with another one between it and the lesson is stale). */
  fullMarketDays: string[];
  /** Up to five full-market days before it, oldest first. */
  previousDays: string[];
  version: string;
};

async function dayRef(dir: string, date: string, published: readonly PublishedDay[]): Promise<DayRef | null> {
  if (!dir || !DATE.test(date) || date < FIRST_LESSON_DAY) return null;
  const day = published.find((entry) => entry.date === date);
  if (!day?.manifestSha256) return null;
  const ticks = await fileVersion(join(dir, "ticks", date, "manifest.json"));
  if (!ticks) return null;
  const previous = published.filter((entry) => entry.date < date).slice(-5);
  return {
    date,
    manifestSha256: day.manifestSha256,
    fullMarketDays: published.map((entry) => entry.date),
    previousDays: previous.map((entry) => entry.date),
    version: [day.manifestSha256, ticks, ...previous.map((entry) => `${entry.date}:${entry.manifestSha256 ?? ""}`)].join("\n"),
  };
}

/** What a day's lesson needs of its lists: read once per version. */
type DayCore = {
  symbols: Map<string, DaySymbol>;
  /** Stocks the ticks manifest marks complete. */
  complete: Set<string>;
  /** Read only for a picker or a run, not to tell whether the day is open. */
  details?: Promise<DayDetails | null>;
};

type DayDetails = {
  sourceHash: string;
  /** The previous full-market day's turnover. */
  previousValue: Map<string, number>;
  /** The mean close of the five previous full-market days, for stocks in all five (③ decision N). */
  previous5CloseMean: Map<string, number>;
};

const cores = new Lru<Versioned<Promise<DayCore | null>>>(DAYS_KEPT);

function dayCore(dir: string, ref: DayRef): Promise<DayCore | null> {
  const cached = cores.get(ref.date);
  if (cached?.version === ref.version) return cached.value;
  const value = loadCore(dir, ref);
  cores.set(ref.date, { version: ref.version, value });
  return value;
}

async function loadCore(dir: string, ref: DayRef): Promise<DayCore | null> {
  const [symbols, manifest] = await Promise.all([readDaySymbols(dir, ref.date), readTicksManifest(dir, ref.date)]);
  if (!symbols || !manifest) return null;
  return {
    symbols: new Map(symbols.map((symbol) => [symbol.code, symbol])),
    complete: new Set(manifest.symbols.filter((entry) => entry.complete).map((entry) => entry.code)),
  };
}

function dayDetails(dir: string, ref: DayRef, core: DayCore): Promise<DayDetails | null> {
  core.details ??= loadDetails(dir, ref, core);
  return core.details;
}

async function loadDetails(dir: string, ref: DayRef, core: DayCore): Promise<DayDetails | null> {
  const [manifestHash, previous] = await Promise.all([
    sha256File(join(dir, "ticks", ref.date, "manifest.json")),
    Promise.all(ref.previousDays.map((day) => readDaySymbols(dir, day))),
  ]);
  if (!manifestHash) return null;
  const previousValue = new Map<string, number>();
  for (const symbol of previous.at(-1) ?? []) previousValue.set(symbol.code, symbol.tradeValue);
  const previous5CloseMean = new Map<string, number>();
  if (previous.length === 5) {
    const closes = previous.map((list) => new Map((list ?? []).map((symbol) => [symbol.code, symbol.close])));
    for (const code of core.symbols.keys()) {
      let sum = 0;
      let count = 0;
      for (const byCode of closes) {
        const close = byCode.get(code);
        if (close !== undefined && close > 0) {
          sum += close;
          count += 1;
        }
      }
      if (count === 5) previous5CloseMean.set(code, sum / 5);
    }
  }
  return {
    sourceHash: createHash("sha256").update(`${ref.manifestSha256}\n${manifestHash}`).digest("hex"),
    previousValue,
    previous5CloseMean,
  };
}

/** The part of "practisable" that needs no file of the stock: a 4-digit 上市 code in the day's list, trades complete. */
const listedAndComplete = (core: DayCore, code: string): boolean =>
  LISTED_CODE.test(code) && !OTC.has(code) && core.symbols.has(code) && core.complete.has(code);

const tradedInMorning = (bars: readonly MarketBarRow[]): boolean =>
  bars.some((bar) => bar[0] >= 0 && bar[0] < MORNING_SECONDS && bar[5] > 0);

/** The quick check of the picker: a 1-minute bar of the morning (cells 0–89) with volume. */
async function hasMorningVolume(dir: string, date: string, code: string): Promise<boolean> {
  const bars = await readSymbolBars(dir, date, code);
  return !!bars && tradedInMorning(bars);
}

const openDays = new Map<string, Versioned<Promise<boolean>>>();

/** ③ §1: at least five practisable stocks (by the quick check). */
function isOpen(dir: string, ref: DayRef): Promise<boolean> {
  const cached = openDays.get(ref.date);
  if (cached?.version === ref.version) return cached.value;
  const value = (async () => {
    const core = await dayCore(dir, ref);
    if (!core) return false;
    // The most traded first: an open day shows its five in the first few files.
    const codes = [...core.symbols.values()].filter((symbol) => listedAndComplete(core, symbol.code)).sort(byValue);
    let found = 0;
    for (const { code } of codes) {
      if (await hasMorningVolume(dir, ref.date, code)) found += 1;
      if (found >= MIN_STOCKS) return true;
    }
    return false;
  })();
  openDays.set(ref.date, { version: ref.version, value });
  return value;
}

async function openDay(dir: string, date: string): Promise<{ ref: DayRef; core: DayCore; details: DayDetails } | null> {
  if (!dir || !DATE.test(date) || date < FIRST_LESSON_DAY) return null;
  const ref = await dayRef(dir, date, await fullMarketDays(dir));
  if (!ref || !(await isOpen(dir, ref))) return null;
  const core = await dayCore(dir, ref);
  const details = core && (await dayDetails(dir, ref, core));
  return core && details ? { ref, core, details } : null;
}

/** The open lesson days, newest first. */
export async function listLessonDays(dir: string): Promise<string[]> {
  if (!dir) return [];
  const published = await fullMarketDays(dir);
  const open: string[] = [];
  for (const { date } of published) {
    // Oldest first, so the newest days are the most recently cached.
    const ref = await dayRef(dir, date, published);
    if (ref && (await isOpen(dir, ref))) open.push(date);
  }
  return open.reverse();
}

// ── One stock's checked morning ──────────────────────────────────────────────────────────────────────────────────

type CheckedStock = { bars: Bar[]; trades: readonly TradeRow[] };

const runs = new Lru<Versioned<CheckedStock>>(TRADE_CACHE_LIMIT);
const verdicts = new Lru<Versioned<boolean>>(VERDICTS_KEPT);
const reading = new Map<string, Promise<CheckedStock | null>>();
const stockKey = (date: string, code: string) => `${date} ${code}`;

async function readChecked(dir: string, date: string, core: DayCore, code: string): Promise<CheckedStock | null> {
  if (!listedAndComplete(core, code)) return null;
  const [dayBars, trades] = await Promise.all([readSymbolBars(dir, date, code), readMorningTrades(dir, date, code)]);
  if (!dayBars || !tradedInMorning(dayBars)) return null;
  const bars = trades ? morningBars(dayBars, trades) : null;
  if (!trades || !bars) {
    // ③ decision H: the stock is not open that day, and the server log says why.
    console.warn(`[daily-lessons] ${date} ${code}：${trades ? "逐筆和 1 分 K 對不起來" : "讀不到逐筆"}，這天不開放這檔`);
    return null;
  }
  return { bars, trades };
}

/**
 * The strict check of the start (③ §8): the morning's 1-minute bars must agree with the trades minute by minute.
 * The bars and trades are kept (by day and stock) so an advance never reads or unpacks a file again; the verdict is
 * kept longer than the trades, so a stock found not to agree is not read again either. Null: not practisable.
 */
function checkedStock(dir: string, ref: DayRef, core: DayCore, code: string): Promise<CheckedStock | null> {
  const key = stockKey(ref.date, code);
  const cached = runs.get(key);
  if (cached?.version === ref.version) return Promise.resolve(cached.value);
  const verdict = verdicts.get(key);
  if (verdict?.version === ref.version && !verdict.value) return Promise.resolve(null);
  const readKey = `${key}\n${ref.version}`;
  let pending = reading.get(readKey);
  if (!pending) {
    pending = readChecked(dir, ref.date, core, code)
      .then((stock) => {
        verdicts.set(key, { version: ref.version, value: stock !== null });
        if (stock) runs.set(key, { version: ref.version, value: stock }, Math.max(1, stock.trades.length));
        return stock;
      })
      .finally(() => reading.delete(readKey));
    reading.set(readKey, pending);
  }
  return pending;
}

async function passesStrictCheck(dir: string, ref: DayRef, core: DayCore, code: string): Promise<boolean> {
  const verdict = verdicts.get(stockKey(ref.date, code));
  if (verdict?.version === ref.version) return verdict.value;
  return (await checkedStock(dir, ref, core, code)) !== null;
}

function knownNotToAgree(ref: DayRef, code: string): boolean {
  const verdict = verdicts.get(stockKey(ref.date, code));
  return verdict?.version === ref.version && !verdict.value;
}

// ── Picker ───────────────────────────────────────────────────────────────────────────────────────────────────────

type PickerBase = {
  /** Practisable stocks (quick check) by code, with only what is known before 09:00. */
  symbols: PickerSymbol[];
  practisable: Set<string>;
  /** Practisable stocks not under 處置, by the day's turnover, most first: where the top 5 come from. Server only. */
  byValue: string[];
};

const pickers = new Lru<Versioned<Promise<PickerBase>>>(DAYS_KEPT);

function pickerBase(dir: string, ref: DayRef, core: DayCore, details: DayDetails): Promise<PickerBase> {
  const cached = pickers.get(ref.date);
  if (cached?.version === ref.version) return cached.value;
  const value = (async () => {
    const listed = [...core.symbols.values()].filter((symbol) => listedAndComplete(core, symbol.code));
    const traded = await mapLimited(listed, READ_CONCURRENCY, (symbol) => hasMorningVolume(dir, ref.date, symbol.code));
    const practisable = listed.filter((_, index) => traded[index]);
    return {
      symbols: practisable
        .map(({ code, name, referencePrice, disposition }) => ({
          code,
          name,
          referencePrice,
          previousValue: details.previousValue.get(code) ?? null,
          disposition,
        }))
        .sort((a, b) => compareCodes(a.code, b.code)),
      practisable: new Set(practisable.map((symbol) => symbol.code)),
      byValue: practisable.filter((symbol) => !symbol.disposition).sort(byValue).map((symbol) => symbol.code),
    };
  })();
  pickers.set(ref.date, { version: ref.version, value });
  return value;
}

/** The day's top 5 by turnover: not under 處置, practisable, and through the strict check (③ decision I, H). */
async function topFive(dir: string, ref: DayRef, core: DayCore, base: PickerBase): Promise<string[]> {
  const top: string[] = [];
  // Five at a time, in turnover order: most days need only the first five files.
  for (let at = 0; top.length < TOP && at < base.byValue.length; at += TOP) {
    const batch = base.byValue.slice(at, at + TOP);
    const passed = await Promise.all(batch.map((code) => passesStrictCheck(dir, ref, core, code)));
    for (const [index, code] of batch.entries()) if (passed[index] && top.length < TOP) top.push(code);
  }
  return top;
}

/** The newest 當沖 list before the lesson day (list decision A); whether it is stale is chooseDefaultCodes' call. */
async function listBefore(dir: string, date: string): Promise<RadarList | null> {
  const listDate = (await listRadarDates(dir)).filter((day) => day < date).at(-1);
  return listDate ? readRadarList(dir, listDate) : null;
}

/**
 * The picker of an open lesson day, sent before a run starts: the practisable stocks by code with only what is
 * known before 09:00 (no close, change, turnover or rank of the day: ③ decision P), the default 自選 and its
 * wording. Guests get the top 5, and the list is not even read for them (list decision L).
 */
export async function lessonPicker(dir: string, date: string, opts: { guest: boolean }): Promise<LessonPicker | null> {
  const day = await openDay(dir, date);
  if (!day) return null;
  const { ref, core, details } = day;
  const base = await pickerBase(dir, ref, core, details);
  const top5 = await topFive(dir, ref, core, base);
  const radar = opts.guest ? null : await listBefore(dir, date);
  const choose = () =>
    chooseDefaultCodes({
      lessonDate: date,
      fullMarketDays: ref.fullMarketDays,
      radar,
      practisable: new Set([...base.practisable].filter((code) => !knownNotToAgree(ref, code))),
      otc: OTC,
      top5,
      guest: opts.guest,
    });
  let choice = choose();
  if (choice.basis === "radar") {
    // The list's stocks go through the strict check now: one that does not agree is "no practisable data" (B).
    const passed = await mapLimited(choice.codes, READ_CONCURRENCY, (code) => passesStrictCheck(dir, ref, core, code));
    if (passed.includes(false)) choice = choose();
  }
  const [books, taiex] = await Promise.all([booksManifest(dir, date), taiexSeries(dir, date)]);
  return {
    lessonId: lessonIdFor(date),
    date,
    symbols: base.symbols.filter((symbol) => !knownNotToAgree(ref, symbol.code)).map((symbol) => ({ ...symbol })),
    defaults: choice.codes,
    note: defaultNote(choice),
    booksAvailable: books !== null,
    taiexAvailable: taiex !== null,
  };
}

// ── TAIEX and books ──────────────────────────────────────────────────────────────────────────────────────────────

const taiexDays = new Lru<Versioned<Promise<MorningIndexSeries | null>>>(DAYS_KEPT);

async function taiexSeries(dir: string, date: string): Promise<MorningIndexSeries | null> {
  const version = await fileVersion(join(dir, "taiex", date, "points.json"));
  if (!version) return null;
  const cached = taiexDays.get(date);
  if (cached?.version === version) return cached.value;
  const value = readTaiexPoints(dir, date).then((file) => (file ? taiexMorningSeries(file.previousClose, file.points) : null));
  taiexDays.set(date, { version, value });
  return value;
}

type BooksDay = { version: string; sizes: boolean };
const booksDays = new Lru<Versioned<Promise<BooksDay | null>>>(DAYS_KEPT);

/** books/<date>/manifest.json. Sizes are shown only once it says they are in lots (R6); the files say "unverified". */
async function booksManifest(dir: string, date: string): Promise<BooksDay | null> {
  const path = join(dir, "books", date, "manifest.json");
  const version = await fileVersion(path);
  if (!version) return null;
  const cached = booksDays.get(date);
  if (cached?.version === version) return cached.value;
  const value = readJson(path).then((manifest) =>
    isRecord(manifest) && manifest.schema === 1 && manifest.date === date ? { version, sizes: manifest.sizeUnit === "lot" } : null,
  );
  booksDays.set(date, { version, value });
  return value;
}

const timelines = new Lru<Versioned<BookTimeline | null>>(BOOK_CACHE_ROWS);
const readingBooks = new Map<string, Promise<BookTimeline | null>>();

function bookTimeline(dir: string, date: string, code: string, version: string): Promise<BookTimeline | null> {
  const key = stockKey(date, code);
  const cached = timelines.get(key);
  if (cached?.version === version) return Promise.resolve(cached.value);
  const readKey = `${key}\n${version}`;
  let pending = readingBooks.get(readKey);
  if (!pending) {
    pending = readBooks(dir, date, code)
      .then((books) => {
        const timeline = books?.timeline ?? null;
        timelines.set(key, { version, value: timeline }, Math.max(1, timeline?.times.length ?? 0));
        return timeline;
      })
      .finally(() => readingBooks.delete(readKey));
    readingBooks.set(readKey, pending);
  }
  return pending;
}

/**
 * One stock's recorded books in one cell (09:00 + cell minutes): the book as the cell starts, every change inside
 * it, and the stretches whose book is unknown (R7). Null when the day or the stock has no recorded books; the
 * desk then shows only the trades' best bid and ask. `sizes` false: the desk shows 「—」 for every size.
 */
export async function runBookCell(
  dir: string,
  date: string,
  code: string,
  cell: number,
): Promise<{ start: BookLevels | null; frames: [number, BookLevels][]; gaps: [number, number][]; sizes: boolean } | null> {
  if (!dir || !DATE.test(date)) return null;
  const books = await booksManifest(dir, date);
  if (!books) return null;
  const timeline = await bookTimeline(dir, date, code, books.version);
  if (!timeline) return null;
  const { start, frames, gaps } = bookCell(timeline, cell);
  return { start, frames, gaps, sizes: books.sizes };
}

// ── A run's data ─────────────────────────────────────────────────────────────────────────────────────────────────

export type RunSource = MorningSource & { trades: Record<string, readonly TradeRow[]>; sourceHash: string; booksAvailable: boolean };

/**
 * The data of a run on an open day with the chosen stocks, in the order chosen. Every stock goes through the
 * strict check; any that fails is a 409 naming them. `sourceHash` ties a run to the day's published files.
 */
export async function buildRunSource(dir: string, date: string, codes: readonly string[]): Promise<RunSource> {
  if (
    codes.length < 1 ||
    codes.length > MAX_RUN_CODES ||
    new Set(codes).size !== codes.length ||
    !codes.every((code) => LISTED_CODE.test(code))
  ) {
    throw new MorningError(400, `請選 1 到 ${MAX_RUN_CODES} 檔不重複的上市股票`);
  }
  const day = await openDay(dir, date);
  if (!day) throw new MorningError(400, "請選擇已提供真實行情的練習日期");
  const { ref, core, details } = day;
  const stocks = await mapLimited(codes, READ_CONCURRENCY, (code) => checkedStock(dir, ref, core, code));
  const failed = codes.filter((_, index) => !stocks[index]);
  if (failed.length) throw new MorningError(409, `這幾檔這天的資料對不起來：${failed.join("、")}，請改選其他股票`);
  const [books, index] = await Promise.all([booksManifest(dir, date), taiexSeries(dir, date)]);
  const booksAvailable = books !== null;
  const bars: Record<string, Bar[]> = {};
  const trades: Record<string, readonly TradeRow[]> = {};
  codes.forEach((code, at) => {
    bars[code] = stocks[at]!.bars;
    trades[code] = stocks[at]!.trades;
  });
  const catalog: MorningCatalog = {
    lessonId: lessonIdFor(date),
    title: lessonTitle(date),
    date,
    start: "09:00",
    end: "10:30",
    maxCursor: MORNING_CELLS,
    symbols: codes.map((code) => {
      const symbol = core.symbols.get(code)!;
      return {
        code,
        name: symbol.name,
        previousClose: symbol.referencePrice,
        previous5CloseMean: details.previous5CloseMean.get(code) ?? null,
      };
    }),
    context: [],
    strategy: [],
    notices: [],
    videoUrl: null,
    volumeUnit: "lot",
    booksAvailable,
  };
  return { catalog, bars, trades, sourceHash: details.sourceHash, booksAvailable, ...(index ? { index } : {}) };
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function clearLessonCaches(): void {
  for (const cache of [cores, pickers, runs, verdicts, taiexDays, booksDays, timelines]) cache.clear();
  openDays.clear();
  reading.clear();
  readingBooks.clear();
}

/** For tests: a smaller trade cache. */
export function setTradeCacheLimit(limit: number): void {
  runs.limit = limit;
  runs.trim();
}

/** For tests: trades now cached. */
export function cachedTradeCount(): number {
  return runs.weight;
}
