// Daily Fubon lessons on the QA fixture (make-market-fixture.mjs), through a running desk-server that wrote it (no
// MARKET_DATA_DIR) and its owner session. Checks, by the API and on the desk (1366×900):
//   1. 選課: the open days are 10/27, 10/22 and 10/21 (newest first; 10/14 is the daily question's day, not a lesson);
//      each day's default 自選 and its exact wording (10/27: the 10/22 list of 70, with its 上櫃 and no-data counts;
//      10/22: no list of the day before, so the top 5; 10/21: the 10/20 list); no stock that cannot be practised; and
//      nothing of the day's own market in the picker (only code, name, reference price, previous turnover, 處置).
//      On the desk the date menu switches the picker between the days with the same words.
//   2. A stock with minutes that have no trade (the fixture's thin stock: first trade at 09:06, then now and then): no
//      bar and no trade before its first trade, 「尚無成交」 in its 五檔, a market order waiting until that first trade
//      and filling on it, and a quiet minute later on as a flat bar (volume 0) at the last price.
//   3. A day without recorded books (10/22): the 五檔 area shows only the real best bid and ask (買一賣一) with
//      「這天沒有五檔掛單資料」, no advance carries a book, and the day without TAIEX says so.
//   4. A recording gap (10/27, the gap stock 09:04:00–09:06:30): the advance carries the gap and no frame inside it,
//      and the desk shows 「這段時間沒有五檔資料」 over the trades' 買一賣一.
//   5. Real 五檔 (10/27): five levels a side with their lots, 「真實五檔」, the 委買／委賣 bar.
//   6. Each step's reply at 2× (an advance every second, the server's floor) on 10/27's default list (63 stocks): its
//      body compressed (gzip level 6 and brotli quality 5, measured here; the QA server sends it uncompressed) is at
//      most 60 KB, and the server answers within 100 ms (time to the reply's headers on loopback).
//   7. A guest (a fresh visitor through the gate): nothing the server sends it names the list (no radar, 熱門當沖, 名單,
//      「M/D 盤後）」, or the list's counts), its picker on every day is the top 5 with 「預設：成交值前 5 名」, while the owner's
//      10/27 picker does carry the list (so the check can see it).
// The owner's runs this starts are given up at the end. Usage: node scripts/qa/desk-lessons.mjs [label] [proxyPort]
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { FIXTURE } from "./make-market-fixture.mjs";

const [label = "lessons", proxyPort = "18811"] = process.argv.slice(2);
const state = JSON.parse(readFileSync(fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url)), "utf8"));
if (!state.appBase || !state.gateCode) throw new Error("Restart desk-server.mjs: its state file has no appBase/gateCode");
if (!state.fixture) throw new Error("desk-lessons checks the QA fixture's stocks: start desk-server.mjs without MARKET_DATA_DIR");
const base = `http://127.0.0.1:${proxyPort}`;
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const KB = 1024;
const SIZE_LIMIT = 60 * KB;
const TIME_LIMIT = 100;
const STEPS = 20;
const [D21, D22, D27] = FIXTURE.lessonDays;
const id = (date) => `fubon-${date.replaceAll("-", "")}-am`;
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const sorted = (codes) => [...codes].sort();
const failures = [];
const results = {};
const fail = (name, message) => failures.push(`${name}: ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One /api/morning request as the owner (the proxy's session): its reply, raw size and time to its headers. */
async function request(action, lesson) {
  const url = `${base}/api/morning${lesson ? `?lesson=${encodeURIComponent(lesson)}` : ""}`;
  const started = performance.now();
  const response = await fetch(url, action
    ? { method: "POST", headers: { origin: state.appBase, "content-type": "application/json" }, body: JSON.stringify({ ...action, requestId: randomUUID() }) }
    : {});
  const headers = performance.now() - started;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200) throw new Error(`/api/morning ${action?.action ?? "GET"}: HTTP ${response.status} ${bytes.toString("utf8").slice(0, 200)}`);
  return { body: JSON.parse(bytes.toString("utf8")), bytes, headers };
}
const call = async (action, lesson) => (await request(action, lesson)).body;
async function advance(run, lesson, view) {
  await sleep(Math.max(0, run.state.nextAdvanceAt - Date.now()) + 30);
  return call({ action: "advance", id: run.state.id, expectedRevision: run.state.revision, ...(view ? { view } : {}) }, lesson);
}
async function abandonOpen() {
  for (let round = 0; round < 10; round++) {
    const data = await call();
    if (data.blockedRun) await call({ action: "abandon", id: data.blockedRun.id, expectedRevision: data.blockedRun.revision }, data.blockedRun.lessonId);
    else if (data.state && !data.state.completed) await call({ action: "abandon", id: data.state.id, expectedRevision: data.state.revision }, data.state.lessonId);
    else return data;
  }
  throw new Error("unfinished runs keep coming back");
}
async function start(lesson, codes, focusCode) {
  const opened = await call(undefined, lesson);
  if (opened.state && !opened.state.completed) await call({ action: "abandon", id: opened.state.id, expectedRevision: opened.state.revision }, lesson);
  return call({
    action: "start",
    codes,
    plan: { exerciseId: "first-order", focusCode, bias: "observe", reason: "驗收每日教材的資料。", entry: "依檢查需要下單。", stop: "檢查完成後放棄這局。" },
  }, lesson);
}
async function check(name, run) {
  try {
    results[name] = (await run()) ?? "pass";
  } catch (error) {
    results[name] = `FAIL: ${error.message}`;
    fail(name, error.message.split("\n")[0]);
  }
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
async function desk(path, { width = 1366, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem("day-tycoon-coach-v1", "seen"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  return { context, page, errors };
}
/** The desk at rest: the clock on a whole minute and no minute replaying. */
async function rest(page) {
  await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
  await page
    .waitForFunction(() => {
      const clock = document.querySelector(".td-clock strong")?.textContent?.trim() ?? "";
      const stamp = document.querySelector(".td-hero-stamp")?.textContent ?? "";
      return clock.endsWith(":00") && !stamp.includes("成交 · 歷史重播");
    }, null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(600);
}
const bookView = (page) =>
  page.evaluate(() => {
    const cells = (side) =>
      [...document.querySelectorAll(`.td-book-cell[data-side="${side}"]:not(.td-book-cell-empty)`)].map((cell) => ({
        price: cell.querySelector(".td-book-price")?.textContent?.trim() ?? "",
        lots: cell.querySelector(".td-book-lots")?.textContent?.trim() ?? "",
      }));
    return {
      chip: document.querySelector(".td-book-head .td-chip")?.textContent?.trim() ?? null,
      source: document.querySelector(".td-book-source")?.textContent?.trim() ?? "",
      empty: document.querySelector(".td-ladder-empty")?.textContent?.trim() ?? null,
      pressure: Boolean(document.querySelector(".td-pressure")),
      bids: cells("bid"),
      asks: cells("ask"),
      hero: document.querySelector(".td-hero h1")?.textContent?.trim() ?? "",
      heroPrice: document.querySelector(".td-hero-price strong")?.textContent?.trim() ?? "",
      chartSource: document.querySelector(".td-chartbar-source .td-chip")?.textContent?.trim() ?? null,
      index: document.querySelector(".td-index-empty")?.textContent?.trim() ?? null,
    };
  });
async function selectStock(page, code) {
  await page.locator(`.td-watch-row[data-code="${code}"]`).click({ timeout: 6000 });
  await page.waitForTimeout(400);
}

// ── 1. 選課 ────────────────────────────────────────────────────────────────────────────────────────────────────────
const blocked = new Set([FIXTURE.cold, FIXTURE.incomplete, FIXTURE.mismatch]);
const notPractisable = (date) => new Set([...blocked, ...(date === FIXTURE.noTicksDay ? [FIXTURE.noTicks] : [])]);
const listDefaults = (listDate, lessonDate) =>
  sorted(FIXTURE.radar[listDate].filter((code) => !FIXTURE.otc.includes(code) && code !== FIXTURE.unknown && !notPractisable(lessonDate).has(code)));
const listDetail = (listDate, lessonDate) => {
  const codes = FIXTURE.radar[listDate];
  const otc = codes.filter((code) => FIXTURE.otc.includes(code)).length;
  const missing = codes.length - otc - listDefaults(listDate, lessonDate).length;
  const halves = [...(otc ? [`上櫃 ${otc} 檔不在教材範圍`] : []), ...(missing ? [`另 ${missing} 檔這天沒有可練習的資料`] : [])];
  return halves.length ? `名單 ${codes.length} 檔：${halves.join("，")}` : null;
};
const EXPECTED = {
  [D27]: { title: `預設：前一交易日熱門當沖股（${FIXTURE.radarFor[D27].slice(5).replace("-", "/")} 盤後）`, detail: listDetail(FIXTURE.radarFor[D27], D27), defaults: listDefaults(FIXTURE.radarFor[D27], D27), books: true, taiex: true },
  [D22]: { title: "前一交易日沒有熱門當沖名單，改用成交值前 5 名", detail: null, defaults: sorted(FIXTURE.hot), books: false, taiex: false },
  [D21]: { title: `預設：前一交易日熱門當沖股（${FIXTURE.radarFor[D21].slice(5).replace("-", "/")} 盤後）`, detail: listDetail(FIXTURE.radarFor[D21], D21), defaults: listDefaults(FIXTURE.radarFor[D21], D21), books: false, taiex: true },
};
const GUEST_TITLE = "預設：成交值前 5 名";
const PICKER_KEYS = "code,disposition,name,previousValue,referencePrice";
const pickers = {};

const opening = await abandonOpen();
await check("1-picker-api", async () => {
  const problems = [];
  const lessons = (opening.lessons ?? []).map((lesson) => lesson.lessonId);
  const expectedLessons = [D27, D22, D21].map(id);
  if (lessons.join() !== expectedLessons.join()) problems.push(`open days ${lessons.join(",")}, not ${expectedLessons.join(",")}`);
  for (const date of [D27, D22, D21]) {
    const picker = (await call(undefined, id(date))).picker;
    pickers[date] = picker;
    const want = EXPECTED[date];
    if (!picker) {
      problems.push(`${date}: no picker`);
      continue;
    }
    if (picker.note.title !== want.title) problems.push(`${date}: title 「${picker.note.title}」, not 「${want.title}」`);
    if (picker.note.detail !== want.detail) problems.push(`${date}: detail 「${picker.note.detail}」, not 「${want.detail}」`);
    if (picker.defaults.join() !== want.defaults.join()) problems.push(`${date}: defaults ${picker.defaults.join(",")}, not ${want.defaults.join(",")}`);
    if (picker.booksAvailable !== want.books || picker.taiexAvailable !== want.taiex)
      problems.push(`${date}: books ${picker.booksAvailable}, taiex ${picker.taiexAvailable}`);
    const codes = picker.symbols.map((symbol) => symbol.code);
    for (const code of [FIXTURE.cold, FIXTURE.incomplete, ...(date === FIXTURE.noTicksDay ? [FIXTURE.noTicks] : [])])
      if (codes.includes(code)) problems.push(`${date}: ${code} cannot be practised but is offered`);
    for (const code of [...FIXTURE.otc, FIXTURE.unknown]) if (codes.includes(code)) problems.push(`${date}: ${code} (not 上市) is offered`);
    if (!picker.symbols.find((symbol) => symbol.code === FIXTURE.disposition)?.disposition) problems.push(`${date}: ${FIXTURE.disposition} is not marked 處置`);
    if (!codes.includes(FIXTURE.thin)) problems.push(`${date}: the thin stock ${FIXTURE.thin} is not offered`);
    const keys = new Set(picker.symbols.map((symbol) => Object.keys(symbol).sort().join()));
    if (keys.size !== 1 || !keys.has(PICKER_KEYS)) problems.push(`${date}: picker symbols carry ${[...keys].join(" / ")}, not only ${PICKER_KEYS}`);
  }
  if (problems.length) throw new Error(problems.join("; "));
  return Object.fromEntries([D27, D22, D21].map((date) => [date, { stocks: pickers[date].symbols.length, defaults: pickers[date].defaults.length, note: pickers[date].note }]));
});

await check("1-picker-desk", async () => {
  const session = await desk("/morning?new=1");
  const { page } = session;
  const problems = [];
  try {
    await page.locator(".td-picker").waitFor({ timeout: 20000 });
    const menu = page.locator(".td-picker-date");
    const seen = {};
    for (const date of [D27, D22, D21]) {
      if ((await menu.inputValue()) !== id(date)) await menu.selectOption(id(date));
      const want = EXPECTED[date];
      await page.locator(".td-picker-note-title", { hasText: want.title }).waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      const title = (await page.locator(".td-picker-note-title").textContent())?.trim();
      const details = (await page.locator(".td-picker-note-detail").allTextContents()).map((text) => text.trim());
      const chosen = await page.$$eval(".td-picker-list:not(.td-picker-found) .td-picker-row", (rows) => rows.map((row) => row.dataset.code));
      seen[date] = { title, details, chosen: chosen.length };
      if (title !== want.title) problems.push(`${date}: the desk says 「${title}」, not 「${want.title}」`);
      if ((details[0] ?? null) !== want.detail || details.length > 1) problems.push(`${date}: the detail line is ${JSON.stringify(details)}, not 「${want.detail}」`);
      if (chosen.join() !== want.defaults.join()) problems.push(`${date}: the desk starts with ${chosen.length} stocks, not the ${want.defaults.length} defaults`);
      await page.screenshot({ path: `${out}1-picker-${date}.png` });
    }
    if (session.errors.length) problems.push(`page errors: ${session.errors.join("; ")}`);
    if (problems.length) throw new Error(problems.join("; "));
    return seen;
  } finally {
    await session.context.close();
  }
});

// ── 2, 4, 5: a 10/27 run of the thin stock, 台積電 and the gap stock (the gap stock is the 主角股) ──────────────────
const thin = FIXTURE.thin;
const gapStock = FIXTURE.gapStock;
const [gapFrom, gapTo] = FIXTURE.gap;
const gapCell = Math.ceil(gapFrom / 60_000); // the first cell wholly inside the gap
await check("2-no-trade-minutes", async () => {
  const problems = [];
  let run = await start(id(D27), sorted([thin, "2330", gapStock]), gapStock);
  run = await advance(run, id(D27), gapStock);
  run = await call({ action: "order", id: run.state.id, expectedRevision: run.state.revision, code: thin, side: "buy", lots: 1 }, id(D27));
  const deltas = [];
  while (run.state.cursor < 3) {
    run = await advance(run, id(D27), gapStock);
    deltas.push(run.delta);
  }
  // On the desk at 09:03: the thin stock has not traded yet.
  const session = await desk(`/morning?lesson=${id(D27)}`);
  try {
    await rest(session.page);
    await selectStock(session.page, thin);
    const view = await bookView(session.page);
    results.noTradeYet = view;
    if (view.empty !== "尚無成交") problems.push(`before its first trade ${thin}'s 五檔 says 「${view.empty}」, not 尚無成交`);
    if (view.bids.length || view.asks.length) problems.push(`before its first trade ${thin} shows book prices`);
    await session.page.screenshot({ path: `${out}2-no-trade-yet.png` });
    if (session.errors.length) problems.push(`page errors: ${session.errors.join("; ")}`);
  } finally {
    await session.context.close();
  }
  const pending = run.state.orders.at(-1);
  if (pending?.status !== "pending") problems.push(`the market order on ${thin} is ${pending?.status} before any trade, not pending`);
  while (run.state.cursor < 30) {
    run = await advance(run, id(D27), gapStock);
    deltas.push(run.delta);
  }
  const first = deltas.find((delta) => delta.trades[thin].length);
  if (!first || first.cell !== FIXTURE.thinFirstCell) problems.push(`${thin}'s first trade is in cell ${first?.cell}, not ${FIXTURE.thinFirstCell}`);
  for (const delta of deltas.filter((item) => item.cell < FIXTURE.thinFirstCell))
    if (delta.bars[thin] !== null || delta.trades[thin].length) problems.push(`cell ${delta.cell}: ${thin} has a bar or trades before its first trade`);
  const fill = run.state.fills.find((item) => item.code === thin);
  const firstTrade = first?.trades[thin][0];
  if (!fill || !firstTrade || fill.ms !== firstTrade[0] || fill.price !== firstTrade[1])
    problems.push(`the waiting market order filled at ${JSON.stringify(fill && [fill.ms, fill.price])}, not on the first trade ${JSON.stringify(firstTrade)}`);
  const quiet = deltas.filter((delta) => delta.cell > FIXTURE.thinFirstCell && !delta.trades[thin].length);
  if (!quiet.length) problems.push(`${thin} has no quiet minute after its first trade`);
  for (const delta of quiet) {
    const bar = delta.bars[thin];
    const before = deltas.find((item) => item.cell === delta.cell - 1)?.bars[thin];
    if (!bar || bar.v !== 0 || bar.o !== bar.c || bar.h !== bar.c || bar.l !== bar.c || (before && bar.c !== before.c))
      problems.push(`quiet cell ${delta.cell}: ${thin}'s bar is ${JSON.stringify(bar)}, not flat at ${before?.c} with volume 0`);
  }
  results.thinRun = { id: run.state.id, deltas: deltas.length };
  if (problems.length) throw new Error(problems.slice(0, 6).join("; "));
  return { firstCell: first?.cell, fill: fill && { ms: fill.ms, price: fill.price }, quietCells: quiet.map((delta) => delta.cell) };
});

await check("4-books-gap", async () => {
  // The run of check 2 has gone to 09:30; a fresh one stops inside the gap for the desk.
  const problems = [];
  let run = await start(id(D27), sorted([thin, "2330", gapStock]), gapStock);
  const books = {};
  while (run.state.cursor <= gapCell) {
    run = await advance(run, id(D27), gapStock);
    books[run.delta.cell] = run.delta.book ?? null;
  }
  const inside = books[gapCell];
  if (!inside || inside.code !== gapStock || inside.start !== null || inside.frames.length || JSON.stringify(inside.gaps) !== JSON.stringify([[gapCell * 60_000, Math.min(gapTo, (gapCell + 1) * 60_000)]]))
    problems.push(`cell ${gapCell} (inside the gap) carries ${JSON.stringify(inside && { start: inside.start, frames: inside.frames.length, gaps: inside.gaps })}`);
  const before = books[gapCell - 1];
  if (!before?.frames.length) problems.push(`cell ${gapCell - 1} (before the gap) has no book frames`);
  const session = await desk(`/morning?lesson=${id(D27)}`);
  try {
    await rest(session.page);
    const view = await bookView(session.page);
    results.gapView = view;
    if (!view.hero.includes(gapStock)) problems.push(`the desk opens on ${view.hero}, not the 主角股 ${gapStock}`);
    if (view.source !== "這段時間沒有五檔資料") problems.push(`inside the gap the 五檔 says 「${view.source}」`);
    if (view.chip !== "買一賣一") problems.push(`inside the gap the 五檔 is 「${view.chip}」, not 買一賣一`);
    if (view.bids.length > 1 || view.asks.length > 1) problems.push(`inside the gap the 五檔 shows ${view.bids.length}/${view.asks.length} levels`);
    await session.page.screenshot({ path: `${out}4-books-gap.png` });
    if (session.errors.length) problems.push(`page errors: ${session.errors.join("; ")}`);
  } finally {
    await session.context.close();
  }
  if (problems.length) throw new Error(problems.join("; "));
  return { gapCell, gaps: inside?.gaps };
});

await check("5-real-book", async () => {
  // The same run on the desk: 台積電 chosen, one minute on (the desk's own advance asks for its book).
  const problems = [];
  const session = await desk(`/morning?lesson=${id(D27)}`);
  try {
    await rest(session.page);
    await selectStock(session.page, "2330");
    await session.page.getByRole("button", { name: "前進 1 分鐘" }).click();
    await session.page.waitForTimeout(800);
    await rest(session.page);
    const view = await bookView(session.page);
    results.realBook = view;
    if (view.chip !== "真實五檔") problems.push(`the 五檔 is 「${view.chip}」, not 真實五檔`);
    if (view.bids.length !== 5 || view.asks.length !== 5) problems.push(`the 五檔 shows ${view.bids.length} bids and ${view.asks.length} asks`);
    if ([...view.bids, ...view.asks].some((level) => !/^\d+$/.test(level.lots))) problems.push(`a level shows no lots (${JSON.stringify(view.bids)})`);
    if (!view.pressure) problems.push("no 委買／委賣 bar");
    if (view.source) problems.push(`a full book carries the note 「${view.source}」`);
    if (view.chartSource !== "富邦逐筆／證交所大盤") problems.push(`the chart bar names 「${view.chartSource}」`);
    await session.page.screenshot({ path: `${out}5-real-book.png` });
    if (session.errors.length) problems.push(`page errors: ${session.errors.join("; ")}`);
  } finally {
    await session.context.close();
  }
  const run = await call(undefined, id(D27));
  const book = (await advance(run, id(D27), "2330")).delta.book;
  if (!book || book.code !== "2330" || !book.sizes || !book.frames.length) problems.push(`an advance viewing 2330 carries ${JSON.stringify(book && { sizes: book.sizes, frames: book.frames.length })}`);
  if (problems.length) throw new Error(problems.join("; "));
  return { levels: [results.realBook.bids.length, results.realBook.asks.length], frames: book?.frames.length };
});

// ── 3. A day without books and without TAIEX (10/22) ───────────────────────────────────────────────────────────────
await check("3-top-only-book", async () => {
  const problems = [];
  let run = await start(id(D22), sorted(FIXTURE.hot), "2330");
  while (run.state.cursor < 3) {
    run = await advance(run, id(D22), "2330");
    if (run.delta.book) problems.push(`cell ${run.delta.cell} carries a book on a day without books`);
    if (run.delta.index) problems.push(`cell ${run.delta.cell} carries a TAIEX minute on a day without it`);
  }
  const session = await desk(`/morning?lesson=${id(D22)}`);
  try {
    await rest(session.page);
    const view = await bookView(session.page);
    results.topOnly = view;
    if (view.chip !== "買一賣一") problems.push(`the 五檔 is 「${view.chip}」, not 買一賣一`);
    if (view.source !== "這天沒有五檔掛單資料") problems.push(`the 五檔 says 「${view.source}」`);
    if (view.bids.length !== 1 || view.asks.length !== 1) problems.push(`the 五檔 shows ${view.bids.length} bids and ${view.asks.length} asks, not the best of each`);
    if ([...view.bids, ...view.asks].some((level) => level.lots !== "—")) problems.push("the trades' best bid/ask show lots");
    if (view.pressure) problems.push("a 委買／委賣 bar without sizes");
    if (view.chartSource !== "富邦逐筆") problems.push(`the chart bar names 「${view.chartSource}」 on a day without TAIEX`);
    if (view.index !== "本教材沒有大盤資料") problems.push(`the 大盤 pane says 「${view.index}」`);
    await session.page.screenshot({ path: `${out}3-top-only.png` });
    if (session.errors.length) problems.push(`page errors: ${session.errors.join("; ")}`);
  } finally {
    await session.context.close();
  }
  if (problems.length) throw new Error(problems.join("; "));
  return { bid: results.topOnly.bids[0], ask: results.topOnly.asks[0] };
});

// ── 6. Each step at 2× on 10/27's default list ─────────────────────────────────────────────────────────────────────
await check("6-step-size-and-time", async () => {
  const defaults = pickers[D27]?.defaults ?? EXPECTED[D27].defaults;
  const first = await request(undefined, id(D27));
  if (first.body.state && !first.body.state.completed)
    await call({ action: "abandon", id: first.body.state.id, expectedRevision: first.body.state.revision }, id(D27));
  const started = await request({
    action: "start",
    codes: defaults,
    plan: { exerciseId: "first-order", focusCode: "2330", bias: "observe", reason: "量每次前進的回應大小。", entry: "不下單。", stop: "量完放棄。" },
  }, id(D27));
  let run = started.body;
  const measure = (reply) => ({
    raw: reply.bytes.length,
    gzip: gzipSync(reply.bytes, { level: 6 }).length,
    brotli: brotliCompressSync(reply.bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
    ms: Math.round(reply.headers * 10) / 10,
  });
  const steps = [];
  for (let step = 0; step < STEPS; step++) {
    await sleep(Math.max(0, run.state.nextAdvanceAt - Date.now()) + 5);
    const reply = await request({ action: "advance", id: run.state.id, expectedRevision: run.state.revision, view: "2330" }, id(D27));
    run = reply.body;
    const trades = Object.values(run.delta.trades).reduce((sum, rows) => sum + rows.length, 0);
    steps.push({ cell: run.delta.cell, trades, ...measure(reply) });
  }
  const snapshot = measure(await request(undefined, id(D27)));
  const worst = {
    raw: Math.max(...steps.map((step) => step.raw)),
    gzip: Math.max(...steps.map((step) => step.gzip)),
    brotli: Math.max(...steps.map((step) => step.brotli)),
    ms: Math.max(...steps.map((step) => step.ms)),
    medianMs: [...steps.map((step) => step.ms)].sort((a, b) => a - b)[Math.floor(steps.length / 2)],
    trades: Math.max(...steps.map((step) => step.trades)),
  };
  results.steps = steps;
  results.stepsSummary = { stocks: defaults.length, start: measure(started), snapshot, worst };
  writeFileSync(`${out}6-steps.json`, JSON.stringify(results.stepsSummary, null, 2) + "\n" + JSON.stringify(steps, null, 1));
  const problems = [];
  if (worst.gzip > SIZE_LIMIT || worst.brotli > SIZE_LIMIT)
    problems.push(`a step's reply is ${(worst.gzip / KB).toFixed(1)} KB gzip / ${(worst.brotli / KB).toFixed(1)} KB brotli, over 60 KB`);
  if (worst.ms > TIME_LIMIT) problems.push(`a step took ${worst.ms} ms to answer (over ${TIME_LIMIT} ms): ${steps.map((step) => step.ms).join(", ")}`);
  if (problems.length) throw new Error(problems.join("; "));
  return results.stepsSummary;
});

// ── 7. A guest never gets the list ────────────────────────────────────────────────────────────────────────────────
await check("7-guest-no-list", async () => {
  const problems = [];
  // The owner's 10/27 picker carries the list's words: the same search on the guest's replies can see them.
  const owner = (await request(undefined, id(D27))).bytes.toString("utf8");
  // 「盤後）」 as the note writes it: 「盤後」 alone is also in a plan template's 「開盤後」.
  const LIST_WORDS = ["radar", "熱門當沖", "名單", "盤後）"];
  if (!LIST_WORDS.slice(1).every((word) => owner.includes(word))) problems.push("the owner's 10/27 reply does not carry the list's words: the check below would prove nothing");
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.addInitScript(() => localStorage.setItem("day-tycoon-coach-v1", "seen"));
  const page = await context.newPage();
  const bodies = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    const type = response.headers()["content-type"] ?? "";
    if (url.pathname.startsWith("/api/") || type.includes("text/html"))
      bodies.push(response.text().then((text) => ({ url: url.pathname + url.search, html: type.includes("text/html"), text })).catch(() => null));
  });
  try {
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByLabel("教室入場碼", { exact: true }).fill(state.gateCode);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "進入教室" }).click();
    await page.getByRole("link", { name: "開始今天的練習" }).click({ timeout: 20000 });
    await page.locator(".td-picker").waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${out}7-guest-picker.png` });
    await page.getByRole("button", { name: "用這個計畫開始" }).click();
    let run = null;
    for (let i = 0; i < 40 && !(run?.cursor >= 1); i++) {
      await page.waitForTimeout(500);
      run = await page.evaluate(async () => (await (await fetch("/api/morning", { cache: "no-store" })).json()).state);
    }
    if (!(run?.cursor >= 1)) problems.push("the guest's run did not reach 09:01");
    // Two more minutes as the desk asks for them (a step's reply), then every day's picker as the guest's browser
    // asks for it.
    for (let step = 0; step < 2 && run; step++) {
      await page.waitForTimeout(Math.max(0, run.nextAdvanceAt - Date.now()) + 50);
      run = await page.evaluate(async ({ id, revision, view }) => {
        const response = await fetch("/api/morning", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "advance", requestId: crypto.randomUUID(), id, expectedRevision: revision, view }),
        });
        return (await response.json()).state;
      }, { id: run.id, revision: run.revision, view: run.plan.focusCode });
    }
    for (const date of [D27, D22, D21])
      await page.evaluate(async (lesson) => (await fetch(`/api/morning?lesson=${lesson}`, { cache: "no-store" })).text(), id(date));
    await page.screenshot({ path: `${out}7-guest-desk.png` });
  } finally {
    await page.waitForTimeout(500);
    await context.close();
  }
  const seen = (await Promise.all(bodies)).filter(Boolean);
  const api = seen.filter((body) => !body.html);
  const listOnly = [
    `名單 ${FIXTURE.radar[FIXTURE.radarFor[D27]].length} 檔`,
    `${md(FIXTURE.radarFor[D27])} 盤後`,
    `名單 ${FIXTURE.radar[FIXTURE.radarFor[D21]].length} 檔`,
    `${md(FIXTURE.radarFor[D21])} 盤後`,
  ];
  for (const body of seen) {
    const words = body.html ? listOnly : [...LIST_WORDS, ...listOnly];
    const found = words.filter((word) => body.text.includes(word));
    if (found.length) problems.push(`${body.url} carries ${found.join(", ")}`);
  }
  let pickersSeen = 0;
  for (const body of api) {
    let data;
    try {
      data = JSON.parse(body.text);
    } catch {
      continue;
    }
    for (const note of [data?.picker?.note, data?.catalog?.note].filter(Boolean))
      if (note.title !== GUEST_TITLE || note.detail !== null) problems.push(`${body.url}: the guest's note is ${JSON.stringify(note)}`);
    if (data?.picker) {
      pickersSeen++;
      if (data.picker.defaults.join() !== sorted(FIXTURE.hot).join()) problems.push(`${body.url}: the guest's defaults are ${data.picker.defaults.join(",")}, not the top 5`);
    }
  }
  if (api.length < 5) problems.push(`only ${api.length} API replies were seen`);
  if (pickersSeen < 3) problems.push(`only ${pickersSeen} guest pickers were seen`);
  if (problems.length) throw new Error(problems.slice(0, 6).join("; "));
  return { replies: seen.length, api: api.length, pickers: pickersSeen };
});

await browser.close();
await abandonOpen().catch((error) => fail("cleanup", error.message));
writeFileSync(`${out}lessons.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify({ ...results, steps: undefined }, null, 1));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("Daily lessons on the fixture: picker, quiet minutes, books, step size and the guest: all checks pass.");
