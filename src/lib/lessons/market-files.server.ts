import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { readBookTimeline, type BookTimeline } from "./books.ts";
import { MORNING_END_MS, type TradeRow } from "./trades.ts";
import type { RadarList } from "./types.ts";

/**
 * Read-only access to what the Fubon fetcher published for the daily lessons under MARKET_DATA_DIR: the real
 * trades (ticks/), the TAIEX 5-second points (taiex/), the 當沖 lists (radar/) and the recorded books (books/).
 * A missing file, a bad date or code and a file that is not what the fetcher writes are all "no data" (null).
 */
export type TicksManifest = { date: string; symbols: { code: string; complete: boolean }[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RADAR_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const CODE = /^\d{4,6}[A-Z]?$/;
const TICK_FIELDS = ["msAfter0900", "price", "size", "bid", "ask"];

export function marketDataDir(): string {
  return process.env.MARKET_DATA_DIR?.trim() ?? "";
}

/** A file saved by a Windows editor may start with a byte order mark. */
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(withoutBom(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function readGzipJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(gunzipSync(await readFile(path)).toString("utf8"));
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPositive = (value: unknown): value is number => isNumber(value) && value > 0;

/** Malformed entries are left out; a list with entries but none usable is a format problem, so no data. */
export async function readTicksManifest(dir: string, date: string): Promise<TicksManifest | null> {
  if (!DATE.test(date)) return null;
  const manifest = await readJson(join(dir, "ticks", date, "manifest.json"));
  if (!isRecord(manifest) || manifest.schema !== 1 || manifest.date !== date || !Array.isArray(manifest.symbols)) return null;
  const symbols = manifest.symbols.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.code === "string" && CODE.test(entry.code) && typeof entry.complete === "boolean"
      ? [{ code: entry.code, complete: entry.complete }]
      : [],
  );
  return manifest.symbols.length && !symbols.length ? null : { date, symbols };
}

/** [ms, price, size, bid, ask]: time whole and from 09:00, price and size positive (size in whole lots), the
 *  quotes of the time of the trade positive or null (a side that was empty). */
function isTradeRow(row: unknown): row is TradeRow {
  return Array.isArray(row) && row.length === 5 && Number.isInteger(row[0]) && row[0] >= 0 && isPositive(row[1]) &&
    Number.isInteger(row[2]) && row[2] > 0 && (row[3] === null || isPositive(row[3])) && (row[4] === null || isPositive(row[4]));
}

/**
 * The trades before 10:30 of one stock, in time order. Anything from 10:30 on is not read, not even to check it;
 * the 13:35 after-hours rows are a list of their own that is never looked at. A trade that breaks the rules
 * (price, whole positive lots, time not going back) makes the file no data.
 */
export async function readMorningTrades(dir: string, date: string, code: string): Promise<TradeRow[] | null> {
  if (!DATE.test(date) || !CODE.test(code)) return null;
  const file = await readGzipJson(join(dir, "ticks", date, "symbols", `${code}.json.gz`));
  if (!isRecord(file) || file.schema !== 1 || file.code !== code || file.date !== date || file.sizeUnit !== "lot") return null;
  if (!Array.isArray(file.fields) || file.fields.join() !== TICK_FIELDS.join() || !Array.isArray(file.trades)) return null;
  const trades: TradeRow[] = [];
  for (const row of file.trades as unknown[]) {
    if (Array.isArray(row) && isNumber(row[0]) && row[0] >= MORNING_END_MS) break;
    if (!isTradeRow(row) || (trades.length && row[0] < trades[trades.length - 1][0])) return null;
    trades.push([row[0], row[1], row[2], row[3], row[4]]);
  }
  return trades;
}

/** TWSE's 5-second TAIEX points of a day: [seconds after 09:00, value]; every point must be a pair of numbers. */
export async function readTaiexPoints(dir: string, date: string): Promise<{ previousClose: number; points: [number, number][] } | null> {
  if (!DATE.test(date)) return null;
  const file = await readJson(join(dir, "taiex", date, "points.json"));
  if (!isRecord(file) || file.schema !== 1 || file.date !== date || !isPositive(file.previousClose) || !Array.isArray(file.points)) return null;
  const points: [number, number][] = [];
  for (const point of file.points as unknown[]) {
    if (!Array.isArray(point) || point.length !== 2 || !isNumber(point[0]) || !isPositive(point[1])) return null;
    points.push([point[0], point[1]]);
  }
  return { previousClose: file.previousClose, points };
}

/** The days that have a stored 當沖 list, oldest first. Other names (and folders) in radar/ are not lists. */
export async function listRadarDates(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(dir, "radar"), { withFileTypes: true });
    return entries
      .flatMap((entry) => (entry.isFile() ? [RADAR_FILE.exec(entry.name)?.[1]] : []))
      .filter((date): date is string => !!date)
      .sort();
  } catch {
    return [];
  }
}

/** A day's stored 當沖 list as it is, duplicates and codes the lessons do not teach included. */
export async function readRadarList(dir: string, date: string): Promise<RadarList | null> {
  if (!DATE.test(date)) return null;
  const file = await readJson(join(dir, "radar", `${date}.json`));
  if (!isRecord(file) || file.schema !== 1 || file.date !== date || file.kind !== "當沖" || !Array.isArray(file.symbols)) return null;
  const symbols: RadarList["symbols"] = [];
  for (const entry of file.symbols as unknown[]) {
    if (!isRecord(entry) || typeof entry.code !== "string" || typeof entry.name !== "string") return null;
    symbols.push({ code: entry.code, name: entry.name });
  }
  return { date, symbols };
}

/** One stock's recorded books of the morning, and the unit the file says its sizes are in ("unverified" until known). */
export async function readBooks(dir: string, date: string, code: string): Promise<{ timeline: BookTimeline; sizeUnit: string } | null> {
  if (!DATE.test(date) || !CODE.test(code)) return null;
  const file = await readGzipJson(join(dir, "books", date, "symbols", `${code}.json.gz`));
  if (!isRecord(file) || file.code !== code || file.date !== date || typeof file.sizeUnit !== "string") return null;
  const timeline = readBookTimeline(file);
  return timeline ? { timeline, sizeUnit: file.sizeUnit } : null;
}

/** The SHA-256 (hex) of a file, or null when it cannot be read. */
export async function sha256File(path: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch {
    return null;
  }
}
