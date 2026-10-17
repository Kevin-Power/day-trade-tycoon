// Disposable market-data fixture for the daily question: one full-market day (2026-10-14) with two
// hand-made retests of the day's high (one makes a higher high, one does not) and quiet filler stocks.
// Usage: node scripts/qa/make-market-fixture.mjs <dir>   (also imported by tests and desk-server)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const DATE = "2026-10-14";
const CLOSE_T = 16200;
const LAST_CONTINUOUS_T = 15840;

/** [high, low, close] per minute from 09:00; open is the previous close; volume and average are filler. */
function toRows(minutes) {
  return minutes.map(([h, l, c], index) => [index * 60, index ? minutes[index - 1][2] : c, h, l, c, 20 + (index % 7), c]);
}
function fillTo(minutes, high) {
  const out = [...minutes];
  while (out.length * 60 <= LAST_CONTINUOUS_T) out.push([high - (out.length % 3) * 0.1, high - 0.6, high - 0.3]);
  return out;
}
const RETEST = [
  [98.1, 97.9, 98], [98.3, 98, 98.2], [98.5, 98.2, 98.4], [98.7, 98.4, 98.6], [98.9, 98.6, 98.8], [99.1, 98.8, 99],
  [99.6, 99, 99.5], [100, 99.5, 99.8], [99.7, 99.4, 99.5], [99.4, 99.1, 99.2], [99.2, 99, 99], [99.3, 99, 99.2],
  [99.85, 99.2, 99.8],
];
function day(after, tailHigh) {
  const rows = toRows(fillTo([...RETEST, ...after], tailHigh));
  const last = rows.at(-1);
  rows.push([CLOSE_T, last[4], last[4], last[4], last[4], 300, last[4]]);
  return rows;
}
const higher = day([[100.2, 99.6, 100], [100.8, 100, 100.5], [100.3, 99.9, 100.1], [100.1, 99.8, 100]], 100.4);
const lower = day([[99.6, 99.2, 99.3], [99.4, 99, 99.1], [99.2, 98.8, 98.9]], 99);
const flat = Array.from({ length: 266 }, (_, index) => [index * 60, 50, 50, 50, 50, 5, 50]).concat([[CLOSE_T, 50, 50, 50, 50, 50, 50]]);

const SYMBOLS = [
  { code: "2330", name: "台積電", rows: higher, tradeValue: 90_000_000_000, tradeVolume: 30_000 },
  { code: "2317", name: "鴻海", rows: lower, tradeValue: 80_000_000_000, tradeVolume: 60_000 },
  ...["2303", "2454", "2382", "2308", "2412", "2881", "2882", "2891", "1301", "2002"].map((code, index) => ({
    code, name: `測試${code}`, rows: flat, tradeValue: 1_000_000_000 - index, tradeVolume: 1_000 - index,
  })),
];

export async function writeMarketFixture(dir) {
  await mkdir(join(dir, "days", DATE, "symbols"), { recursive: true });
  const symbols = SYMBOLS.map(({ code, name, rows, tradeValue, tradeVolume }) => ({
    code, name, referencePrice: rows[0][1], close: rows.at(-1)[4], change: 0, tradeVolume, tradeValue, disposition: false, bars: rows.length,
  }));
  await writeFile(join(dir, "days", DATE, "index.json"),
    JSON.stringify({ schema: 1, date: DATE, coverage: "full-market", volumeUnit: "lot", symbols }, null, 1));
  for (const { code, rows } of SYMBOLS)
    await writeFile(join(dir, "days", DATE, "symbols", `${code}.json.gz`), gzipSync(JSON.stringify({ schema: 1, code, date: DATE, bars: rows })));
  await writeFile(join(dir, "index.json"), JSON.stringify({ schema: 1, days: [
    { date: DATE, coverage: "full-market", symbols: symbols.length, publishedAt: "2026-10-14T18:00:00+08:00" },
  ] }, null, 1));
  return { dataDate: DATE };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node scripts/qa/make-market-fixture.mjs <dir>");
  await writeMarketFixture(target);
  console.log(`Market fixture written to ${target}`);
}
