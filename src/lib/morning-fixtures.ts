// Tests only: never imported by the app. A market-data folder made in code, in the formats tools/fubon-daily writes
// (the same shapes as the helpers of lessons/daily-lessons.test.ts), and a classroom database on PGlite with the
// migrations the practice API needs. Nothing here reads or writes production data: every folder is a fresh mkdtemp.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";
import type { MarketBarRow } from "./market-days.server.ts";
import { clearLessonCaches } from "./lessons/daily-lessons.server.ts";
import type { TradeRow } from "./lessons/trades.ts";
import { clearMorningDataCaches } from "./morning-data.server.ts";

const NAMES: Record<string, string> = {
  "2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2603": "長榮", "1101": "台泥", "2002": "中鋼", "2881": "富邦金",
  "2882": "國泰金", "2883": "凱基金", "2886": "兆豐金", "2891": "中信金", "6488": "環球晶",
};

export type FixtureStock = {
  code: string;
  name?: string;
  referencePrice?: number;
  close?: number;
  tradeValue?: number;
  disposition?: boolean;
  /** Morning trades; by default two, in the first two minutes. */
  trades?: TradeRow[];
  /** The published 1-minute bars; by default made from the trades, so the two agree. */
  bars?: MarketBarRow[];
  /** The ticks manifest's flag. */
  complete?: boolean;
};

/** Two trades, in the first two minutes. */
export const twoTrades = (price: number): TradeRow[] => [
  [1_000, price, 2, price - 0.5, price],
  [61_000, price + 0.5, 3, price, price + 0.5],
];

/** One trade a minute from cell `from` to 10:29, 1 s into the minute, stepping between three prices. */
export function everyMinute(price: number, from = 0): TradeRow[] {
  return Array.from({ length: 90 - from }, (_, index) => {
    const cell = from + index;
    const traded = price + (cell % 3) * 0.5;
    return [cell * 60_000 + 1_000, traded, 1 + (cell % 4), traded - 0.5, traded] as TradeRow;
  });
}

/** The 1-minute bars the fetcher publishes for these trades (they agree minute by minute). */
export function barsFrom(trades: readonly TradeRow[]): MarketBarRow[] {
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

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function put(dir: string, path: string, content: string | Buffer): Promise<void> {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), content);
}
const putGz = (dir: string, path: string, value: unknown) => put(dir, path, gzipSync(JSON.stringify(value)));

async function addToIndex(dir: string, entry: Record<string, unknown>): Promise<void> {
  let index: { schema: number; days: Record<string, unknown>[] } = { schema: 1, days: [] };
  try {
    index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
  } catch {
    // the folder's first day
  }
  index.days = [...index.days.filter((day) => day.date !== entry.date), entry];
  await put(dir, "index.json", JSON.stringify(index));
}

/** A full-market day: days/ (index, bars, manifest), ticks/ (manifest, trades), the root index.json, a TAIEX on request. */
export async function writeDay(dir: string, date: string, stocks: FixtureStock[], options: { taiex?: boolean } = {}): Promise<void> {
  const symbols = stocks.map((stock) => {
    const referencePrice = stock.referencePrice ?? 100;
    const close = stock.close ?? referencePrice + 1;
    return {
      code: stock.code,
      name: stock.name ?? NAMES[stock.code] ?? `股${stock.code}`,
      referencePrice,
      close,
      change: close - referencePrice,
      tradeVolume: 10,
      tradeValue: stock.tradeValue ?? 1_000_000,
      disposition: stock.disposition ?? false,
      bars: 2,
    };
  });
  await put(dir, `days/${date}/index.json`, JSON.stringify({ schema: 1, date, coverage: "full-market", volumeUnit: "lot", symbols }));
  for (const stock of stocks) {
    const trades = stock.trades ?? twoTrades(stock.referencePrice ?? 100);
    const afternoonBar: MarketBarRow = [7_200, 1, 1, 1, 1, 1, 1];
    await putGz(dir, `days/${date}/symbols/${stock.code}.json.gz`, {
      schema: 1, code: stock.code, date, volumeUnit: "lot", bars: [...(stock.bars ?? barsFrom(trades)), afternoonBar],
    });
    await putGz(dir, `ticks/${date}/symbols/${stock.code}.json.gz`, {
      schema: 1, code: stock.code, date, sizeUnit: "lot", fields: ["msAfter0900", "price", "size", "bid", "ask"],
      trades: [...trades, [7_200_000, 1, 1, null, null]], afterHours: [],
    });
  }
  await put(dir, `ticks/${date}/manifest.json`, JSON.stringify({
    schema: 1, date, sizeUnit: "lot", symbols: stocks.map((stock) => ({ code: stock.code, complete: stock.complete !== false })),
  }));
  if (options.taiex) {
    const points = Array.from({ length: 1081 }, (_, step) => [step * 5, 20_000 + step]);
    await put(dir, `taiex/${date}/points.json`, JSON.stringify({ schema: 1, date, previousClose: 20_000, points }));
  }
  const manifest = JSON.stringify({ schema: 1, date, coverage: "full-market", codes: stocks.map((stock) => stock.code) });
  await put(dir, `days/${date}/manifest.json`, manifest);
  await addToIndex(dir, { date, coverage: "full-market", symbols: stocks.length, manifestSha256: sha256(manifest), publishedAt: `${date}T17:10:00+08:00` });
}

/** The 當沖 list the fetcher stored for `date` (radar/<date>.json). */
export const putRadar = (dir: string, date: string, codes: string[]) =>
  put(dir, `radar/${date}.json`, JSON.stringify({
    schema: 1, date, kind: "當沖", fetchedAt: `${date}T19:00:00+08:00`, sha256: "x",
    symbols: codes.map((code) => ({ code, name: NAMES[code] ?? `股${code}` })),
  }));

/** Recorded books: rows [dt, flags, payload] as books_compact.py writes them (flag 4: the whole book). */
export async function putBooks(dir: string, date: string, sizeUnit: string, files: Record<string, { rows: unknown[]; gaps: unknown[] }>): Promise<void> {
  await put(dir, `books/${date}/manifest.json`, JSON.stringify({ schema: 1, date, sizeUnit, symbols: Object.keys(files).map((code) => ({ code })) }));
  for (const [code, file] of Object.entries(files)) {
    await putGz(dir, `books/${date}/symbols/${code}.json.gz`, { schema: 1, code, date, sizeUnit: "unverified", keyEvery: 60_000, ...file });
  }
}

/** A book that changes once a minute, 2 s into it: whole at 09:00:02, then the best bid moves up 0.5 each minute. */
export function minuteBook(price: number): { rows: unknown[]; gaps: unknown[] } {
  const rows: unknown[] = [[2_000, 4, [[[price - 0.5, 10]], [[price, 5]]]]];
  for (let cell = 1; cell < 90; cell += 1) rows.push([60_000, 0, [[0, price - 0.5 + cell * 0.5, 10 + cell]]]);
  return { rows, gaps: [] };
}

export const SIX: FixtureStock[] = [
  { code: "2330", referencePrice: 1000, tradeValue: 9_000_000 },
  { code: "2317", referencePrice: 200, tradeValue: 8_000_000 },
  { code: "2454", referencePrice: 1200, tradeValue: 7_000_000 },
  { code: "2603", referencePrice: 180, tradeValue: 6_000_000 },
  { code: "1101", referencePrice: 30, tradeValue: 5_000_000 },
  { code: "2002", referencePrice: 20, tradeValue: 4_000_000 },
];

/** The same six stocks trading every minute of the morning. */
export const SIX_ALL_MORNING: FixtureStock[] = SIX.map((stock) => ({ ...stock, trades: everyMinute(stock.referencePrice!) }));

/** A fresh market-data folder (and fresh lesson caches) for `run`; removed afterwards. */
export async function withMarket(run: (dir: string) => Promise<void>): Promise<void> {
  clearLessonCaches();
  clearMorningDataCaches();
  const dir = await mkdtemp(join(tmpdir(), "morning-market-test-"));
  try {
    await run(dir);
  } finally {
    clearLessonCaches();
    clearMorningDataCaches();
    await rm(dir, { recursive: true, force: true });
  }
}

type Db = { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> };

/** The app's tagged-template SQL over one PGlite connection or transaction. */
export function sqlFor(db: Db): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) =>
    (await db.query<T>(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) => (await db.query<T>(query, params)).rows;
  return sql;
}

const MIGRATIONS = ["0001_auth.sql", "0003_classroom.sql", "0007_morning_replay.sql", "0008_anonymous_users.sql", "0009_daily_questions.sql"];

/** Members with an accepted profile; guests are anonymous accounts; "unconsented" has a profile without the statement. */
export const MEMBERS = ["alice", "bob", "member"] as const;
export const GUESTS = ["guest", "guest2"] as const;

export type Classroom = {
  db: PGlite;
  /** One transaction, as the route runs every request. */
  tx: <T>(run: (sql: Sql) => Promise<T>) => Promise<T>;
  count: (query: string, params?: unknown[]) => Promise<number>;
  /** Closes and reopens the database from disk. */
  reopen: () => Promise<void>;
};

/** A classroom database on disk (PGlite) with the practice tables and a few accounts; removed afterwards. */
export async function withClassroom(run: (classroom: Classroom) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "morning-sql-test-"));
  let db = new PGlite({ dataDir: join(directory, "pglite") });
  try {
    for (const migration of MIGRATIONS) await db.exec(await readFile(new URL("../../migrations/" + migration, import.meta.url), "utf8"));
    const accounts: [string, boolean][] = [
      ...MEMBERS.map((id): [string, boolean] => [id, false]),
      ...GUESTS.map((id): [string, boolean] => [id, true]),
      ["unconsented", false],
      ["stranger", false],
    ];
    for (const [id, anonymous] of accounts)
      await db.query('INSERT INTO "user"(id,name,email,"emailVerified","isAnonymous") VALUES($1,$1,$2,FALSE,$3)', [id, id + "@example.invalid", anonymous]);
    for (const id of MEMBERS)
      await db.query("INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES($1,$1,'student','A',NOW())", [id]);
    await db.query("INSERT INTO classroom_profiles(user_id,display_name,role,class_code,tos_accepted_at) VALUES('unconsented','U','student','A',NULL)");
    const classroom: Classroom = {
      get db() {
        return db;
      },
      tx: (work) => db.transaction((tx) => work(sqlFor(tx))),
      count: async (query, params) => Number((await db.query<{ count: number }>(query, params)).rows[0].count),
      reopen: async () => {
        await db.close();
        db = new PGlite({ dataDir: join(directory, "pglite") });
      },
    };
    await run(classroom);
  } finally {
    await db.close();
    const target = resolve(directory);
    const temporaryRoot = resolve(tmpdir());
    const relativeTarget = relative(temporaryRoot, target);
    // Never remove a path outside this test's own temporary directory.
    const own = Boolean(relativeTarget) && !relativeTarget.startsWith("..") && !isAbsolute(relativeTarget)
      && dirname(target) === temporaryRoot && basename(target).startsWith("morning-sql-test-");
    if (own) await rm(target, { recursive: true, force: true });
  }
}
