// Real trade-by-trade replay (富邦逐筆) on a disposable desk-server runtime (after desk-seed). Plays the desk and
// samples it every 100 ms: the price moves several times inside each minute, stays inside that minute's real high
// and low and rests on its real close; the hero's best bid/ask always match the ladder; the clock runs through the
// seconds; the tape's newest trade is the price on screen; replayed prices say 「成交 · 歷史重播」 and nothing of the
// quote says 模擬 (the market data is real since 2026-10-28; only the paper trading is 模擬); the tape is labelled
// 富邦逐筆 and shows each trade's lots, as the lesson's volume is in lots; the main thread has no long stalls; and
// with 即送 armed the ladder holds still under the pointer (refreshing at most once, at a new minute). No entry
// notice about a simulated replay is shown any more. 「下一檔股票」 goes to the next stock in the run's own order. On
// desktops the 大盤 index moves through its real 5-second values while a minute replays and rests on the minute's
// real close.
// Usage: node scripts/qa/desk-ticks.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "ticks"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const failures = [];
const fail = (message) => failures.push(message);
const number = (text) => Number(String(text ?? "").replace(/[^\d.-]/g, ""));
const formatIndex = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function state(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/morning", { credentials: "same-origin" });
    return (await response.json()).state;
  });
}

const sample = () => {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? "";
  // The book's best levels (五檔 tab) and the tape (明細 tab): only the open tab is on the page.
  const best = (side) =>
    document.querySelector(`.td-book-cell[data-side="${side}"][data-level="1"] .td-book-price`)?.textContent?.trim() ?? "";
  return {
    at: performance.now(),
    code: document.querySelector("#morning-practice-title small")?.textContent?.trim() ?? "",
    price: text(".td-hero-price strong"),
    heroBid: text('.td-hero-book [data-side="bid"] dd'),
    heroAsk: text('.td-hero-book [data-side="ask"] dd'),
    ladderBid: best("bid"),
    ladderAsk: best("ask"),
    index: text(".td-index-value"),
    clock: text(".td-clock strong"),
    tapeTop: text(".td-tape-rows li:first-child span"),
    tapeRows: document.querySelectorAll(".td-tape-rows li").length,
    tapeLots: document.querySelectorAll(".td-tape-lots").length,
    stamp: text(".td-hero-stamp"),
    // 報價明細 (desks): real trades, so no 模擬 anywhere in it (it used to tag replayed simulated trades).
    grid: Boolean(document.querySelector(".td-quote-grid")),
    gridSim: /模擬/.test(document.querySelector(".td-quote-grid")?.textContent ?? "") ||
      Boolean(document.querySelector(".td-quote-grid .td-sim-tag")),
    heroSim: /模擬/.test(document.querySelector(".td-hero")?.textContent ?? ""),
    tapeChip: text(".td-tape-head .td-chip"),
    flashing: document.querySelectorAll('[data-flash="up"], [data-flash="down"]').length,
  };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const rows = [];
for (const viewport of [
  { name: "1366", width: 1366, height: 900 },
  { name: "390", width: 390, height: 844 },
  // A mid-range phone: the same desk with the CPU slowed four times.
  { name: "390-slow", width: 390, height: 844, throttle: 4 },
]) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({
      type: "longtask",
      buffered: true,
    });
  });
  const page = await context.newPage();
  if (viewport.throttle)
    await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: viewport.throttle });
  const phone = viewport.width < 768;
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    // The trades are real now: the lesson carries no notice about a simulated replay, and none is shown on entry.
    const lesson = await page.evaluate(async () => (await (await fetch("/api/morning")).json()));
    const simulatedNotice = lesson.catalog.notices.find((text) => text.includes("模擬逐筆"));
    if (simulatedNotice) fail(`${viewport.name}: the lesson still carries the simulated-replay notice 「${simulatedNotice}」`);
    if (await page.locator(".td-notice").filter({ hasText: "模擬" }).isVisible()) fail(`${viewport.name}: an entry notice about simulated trades is shown`);
    // 「下一檔股票」 follows the run's own order (the picker keeps stocks in code order): the stock after the one shown.
    const order = lesson.catalog.symbols.map((symbol) => symbol.code);
    const shown = (await page.evaluate(sample)).code;
    const expectedNext = order[(order.indexOf(shown) + 1) % order.length];
    await page.getByRole("button", { name: "下一檔股票" }).click();
    await page.waitForTimeout(300);
    const startCursor = (await state(page)).cursor;
    await page.evaluate(() => (window.__longTasks = []));
    await page.getByRole("button", { name: "自動重播", exact: true }).click();
    const samples = [];
    const until = Date.now() + 6500;
    const tabs = page.locator('nav[aria-label="個股資訊分頁"]');
    let onTape = false;
    while (Date.now() < until) {
      samples.push(await page.evaluate(sample));
      if (samples.length === 12) await page.screenshot({ path: `${out}${viewport.name}-playing.png` });
      if (!onTape && Date.now() > until - 3200) {
        await tabs.getByRole("button", { name: "明細" }).click();
        onTape = true;
      }
      await page.waitForTimeout(100);
    }
    await page.getByRole("button", { name: "暫停重播", exact: true }).click();
    await page.waitForTimeout(2200);
    const rest = await page.evaluate(sample);
    const after = await state(page);
    const longTasks = await page.evaluate(() => window.__longTasks);
    const code = rest.code;
    const bars = after.bars[code];
    const played = bars.slice(startCursor);
    if (played.length < 2) fail(`${viewport.name}: only ${played.length} minutes played in 6.5 s`);
    // Inside every played minute the price stays within the real range; at rest it is the real close.
    const prices = samples.map((s) => number(s.price));
    const lo = Math.min(...played.map((bar) => bar.l), bars[startCursor - 1].c);
    const hi = Math.max(...played.map((bar) => bar.h), bars[startCursor - 1].c);
    const outside = prices.filter((p) => p < lo || p > hi);
    if (outside.length) fail(`${viewport.name}: prices outside the played minutes' range ${lo}–${hi}: ${outside.slice(0, 3)}`);
    // Narrow minutes may only move between two prices, so count moves rather than distinct prices.
    const distinct = new Set(samples.map((s) => s.price)).size;
    const moves = samples.filter((s, i) => i > 0 && s.price !== samples[i - 1].price).length;
    const moving = played.filter((bar) => bar.h > bar.l).length;
    if (code !== expectedNext) fail(`${viewport.name}: 下一檔股票 after ${shown} chose ${code}, not ${expectedNext} (the run's order ${order.join(",")})`);
    if (moves < moving * 2) fail(`${viewport.name}: the price moved only ${moves} times over ${moving} moving minutes`);
    if (number(rest.price) !== bars.at(-1).c) fail(`${viewport.name}: rests on ${rest.price}, real close ${bars.at(-1).c}`);
    if (rest.clock !== `${String(9 + Math.floor(after.cursor / 60)).padStart(2, "0")}:${String(after.cursor % 60).padStart(2, "0")}:00`)
      fail(`${viewport.name}: clock at rest ${rest.clock} for cursor ${after.cursor}`);
    const seconds = new Set(samples.map((s) => s.clock)).size;
    if (seconds < 8) fail(`${viewport.name}: the clock showed only ${seconds} different times while playing`);
    for (const s of [...samples, rest]) {
      if (s.ladderBid && (s.heroBid !== s.ladderBid || s.heroAsk !== s.ladderAsk))
        fail(`${viewport.name}: hero ${s.heroBid}/${s.heroAsk} vs book ${s.ladderBid}/${s.ladderAsk}`);
      if (s.tapeTop && s.tapeTop !== s.price) fail(`${viewport.name}: newest trade ${s.tapeTop} but price ${s.price}`);
    }
    const bookSamples = samples.filter((s) => s.ladderBid).length;
    const tapeSamples = samples.filter((s) => s.tapeTop).length;
    if (bookSamples < 10 || tapeSamples < 10)
      fail(`${viewport.name}: only ${bookSamples} samples with the book and ${tapeSamples} with the tape`);
    // Desktops show the 大盤 pane: it replays the minute's real 5-second values and rests on the real close.
    if (!phone) {
      const indexValues = new Set(samples.map((s) => s.index).filter(Boolean));
      if (indexValues.size < 3) fail(`${viewport.name}: the index showed only ${indexValues.size} values while playing`);
      const realClose = after.index?.bars.at(-1)?.c;
      if (realClose === undefined || rest.index !== formatIndex(realClose))
        fail(`${viewport.name}: the index rests on ${rest.index}, real close ${realClose}`);
    }
    if (!samples.some((s) => s.flashing)) fail(`${viewport.name}: no price flash seen while playing`);
    // While a minute replays the hero shows the real trade's time and 「成交 · 歷史重播」; at rest the minute's real
    // close (「收價 · 歷史重播」). Nothing of the quote says 模擬: the trades are Fubon's real ones.
    const REPLAYING = "成交 · 歷史重播";
    if (!samples.some((s) => s.stamp.includes(REPLAYING))) fail(`${viewport.name}: replayed trades are not labelled 「${REPLAYING}」`);
    if (!rest.stamp.includes("收價")) fail(`${viewport.name}: at rest the hero stamp reads "${rest.stamp}"`);
    if ([...samples, rest].some((s) => s.heroSim)) fail(`${viewport.name}: the quote says 模擬 about real trades`);
    if (!phone) {
      const replaying = samples.filter((s) => s.grid && s.stamp.includes(REPLAYING));
      if (!replaying.length) fail(`${viewport.name}: no sample of 報價明細 while a minute replayed`);
      if ([...samples, rest].some((s) => s.gridSim)) fail(`${viewport.name}: 報價明細 says 模擬 about real trades`);
    }
    // The tape is Fubon's real trades, and the lesson's volume is in lots: each trade shows its lots.
    const taped = [...samples, rest].filter((s) => s.tapeRows);
    if (taped.some((s) => s.tapeChip !== "富邦逐筆")) fail(`${viewport.name}: the tape is labelled 「${taped.find((s) => s.tapeChip !== "富邦逐筆")?.tapeChip}」, not 富邦逐筆`);
    if (lesson.catalog.volumeUnit === "lot" && taped.some((s) => s.tapeLots !== s.tapeRows))
      fail(`${viewport.name}: the tape shows lots on ${taped.find((s) => s.tapeLots !== s.tapeRows)?.tapeLots} of its rows`);
    if (!rest.tapeRows) fail(`${viewport.name}: the trade tape is empty`);
    const stalled = longTasks.filter((ms) => ms >= 100);
    const busy = Math.round(longTasks.reduce((sum, ms) => sum + ms, 0));
    if (stalled.length) fail(`${viewport.name}: ${stalled.length} main-thread stalls of 100 ms or more (${stalled.map(Math.round)})`);
    await page.screenshot({ path: `${out}${viewport.name}-rest.png` });
    rows.push({ viewport: viewport.name, minutes: played.length, samples: samples.length, distinct, moves, seconds, longTasks: longTasks.length, busyMs: busy, tapeRows: rest.tapeRows, bookSamples, tapeSamples });

    if (!phone) {
      // 即送 armed: the book holds still while the pointer is on it, then moves again.
      await tabs.getByRole("button", { name: "五檔" }).click();
      await page.getByRole("switch", { name: "閃電即送" }).click();
      await page.getByRole("button", { name: "自動重播", exact: true }).click();
      // Auto-play advances after its first interval; hover once a minute is replaying.
      await page.locator(".td-hero-stamp", { hasText: "成交 · 歷史重播" }).waitFor({ timeout: 8000 });
      await page.locator(".td-book-head").hover();
      // Prices and quantities: in a bid/ask bounce the quotes stay put while the quantities still shift.
      const ladder = () => page.evaluate(() => [...document.querySelectorAll(".td-book-cell")].map((el) => el.textContent).join("|"));
      const heroPrice = () => page.evaluate(() => document.querySelector(".td-hero-price strong")?.textContent);
      const held = [];
      const hero = [];
      for (let i = 0; i < 25; i++) {
        held.push(await ladder());
        hero.push(await heroPrice());
        await page.waitForTimeout(100);
      }
      const marked = await page.evaluate(() => document.querySelector(".td-book")?.dataset.held);
      // 2.5 s spans at most two new minutes, each refreshing the held ladder once, while trades keep coming.
      const changes = held.filter((value, i) => i > 0 && value !== held[i - 1]).length;
      const heroChanges = hero.filter((value, i) => i > 0 && value !== hero[i - 1]).length;
      if (changes > 2) fail(`${viewport.name}: the ladder moved ${changes} times under the pointer with 即送 armed`);
      if (heroChanges < 3) fail(`${viewport.name}: only ${heroChanges} trades while held, so the hold was not tested`);
      if (marked !== "true") fail(`${viewport.name}: the book is not marked as held`);
      // Off the book it moves with the trades again.
      await page.mouse.move(5, 5);
      const free = [];
      for (let i = 0; i < 15; i++) {
        free.push(await ladder());
        await page.waitForTimeout(100);
      }
      const freeChanges = free.filter((value, i) => i > 0 && value !== free[i - 1]).length;
      if (freeChanges < 3) fail(`${viewport.name}: the ladder moved only ${freeChanges} times after the pointer left`);
      rows.at(-1).heldChanges = changes;
      rows.at(-1).heroChangesWhileHeld = heroChanges;
      rows.at(-1).ladderChangesFree = freeChanges;
      await page.mouse.move(5, 5);
      await page.getByRole("button", { name: "暫停重播", exact: true }).click();
      await page.getByRole("switch", { name: "閃電即送" }).click();
    }
  } catch (error) {
    fail(`${viewport.name}: flow stopped: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}${viewport.name}-stopped.png` }).catch(() => {});
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}ticks.json`, JSON.stringify(rows, null, 2));
console.table(rows);
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("Trade-by-trade replay checks passed.");
