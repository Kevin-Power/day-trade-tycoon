// The desk's lesson picker and run records, browser side (③ §7, decision G; 當沖 list design E, F). Pure: what
// the picker shows and allows (1–80 stocks, search in the browser over the day's stocks), the labels of days and
// runs, and what the desk keeps from one reply to the next. Nothing here talks to the server.
import { MAX_RUN_CODES, sameCodes } from "./lessons/default-codes.ts";
import type { PickerSymbol, RunRecord } from "./lessons/types.ts";
import type { MorningCatalog, MorningLessonSummary } from "./morning.ts";
import type { DeskResponse } from "./market/real-replay.ts";

export { MAX_RUN_CODES, sameCodes };

/** Shown when the run holds MAX_RUN_CODES stocks and no more can be added. */
export const FULL_LIST_TEXT = `最多 ${MAX_RUN_CODES} 檔`;
/** The mark of a stock under disposition (分盤交易), in the picker as in the spec (decision I). */
export const DISPOSITION_TEXT = "處置（分盤交易）";
/** A retired lesson's runs, in the records and on their text-only page (spec §9). */
export const RETIRED_TEXT = "舊課（已停用）";
/** Asked before a run is given up (ruling R10). */
export const ABANDON_CONFIRM_TEXT = "確定放棄這局？放棄後不計紀律分數，可以重新選股。";
/** How many search results the picker lists at once. */
export const SEARCH_SHOWN = 20;

/** "10/27" from "2026-10-27". */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

/** A daily lesson as the date menus show it: "10/27 早盤" (the morning is the only session). */
export const lessonDayLabel = (date: string): string => `${shortDate(date)} 早盤`;

/** The date menu's choices: the open days, plus the lesson on screen when it is not one of them (a retired one). */
export function dateOptions(
  lessons: readonly MorningLessonSummary[],
  current?: { lessonId: string; date: string; retired?: boolean },
): { lessonId: string; label: string }[] {
  const options = lessons.map((lesson) => ({ lessonId: lesson.lessonId, label: lessonDayLabel(lesson.date) }));
  if (current && !options.some((option) => option.lessonId === current.lessonId))
    options.unshift({
      lessonId: current.lessonId,
      label: current.retired ? `${shortDate(current.date)} ${RETIRED_TEXT}` : lessonDayLabel(current.date),
    });
  return options;
}

/** The previous trading day's turnover (TWD) as the picker shows it: 億 above 100 million, else 萬; "—" unknown. */
export function formatPreviousValue(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 1e8)
    return `${(value / 1e8).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 億`;
  return `${Math.round(value / 1e4).toLocaleString("zh-TW")} 萬`;
}

const compareCodes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The run's stocks with `code` added, by code; unchanged when it is already there or the run is full. */
export function addCode(codes: readonly string[], code: string): string[] {
  if (codes.includes(code) || codes.length >= MAX_RUN_CODES) return [...codes];
  return [...codes, code].sort(compareCodes);
}

/** The run's stocks without `code`; a run keeps at least one stock. */
export function removeCode(codes: readonly string[], code: string): string[] {
  if (codes.length <= 1) return [...codes];
  return codes.filter((item) => item !== code);
}

/**
 * The day's stocks matching what was typed: a code from its start, or a name containing it (case ignored). An exact
 * code comes first, then by code. Nothing for an empty query. At most `limit`, and how many matched in all.
 */
export function searchSymbols(
  symbols: readonly PickerSymbol[],
  query: string,
  limit = SEARCH_SHOWN,
): { shown: PickerSymbol[]; total: number } {
  const text = query.trim().toLowerCase();
  if (!text) return { shown: [], total: 0 };
  const matches = symbols.filter(
    (symbol) => symbol.code.startsWith(text) || symbol.name.toLowerCase().includes(text),
  );
  matches.sort((a, b) => Number(b.code === text) - Number(a.code === text) || compareCodes(a.code, b.code));
  return { shown: matches.slice(0, limit), total: matches.length };
}

/** What the records list says about a run: finished with a review, given up, or not finished yet. */
export function recordStatus(record: Pick<RunRecord, "completed" | "abandoned" | "reflected">): string {
  if (record.abandoned) return "已放棄";
  if (!record.completed) return "未完成";
  return record.reflected ? "已復盤" : "未復盤";
}

/** A run's result as the records list shows it: "+12,345", "-800" or "0" (TWD, whole dollars). */
export function formatPnl(pnl: number): string {
  if (!Number.isFinite(pnl)) return "—";
  const whole = Math.round(pnl);
  return `${whole > 0 ? "+" : ""}${whole.toLocaleString("zh-TW")}`;
}

/**
 * The records that open: a lesson opens its latest run (the API has no other way in), so of each lesson's runs only
 * the newest one, the first listed, is a link.
 */
export function openableRecords(records: readonly RunRecord[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const record of records) {
    if (seen.has(record.lessonId)) continue;
    seen.add(record.lessonId);
    ids.add(record.id);
  }
  return ids;
}

/** A catalog with nothing of the market: the stocks of a run whose day's data could not be read (previousClose 0). */
export const isTextOnly = (catalog: MorningCatalog): boolean =>
  catalog.symbols.length > 0 && catalog.symbols.every((symbol) => !(symbol.previousClose > 0));

const codesOf = (catalog: MorningCatalog) => catalog.symbols.map((symbol) => symbol.code);

/**
 * What the desk holds after a reply, from what it held before. A start, a step or a retired run's page carries no
 * lesson list, a step no records and only a GET the picker: those are kept from before (the picker only for the same
 * lesson, so a new round on that day can be picked). A run's text-only catalog (sent when its day's data could not
 * be read as it was finished or abandoned) gives way to the catalog held for the same stocks, which knows their
 * previous closes.
 */
export function carryHeld(previous: DeskResponse | null, next: DeskResponse): DeskResponse {
  if (!previous) return next;
  const desk: DeskResponse = { ...next };
  if (desk.lessons === undefined && previous.lessons !== undefined) desk.lessons = previous.lessons;
  if (desk.records === undefined && previous.records !== undefined) desk.records = previous.records;
  const lessonId = next.state?.lessonId ?? next.catalog.lessonId;
  if (desk.picker === undefined && !next.retired && previous.picker?.lessonId === lessonId)
    desk.picker = previous.picker;
  if (
    !next.retired &&
    !previous.retired &&
    isTextOnly(next.catalog) &&
    !isTextOnly(previous.catalog) &&
    previous.catalog.lessonId === next.catalog.lessonId &&
    sameCodes(codesOf(previous.catalog), codesOf(next.catalog))
  )
    desk.catalog = previous.catalog;
  return desk;
}

/**
 * The desk before a run, on the stocks picked: the catalog's own entry for a stock it has (the day's defaults, or
 * a finished run's stocks), else the picker's (its reference price is the previous close), by the picked order. The
 * day's 「預設：…」 note goes with it only while the picked stocks are the day's defaults.
 */
export function previewCatalog(
  catalog: MorningCatalog,
  picker: { symbols: readonly PickerSymbol[]; defaults: readonly string[]; note: { title: string; detail: string | null } },
  codes: readonly string[],
): MorningCatalog {
  const held = new Map(catalog.symbols.map((symbol) => [symbol.code, symbol]));
  const offered = new Map(picker.symbols.map((symbol) => [symbol.code, symbol]));
  const symbols = codes.flatMap((code) => {
    const known = held.get(code);
    if (known) return [known];
    const symbol = offered.get(code);
    return symbol ? [{ code, name: symbol.name, previousClose: symbol.referencePrice, previous5CloseMean: null }] : [];
  });
  const preview: MorningCatalog = { ...catalog, symbols };
  if (sameCodes(codes, picker.defaults)) preview.note = { ...picker.note };
  else delete preview.note;
  return preview;
}
