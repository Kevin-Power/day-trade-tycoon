// Real-day consistency check of the daily lessons (Task 17): one real lesson day from a READ-ONLY copy of the Fubon
// market data, run end to end through the lessons' own code (buildRunSource, the engine) and compared with answers
// recomputed here from the raw files and the trades, never from the app's readers or matcher:
//   1. the scratch copy: only what one lesson day needs is copied from the real folder (which is never written):
//      index.json, the previous full-market days' lists, the lesson day's days/ and ticks/ (not ticks' raw/), the
//      TAIEX points made from a saved TWSE answer by the fetcher's rules (taiex.py), and a made-up 當沖 list of the
//      day's 30 most traded listed stocks (the real list lives in the user's sheet, which is never read).
//   2. strict check: for every stock the lessons could offer, the app (buildRunSource) refuses it exactly when this
//      script's own minute bars from the trades disagree with the published bars.
//   3. the picker (member and guest), the default wording and the top 5 by turnover.
//   4. a whole morning of five hot stocks with no order: every cell's bar, trades and TAIEX minute, and nothing at or
//      after the cursor anywhere (state, tape).
//   5. matching: many scripted orders (market and limit, buy and sell, 1 lot and as many as the cash or the holdings
//      allow up to 400, all through the morning, on the hot five and on the stocks whose first trade comes latest) are
//      simulated here from the trades alone by the 2026-10-30 rule 量夠才成交 (the trades after the order that touch
//      its price, every trade for a market order, are counted until their lots reach the order's; it fills whole at
//      the trade that completes them: a market order, or a limit the first trade after it touched, at the average of
//      the lots taken, a limit never worse than its price; a resting limit at its limit; 10:30 cancels with 「之後沒有
//      成交」, 「教材結束，委託未成交」 or 「成交量不足」) and compared with the engine's orders, fills, cash and equity.
//   6. with --release, the same scripts through a built release over HTTP, one member per stock, in parallel.
// Usage: node scripts/qa/real-day-check.mjs --source <real market-data> --scratch <new folder> [--taiex-raw <TWSE answer>]
//          [--date 2026-10-27] [--release <abs .output/server/index.mjs> --port 18901] [--out <folder>] [--prepare-only]
// The TWSE answer is the public https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=YYYYMMDD,
// saved once by hand: this script never connects to anything.
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildRunSource, clearLessonCaches, lessonPicker, listLessonDays } from '../../src/lib/lessons/daily-lessons.server.ts';
import { applyMorningAction, advanceDelta, createMorningState, visibleMorningState, visibleTape } from '../../src/lib/morning-engine.ts';
import { validMorningLimit } from '../../src/lib/morning-book.ts';
import { commission, DAYTRADE_TAX, LOT_SHARES, stepTick } from '../../src/lib/market/ticks.ts';
import { STOCK_CATALOGUE } from '../../src/lib/market/universe.ts';
import { startClassroom } from './lessons-server.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CELLS = 90;
const CELL_MS = 60_000;
const MORNING_MS = CELLS * CELL_MS;
const START_CASH = 10_000_000;
const OTC = new Set(STOCK_CATALOGUE.filter(stock => stock.market === 'otc').map(stock => stock.code));
const wait = ms => new Promise(done => setTimeout(done, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const money = amount => Math.round(amount * 100) / 100;

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (key === 'prepare-only') out[key] = true;
    else out[key] = argv[++index];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const date = args.date ?? '2026-10-27';
const failures = [];
const report = { date, checks: {} };
function check(name, ok, detail) {
  report.checks[name] = detail === undefined ? ok : { ok, ...(typeof detail === 'object' ? detail : { detail }) };
  if (!ok) failures.push(name + (typeof detail === 'string' ? ': ' + detail : ''));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${typeof detail === 'string' ? '  ' + detail : ''}`);
}

// ── 1. The scratch copy ──────────────────────────────────────────────────────────────────────────────────────────

const inside = (parent, child) => resolve(child) === resolve(parent) || resolve(child).startsWith(resolve(parent) + sep);

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** The fetcher's rules for TWSE's 5-second answer (tools/fubon-daily/fubon_daily/taiex.py parse_points). */
function parseTaiex(raw, day) {
  let value;
  try { value = JSON.parse(raw.toString('utf8').replace(/^﻿/, '')); } catch { throw new Error('證交所回覆不是 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('證交所回覆不是 JSON');
  if (value.stat !== 'OK') throw new Error('證交所回覆不是 OK');
  if (value.date !== day.replaceAll('-', '')) throw new Error('日期不符');
  const { fields, data } = value;
  if (!Array.isArray(fields) || !Array.isArray(data) || !fields.includes('時間') || !fields.includes('發行量加權股價指數')) throw new Error('大盤檔案格式不正確');
  const timeAt = fields.indexOf('時間');
  const valueAt = fields.indexOf('發行量加權股價指數');
  const points = data.map(row => {
    if (!Array.isArray(row) || row.length <= Math.max(timeAt, valueAt)) throw new Error('大盤檔案格式不正確');
    const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(typeof row[timeAt] === 'string' ? row[timeAt] : '');
    if (!match) throw new Error('大盤檔案格式不正確');
    const cell = row[valueAt];
    const number = typeof cell === 'string' ? (cell.trim() === '' ? NaN : Number(cell.replaceAll(',', ''))) : typeof cell === 'number' ? cell : NaN;
    if (!Number.isFinite(number) || number <= 0) throw new Error('大盤數值不正確');
    return [Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) - 9 * 3600, number];
  });
  if (new Set(points.map(point => point[0])).size !== points.length) throw new Error('大盤資料重複');
  if (points.length !== 3241 || points.some((point, index) => point[0] !== index * 5)) throw new Error('大盤資料不連續');
  return points;
}

async function readJsonFile(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
}

async function prepareScratch({ source, scratch, rawTaiex }) {
  if (!(inside(join(project, 'artifacts'), scratch) || inside(tmpdir(), scratch))) throw new Error('The scratch folder must be under artifacts/ or the temp folder');
  const marker = join(scratch, '.real-day-scratch.json');
  if (await exists(scratch)) {
    if (!(await exists(marker))) throw new Error('The scratch folder exists and is not one made by this script');
    console.log(`scratch copy kept as it is: ${scratch}`);
    return JSON.parse(await readFile(marker, 'utf8'));
  }
  if (!source) throw new Error('--source is needed to make the scratch copy');
  if (inside(source, scratch) || inside(scratch, source)) throw new Error('The scratch folder and the real folder must be apart');
  const index = await readJsonFile(join(source, 'index.json'));
  const full = index.days.filter(entry => entry.coverage === 'full-market').map(entry => entry.date).sort();
  if (!full.includes(date)) throw new Error(`${date} is not a full-market day of the real folder`);
  const previous = full.filter(day => day < date).slice(-5);
  await mkdir(scratch, { recursive: true });
  const copy = (from, to = from, options = {}) => cp(join(source, from), join(scratch, to), { recursive: true, errorOnExist: true, force: false, ...options });
  await copy('index.json');
  for (const day of previous.slice(0, -1)) {
    await copy(`days/${day}/index.json`);
    await copy(`days/${day}/manifest.json`);
  }
  await copy(`days/${previous.at(-1)}`);
  await copy(`days/${date}`);
  await copy(`ticks/${date}/manifest.json`);
  await copy(`ticks/${date}/symbols`);
  const files = { taiex: null };
  if (rawTaiex) {
    const raw = await readFile(rawTaiex);
    const points = parseTaiex(raw, date);
    const bytes = Buffer.from(JSON.stringify({ date, points, previousClose: points[0][1], schema: 1, source: 'twse MI_5MINS_INDEX' }), 'utf8');
    const folder = join(scratch, 'taiex', date);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'raw.json'), raw);
    await writeFile(join(folder, 'points.json'), bytes);
    await writeFile(join(folder, 'manifest.json'), JSON.stringify({
      schema: 1, date, createdAt: new Date().toISOString().slice(0, 19) + '+00:00', version: 'real-day-check scratch',
      files: [{ path: 'raw.json', bytes: raw.length, sha256: sha256(raw) }, { path: 'points.json', bytes: bytes.length, sha256: sha256(bytes) }],
    }, null, 1));
    files.taiex = { points: points.length, previousClose: points[0][1], rawSha256: sha256(raw) };
  }
  // A made-up 當沖 list for the day before the lesson: the lesson day's 30 most traded listed stocks.
  const day = await readJsonFile(join(source, 'days', date, 'index.json'));
  const top = day.symbols.filter(symbol => /^\d{4}$/.test(symbol.code) && !OTC.has(symbol.code))
    .sort((a, b) => b.tradeValue - a.tradeValue || (a.code < b.code ? -1 : 1)).slice(0, 30);
  const entries = top.map(symbol => ({ code: symbol.code, name: symbol.name }));
  const listDay = previous.at(-1);
  await mkdir(join(scratch, 'radar'), { recursive: true });
  await writeFile(join(scratch, 'radar', `${listDay}.json`), JSON.stringify({
    schema: 1, date: listDay, kind: '當沖', fetchedAt: `${listDay}T19:00:04+08:00`,
    sha256: sha256(Buffer.from(JSON.stringify(entries), 'utf8')), symbols: entries,
  }, null, 1));
  const made = { sourceDays: { lesson: date, previous }, radarDay: listDay, radarCodes: entries.map(entry => entry.code), ...files };
  await writeFile(marker, JSON.stringify(made, null, 1));
  console.log(`scratch copy made: ${scratch}`);
  return made;
}

// ── Independent readers of the raw files ─────────────────────────────────────────────────────────────────────────

const readGz = async path => JSON.parse(gunzipSync(await readFile(path)).toString('utf8'));

/** The morning's trades of one stock, or null when the file is not what the fetcher writes (rules of readMorningTrades). */
async function rawTrades(dir, code) {
  let file;
  try { file = await readGz(join(dir, 'ticks', date, 'symbols', `${code}.json.gz`)); } catch { return null; }
  if (file.schema !== 1 || file.code !== code || file.date !== date || file.sizeUnit !== 'lot' || !Array.isArray(file.trades)) return null;
  if (file.fields?.join() !== 'msAfter0900,price,size,bid,ask') return null;
  const rows = [];
  for (const row of file.trades) {
    if (Array.isArray(row) && typeof row[0] === 'number' && row[0] >= MORNING_MS) break;
    const good = Array.isArray(row) && row.length === 5 && Number.isInteger(row[0]) && row[0] >= 0 && row[1] > 0 && Number.isInteger(row[2]) && row[2] > 0
      && (row[3] === null || row[3] > 0) && (row[4] === null || row[4] > 0);
    if (!good || (rows.length && row[0] < rows.at(-1)[0])) return null;
    rows.push(row);
  }
  return rows;
}

async function rawBars(dir, code) {
  try { return (await readGz(join(dir, 'days', date, 'symbols', `${code}.json.gz`))).bars; } catch { return null; }
}

/** Trades split into the morning's 90 cells (one pass; both ends of each cell are [from, to) in the trades array). */
function cellIndex(trades) {
  const from = new Array(CELLS + 1).fill(trades.length);
  let at = 0;
  for (let cell = 0; cell <= CELLS; cell += 1) {
    while (at < trades.length && trades[at][0] < cell * CELL_MS) at += 1;
    from[cell] = at;
  }
  return from;
}

/** The minute bars from the trades alone: null before the stock's first trade, flat at the last close in a quiet minute. */
function barsFromTrades(trades) {
  const edges = cellIndex(trades);
  const bars = [];
  let started = false;
  for (let cell = 0; cell < CELLS; cell += 1) {
    const rows = trades.slice(edges[cell], edges[cell + 1]);
    if (rows.length) {
      started = true;
      const prices = rows.map(row => row[1]);
      bars.push({ o: rows[0][1], h: Math.max(...prices), l: Math.min(...prices), c: rows.at(-1)[1], v: rows.reduce((sum, row) => sum + row[2], 0) });
    } else if (started) {
      const close = bars.at(-1).c;
      bars.push({ o: close, h: close, l: close, c: close, v: 0 });
    } else bars.push(null);
  }
  return bars;
}

/** Whether the published bars agree with the trades, minute by minute (the strict check of the start, stated again). */
function agrees(published, trades) {
  const byT = new Map();
  for (const bar of published) {
    if (bar[0] >= MORNING_MS / 1000) continue;
    if (byT.has(bar[0])) return false;
    byT.set(bar[0], bar);
  }
  const edges = cellIndex(trades);
  let matched = 0;
  for (let cell = 0; cell < CELLS; cell += 1) {
    const rows = trades.slice(edges[cell], edges[cell + 1]);
    const bar = byT.get(cell * 60);
    if (!rows.length) {
      if (bar) return false;
      continue;
    }
    if (!bar) return false;
    const prices = rows.map(row => row[1]);
    const volume = rows.reduce((sum, row) => sum + row[2], 0);
    const [, o, h, l, c, v] = bar;
    if (o !== rows[0][1] || h !== Math.max(...prices) || l !== Math.min(...prices) || c !== rows.at(-1)[1] || v !== volume) return false;
    matched += 1;
  }
  return matched === byT.size;
}

// ── Independent matching ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The fill of an order of `order.lots` sent at `fromMs`, by 量夠才成交 (design 2026-10-30), from the trades alone: the
 * trades from then on that touch its price (all of them for a market order) are taken in time order until their lots
 * reach the order's, the last one only for the lots still needed. It fills at the trade that completes them: a market
 * order at the average of the lots taken; a limit whose first trade after it touched at that average, never worse
 * than the limit; a limit whose first trade did not touch at its limit. `seen`: any trade came after it; `counted`:
 * the lots reached when it never fills; `trades`: how many trades the fill took.
 */
function findFill(trades, fromMs, order) {
  let seen = false;
  let resting = false;
  let counted = 0;
  let value = 0;
  let used = 0;
  for (const [ms, price, size] of trades) {
    if (ms < fromMs) continue;
    const touches = order.limit === undefined || (order.side === 'buy' ? price <= order.limit : price >= order.limit);
    if (!seen && !touches) resting = true;
    seen = true;
    if (!touches) continue;
    const take = Math.min(size, order.lots - counted);
    counted += take;
    value += price * take;
    used += 1;
    if (counted === order.lots) {
      const average = value / order.lots;
      const fill = order.limit === undefined ? average : resting ? order.limit : order.side === 'buy' ? Math.min(average, order.limit) : Math.max(average, order.limit);
      return { price: fill, ms, seen, counted, trades: used };
    }
  }
  return { price: null, ms: null, seen, counted, trades: used };
}

const lastPrice = (stock, cursor) => {
  let price = stock.reference;
  for (const row of stock.trades) {
    if (row[0] >= cursor * CELL_MS) break;
    price = row[1];
  }
  return price;
};

/** `n` ticks up (n > 0) or down from a price on TWSE's grid; undefined past the grid. */
function ticksFrom(price, n) {
  let out = price;
  for (let step = 0; step < Math.abs(n); step += 1) {
    out = stepTick(out, n > 0 ? 1 : -1);
    if (!out) return undefined;
  }
  return out;
}

/**
 * Plays a script on one stock from the trades alone. `script(view)` returns the actions the learner wants at a cursor
 * (after the cell before it was revealed, before the next one is): {type:'order', side, lots, limit?} or {type:'cancel'}.
 * An action that could not be sent (an order while one waits, too little cash or stock, a limit off the grid or past
 * ±10%, a cancel with nothing waiting) is left out of `actions`: those are what is replayed on the engine or server.
 */
function simulate(stock, script) {
  const actions = [];
  const orders = [];
  const fills = [];
  let cash = START_CASH;
  let shares = 0;
  let pending = null;
  for (let cursor = 0; cursor < CELLS; cursor += 1) {
    const last = lastPrice(stock, cursor);
    for (const action of script({ cursor, last, pending: pending !== null, shares, cash })) {
      if (action.type === 'cancel') {
        if (!pending) continue;
        pending.order.status = 'cancelled';
        pending.order.reason = '由學員取消';
        pending = null;
        actions.push({ cursor, ...action });
        continue;
      }
      if (cursor < 1 || pending) continue;
      if (action.limit !== undefined && (!Number.isFinite(action.limit) || !validMorningLimit(action.limit, stock.reference))) continue;
      const amount = action.lots * LOT_SHARES;
      const known = money(amount * (action.limit ?? last));
      if (action.side === 'buy' && known + commission(known) > cash) continue;
      if (action.side === 'sell' && shares < amount) continue;
      const order = { side: action.side, shares: amount, status: 'pending', ...(action.limit !== undefined ? { limitPrice: action.limit } : {}) };
      const found = findFill(stock.trades, cursor * CELL_MS, { side: action.side, limit: action.limit, lots: action.lots });
      pending = { order, found, cursor };
      orders.push(order);
      actions.push({ cursor, ...action });
    }
    if (!pending) continue;
    const { order, found } = pending;
    if (found.ms !== null && Math.floor(found.ms / CELL_MS) === cursor) {
      const notional = money(order.shares * found.price);
      const fee = commission(notional);
      const tax = order.side === 'sell' ? Math.round(notional * DAYTRADE_TAX) : 0;
      if (order.side === 'buy' && notional + fee > cash) {
        order.status = 'rejected';
        order.reason = '成交價變動後，模擬資金不足，未成交';
      } else if (order.side === 'sell' && shares < order.shares) {
        order.status = 'rejected';
        order.reason = '持有股數不足，未成交';
      } else {
        if (order.side === 'buy') { cash = money(cash - notional - fee); shares += order.shares; }
        else { cash = money(cash + notional - fee - tax); shares -= order.shares; }
        order.status = 'filled';
        order.price = found.price;
        order.trades = found.trades;
        fills.push({ side: order.side, shares: order.shares, price: found.price, fee, tax, t: Math.floor(found.ms / 1000), ms: found.ms });
      }
      pending = null;
    } else if (cursor === CELLS - 1) {
      order.status = 'cancelled';
      order.reason = !found.seen ? '之後沒有成交' : found.counted > 0 ? '成交量不足' : '教材結束，委託未成交';
      order.counted = found.counted;
      pending = null;
    }
  }
  const equity = money(cash + shares * lastPrice(stock, CELLS));
  return { actions, expected: { orders, fills, cash, shares, equity } };
}

/**
 * The scripts: every kind of order placed at each cursor of `cells`, of one lot and of as many lots as the cash (a
 * buy, at most 400) or the holdings (a sell) allow. A sell script buys at cursor 1 first.
 */
function scriptsFor(cells) {
  const out = [];
  const order = (side, limit, lots = 1) => ({ type: 'order', side, lots, ...(limit !== undefined ? { limit } : {}) });
  // As many lots as 90% of the cash buys at `price` (the last price for a market order), 1 to 400.
  const most = (v, price) => Math.max(1, Math.min(400, Math.floor((0.9 * v.cash) / ((price ?? v.last) * LOT_SHARES))));
  const held = v => Math.max(1, Math.min(400, Math.floor(v.shares / LOT_SHARES)));
  const big = (side, v, limit) => order(side, limit, side === 'buy' ? most(v, limit) : held(v));
  for (const c of cells) {
    out.push({ name: `market buy @${c}`, script: v => (v.cursor === c ? [order('buy')] : []) });
    out.push({ name: `limit buy at the last price @${c}`, script: v => (v.cursor === c ? [order('buy', v.last)] : []) });
    out.push({ name: `limit buy 3 ticks under @${c}`, script: v => (v.cursor === c ? [order('buy', ticksFrom(v.last, -3))] : []) });
    out.push({ name: `limit buy 3 ticks over @${c}`, script: v => (v.cursor === c ? [order('buy', ticksFrom(v.last, 3))] : []) });
    out.push({ name: `buy a lot, cancel a resting limit buy @${c}`, script: v => (v.cursor === c ? [order('buy', ticksFrom(v.last, -6))] : v.cursor === c + 3 ? [{ type: 'cancel' }] : []) });
    if (c < 2) continue;
    const buyFirst = v => (v.cursor === 1 ? [order('buy')] : []);
    out.push({ name: `buy @1, market sell @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [order('sell')] : [])] });
    out.push({ name: `buy @1, limit sell at the last price @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [order('sell', v.last)] : [])] });
    out.push({ name: `buy @1, limit sell 3 ticks over @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [order('sell', ticksFrom(v.last, 3))] : [])] });
    out.push({ name: `buy @1, limit sell 3 ticks under @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [order('sell', ticksFrom(v.last, -3))] : [])] });
  }
  // The same with as many lots as the cash or the holdings allow (量夠才成交: these need many trades).
  for (const c of cells) {
    out.push({ name: `big market buy @${c}`, script: v => (v.cursor === c ? [big('buy', v)] : []) });
    out.push({ name: `big limit buy at the last price @${c}`, script: v => (v.cursor === c ? [big('buy', v, v.last)] : []) });
    out.push({ name: `big limit buy 3 ticks under @${c}`, script: v => (v.cursor === c ? [big('buy', v, ticksFrom(v.last, -3))] : []) });
    out.push({ name: `big limit buy 2 ticks over @${c}`, script: v => (v.cursor === c ? [big('buy', v, ticksFrom(v.last, 2))] : []) });
    if (c < 2) continue;
    const buyFirst = v => (v.cursor === 1 ? [big('buy', v)] : []);
    out.push({ name: `big buy @1, big market sell @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [big('sell', v)] : [])] });
    out.push({ name: `big buy @1, big limit sell at the last price @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [big('sell', v, v.last)] : [])] });
    out.push({ name: `big buy @1, big limit sell 3 ticks over @${c}`, script: v => [...buyFirst(v), ...(v.cursor === c ? [big('sell', v, ticksFrom(v.last, 3))] : [])] });
  }
  // One long mixed morning: every kind of order in turn, whatever the earlier ones did.
  out.push({
    name: 'mixed morning',
    script: v => {
      const at = v.cursor;
      if (at === 1) return [order('buy')];
      if (at === 6) return [order('sell', ticksFrom(v.last, 2))];
      if (at === 18 && v.pending) return [{ type: 'cancel' }];
      if (at === 20) return [v.shares >= LOT_SHARES ? order('sell', v.last) : order('buy', v.last)];
      if (at === 36) return [order(v.shares >= LOT_SHARES ? 'sell' : 'buy', ticksFrom(v.last, v.shares >= LOT_SHARES ? 1 : -2))];
      if (at === 50 && v.pending) return [{ type: 'cancel' }];
      if (at === 52) return [order(v.shares >= LOT_SHARES ? 'sell' : 'buy')];
      if (at === 66) return [order(v.shares >= LOT_SHARES ? 'sell' : 'buy', v.last)];
      if (at === 80) return [order(v.shares >= LOT_SHARES ? 'sell' : 'buy', ticksFrom(v.last, v.shares >= LOT_SHARES ? 4 : -4))];
      if (at === 88) return [order(v.shares >= LOT_SHARES ? 'sell' : 'buy', ticksFrom(v.last, v.shares >= LOT_SHARES ? 8 : -8))];
      return [];
    },
  });
  // The same morning with large orders: every buy as many lots as the cash allows, every sell all the holdings.
  out.push({
    name: 'mixed big morning',
    script: v => {
      const at = v.cursor;
      const holding = v.shares >= LOT_SHARES;
      if (at === 1) return [big('buy', v)];
      if (at === 6) return [big('sell', v, ticksFrom(v.last, 2))];
      if (at === 18 && v.pending) return [{ type: 'cancel' }];
      if (at === 20) return [holding ? big('sell', v, v.last) : big('buy', v, v.last)];
      if (at === 36) return [holding ? big('sell', v, ticksFrom(v.last, 1)) : big('buy', v, ticksFrom(v.last, -2))];
      if (at === 50 && v.pending) return [{ type: 'cancel' }];
      if (at === 52) return [holding ? big('sell', v) : big('buy', v)];
      if (at === 66) return [holding ? big('sell', v, v.last) : big('buy', v, v.last)];
      if (at === 80) return [holding ? big('sell', v, ticksFrom(v.last, 4)) : big('buy', v, ticksFrom(v.last, -4))];
      if (at === 88) return [holding ? big('sell', v, ticksFrom(v.last, 8)) : big('buy', v, ticksFrom(v.last, -8))];
      return [];
    },
  });
  return out;
}

// ── Comparing with what the engine or the server answered ───────────────────────────────────────────────────────

function compareRun(expected, state) {
  const problems = [];
  const same = (what, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${what}: server ${JSON.stringify(a)} but recomputed ${JSON.stringify(b)}`); };
  same('number of orders', state.orders.length, expected.orders.length);
  expected.orders.forEach((order, index) => {
    const got = state.orders[index];
    if (!got) return;
    same(`order ${index} side/shares/limit/status/price/reason`,
      [got.side, got.shares, got.limitPrice ?? null, got.status, got.price ?? null, got.reason ?? null],
      [order.side, order.shares, order.limitPrice ?? null, order.status, order.price ?? null, order.reason ?? null]);
    // An order 10:30 cancelled for want of lots keeps the lots it reached.
    if (order.reason === '成交量不足') same(`order ${index} lots counted by 10:30`, got.filledLots ?? 0, order.counted);
  });
  same('number of fills', state.fills.length, expected.fills.length);
  expected.fills.forEach((fill, index) => {
    const got = state.fills[index];
    if (!got) return;
    same(`fill ${index} side/shares/price/fee/tax/t/ms`, [got.side, got.shares, got.price, got.fee, got.tax, got.t, got.ms], [fill.side, fill.shares, fill.price, fill.fee, fill.tax, fill.t, fill.ms]);
  });
  same('cash', state.cash, expected.cash);
  same('shares held', state.positions.reduce((sum, position) => sum + position.shares, 0), expected.shares);
  same('equity', state.equity, expected.equity);
  return problems;
}

/** One cell's reveal as the engine or the server sent it, against the cell worked out from the raw trades. */
function compareDelta(delta, cursor, stocks, taiex) {
  const problems = [];
  if (delta.cell !== cursor - 1) problems.push(`delta.cell ${delta.cell} at cursor ${cursor}`);
  for (const stock of stocks) {
    const want = stock.minuteBars[delta.cell];
    const got = delta.bars[stock.code];
    const gotBar = got ? { o: got.o, h: got.h, l: got.l, c: got.c, v: got.v } : null;
    if (JSON.stringify(gotBar) !== JSON.stringify(want)) problems.push(`${stock.code} cell ${delta.cell} bar ${JSON.stringify(gotBar)} but trades give ${JSON.stringify(want)}`);
    const rows = stock.trades.slice(stock.edges[delta.cell], stock.edges[delta.cell + 1]);
    if (JSON.stringify(delta.trades[stock.code]) !== JSON.stringify(rows)) problems.push(`${stock.code} cell ${delta.cell} trades differ (${delta.trades[stock.code]?.length} vs ${rows.length})`);
    if (rows.some(row => row[0] >= cursor * CELL_MS)) problems.push(`${stock.code}: a trade at or after the cursor`);
  }
  if (taiex) {
    const p = taiex.points.filter(([second]) => second > delta.cell * 60 && second <= delta.cell * 60 + 60).map(point => point[1]);
    const got = delta.index;
    if (!got || JSON.stringify(got.p) !== JSON.stringify(p) || got.o !== p[0] || got.c !== p.at(-1) || got.h !== Math.max(...p) || got.l !== Math.min(...p))
      problems.push(`TAIEX minute ${delta.cell} differs from the 12 five-second points`);
  } else if (delta.index) problems.push('a TAIEX minute without a TAIEX file');
  return problems;
}

/** Nothing at or after the cursor in a snapshot (state bars, tape), and what is there is the trades' own. */
function compareSnapshot(state, tape, cursor, stocks) {
  const problems = [];
  for (const stock of stocks) {
    const bars = state.bars[stock.code] ?? [];
    const want = stock.minuteBars.slice(0, cursor).flatMap((bar, cell) => (bar ? [{ t: cell * 60, ...bar }] : []));
    const got = bars.map(bar => ({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v }));
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${stock.code}: snapshot bars at cursor ${cursor} differ from the trades' (${got.length} vs ${want.length})`);
    const before = stock.trades.slice(0, stock.edges[cursor]);
    const tapeRows = tape?.[stock.code] ?? [];
    if (JSON.stringify(tapeRows) !== JSON.stringify(before.slice(Math.max(0, before.length - 40)))) problems.push(`${stock.code}: tape at cursor ${cursor} is not the last 40 trades before it`);
  }
  return problems;
}

// ── The run ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function mapLimited(items, limit, run) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const at = next++; out[at] = await run(items[at], at); }
  }));
  return out;
}

const PLAN = { exerciseId: 'first-order', bias: 'observe', reason: '真實日一致性檢查', entry: '依腳本下單', stop: '依腳本取消' };

async function main() {
  if (!args.scratch) throw new Error('Usage: --source <real market-data> --scratch <new folder> [--taiex-raw <file>] [--date 2026-10-27] [--release <entry> --port <p>] [--out <folder>]');
  const scratch = resolve(args.scratch);
  const made = await prepareScratch({ source: args.source ? resolve(args.source) : undefined, scratch, rawTaiex: args['taiex-raw'] });
  report.scratch = made;
  if (args['prepare-only']) return;

  clearLessonCaches();
  // 1. Which days open.
  const days = await listLessonDays(scratch);
  check('only the scratch copy\'s lesson day opens', days.length === 1 && days[0] === date, `open days: ${days.join(', ') || 'none'}`);

  // 2. Independent facts of the whole day: the lists, the quick check, every stock's trades and bars.
  const dayList = await readJsonFile(join(scratch, 'days', date, 'index.json'));
  const manifest = await readJsonFile(join(scratch, 'ticks', date, 'manifest.json'));
  const complete = new Set(manifest.symbols.filter(entry => entry.complete).map(entry => entry.code));
  const listed = dayList.symbols.filter(symbol => /^\d{4}$/.test(symbol.code) && !OTC.has(symbol.code) && complete.has(symbol.code));
  const loaded = await mapLimited(listed, 16, async symbol => {
    const [trades, bars] = await Promise.all([rawTrades(scratch, symbol.code), rawBars(scratch, symbol.code)]);
    return { symbol, trades, bars };
  });
  const quick = loaded.filter(item => item.bars?.some(bar => bar[0] >= 0 && bar[0] < MORNING_MS / 1000 && bar[5] > 0));
  const verdict = new Map(quick.map(item => [item.symbol.code, item.trades !== null && agrees(item.bars, item.trades)]));
  const ownAgree = [...verdict].filter(([, ok]) => ok).map(([code]) => code);
  const ownRefuse = [...verdict].filter(([, ok]) => !ok).map(([code]) => code);
  console.log(`day ${date}: ${dayList.symbols.length} stocks, ${listed.length} listed with complete trades, ${quick.length} traded in the morning`);

  // 3. The app's strict check, stock by stock, against this one.
  const appVerdict = new Map();
  await mapLimited(quick.map(item => item.symbol.code), 16, async code => {
    try { await buildRunSource(scratch, date, [code]); appVerdict.set(code, true); } catch (error) { appVerdict.set(code, error?.status === 409 ? false : `error ${error?.status ?? ''} ${error?.message ?? error}`); }
  });
  const differ = quick.map(item => item.symbol.code).filter(code => appVerdict.get(code) !== verdict.get(code));
  check('the strict check refuses exactly the stocks whose bars disagree with their trades', differ.length === 0, {
    practisableByQuickCheck: quick.length, agree: ownAgree.length, refused: ownRefuse.length, refusedCodes: ownRefuse, differing: differ,
  });

  // The fetcher keeps a stock's ticks only when their volume adds up to the day's; the rejected ones are not lessons.
  const rank = new Map([...dayList.symbols].sort((a, b) => b.tradeValue - a.tradeValue).map((symbol, index) => [symbol.code, index + 1]));
  const rejectedRanks = (manifest.rejected ?? []).map(entry => rank.get(entry.code)).filter(Boolean).sort((a, b) => a - b);
  report.ticksRejectedByTheFetcher = {
    total: (manifest.rejected ?? []).length, inTop30ByValue: rejectedRanks.filter(at => at <= 30).length, inTop100ByValue: rejectedRanks.filter(at => at <= 100).length,
    ranks: rejectedRanks, reasons: [...new Set((manifest.rejected ?? []).map(entry => String(entry.error).replace(/\d+/g, '#')))],
  };
  console.log(`ticks rejected by the fetcher: ${report.ticksRejectedByTheFetcher.total} (top 30 by value: ${report.ticksRejectedByTheFetcher.inTop30ByValue}, top 100: ${report.ticksRejectedByTheFetcher.inTop100ByValue})`);

  // A negative control, so the comparison above is not an empty one: one morning bar of one stock gets a lot more
  // volume in the scratch copy (never the real folder); this script's check and the app's must both refuse the stock.
  const subject = quick.map(item => item.symbol.code).sort()[Math.floor(quick.length / 2)];
  const subjectFile = join(scratch, 'days', date, 'symbols', `${subject}.json.gz`);
  const original = await readFile(subjectFile);
  try {
    const file = JSON.parse(gunzipSync(original).toString('utf8'));
    file.bars.find(bar => bar[0] >= 0 && bar[0] < MORNING_MS / 1000 && bar[5] > 0)[5] += 1;
    await writeFile(subjectFile, gzipSync(Buffer.from(JSON.stringify(file), 'utf8')));
    clearLessonCaches();
    let refused = false;
    try { await buildRunSource(scratch, date, [subject]); } catch (error) { refused = error?.status === 409; }
    check('negative control: one lot more in a published bar is refused by the app and by this script',
      refused && !agrees(file.bars, loaded.find(item => item.symbol.code === subject).trades), { subject });
  } finally {
    await writeFile(subjectFile, original);
    clearLessonCaches();
  }

  // 4. The picker.
  const picker = await lessonPicker(scratch, date, { guest: false });
  const guestPicker = await lessonPicker(scratch, date, { guest: true });
  const radarCodes = made.radarCodes ?? [];
  const wantDefaults = radarCodes.filter(code => verdict.get(code) === true).sort();
  const sameSet = (a, b) => a.length === b.length && a.every((code, index) => code === b[index]);
  check('the picker offers the stocks that pass', !!picker && sameSet(picker.symbols.map(symbol => symbol.code).sort(), ownAgree.slice().sort()),
    { offered: picker?.symbols.length, agree: ownAgree.length });
  check('the default list is the 當沖 list\'s stocks that pass', !!picker && sameSet([...picker.defaults].sort(), wantDefaults), { defaults: picker?.defaults.length, wanted: wantDefaults.length });
  const listDay = made.radarDay ?? '';
  const wantTitle = `預設：前一交易日熱門當沖股（${listDay.slice(5, 7)}/${listDay.slice(8, 10)} 盤後）`;
  check('the default wording', picker?.note.title === wantTitle, { title: picker?.note.title, detail: picker?.note.detail });
  check('the picker carries no close, change, turnover or rank of the day', !!picker && picker.symbols.every(symbol => sameSet(Object.keys(symbol).sort(), ['code', 'disposition', 'name', 'previousValue', 'referencePrice'])));
  const top5 = loaded.filter(item => verdict.get(item.symbol.code) === true && !item.symbol.disposition)
    .sort((a, b) => b.symbol.tradeValue - a.symbol.tradeValue || (a.symbol.code < b.symbol.code ? -1 : 1)).slice(0, 5).map(item => item.symbol.code);
  check('a guest\'s default is the day\'s top 5 by turnover', !!guestPicker && sameSet([...guestPicker.defaults].sort(), [...top5].sort()) && guestPicker.note.title === '預設：成交值前 5 名', { top5 });
  check('the day has the TAIEX and no books', picker?.taiexAvailable === true && picker?.booksAvailable === false, { taiex: picker?.taiexAvailable, books: picker?.booksAvailable });
  report.picker = { symbols: picker?.symbols.length, defaults: picker?.defaults.length, note: picker?.note, top5 };

  // 5. The stocks that are run: the hot five and the ones whose first trade comes latest.
  const byCode = new Map(loaded.map(item => [item.symbol.code, item]));
  const firstTrade = code => byCode.get(code).trades[0]?.[0] ?? Infinity;
  const thin = ownAgree.filter(code => byCode.get(code).trades.length > 0).sort((a, b) => firstTrade(b) - firstTrade(a) || (a < b ? -1 : 1)).slice(0, 3);
  const middle = ownAgree.filter(code => !top5.includes(code) && !thin.includes(code)).sort()[Math.floor(ownAgree.length / 2)];
  const stockOf = code => {
    const item = byCode.get(code);
    const trades = item.trades;
    return { code, name: item.symbol.name, reference: item.symbol.referencePrice, trades, edges: cellIndex(trades), minuteBars: barsFromTrades(trades) };
  };
  const hotStocks = top5.map(stockOf);
  const extraStocks = [...thin, middle].map(stockOf);
  // Cheap and busy: the three most traded stocks at 22 or less, where the cash buys the full 400 lots (量夠才成交 with
  // orders of hundreds of lots against real volume).
  const cheap = loaded.filter(item => verdict.get(item.symbol.code) === true && !item.symbol.disposition && item.symbol.referencePrice <= 22
    && !top5.includes(item.symbol.code) && !thin.includes(item.symbol.code) && item.symbol.code !== middle)
    .sort((a, b) => b.symbol.tradeValue - a.symbol.tradeValue || (a.symbol.code < b.symbol.code ? -1 : 1)).slice(0, 3).map(item => item.symbol.code);
  const cheapStocks = cheap.map(stockOf);
  report.stocks = { hot: top5, thin: thin.map(code => ({ code, firstTradeMs: firstTrade(code) })), middle, cheap: cheapStocks.map(stock => ({ code: stock.code, reference: stock.reference })) };

  const taiex = made.taiex ? await readJsonFile(join(scratch, 'taiex', date, 'points.json')) : null;

  // 6. A whole morning of the hot five with no order: bars, trades, TAIEX and nothing past the cursor.
  const source = await buildRunSource(scratch, date, top5);
  const problems = [];
  for (const stock of hotStocks) {
    if (JSON.stringify(source.trades[stock.code]) !== JSON.stringify(stock.trades)) problems.push(`${stock.code}: the run's trades are not the file's`);
    const published = new Map(byCode.get(stock.code).bars.map(bar => [bar[0], bar]));
    for (let cell = 0; cell < CELLS; cell += 1) {
      const want = stock.minuteBars[cell];
      const got = source.bars[stock.code].find(bar => bar.t === cell * 60);
      if (!want ? !!got : !got || [got.o, got.h, got.l, got.c, got.v].join() !== [want.o, want.h, want.l, want.c, want.v].join()) problems.push(`${stock.code} cell ${cell}: the run's bar differs from the trades'`);
      const bar = published.get(cell * 60);
      if (bar && want && [bar[1], bar[2], bar[3], bar[4], bar[5]].join() !== [want.o, want.h, want.l, want.c, want.v].join()) problems.push(`${stock.code} cell ${cell}: the published bar differs from the trades'`);
    }
  }
  check('each of the five\'s 90 bars and its trades agree (run source, published bars, trades)', problems.length === 0, { problems: problems.slice(0, 10), stocks: top5 });

  const walk = createMorningState(randomUUID(), { ...PLAN, focusCode: top5[0] }, source, 0, top5);
  let state = walk;
  let clock = 0;
  const walkProblems = [];
  const sizes = [];
  for (let cursor = 1; cursor <= CELLS; cursor += 1) {
    clock += 1000;
    state = applyMorningAction(state, { action: 'advance', requestId: randomUUID(), id: state.id, expectedRevision: state.revision }, source, clock);
    walkProblems.push(...compareDelta(advanceDelta(state, source), cursor, hotStocks, taiex));
    if (cursor % 15 === 0 || cursor === 1 || cursor === CELLS) {
      const snapshot = visibleMorningState(state, source);
      walkProblems.push(...compareSnapshot(snapshot, visibleTape(state, source), cursor, hotStocks));
      if (snapshot.index && snapshot.index.bars.some(bar => bar.t >= cursor * 60)) walkProblems.push(`TAIEX bar at or after the cursor in a snapshot at ${cursor}`);
      sizes.push({ cursor, stateJsonBytes: JSON.stringify(state).length });
    }
  }
  check('a whole morning, cell by cell: bars, trades, TAIEX minutes and snapshots are the raw data and nothing is past the cursor', walkProblems.length === 0 && state.cursor === CELLS, { problems: walkProblems.slice(0, 10), cells: CELLS });

  // 7. Matching, engine against the recomputation. The hot five carry all five stocks in the run, the others run alone.
  const cells = [1, 2, 3, 5, 8, 13, 21, 34, 55, 70, 85, 88, 89];
  const runs = [];
  for (const stock of hotStocks) runs.push({ stock, codes: top5, scripts: scriptsFor(cells) });
  for (const stock of extraStocks) runs.push({ stock, codes: [stock.code], scripts: scriptsFor([1, 2, 3, 8, 21, 55, 89]) });
  for (const stock of cheapStocks) runs.push({ stock, codes: [stock.code], scripts: scriptsFor([1, 2, 3, 8, 21, 55, 89]) });
  const engineProblems = [];
  const tally = { scenarios: 0, orders: 0, filled: 0, cancelledByLearner: 0, cancelledAtEnd: 0, quietEnd: 0, shortOfLots: 0, rejected: 0, firstTradeFills: 0, limitFills: 0, fillsAtLimit: 0, marketFills: 0, multiTradeFills: 0, largestFill: 0, lotsCountedWhenShort: 0 };
  const sources = new Map();
  const sourceFor = async codes => {
    const key = codes.join();
    if (!sources.has(key)) sources.set(key, await buildRunSource(scratch, date, codes));
    return sources.get(key);
  };
  const scenarios = [];
  for (const run of runs) {
    const runSource = await sourceFor(run.codes);
    for (const { name, script } of run.scripts) {
      const { actions, expected } = simulate(run.stock, script);
      scenarios.push({ run, name, actions, expected });
      let engine = createMorningState(randomUUID(), { ...PLAN, focusCode: run.stock.code }, runSource, 0, run.codes);
      let at = 0;
      let waiting = null;
      for (let cursor = 0; cursor < CELLS; cursor += 1) {
        for (const action of actions.filter(item => item.cursor === cursor)) {
          at += 1;
          if (action.type === 'cancel') {
            engine = applyMorningAction(engine, { action: 'cancel', requestId: randomUUID(), id: engine.id, expectedRevision: engine.revision, orderId: waiting }, runSource, at);
          } else {
            waiting = randomUUID();
            engine = applyMorningAction(engine, { action: 'order', requestId: waiting, id: engine.id, expectedRevision: engine.revision,
              code: run.stock.code, side: action.side, lots: action.lots, ...(action.limit !== undefined ? { limitPrice: action.limit } : {}) }, runSource, at);
          }
        }
        clock += 1000;
        engine = applyMorningAction(engine, { action: 'advance', requestId: randomUUID(), id: engine.id, expectedRevision: engine.revision }, runSource, clock);
      }
      const diff = compareRun(expected, engine);
      tally.scenarios += 1;
      tally.orders += expected.orders.length;
      for (const order of expected.orders) {
        if (order.status === 'filled') {
          tally.filled += 1;
          if (order.trades > 1) tally.multiTradeFills += 1;
          tally.largestFill = Math.max(tally.largestFill, order.shares / LOT_SHARES);
          if (order.limitPrice === undefined) tally.marketFills += 1; else { tally.limitFills += 1; if (order.price === order.limitPrice) tally.fillsAtLimit += 1; else tally.firstTradeFills += 1; }
        } else if (order.reason === '由學員取消') tally.cancelledByLearner += 1;
        else if (order.reason === '教材結束，委託未成交') tally.cancelledAtEnd += 1;
        else if (order.reason === '之後沒有成交') tally.quietEnd += 1;
        else if (order.reason === '成交量不足') { tally.shortOfLots += 1; tally.lotsCountedWhenShort += order.counted; }
        else tally.rejected += 1;
      }
      if (diff.length) engineProblems.push(`${run.stock.code} · ${name}: ${diff.slice(0, 3).join('; ')}`);
    }
  }
  check('matching: the engine\'s orders, fills, cash and equity are what the trades alone give', engineProblems.length === 0, { ...tally, problems: engineProblems.slice(0, 8) });
  check('the scripted orders include fills of 400 lots, fills of several trades and 10:30 cancels for want of lots',
    tally.largestFill === 400 && tally.multiTradeFills > 0 && tally.shortOfLots > 0, { largestFill: tally.largestFill, multiTradeFills: tally.multiTradeFills, shortOfLots: tally.shortOfLots });
  const sample = scenarios.find(item => item.expected.fills.length > 0);
  const wrong = structuredClone(sample.expected);
  wrong.fills[0].price += 0.5;
  check('negative control: a fill half a point off is noticed by the comparison',
    compareRun(wrong, { ...sample.expected, positions: [{ shares: sample.expected.shares }] }).length > 0);
  // And an average of many trades that is off by a hundredth of a cent, and a progress-only difference in the reason.
  const many = scenarios.find(item => item.expected.orders.some(order => order.status === 'filled' && order.trades > 1));
  const nudged = structuredClone(many.expected);
  nudged.fills[nudged.orders.filter(order => order.status === 'filled').findIndex(order => order.trades > 1)].price += 0.0001;
  check('negative control: an average fill price a ten-thousandth off is noticed by the comparison',
    compareRun(nudged, { ...many.expected, positions: [{ shares: many.expected.shares }] }).length > 0, { scenario: many.name });
  const short = scenarios.find(item => item.expected.orders.some(order => order.reason === '成交量不足'));
  if (short) {
    const renamed = structuredClone(short.expected);
    renamed.orders.find(order => order.reason === '成交量不足').reason = '教材結束，委託未成交';
    check('negative control: 成交量不足 told as 教材結束 is noticed by the comparison',
      compareRun(renamed, { ...short.expected, positions: [{ shares: short.expected.shares }] }).length > 0, { scenario: short.name });
  } else check('some scripted order ends 10:30 with 成交量不足', false, 'none did');

  // 8. The same scripts through a built release over HTTP.
  if (args.release) await runHttp({ scratch, hotStocks, top5, taiex, scenarios });

  report.walk = { stateJsonBytes: sizes };
}

/** The two mixed mornings of each hot stock through a built release, one member per morning, in parallel (about 95 s). */
async function runHttp({ scratch, hotStocks, top5, taiex, scenarios }) {
  const port = Number(args.port ?? 18901);
  const classroom = await startClassroom({ entry: args.release, marketData: scratch, port, label: 'real-day-qa' });
  try {
    const mixed = ['mixed morning', 'mixed big morning'].flatMap(name =>
      hotStocks.map(stock => scenarios.find(item => item.run.stock.code === stock.code && item.name === name)));
    const results = await Promise.all(mixed.map(async (scenario, index) => {
      const jar = await classroom.member(index);
      const post = data => classroom.request('/api/morning', { method: 'POST', jar, data });
      const picked = await classroom.request('/api/morning', { jar });
      if (picked.status !== 200 || !picked.body?.picker) return [`GET /api/morning answered ${picked.status}`];
      const stock = scenario.run.stock;
      const began = await post({ action: 'start', requestId: randomUUID(), plan: { ...PLAN, focusCode: stock.code }, codes: top5 });
      if (began.status !== 200) return [`start answered ${began.status}`];
      let state = began.body.state;
      const problems = [];
      let waiting = null;
      for (let cursor = 0; cursor < CELLS; cursor += 1) {
        for (const action of scenario.actions.filter(item => item.cursor === cursor)) {
          const common = { id: state.id, expectedRevision: state.revision, requestId: randomUUID() };
          const reply = await post(action.type === 'cancel'
            ? { action: 'cancel', ...common, orderId: waiting }
            : { action: 'order', ...common, code: stock.code, side: action.side, lots: action.lots, ...(action.limit !== undefined ? { limitPrice: action.limit } : {}) });
          if (action.type === 'order') waiting = common.requestId;
          if (reply.status !== 200) { problems.push(`${action.type} at ${cursor} answered ${reply.status} ${reply.body?.message ?? ''}`); return problems; }
          state = reply.body.state;
        }
        await wait(Math.max(0, state.nextAdvanceAt - Date.now()) + 25);
        const reply = await post({ action: 'advance', id: state.id, expectedRevision: state.revision, requestId: randomUUID(), view: stock.code });
        if (reply.status !== 200) { problems.push(`advance at ${cursor} answered ${reply.status} ${reply.body?.message ?? ''}`); return problems; }
        state = reply.body.state;
        problems.push(...compareDelta(reply.body.delta, cursor + 1, hotStocks, taiex));
      }
      problems.push(...compareRun(scenario.expected, state));
      const finished = await post({ action: 'finish', id: state.id, expectedRevision: state.revision, requestId: randomUUID(), reflection: '真實日一致性檢查完成' });
      if (finished.status !== 200) return [...problems, `finish answered ${finished.status}`];
      const snapshot = await classroom.request(`/api/morning?lesson=fubon-${date.replaceAll('-', '')}-am`, { jar });
      problems.push(...compareSnapshot(snapshot.body.state, snapshot.body.tape, CELLS, hotStocks));
      return problems;
    }));
    check('over HTTP on a built release: ten mixed mornings (one lot, and as many as the cash allows), replies against the trades and the recomputed fills',
      results.every(list => list.length === 0), { problems: results.flat().slice(0, 8), orders: mixed.map(item => item.expected.orders.length) });
  } finally {
    await classroom.stop();
  }
}

try {
  await main();
} catch (error) {
  failures.push('error: ' + (error?.stack ?? error));
  console.error(error);
}
if (args.out) {
  await mkdir(resolve(args.out), { recursive: true });
  await writeFile(join(resolve(args.out), 'real-day-check.json'), JSON.stringify({ ...report, failures }, null, 1));
}
console.log(failures.length ? `\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}` : '\nAll real-day checks passed.');
process.exit(failures.length ? 1 : 0);
