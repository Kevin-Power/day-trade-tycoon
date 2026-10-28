// Disposable market-data fixture in the formats tools/fubon-daily publishes, for the daily question and the QA
// classrooms (desk-server.mjs). Nothing here is real market data: every price, trade, book and list is made from a
// seeded generator, so each run writes the same bytes.
//   - 2026-10-14: the daily question's day (one full-market day with two hand-made retests of the day's high).
//   - 2026-10-21, 2026-10-22, 2026-10-27: three full-market lesson days with 1-minute bars (days/), the real-trade
//     files and their manifest (ticks/), and the root index.json entry with the manifest's SHA-256. Every bar is made
//     from the trades, so the strict check of the lessons (lessons/trades.ts morningBars) passes, except for the one
//     stock that is meant to fail it.
//   - TAIEX 5-second points (taiex/) on 10/21 and 10/27; 10/22 has none.
//   - Recorded books (books/) on 10/27 only, sizes in lots, one stock with a recording gap.
//   - The 當沖 lists (radar/): 2026-10-20 (used by 10/21) and 2026-10-22 (70 codes, used by 10/27, with 上櫃 and an
//     unknown code). 10/22 has no list of the day before, so it falls back to the day's top 5.
//   - status.json with the fetcher's ticks, taiex and radar keys.
// Special stocks (FIXTURE below): a 處置 stock, a stock with no trade before 10:30, a stock that first trades at 09:06
// and then only now and then, a stock whose trades are marked incomplete, a stock whose bars do not agree with its
// trades, a stock with bars but no trades file (10/27), a stock that closes late (13:33) and the five hot stocks
// (2330, 2317, 2454, 2308, 2382) the older desk QA picks, always the day's top 5 by turnover.
// Usage: node scripts/qa/make-market-fixture.mjs <dir>   (also imported by tests and desk-server)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// ── 2026-10-14: the daily question's day (unchanged) ─────────────────────────────────────────────────────────────

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

// ── The lesson days ──────────────────────────────────────────────────────────────────────────────────────────────

const MORNING_CELLS = 90;
const CELL_MS = 60_000;
const CLOSE_MS = 16_200_000; // 13:30:00
const LATE_CLOSE_MS = 16_380_000; // 13:33:00, a delayed close
const VERSION = "qa-fixture-2026-10-28";

/** The five hot stocks the older desk QA picks: always the day's top 5 by turnover (reference price on 10/21). */
const HOT = [
  { code: "2330", price: 1465, rate: 60, lots: [5, 40] },
  { code: "2317", price: 226, rate: 45, lots: [10, 60] },
  { code: "2454", price: 1405, rate: 40, lots: [3, 30] },
  { code: "2308", price: 1010, rate: 35, lots: [3, 30] },
  { code: "2382", price: 291.5, rate: 30, lots: [10, 60] },
];
/** Listed (上市) stocks of the fixture besides the hot five, in this order; names come from the catalogue. */
const ORDINARY = (
  "1101 1102 1216 1301 1303 1326 1402 1503 1504 1513 1519 1590 1605 2002 2027 2059 2105 2201 2207 2301 2303 2313 " +
  "2324 2327 2337 2344 2345 2347 2353 2356 2357 2360 2368 2376 2377 2379 2383 2395 2404 2408 2409 2412 2449 2451 " +
  "2474 2492 2603 2609 2610 2615 2618 2633 2801 2880 2881 2882 2883 2884 2885 2886 2887 2890 2891 2892 2912 3008 " +
  "3017 3034 3035 3037 3045 3231 3443 3481 3533 3653 3661 3702 3711 4904 4938 5871 5876 5880 6116 6239 6505"
).split(" ");

/** What the QA scripts may rely on. */
export const FIXTURE = {
  questionDay: DATE,
  lessonDays: ["2026-10-21", "2026-10-22", "2026-10-27"],
  hot: HOT.map((stock) => stock.code),
  /** Under 處置 on every lesson day: practisable, never in a top 5. */
  disposition: "2409",
  /** No trade before 10:30 on any lesson day (it trades in the afternoon): never practisable. */
  cold: "2633",
  /** First trades at 09:06 (cell 6), then only in some minutes: a stock with minutes that have no trade. */
  thin: "2201",
  thinFirstCell: 6,
  /** The ticks manifest marks its trades incomplete (complete:false) on every lesson day. */
  incomplete: "2105",
  /** One morning bar does not agree with its trades on every lesson day: refused by the strict check. */
  mismatch: "2344",
  /** 10/27 only: in the day's bars but with no trades file. */
  noTicks: "2610",
  noTicksDay: "2026-10-27",
  /** Closes at 13:33 (a delayed close) on every lesson day. */
  lateClose: "1513",
  /** The day with recorded books, and its stock with a recording gap (ms after 09:00, start included). */
  booksDay: "2026-10-27",
  gapStock: "2603",
  gap: [240_000, 390_000],
  /** The day without TAIEX. */
  noTaiexDay: "2026-10-22",
  /** 上櫃 codes and a code the catalogue does not know, both only in the 當沖 lists. */
  otc: ["6488", "8299"],
  unknown: "9998",
  /** radar/<date>.json codes, in the order the sheet lists them, and the lesson each one serves. */
  radar: {},
  radarFor: { "2026-10-21": "2026-10-20", "2026-10-22": null, "2026-10-27": "2026-10-22" },
};

const catalogue = JSON.parse(readFileSync(new URL("../../src/lib/market/catalogue.json", import.meta.url), "utf8")).symbols;
const NAMES = new Map(catalogue.map((stock) => [stock.code, stock.name]));
const MARKETS = new Map(catalogue.map((stock) => [stock.code, stock.market]));
for (const code of [...HOT.map((stock) => stock.code), ...ORDINARY])
  if (MARKETS.get(code) !== "TWSE") throw new Error(`fixture stock ${code} is not a 上市 stock of the catalogue`);
for (const code of FIXTURE.otc) if (MARKETS.get(code) !== "TPEx") throw new Error(`fixture 上櫃 code ${code} is not 上櫃`);
if (NAMES.has(FIXTURE.unknown)) throw new Error(`fixture unknown code ${FIXTURE.unknown} is in the catalogue`);

// The 當沖 lists. 10/22 (for 10/27): 70 codes = the hot five, the 處置, thin and gap stocks, 55 ordinary stocks
// (practisable), the cold, incomplete, mismatched and no-trades stocks and the unknown code (no practisable data),
// and two 上櫃 codes. 10/20 (for 10/21): 14 codes, one 上櫃 and the cold stock among them.
const SPECIAL = new Set([FIXTURE.disposition, FIXTURE.cold, FIXTURE.thin, FIXTURE.incomplete, FIXTURE.mismatch,
  FIXTURE.noTicks, FIXTURE.gapStock]);
const PLAIN = ORDINARY.filter((code) => !SPECIAL.has(code));
const LIST_1022 = [
  ...FIXTURE.hot, FIXTURE.disposition, FIXTURE.thin, FIXTURE.gapStock, ...PLAIN.slice(0, 55),
  FIXTURE.cold, FIXTURE.incomplete, FIXTURE.mismatch, FIXTURE.noTicks, FIXTURE.unknown, ...FIXTURE.otc,
];
const LIST_1020 = [...FIXTURE.hot, FIXTURE.disposition, FIXTURE.gapStock, ...PLAIN.slice(3, 8), FIXTURE.cold, FIXTURE.otc[0]];

/** Seeded generator (mulberry32 on the first 4 bytes of a SHA-256). */
function random(seed) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (next, low, high) => low + Math.floor(next() * (high - low + 1));
// The sheet's order: stable per list, not the code order.
function shuffled(codes, seed) {
  const next = random(seed);
  const out = [...codes];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
FIXTURE.radar = { "2026-10-20": shuffled(LIST_1020, "radar-1020"), "2026-10-22": shuffled(LIST_1022, "radar-1022") };

// Prices in cents on TWSE's grid: under 10 by 0.01, under 50 by 0.05, under 100 by 0.1, under 500 by 0.5, under 1000
// by 1, from 1000 by 5.
const tick = (cents) => (cents < 1_000 ? 1 : cents < 5_000 ? 5 : cents < 10_000 ? 10 : cents < 50_000 ? 50 : cents < 100_000 ? 100 : 500);
const up = (cents) => cents + tick(cents);
const down = (cents) => cents - tick(cents - 1);
const onGrid = (cents) => cents - (cents % tick(cents));
const move = (cents, steps) => {
  let out = cents;
  for (let i = 0; i < Math.abs(steps); i++) out = steps > 0 ? up(out) : down(out);
  return out;
};
const toPrice = (cents) => cents / 100;
const round2 = (value) => Math.round(value * 100) / 100;

/** The stocks of the lesson days, with their 10/21 reference price (cents), trades a minute and lot sizes. */
const STOCKS = [
  ...HOT.map((stock) => ({ ...stock, price: Math.round(stock.price * 100) })),
  ...ORDINARY.map((code) => {
    const next = random(`stock-${code}`);
    return { code, price: onGrid(between(next, 1_800, 42_000)), rate: between(next, 8, 25), lots: [1, between(next, 3, 8)] };
  }),
].map((stock) => ({ ...stock, name: NAMES.get(stock.code) }));

/**
 * One stock's trades of a day: [ms after 09:00, price, size in lots, bid, ask]. Each minute has a level that moves
 * a tick now and then, the trades bounce around it and the minute closes on it, so closes often repeat while the
 * price moves inside every minute. The first trade of the day and the closing trade have no quotes (auctions).
 */
function makeTrades(stock, date, reference, factor) {
  const next = random(`trades-${date}-${stock.code}`);
  const low = onGrid(Math.ceil(reference * 0.94));
  const high = onGrid(Math.floor(reference * 1.06));
  const clamp = (cents) => Math.min(high, Math.max(low, cents));
  const trades = [];
  let level = clamp(move(reference, between(next, -2, 2)));
  let last = null;
  const trade = (ms, cents, quoted = true) => {
    const size = between(next, stock.lots[0], stock.lots[1]);
    const side = last === null || cents === last ? (next() < 0.5 ? "buy" : "sell") : cents > last ? "buy" : "sell";
    const [bid, ask] = !quoted ? [null, null] : side === "buy" ? [toPrice(down(cents)), toPrice(cents)] : [toPrice(cents), toPrice(up(cents))];
    trades.push([ms, toPrice(cents), size, bid, ask]);
    last = cents;
  };
  const minute = (cell, count) => {
    if (cell > 0 && next() >= 0.62) level = clamp(move(level, next() < 0.5 ? -1 : 1));
    const times = new Set();
    while (times.size < count) times.add(cell * CELL_MS + between(next, cell === 0 ? 0 : 200, 59_800));
    [...times].sort((a, b) => a - b).forEach((ms, index) => {
      const roll = next();
      const cents = index === count - 1 ? level : clamp(roll < 0.25 ? down(level) : roll < 0.7 ? level : up(level));
      trade(ms, cents, trades.length > 0);
    });
  };
  for (let cell = 0; cell < MORNING_CELLS; cell++) {
    if (stock.code === FIXTURE.cold) continue;
    if (stock.code === FIXTURE.thin) {
      if (cell < FIXTURE.thinFirstCell || (cell > FIXTURE.thinFirstCell && next() < 0.5)) continue;
      minute(cell, between(next, 1, 3));
      continue;
    }
    minute(cell, Math.max(1, Math.round(stock.rate * factor * (0.6 + 0.8 * next()))));
  }
  // The afternoon is quiet in the fixture: a few trades every third minute, then the closing auction.
  for (let cell = MORNING_CELLS; cell < 270; cell += 3) minute(cell, between(next, 1, 2));
  trade(stock.code === FIXTURE.lateClose ? LATE_CLOSE_MS : CLOSE_MS, level, false);
  return trades;
}

/** The fetcher's 1-minute bars for these trades: [t (s after 09:00), o, h, l, c, v (lots), a (day-to-date VWAP)]. */
function barsOf(trades) {
  const bars = [];
  let value = 0;
  let volume = 0;
  for (const [ms, price, size] of trades) {
    const t = Math.floor(ms / CELL_MS) * 60;
    value += price * size;
    volume += size;
    const bar = bars.at(-1);
    if (bar && bar[0] === t) {
      bar[2] = Math.max(bar[2], price);
      bar[3] = Math.min(bar[3], price);
      bar[4] = price;
      bar[5] += size;
      bar[6] = round2(value / volume);
    } else bars.push([t, price, price, price, price, size, round2(value / volume)]);
  }
  return bars;
}

/**
 * Recorded books as books_compact.py writes them: rows [dt, flags, payload] in arrival order, dt from the row before
 * (the first row's is its own time), a full frame (flag 4) at the first row, at each new minute and after a gap, the
 * changed slots [slot, price, size] otherwise. The book follows the trades: five levels on each side around the
 * quotes each trade came with, sizes in lots. Rows inside a gap were never received.
 */
function makeBooks(stock, date, reference, trades, gaps) {
  const next = random(`books-${date}-${stock.code}`);
  const rows = [];
  let previousT = null;
  let previousSlots = null;
  let afterGap = false;
  const sizes = Array.from({ length: 10 }, () => between(next, 1, 300));
  const add = (t, bidCents, askCents) => {
    if (gaps.some(([from, to]) => t >= from && t < to)) {
      afterGap = true;
      return;
    }
    for (let i = 0; i < 3; i++) sizes[between(next, 0, 9)] = between(next, 1, 300);
    const slots = [];
    let bid = bidCents;
    let ask = askCents;
    for (let level = 0; level < 5; level++, bid = down(bid)) slots.push([toPrice(bid), sizes[level]]);
    for (let level = 0; level < 5; level++, ask = up(ask)) slots.push([toPrice(ask), sizes[5 + level]]);
    const full = previousT === null || afterGap || Math.floor(t / CELL_MS) !== Math.floor(previousT / CELL_MS);
    const payload = full
      ? [slots.slice(0, 5), slots.slice(5)]
      : slots.flatMap(([price, size], index) =>
          price !== previousSlots[index][0] || size !== previousSlots[index][1] ? [[index, price, size]] : [],
        );
    rows.push([t - (previousT ?? 0), (full ? 4 : 0) | 8, payload]);
    previousT = t;
    previousSlots = slots;
    afterGap = false;
  };
  // 08:59:45: the book the opening auction leaves.
  add(-15_000, down(reference), reference);
  for (const [ms, price, , bid, ask] of trades) {
    if (ms >= MORNING_CELLS * CELL_MS) break;
    const cents = Math.round(price * 100);
    add(ms, bid === null ? down(cents) : Math.round(bid * 100), ask === null ? cents : Math.round(ask * 100));
  }
  return { schema: 1, code: stock.code, date, sizeUnit: "unverified", keyEvery: 60_000, rows, gaps };
}

/** TWSE's 5-second index of a day: [seconds after 09:00, value] from 0 to 16200; second 0 repeats the previous close. */
function makeTaiex(date, previousClose) {
  const next = random(`taiex-${date}`);
  let value = previousClose + (next() - 0.4) * 40;
  const points = [[0, previousClose]];
  for (let second = 5; second <= 16_200; second += 5) {
    value += (next() - 0.48) * 6;
    points.push([second, round2(value)]);
  }
  return points;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function put(dir, path, bytes) {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
const json = (value, indent) => Buffer.from(JSON.stringify(value, null, indent), "utf8");
// The fetcher writes its .json.gz files with a zero gzip time, so the same trades give the same bytes.
const gz = (value) => gzipSync(json(value));

const LESSON_DAYS = [
  { date: "2026-10-21", factor: 0.35, taiex: 27_150.42, publishedAt: "2026-10-21T17:12:41+08:00" },
  { date: "2026-10-22", factor: 0.35, taiex: null, publishedAt: "2026-10-22T17:11:05+08:00" },
  { date: "2026-10-27", factor: 1.4, taiex: 27_420.18, publishedAt: "2026-10-27T17:10:22+08:00" },
];

/** One lesson day: days/, ticks/, taiex/ and books/ as the fetcher publishes them. Returns its index entry. */
async function writeLessonDay(dir, { date, factor, taiex, publishedAt }, references) {
  const symbols = [];
  const tickEntries = [];
  const tickFiles = [];
  const dayFiles = [];
  const books = [];
  let tradeCount = 0;
  for (const stock of STOCKS) {
    const reference = references.get(stock.code);
    const trades = makeTrades(stock, date, reference, factor);
    const bars = barsOf(trades);
    // The one stock whose 1-minute bars do not agree with its trades: one morning minute has a lot more.
    if (stock.code === FIXTURE.mismatch) bars.find((bar) => bar[0] >= 720 && bar[0] < 5_400)[5] += 1;
    const close = trades.at(-1)[1];
    const volume = trades.reduce((sum, row) => sum + row[2], 0);
    const value = Math.round(trades.reduce((sum, row) => sum + row[1] * row[2] * 1000, 0));
    const incomplete = stock.code === FIXTURE.incomplete;
    symbols.push({
      code: stock.code,
      name: stock.name,
      referencePrice: toPrice(reference),
      close,
      change: round2(close - toPrice(reference)),
      tradeVolume: volume + (incomplete ? 37 : 0),
      tradeValue: value,
      disposition: stock.code === FIXTURE.disposition,
      bars: bars.length,
    });
    dayFiles.push(await put(dir, `days/${date}/symbols/${stock.code}.json.gz`, gz({ schema: 1, code: stock.code, date, volumeUnit: "lot", bars })));
    references.set(stock.code, Math.round(close * 100));
    if (stock.code === FIXTURE.noTicks && date === FIXTURE.noTicksDay) continue;
    tradeCount += trades.length;
    tickFiles.push(await put(dir, `ticks/${date}/symbols/${stock.code}.json.gz`, gz({
      schema: 1, code: stock.code, date, sizeUnit: "lot", fields: ["msAfter0900", "price", "size", "bid", "ask"], trades, afterHours: [],
    })));
    tickEntries.push({
      code: stock.code, name: stock.name, trades: trades.length, volume, close, complete: !incomplete,
      afterHours: { trades: 0, volume: 0 }, ...(incomplete ? { note: `逐筆量 ${volume} 少於當日量 ${volume + 37}` } : {}),
    });
    if (date === FIXTURE.booksDay && trades.some((row) => row[0] < MORNING_CELLS * CELL_MS)) {
      const gaps = stock.code === FIXTURE.gapStock ? [FIXTURE.gap] : [];
      books.push({ code: stock.code, file: makeBooks(stock, date, reference, trades, gaps), gaps });
    }
  }
  // The top 5 by turnover (not under 處置, practisable) must be the hot five, as the older desk QA expects.
  const practisable = symbols.filter((symbol) => !symbol.disposition && ![FIXTURE.cold, FIXTURE.incomplete, FIXTURE.mismatch, FIXTURE.noTicks].includes(symbol.code));
  const top = practisable.sort((a, b) => b.tradeValue - a.tradeValue).slice(0, 5).map((symbol) => symbol.code).sort();
  if (top.join() !== [...FIXTURE.hot].sort().join()) throw new Error(`${date}: the top 5 by turnover are ${top}, not the hot five`);

  dayFiles.unshift(await put(dir, `days/${date}/index.json`, json({ schema: 1, date, coverage: "full-market", volumeUnit: "lot", symbols }, 1)));
  const dayManifest = json({
    schema: 1, date, coverage: "full-market", createdAt: publishedAt, version: VERSION, source: "fubon-neo 1-minute candles (QA fixture)",
    volumeUnit: "lot", counts: { symbols: symbols.length, bars: symbols.reduce((sum, symbol) => sum + symbol.bars, 0) }, files: dayFiles,
  }, 1);
  await put(dir, `days/${date}/manifest.json`, dayManifest);
  await put(dir, `ticks/${date}/manifest.json`, json({
    schema: 1, date, createdAt: publishedAt, version: VERSION, source: "fubon-neo historical trades (QA fixture)", sizeUnit: "lot",
    counts: { symbols: tickEntries.length, trades: tradeCount }, symbols: tickEntries, rejected: [], warnings: [], files: tickFiles,
  }, 1));
  if (taiex !== null) {
    const points = await put(dir, `taiex/${date}/points.json`, json({ schema: 1, date, source: "twse MI_5MINS_INDEX", previousClose: taiex, points: makeTaiex(date, taiex) }));
    await put(dir, `taiex/${date}/manifest.json`, json({ schema: 1, date, createdAt: publishedAt, version: VERSION, files: [points] }, 1));
  }
  if (books.length) {
    const entries = [];
    for (const { code, file, gaps } of books) {
      const blob = gz(file);
      await put(dir, `books/${date}/symbols/${code}.json.gz`, blob);
      let t = 0;
      const times = file.rows.map(([dt]) => (t += dt));
      entries.push({ code, messages: file.rows.length, first: times[0], last: times.at(-1), gaps, path: `symbols/${code}.json.gz`, bytes: blob.length, sha256: sha256(blob) });
    }
    await put(dir, `books/${date}/manifest.json`, json({
      schema: 1, date, createdAt: publishedAt, version: VERSION, source: "fubon-neo websocket books (QA fixture)", sizeUnit: "lot",
      limitCheck: "reference", counts: { symbols: entries.length, messages: entries.reduce((sum, entry) => sum + entry.messages, 0) },
      symbols: entries, connections: [], warnings: [], unparsable: { count: 0, examples: [] }, truncated: [],
    }, 1));
  }
  return {
    entry: { date, coverage: "full-market", symbols: symbols.length, manifestSha256: sha256(dayManifest), publishedAt },
    ticks: { symbols: tickEntries.length, trades: tradeCount, complete: tickEntries.every((entry) => entry.complete) },
  };
}

/** radar/<date>.json as the fetcher's write_radar stores it: sha256 of the compact, key-sorted symbols JSON. */
async function writeRadar(dir, date, codes) {
  const symbols = codes.map((code) => ({ code, name: NAMES.get(code) ?? "測試代號" }));
  await put(dir, `radar/${date}.json`, json({
    schema: 1, date, kind: "當沖", fetchedAt: `${date}T19:00:04+08:00`, sha256: sha256(json(symbols)), symbols,
  }, 1));
}

export async function writeMarketFixture(dir) {
  // 2026-10-14, as the daily question has always had it, with its manifest's SHA-256 in the root index.
  await mkdir(join(dir, "days", DATE, "symbols"), { recursive: true });
  const symbols = SYMBOLS.map(({ code, name, rows, tradeValue, tradeVolume }) => ({
    code, name, referencePrice: rows[0][1], close: rows.at(-1)[4], change: 0, tradeVolume, tradeValue, disposition: false, bars: rows.length,
  }));
  await writeFile(join(dir, "days", DATE, "index.json"),
    JSON.stringify({ schema: 1, date: DATE, coverage: "full-market", volumeUnit: "lot", symbols }, null, 1));
  for (const { code, rows } of SYMBOLS)
    await writeFile(join(dir, "days", DATE, "symbols", `${code}.json.gz`), gzipSync(JSON.stringify({ schema: 1, code, date: DATE, bars: rows })));
  const questionManifest = json({ schema: 1, date: DATE, coverage: "full-market", createdAt: "2026-10-14T18:00:00+08:00", version: VERSION, counts: { symbols: symbols.length } }, 1);
  await put(dir, `days/${DATE}/manifest.json`, questionManifest);
  const days = [
    { date: DATE, coverage: "full-market", symbols: symbols.length, manifestSha256: sha256(questionManifest), publishedAt: "2026-10-14T18:00:00+08:00" },
  ];

  const references = new Map(STOCKS.map((stock) => [stock.code, stock.price]));
  const ticks = {};
  for (const lesson of LESSON_DAYS) {
    const written = await writeLessonDay(dir, lesson, references);
    days.push(written.entry);
    ticks[lesson.date] = written.ticks;
  }
  for (const [date, codes] of Object.entries(FIXTURE.radar)) await writeRadar(dir, date, codes);

  const newest = LESSON_DAYS.at(-1);
  await put(dir, "status.json", json({
    schema: 1,
    latestDay: newest.date,
    lastRun: {
      date: newest.date, mode: "daily", startedAt: "2026-10-27T16:45:00+08:00", finishedAt: newest.publishedAt, outcome: "ok", reason: null,
      symbols: { total: STOCKS.length, fetched: STOCKS.length, failed: 0, excluded: 0 },
    },
    history: LESSON_DAYS.map((lesson) => ({ date: lesson.date, outcome: "ok", finishedAt: lesson.publishedAt })),
    ticks: {
      date: newest.date, outcome: ticks[newest.date].complete ? "ok" : "partial", reason: ticks[newest.date].complete ? null : `${FIXTURE.incomplete}：逐筆量少於當日量`,
      symbols: { total: STOCKS.length, fetched: ticks[newest.date].symbols, failed: STOCKS.length - ticks[newest.date].symbols },
      trades: ticks[newest.date].trades, finishedAt: newest.publishedAt,
    },
    taiex: { date: newest.date, outcome: "ok", reason: null, points: 3241, failed: [], finishedAt: "2026-10-27T17:12:10+08:00" },
    radar: { outcome: "ok", reason: null, latest: "2026-10-22", symbols: FIXTURE.radar["2026-10-22"].length, finishedAt: "2026-10-27T19:00:04+08:00" },
  }, 1));
  // Last, as the fetcher does: a day is listed only once all its files are there.
  await put(dir, "index.json", json({ schema: 1, days }, 1));
  return { dataDate: DATE, lessonDays: FIXTURE.lessonDays };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node scripts/qa/make-market-fixture.mjs <dir>");
  await writeMarketFixture(target);
  console.log(`Market fixture written to ${target}`);
}
