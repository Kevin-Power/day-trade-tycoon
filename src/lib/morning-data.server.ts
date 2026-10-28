// The lessons the practice API serves: the daily Fubon lessons read at run time from MARKET_DATA_DIR (③ §3, §7, §8;
// 當沖 list design E, F, H, L). Which lesson a request is about, the lesson list, a day's picker and a run's data
// with the desk wording of the day's default 自選. The old Yahoo lessons (10/05, 10/06) are retired: nothing of
// theirs is read or bundled any more, and their runs only show in the records.
// Import only from server handlers. Never include this module in a page loader, shared store or public directory.
import { MorningError, type MorningStoredState } from "./morning-engine.ts";
import type { MorningCatalog, MorningLessonSummary } from "./morning.ts";
import {
  buildRunSource,
  lessonIdFor,
  lessonPicker,
  lessonTitle,
  listLessonDays,
  parseLessonId,
  runBookCell,
  type RunSource,
} from "./lessons/daily-lessons.server.ts";
import { STOCK_CATALOGUE } from "./market/universe.ts";
import { MORNING_CELLS } from "./lessons/trades.ts";
import { marketDataDir } from "./lessons/market-files.server.ts";
import type { LessonPicker } from "./lessons/types.ts";

/** The retired lessons, id → date. Their runs stay readable in the records; the lessons themselves never open. */
export const RETIRED_LESSONS: Record<string, string> = {
  "morning-20261005-v1-bd566804b809": "2026-10-05",
  "morning-20261006-v1-ce4a95ce69f1": "2026-10-06",
};
export const NO_DAILY_LESSONS = "此教室沒有每日教材";
export const NO_LESSON_YET = "目前還沒有每日教材";
export const RETIRED_LESSON = "這堂舊課已停用";
export const NOT_OPEN = "請選擇已提供真實行情的練習日期";
const BAD_QUERY = "請由課程頁面選擇練習日期";

export const isRetiredLesson = (id: string): boolean => Object.hasOwn(RETIRED_LESSONS, id);

/** A lesson's date: a daily lesson's from its id, a retired one's from RETIRED_LESSONS; null for anything else. */
export function lessonDate(id: string): string | null {
  return parseLessonId(id) ?? (isRetiredLesson(id) ? RETIRED_LESSONS[id] : null);
}

/**
 * The one query the API takes: none, or exactly one `lesson` naming a daily lesson (`fubon-YYYYMMDD-am`). A retired
 * lesson is 404 whether or not the classroom has daily lessons; anything else is 400.
 */
export function requestedLesson(params: URLSearchParams): { lessonId: string; date: string } | null {
  const entries = [...params.entries()];
  if (!entries.length) return null;
  if (entries.length !== 1 || entries[0][0] !== "lesson") throw new MorningError(400, BAD_QUERY);
  const lessonId = entries[0][1];
  if (isRetiredLesson(lessonId)) throw new MorningError(404, RETIRED_LESSON);
  const date = parseLessonId(lessonId);
  if (!date) throw new MorningError(400, NOT_OPEN);
  return { lessonId, date };
}

export type MorningTarget =
  | { kind: "unavailable"; unavailable: string }
  | {
      kind: "lesson";
      dir: string;
      /** The open lesson days, newest first. */
      days: string[];
      lessonId: string;
      date: string;
      /** "query": asked for by id; "open-run": the learner's latest unfinished run; "newest": the newest day. */
      from: "query" | "open-run" | "newest";
    };

/**
 * The lesson a request is about: the one in the query; else the day of the learner's latest unfinished run (newest
 * first, as `user.openLessonIds` gives them; a run on a day that is not open is passed over); else the newest day.
 * No MARKET_DATA_DIR (on-prem) or no open day yet is "unavailable", with the sentence the practice area shows.
 */
export async function resolveMorningSource(
  params: URLSearchParams,
  user: { openLessonIds(): Promise<readonly string[]> },
  market: MorningMarket | string = marketDataDir(),
): Promise<MorningTarget> {
  const requested = requestedLesson(params);
  const data = typeof market === "string" ? new MorningMarket(market) : market;
  const { dir } = data;
  if (!dir) return { kind: "unavailable", unavailable: NO_DAILY_LESSONS };
  const days = await data.days();
  if (!days.length) return { kind: "unavailable", unavailable: NO_LESSON_YET };
  if (requested) {
    if (!days.includes(requested.date)) throw new MorningError(400, NOT_OPEN);
    return { kind: "lesson", dir, days, ...requested, from: "query" };
  }
  for (const lessonId of await user.openLessonIds()) {
    const date = parseLessonId(lessonId);
    if (date && days.includes(date)) return { kind: "lesson", dir, days, lessonId, date, from: "open-run" };
  }
  return { kind: "lesson", dir, days, lessonId: lessonIdFor(days[0]), date: days[0], from: "newest" };
}

/** The date list: id, date and title only (nothing of the day's market). */
export function lessonSummaries(days: readonly string[]): MorningLessonSummary[] {
  return days.map((date) => ({ lessonId: lessonIdFor(date), date, title: lessonTitle(date) }));
}

// ── The day's picker, kept a minute ──────────────────────────────────────────────────────────────────────────────

/** Every response of a run carries the default's wording, so the picker is not built again for each advance. */
const PICKER_TTL_MS = 60_000;
const PICKERS_KEPT = 32;
const pickers = new Map<string, { at: number; value: Promise<LessonPicker | null> }>();

/**
 * The picker of an open day (null when the day is not open), for members or for guests: a guest's is made without
 * ever reading the 當沖 list (list decision L). Kept a minute, so a list that arrives late is used soon after.
 * Shared between requests: never change what it returns.
 */
export function dayPicker(dir: string, date: string, guest: boolean, now = Date.now()): Promise<LessonPicker | null> {
  const key = `${guest ? "guest" : "member"}\n${dir}\n${date}`;
  const cached = pickers.get(key);
  if (cached && now >= cached.at && now - cached.at < PICKER_TTL_MS) return cached.value;
  const value = lessonPicker(dir, date, { guest });
  pickers.delete(key);
  pickers.set(key, { at: now, value });
  for (const old of pickers.keys()) {
    if (pickers.size <= PICKERS_KEPT) break;
    pickers.delete(old);
  }
  value.catch(() => {
    if (pickers.get(key)?.value === value) pickers.delete(key);
  });
  return value;
}

/** For tests. */
export function clearMorningDataCaches(): void {
  pickers.clear();
}

// ── Catalogs ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A run's data on an open day, its stocks in the order chosen, with the day's default wording (`catalog.note`) for
 * this audience. Bars, trades and TAIEX are the lesson cache's own objects: never change them.
 */
export async function runSourceFor(dir: string, date: string, codes: readonly string[], guest: boolean): Promise<RunSource> {
  const [source, picker] = await Promise.all([buildRunSource(dir, date, codes), dayPicker(dir, date, guest)]);
  return picker ? { ...source, catalog: { ...source.catalog, note: { ...picker.note } } } : source;
}

/**
 * The catalog shown before a run: the day's default 自選 (what the plan form and the lobby's three steps read) and
 * its wording. Only what is known before 09:00 that day; no bars go with it.
 */
export async function pickerCatalog(dir: string, picker: LessonPicker): Promise<MorningCatalog> {
  const note = { ...picker.note };
  if (picker.defaults.length) {
    try {
      return { ...(await buildRunSource(dir, picker.date, picker.defaults)).catalog, note };
    } catch (error) {
      // A default found not to agree since the picker was made: show the defaults anyway; starting names the stock.
      if (!(error instanceof MorningError)) throw error;
    }
  }
  const symbols = new Map(picker.symbols.map((symbol) => [symbol.code, symbol]));
  return {
    lessonId: picker.lessonId,
    title: lessonTitle(picker.date),
    date: picker.date,
    start: "09:00",
    end: "10:30",
    maxCursor: MORNING_CELLS,
    symbols: picker.defaults.flatMap((code) => {
      const symbol = symbols.get(code);
      return symbol ? [{ code, name: symbol.name, previousClose: symbol.referencePrice, previous5CloseMean: null }] : [];
    }),
    context: [],
    strategy: [],
    notices: [],
    videoUrl: null,
    volumeUnit: "lot",
    booksAvailable: picker.booksAvailable,
    note,
  };
}

const STOCK_NAMES: ReadonlyMap<string, string> = new Map(STOCK_CATALOGUE.map((stock) => [stock.code, stock.name]));

/**
 * The catalog of a run whose day's data cannot be read now (its files changed or do not agree any more): the run's
 * stocks by code and catalogue name, nothing of the market (`previousClose` 0: not known). Sent with the run's
 * saved state only when it was just finished or abandoned, which needs no market data.
 */
export function textOnlyCatalog(state: MorningStoredState, date: string): MorningCatalog {
  return {
    lessonId: state.lessonId,
    title: lessonTitle(date),
    date,
    start: "09:00",
    end: "10:30",
    maxCursor: MORNING_CELLS,
    symbols: (state.codes ?? []).map((code) => ({ code, name: STOCK_NAMES.get(code) ?? code, previousClose: 0, previous5CloseMean: null })),
    context: [],
    strategy: [],
    notices: [],
    videoUrl: null,
  };
}

// ── One request's market data ────────────────────────────────────────────────────────────────────────────────────

/** Inside the transaction: the request needs market data that was not read before it (see MorningMarket). */
export class MarketMiss extends Error {
  constructor() {
    super("market data needed inside the transaction was not read before it");
  }
}

/**
 * The market data of one request. PGlite runs every query of the process under one lock while a transaction is
 * open, so no file may be read inside one: the request reads what it needs first, then the transaction is run with
 * the data sealed. Anything else it asks for then is a MarketMiss, which aborts the transaction; the request reads
 * that outside and runs again. Results and refusals are both kept for the request, so the transaction meets exactly
 * what the reading met. Unsealed (the default), it simply reads on demand.
 */
export class MorningMarket {
  readonly dir: string;
  #sealed = false;
  readonly #kept = new Map<string, Promise<unknown>>();
  readonly #missed = new Map<string, () => Promise<unknown>>();

  constructor(dir: string) {
    this.dir = dir;
  }

  #get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const kept = this.#kept.get(key);
    if (kept) return kept as Promise<T>;
    if (this.#sealed) {
      this.#missed.set(key, load);
      return Promise.reject(new MarketMiss());
    }
    const value = load();
    value.catch(() => undefined); // a refusal is kept as an answer; whoever awaits it handles it
    this.#kept.set(key, value);
    return value;
  }

  /** The open lesson days, newest first. */
  days(): Promise<string[]> {
    return this.#get("days", () => listLessonDays(this.dir));
  }

  picker(date: string, guest: boolean): Promise<LessonPicker | null> {
    return this.#get(`picker|${guest}|${date}`, () => dayPicker(this.dir, date, guest));
  }

  /** The catalog shown before a run, from this audience's picker of the day. */
  pickerCatalog(picker: LessonPicker, guest: boolean): Promise<MorningCatalog> {
    return this.#get(`catalog|${guest}|${picker.date}`, () => pickerCatalog(this.dir, picker));
  }

  runSource(date: string, codes: readonly string[], guest: boolean): Promise<RunSource> {
    return this.#get(`source|${guest}|${date}|${codes.join(",")}`, () => runSourceFor(this.dir, date, codes, guest));
  }

  book(date: string, code: string, cell: number): ReturnType<typeof runBookCell> {
    return this.#get(`book|${date}|${code}|${cell}`, () => runBookCell(this.dir, date, code, cell));
  }

  /** From now on nothing is read: what was not read before is a MarketMiss. */
  seal(): void {
    this.#sealed = true;
  }

  /** Outside the transaction again: reads what the sealed run asked for and did not have. */
  async loadMissed(): Promise<void> {
    this.#sealed = false;
    const loads = [...this.#missed].map(([key, load]) => this.#get(key, load));
    this.#missed.clear();
    await Promise.allSettled(loads);
  }
}
