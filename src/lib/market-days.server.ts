import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Read-only access to the Fubon fetcher's published market data (MARKET_DATA_DIR). */
export type PublishedDay = { date: string; coverage: string; symbols: number; publishedAt: string };
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
    return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
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
    .map(({ date, coverage, symbols, publishedAt }) => ({ date, coverage, symbols, publishedAt }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function readDaySymbols(dir: string, date: string): Promise<DaySymbol[] | null> {
  if (!DATE.test(date)) return null;
  const day = (await readJson(join(dir, "days", date, "index.json"))) as { symbols?: unknown } | null;
  return day && Array.isArray(day.symbols) ? (day.symbols as DaySymbol[]) : null;
}

export async function readSymbolBars(dir: string, date: string, code: string): Promise<MarketBarRow[] | null> {
  if (!DATE.test(date) || !CODE.test(code)) return null;
  try {
    const raw = await readFile(join(dir, "days", date, "symbols", `${code}.json.gz`));
    const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as { bars?: unknown };
    return Array.isArray(parsed.bars) ? (parsed.bars as MarketBarRow[]) : null;
  } catch {
    return null;
  }
}
