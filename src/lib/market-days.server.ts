import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Read-only access to the Fubon fetcher's published market data (MARKET_DATA_DIR). */
/** `manifestSha256` is the SHA-256 of days/<date>/manifest.json, when index.json has it. */
export type PublishedDay = { date: string; coverage: string; symbols: number; publishedAt: string; manifestSha256?: string };
export type DaySymbol = {
  code: string;
  name: string;
  referencePrice: number;
  close: number;
  tradeVolume: number;
  tradeValue: number;
  disposition: boolean;
  bars: number;
};
export type MarketBarRow = [t: number, o: number, h: number, l: number, c: number, v: number, a: number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^\d{4,6}[A-Z]?$/;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export async function listPublishedDays(dir: string): Promise<PublishedDay[]> {
  const index = (await readJson(join(dir, "index.json"))) as { days?: unknown } | null;
  if (!index || !Array.isArray(index.days)) return [];
  return index.days
    .filter(
      (day): day is PublishedDay =>
        !!day && typeof day === "object" && typeof (day as PublishedDay).date === "string" && DATE.test((day as PublishedDay).date),
    )
    .map(({ date, coverage, symbols, publishedAt, manifestSha256 }) => ({
      date,
      coverage,
      symbols,
      publishedAt,
      ...(typeof manifestSha256 === "string" ? { manifestSha256 } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const NUMBER_FIELDS = ["referencePrice", "close", "tradeVolume", "tradeValue", "bars"] as const;
function isDaySymbol(value: unknown): value is DaySymbol {
  if (!value || typeof value !== "object") return false;
  const symbol = value as Record<string, unknown>;
  return typeof symbol.code === "string" && CODE.test(symbol.code) && typeof symbol.name === "string" &&
    typeof symbol.disposition === "boolean" && NUMBER_FIELDS.every((field) => Number.isFinite(symbol[field]));
}

/** [t, o, h, l, c, v, a]: the first six must be finite numbers. */
const isBarRow = (row: unknown): row is MarketBarRow =>
  Array.isArray(row) && row.length >= 6 && row.slice(0, 6).every((value) => Number.isFinite(value));

/** Malformed entries are left out; a list with entries but none usable is a format problem, so no data. */
export async function readDaySymbols(dir: string, date: string): Promise<DaySymbol[] | null> {
  if (!DATE.test(date)) return null;
  const day = (await readJson(join(dir, "days", date, "index.json"))) as { symbols?: unknown } | null;
  if (!day || !Array.isArray(day.symbols)) return null;
  const symbols = day.symbols.filter(isDaySymbol);
  return day.symbols.length && !symbols.length ? null : symbols;
}

/** A file with any malformed row is no data for that symbol. */
export async function readSymbolBars(dir: string, date: string, code: string): Promise<MarketBarRow[] | null> {
  if (!DATE.test(date) || !CODE.test(code)) return null;
  try {
    const raw = await readFile(join(dir, "days", date, "symbols", `${code}.json.gz`));
    const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as { bars?: unknown } | null;
    const bars = parsed?.bars;
    return Array.isArray(bars) && bars.every(isBarRow) ? bars : null;
  } catch {
    return null;
  }
}
