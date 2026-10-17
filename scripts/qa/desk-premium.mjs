// Premium desk acceptance checks on a seeded desk-server (run desk-seed.mjs first):
// layout at the review sizes, data labels, quote/book consistency, stock switching keeps every
// panel in sync, phone tabs, and no broker traffic. Usage: node scripts/qa/desk-premium.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [base = "http://127.0.0.1:18821", outArg = "artifacts/premium-ui/check"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const cases = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1366x900", width: 1366, height: 900 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
  { name: "360x740", width: 360, height: 740 },
  { name: "375x812-large", width: 375, height: 812, senior: true },
  { name: "1366x900-large", width: 1366, height: 900, senior: true },
];

const scan = (senior) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.opacity !== "0";
  };
  const id = (el) =>
    `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}[${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 14)}]`;
  const small = [];
  const offscreen = [];
  for (const el of document.querySelectorAll(".trading-desk *")) {
    if (el.closest(".sr-only, [hidden]") || ["SCRIPT", "STYLE", "CANVAS", "svg", "path"].includes(el.tagName) || !visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 11) small.push(id(el));
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1 || rect.left < -1) offscreen.push(id(el));
  }
  const targets = [];
  const floor = senior ? 56 : 44;
  for (const el of document.querySelectorAll(
    '.trading-desk :is(button, select, input:not([type="hidden"]), [role="switch"], summary, a)',
  )) {
    if (el.closest(".sr-only, [hidden], .td-resources") || !visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height < floor) targets.push(`${Math.round(rect.height)}px ${id(el)}`);
  }
  // Prices use the monospaced face (every digit the same width), so columns line up.
  const numbers = [];
  for (const el of document.querySelectorAll(
    ".td-hero-price strong, .td-hero-book dd, .td-watch-price, .td-level-price, .sim-order-facts dd, .td-hero-stats dd",
  )) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    if (!/IBM Plex Mono/.test(style.fontFamily)) numbers.push(id(el));
  }
  // An unchanged price is "0", never a signed or dashed zero such as "−0" or "-0.00%".
  const signedZero = [...document.querySelectorAll(".trading-desk :is(.td-watch-change, .td-hero-change, .td-quote-line) span")]
    .filter((el) => visible(el) && /(^|\s)[-−—]0(?:\.0+)?(?=\s|%|$)/.test(el.textContent.trim()))
    .map(id);
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  const shown = (selector) => [...document.querySelectorAll(selector)].some(visible);
  const dock = document.querySelector(".td-dock");
  const book = document.querySelector(".td-hero-book")?.getBoundingClientRect();
  return {
    small,
    offscreen,
    targets,
    numbers,
    signedZero,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hero: text(".td-hero h1"),
    heroBid: text('.td-hero-book [data-side="bid"] dd'),
    heroAsk: text('.td-hero-book [data-side="ask"] dd'),
    labels: {
      real: shown('.td-chip[data-kind="real"]'),
      heroSim: shown(".td-hero-book .td-sim-tag"),
      bookSim: shown(".td-book-head .td-chip"),
      paper: shown(".sim-paper-tag"),
      noBroker: [...document.querySelectorAll(".sim-ticket-footnote")].some((el) => /不連接券商/.test(el.textContent)),
    },
    dock: dock
      ? {
          bottom: Math.round(dock.getBoundingClientRect().bottom),
          buttons: [...dock.querySelectorAll("button")].map((el) => el.textContent.trim()),
          narrowest: Math.round(Math.min(...[...dock.querySelectorAll("button")].map((el) => el.getBoundingClientRect().width))),
        }
      : null,
    heroBookBottom: book ? Math.round(book.bottom) : null,
    chartHeight: Math.round(document.querySelector('main canvas[role="img"]')?.getBoundingClientRect().height ?? 0),
    pageScroll: document.documentElement.scrollHeight - innerHeight,
  };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const failures = [];
const rows = [];
for (const item of cases) {
  const fail = (message) => failures.push(`${item.name}: ${message}`);
  const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: 2 });
  if (item.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  const errors = [];
  const broker = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("request", (request) => /\/api\/broker/.test(request.url()) && broker.push(request.url()));
  const phone = item.width < 768 || item.senior;
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const first = await page.evaluate(scan, Boolean(item.senior));
    await page.screenshot({ path: `${out}/${item.name}-market.png` });
    rows.push({ case: item.name, screen: "market", ...first });
    if (first.small.length) fail(`${first.small.length} texts below 11px (${first.small.slice(0, 3).join(" | ")})`);
    if (first.offscreen.length || first.overflowX > 0) fail(`horizontal overflow (${first.offscreen.slice(0, 3).join(" | ")})`);
    if (phone && first.targets.length) fail(`controls below ${item.senior ? 56 : 44}px (${first.targets.slice(0, 4).join(" | ")})`);
    if (first.signedZero.length) fail(`signed zero shown (${first.signedZero.join(" | ")})`);
    if (first.numbers.length) fail(`prices not in the monospaced face (${first.numbers.slice(0, 3).join(" | ")})`);
    if (!first.labels.real) fail("real-history data label not visible");
    if (!first.labels.heroSim) fail("買價／賣價 not labelled 模擬");
    if (!/^台積電/.test(first.hero ?? "")) fail(`hero shows ${first.hero}`);
    if (item.width >= 1200 && !item.senior) {
      if (first.pageScroll > 1) fail(`desktop page scrolls by ${first.pageScroll}px`);
      if (item.name === "1366x900" && first.chartHeight < 700) fail(`chart ${first.chartHeight}px, needs 700`);
      if (!first.labels.bookSim || !first.labels.paper || !first.labels.noBroker) fail(`order-side labels missing ${JSON.stringify(first.labels)}`);
    }
    if (phone) {
      if (
        !first.dock ||
        first.dock.bottom !== item.height ||
        first.dock.buttons.join() !== "自選,行情,下單,庫存" ||
        first.dock.narrowest < 72
      )
        fail(`bottom tabs wrong ${JSON.stringify(first.dock)}`);
      if (!item.senior && first.heroBookBottom > item.height - 60)
        fail(`買價／賣價 end at ${first.heroBookBottom}px, below the first screen`);
    }

    // The hero's best bid/ask must equal the ladder's 買1/賣1 (one teaching book, no second set of values).
    if (phone) await page.getByRole("button", { name: "下單", exact: true }).click();
    const ladder = await page.evaluate(() => ({
      bid: document.querySelector('.td-ladder[data-side="sell"] .td-level .td-level-price')?.textContent?.trim(),
      ask: [...document.querySelectorAll('.td-ladder[data-side="buy"] .td-level .td-level-price')].at(-1)?.textContent?.trim(),
    }));
    if (ladder.bid !== first.heroBid || ladder.ask !== first.heroAsk)
      fail(`hero bid/ask ${first.heroBid}/${first.heroAsk} differ from ladder 買1/賣1 ${ladder.bid}/${ladder.ask}`);
    if (phone) {
      const trade = await page.evaluate(scan, Boolean(item.senior));
      await page.screenshot({ path: `${out}/${item.name}-trade.png` });
      rows.push({ case: item.name, screen: "trade", ...trade });
      if (trade.offscreen.length || trade.overflowX > 0) fail(`trade tab overflow (${trade.offscreen.slice(0, 3).join(" | ")})`);
      if (trade.small.length) fail(`trade tab: ${trade.small.length} texts below 11px`);
      if (trade.targets.length) fail(`trade tab controls below floor (${trade.targets.slice(0, 4).join(" | ")})`);
      if (!trade.labels.bookSim || !trade.labels.paper || !trade.labels.noBroker) fail(`trade tab labels missing ${JSON.stringify(trade.labels)}`);
      await page.getByRole("button", { name: /^庫存/ }).click();
      await page.waitForTimeout(300);
      const positions = await page.evaluate(scan, Boolean(item.senior));
      await page.screenshot({ path: `${out}/${item.name}-positions.png` });
      rows.push({ case: item.name, screen: "positions", ...positions });
      if (positions.offscreen.length || positions.overflowX > 0) fail(`positions tab overflow (${positions.offscreen.slice(0, 3).join(" | ")})`);
      if (!(await page.getByText("參考損益（未含費稅）").first().isVisible())) fail("reference P&L missing on the positions tab");
    }

    // Switch to 鴻海 2317: quote, chart, book and order ticket all follow.
    if (phone) {
      await page.getByRole("button", { name: "自選", exact: true }).click();
      await page.locator(".td-watch-item", { hasText: "鴻海" }).click();
    } else {
      await page.locator(".td-watch .td-watch-item", { hasText: "鴻海" }).click();
    }
    await page.waitForTimeout(400);
    const synced = await page.evaluate(() => ({
      hero: document.querySelector(".td-hero h1")?.textContent ?? null,
      chart: document.querySelector('main canvas[role="img"]')?.getAttribute("aria-label") ?? "",
      stepper: document.querySelector('.td-stepper select')?.value ?? null,
      ticket: document.querySelector('select[aria-label="下單商品"]')?.value ?? null,
      watch: document.querySelector('.td-watch-item[aria-pressed="true"] .td-watch-name small')?.textContent ?? null,
      bid: document.querySelector('.td-hero-book [data-side="bid"] dd')?.textContent?.trim(),
    }));
    if (!/^鴻海/.test(synced.hero ?? "")) fail(`hero did not follow the watchlist (${synced.hero})`);
    if (!synced.chart.includes("2317")) fail("chart did not follow the watchlist");
    if (synced.stepper !== "2317") fail(`stepper shows ${synced.stepper}`);
    if (!phone && (synced.ticket !== "2317" || synced.watch !== "2317")) fail(`ticket/watch not synced ${JSON.stringify(synced)}`);
    await page.screenshot({ path: `${out}/${item.name}-switched.png` });
    if (phone) {
      await page.getByRole("button", { name: "下單", exact: true }).click();
      const ticket = await page.evaluate(() => ({
        line: document.querySelector(".td-quote-line")?.textContent ?? "",
        select: document.querySelector('select[aria-label="下單商品"]')?.value ?? null,
        bid: document.querySelector('.td-ladder[data-side="sell"] .td-level .td-level-price')?.textContent?.trim(),
      }));
      if (!ticket.line.includes("鴻海") || ticket.select !== "2317") fail(`order tab not synced ${JSON.stringify(ticket)}`);
      if (ticket.bid !== synced.bid) fail(`order tab 買1 ${ticket.bid} differs from hero 買價 ${synced.bid}`);
    }
    // The ticket's own selector drives the rest too.
    if (!phone) {
      await page.getByRole("combobox", { name: "下單商品" }).selectOption("2330");
      await page.waitForTimeout(300);
      const back = await page.evaluate(() => document.querySelector(".td-hero h1")?.textContent ?? "");
      if (!/^台積電/.test(back)) fail(`hero did not follow the order ticket selector (${back})`);
    }
  } catch (error) {
    fail(`flow stopped: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}/${item.name}-stopped.png` }).catch(() => {});
  }
  if (errors.length) fail(`console/page errors: ${errors.slice(0, 3).join(" | ")}`);
  if (broker.length) fail(`broker requests sent: ${broker.join(", ")}`);
  await context.close();
}
// Real orders stay disabled on this build: the live hop answers 501 and never sends.
const live = await fetch(`${base}/api/broker/order`, {
  method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: "{}",
});
const liveBody = await live.json().catch(() => null);
if (live.status !== 501 || liveBody?.ok !== false) failures.push(`broker order endpoint answered ${live.status} ${JSON.stringify(liveBody)}`);
await browser.close();
writeFileSync(`${out}/premium.json`, JSON.stringify({ rows, broker: { status: live.status, body: liveBody }, failures }, null, 2));
console.table(
  rows.map((row) => ({
    case: row.case,
    screen: row.screen,
    "<11px": row.small.length,
    overflowX: row.overflowX,
    offscreen: row.offscreen.length,
    "small targets": row.targets.length,
    "not mono": row.numbers.length,
    chart: row.chartHeight,
  })),
);
console.log(`broker /api/broker/order → ${live.status} ${JSON.stringify(liveBody)}`);
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("All premium desk checks passed.");
