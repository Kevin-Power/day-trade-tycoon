// Premium desk acceptance checks on a seeded desk-server (run desk-seed.mjs first):
// layout at the review sizes, data labels, quote/book consistency, stock switching keeps every
// panel in sync, phone tabs, and no broker traffic. Usage: node scripts/qa/desk-premium.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { iconGrid, iconGridFailures } from "./icon-grid.mjs";

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
    ".td-hero-price strong, .td-hero-book dd, .td-watch-price, .td-book-price, .td-book-last strong, .td-index-value, .sim-order-facts dd",
  )) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    if (!/IBM Plex Mono/.test(style.fontFamily)) numbers.push(id(el));
  }
  // An unchanged price is "0", never a signed or dashed zero such as "−0" or "-0.00%".
  const signedZero = [...document.querySelectorAll(".trading-desk :is(.td-watch-change, .td-hero-change, .td-quote-line) span")]
    .filter((el) => visible(el) && /(^|\s)[-−—]0(?:\.0+)?(?=\s|%|$)/.test(el.textContent.trim()))
    .map(id);
  // Text on an opaque filled background meets WCAG AA: 4.5:1, or 3:1 for large text.
  const rgb = (value) => value.match(/[\d.]+/g)?.map(Number) ?? [];
  const luminance = ([r, g, b]) =>
    [r, g, b]
      .map((c) => c / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const lowContrast = [];
  for (const el of document.querySelectorAll(".trading-desk :is(button, span, strong, em, small)")) {
    if (el.closest(".sr-only, [hidden]") || !visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(el);
    const bg = rgb(style.backgroundColor);
    if (bg.length < 3 || (bg.length === 4 && bg[3] < 1)) continue;
    const fg = rgb(style.color);
    const [a, b] = [luminance(fg), luminance(bg)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast.push(`${ratio.toFixed(2)} ${id(el)}`);
  }
  // Weights the loaded faces cannot draw are synthesised (faux bold): Plex Mono ships 400-600;
  // Noto Sans TC Variable covers 100-900 (the static fallback name only 400-700).
  const fauxBold = [];
  for (const el of document.querySelectorAll(".trading-desk *")) {
    if (el.closest(".sr-only, [hidden]") || !visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(el);
    const family = style.fontFamily.split(",")[0].replaceAll('"', "").trim();
    const weight = Number(style.fontWeight);
    if ((family === "IBM Plex Mono" && weight > 600) || (family === "Noto Sans TC" && weight > 700))
      fauxBold.push(`${weight} ${id(el)}`);
  }
  // The label and the amount of each order fact share one baseline when they sit side by side (the desk's
  // two-column ticket stacks them, label over amount, where a shared baseline does not apply).
  const factBaselines = [];
  for (const row of document.querySelectorAll(".sim-order-facts > div")) {
    if (!visible(row)) continue;
    const [label, amount] = [row.querySelector(":scope > dt"), row.querySelector(":scope > dd")];
    if (label && amount && amount.getBoundingClientRect().top >= label.getBoundingClientRect().bottom - 1) continue;
    const probes = [...row.querySelectorAll(":scope > dt, :scope > dd")].map((cell) => {
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0";
      cell.prepend(probe);
      return probe;
    });
    const lines = probes.map((probe) => probe.getBoundingClientRect().bottom);
    for (const probe of probes) probe.remove();
    if (lines.length === 2 && Math.abs(lines[0] - lines[1]) > 0.5)
      factBaselines.push(`${Math.abs(lines[0] - lines[1]).toFixed(2)}px ${id(row)}`);
  }
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
    lowContrast,
    fauxBold,
    factBaselines,
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
    // The stock chart; the 大盤 pane has its own canvas with an image role.
    chartHeight: Math.round(document.querySelector('.td-chart canvas[role="img"]')?.getBoundingClientRect().height ?? 0),
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
  // Fonts are served by the site itself: nothing is fetched from Google Fonts.
  const thirdPartyFonts = [];
  page.on("request", (request) => /fonts\.(googleapis|gstatic)\.com/.test(request.url()) && thirdPartyFonts.push(request.url()));
  const phone = item.width < 768 || item.senior;
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    // QA_EXTRA_CSS lets a reviewer prove a check fails, e.g. by restoring old colours.
    if (process.env.QA_EXTRA_CSS) await page.addStyleTag({ content: process.env.QA_EXTRA_CSS });
    await page.waitForTimeout(800);
    // This classroom's account is the verified owner: its 富邦唯讀行情 link is a tool in the desk bar, never a row
    // of its own (2026-10-27; the row shrank the chart on short desktops and was 19px on touch screens).
    const fubonLink = page.locator('a[href*="feed=fubon"]');
    await page.locator('.td-bar a[href*="feed=fubon"]').first().waitFor({ timeout: 5000 }).catch(() => {});
    const fubon = await fubonLink.evaluateAll((links) => links.map((link) => Boolean(link.closest(".td-bar"))));
    if (fubon.length !== 1 || !fubon[0]) fail(`the owner's 富邦唯讀行情 link: ${fubon.length} found, in the desk bar: ${fubon}`);
    const first = await page.evaluate(scan, Boolean(item.senior));
    await page.screenshot({ path: `${out}/${item.name}-market.png` });
    rows.push({ case: item.name, screen: "market", ...first });
    if (first.small.length) fail(`${first.small.length} texts below 11px (${first.small.slice(0, 3).join(" | ")})`);
    for (const message of iconGridFailures(await page.evaluate(iconGrid, null), { requireIcons: true })) fail(`market: ${message}`);
    if (first.offscreen.length || first.overflowX > 0) fail(`horizontal overflow (${first.offscreen.slice(0, 3).join(" | ")})`);
    // Touch layouts (phones, tablets, large text) need 44px targets (56px in large text).
    if (item.width < 1200 || item.senior)
      if (first.targets.length) fail(`controls below ${item.senior ? 56 : 44}px (${first.targets.slice(0, 4).join(" | ")})`);
    // The price font is preloaded, and the preload is the very file the stylesheet uses (fetched once).
    const fonts = await page.evaluate(() => ({
      preloads: [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((link) => link.href),
      fetched: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => /ibm-plex-mono/.test(name)),
    }));
    const preloadedPlex = fonts.preloads.filter((href) => /ibm-plex-mono/.test(href));
    if (preloadedPlex.length < 3 || preloadedPlex.some((href) => !fonts.fetched.includes(href)) ||
      new Set(fonts.fetched).size > preloadedPlex.length)
      fail(`price font not preloaded as used (${JSON.stringify(fonts)})`);
    if (first.fauxBold.length) fail(`synthesised bold text (${first.fauxBold.slice(0, 3).join(" | ")})`);
    if (first.factBaselines.length) fail(`order facts off their shared baseline (${first.factBaselines.join(" | ")})`);
    if (first.lowContrast.length) fail(`low contrast text (${first.lowContrast.slice(0, 4).join(" | ")})`);
    if (first.signedZero.length) fail(`signed zero shown (${first.signedZero.join(" | ")})`);
    if (first.numbers.length) fail(`prices not in the monospaced face (${first.numbers.slice(0, 3).join(" | ")})`);
    if (!first.labels.real) fail("real-history data label not visible");
    if (!first.labels.heroSim) fail("買進／賣出 not labelled 模擬");
    if (!/^台積電/.test(first.hero ?? "")) fail(`hero shows ${first.hero}`);
    if (item.width >= 1200 && !item.senior) {
      if (first.pageScroll > 1) fail(`desktop page scrolls by ${first.pageScroll}px`);
      if (item.name === "1366x900" && first.chartHeight < 420) fail(`chart ${first.chartHeight}px, needs 420`);
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
        fail(`買進／賣出 end at ${first.heroBookBottom}px, below the first screen`);
    }

    // The hero's best bid/ask must equal the book's 買1/賣1 (one teaching book, no second set of values).
    if (phone) await page.getByRole("button", { name: "下單", exact: true }).click();
    const ladder = await page.evaluate(() => ({
      bid: document.querySelector('.td-book-cell[data-side="bid"][data-level="1"] .td-book-price')?.textContent?.trim(),
      ask: document.querySelector('.td-book-cell[data-side="ask"][data-level="1"] .td-book-price')?.textContent?.trim(),
    }));
    if (ladder.bid !== first.heroBid || ladder.ask !== first.heroAsk)
      fail(`hero bid/ask ${first.heroBid}/${first.heroAsk} differ from ladder 買1/賣1 ${ladder.bid}/${ladder.ask}`);
    if (phone) {
      const trade = await page.evaluate(scan, Boolean(item.senior));
      await page.screenshot({ path: `${out}/${item.name}-trade.png` });
      rows.push({ case: item.name, screen: "trade", ...trade });
      if (trade.offscreen.length || trade.overflowX > 0) fail(`trade tab overflow (${trade.offscreen.slice(0, 3).join(" | ")})`);
      if (trade.small.length) fail(`trade tab: ${trade.small.length} texts below 11px`);
      for (const message of iconGridFailures(await page.evaluate(iconGrid, null), { requireIcons: true })) fail(`trade tab: ${message}`);
      if (trade.fauxBold.length) fail(`trade tab synthesised bold (${trade.fauxBold.slice(0, 3).join(" | ")})`);
      if (trade.factBaselines.length) fail(`trade tab order facts off baseline (${trade.factBaselines.join(" | ")})`);
      if (trade.lowContrast.length) fail(`trade tab low contrast (${trade.lowContrast.slice(0, 4).join(" | ")})`);
      if (trade.targets.length) fail(`trade tab controls below floor (${trade.targets.slice(0, 4).join(" | ")})`);
      if (!trade.labels.bookSim || !trade.labels.paper || !trade.labels.noBroker) fail(`trade tab labels missing ${JSON.stringify(trade.labels)}`);
      await page.getByRole("button", { name: /^庫存/ }).click();
      await page.waitForTimeout(300);
      const positions = await page.evaluate(scan, Boolean(item.senior));
      await page.screenshot({ path: `${out}/${item.name}-positions.png` });
      rows.push({ case: item.name, screen: "positions", ...positions });
      if (positions.offscreen.length || positions.overflowX > 0) fail(`positions tab overflow (${positions.offscreen.slice(0, 3).join(" | ")})`);
      for (const message of iconGridFailures(await page.evaluate(iconGrid, null))) fail(`positions tab: ${message}`);
      if (!(await page.getByText("參考損益（未含費稅）").first().isVisible())) fail("reference P&L missing on the positions tab");
    }

    // Switch to 鴻海 2317: quote, chart, book and order ticket all follow.
    if (phone) {
      await page.getByRole("button", { name: "自選", exact: true }).click();
      // Each row's name and price stay apart (the TAIEX row is the widest).
      const collisions = await page.evaluate(() =>
        [...document.querySelectorAll(".td-watch-row")].flatMap((row) => {
          const name = row.querySelector(".td-watch-name");
          const price = row.querySelector(".td-watch-price");
          if (!name || !price) return [];
          const right = Math.max(...[...name.children].map((child) => child.getBoundingClientRect().right));
          const range = document.createRange();
          range.selectNodeContents(price);
          const left = range.getBoundingClientRect().left;
          return right > left + 1 ? [`${row.dataset.code} name ends at ${Math.round(right)}, price starts at ${Math.round(left)}`] : [];
        }),
      );
      if (collisions.length) fail(`自選 rows run into each other (${collisions.join(" | ")})`);
      await page.locator(".td-watch-row", { hasText: "鴻海" }).click();
    } else {
      await page.locator(".td-watch .td-watch-row", { hasText: "鴻海" }).click();
    }
    await page.waitForTimeout(400);
    const synced = await page.evaluate(() => ({
      hero: document.querySelector(".td-hero h1")?.textContent ?? null,
      chart: document.querySelector('.td-chart canvas[role="img"]')?.getAttribute("aria-label") ?? "",
      stepper: document.querySelector('.td-stepper select')?.value ?? null,
      ticket: document.querySelector('select[aria-label="下單商品"]')?.value ?? null,
      watch: document.querySelector('.td-watch-row[aria-pressed="true"] .td-watch-name small')?.textContent ?? null,
      bid: document.querySelector('.td-hero-book [data-side="bid"] dd')?.textContent?.trim(),
    }));
    if (!/^鴻海/.test(synced.hero ?? "")) fail(`hero did not follow the watchlist (${synced.hero})`);
    if (!synced.chart.includes("2317")) fail("chart did not follow the watchlist");
    // Phones step from the quote block (◀ ▶), desks from the chart toolbar's stepper.
    if (!phone && synced.stepper !== "2317") fail(`stepper shows ${synced.stepper}`);
    if (!phone && (synced.ticket !== "2317" || synced.watch !== "2317")) fail(`ticket/watch not synced ${JSON.stringify(synced)}`);
    await page.screenshot({ path: `${out}/${item.name}-switched.png` });
    if (phone) {
      await page.getByRole("button", { name: "下單", exact: true }).click();
      const ticket = await page.evaluate(() => ({
        line: document.querySelector(".td-quote-line")?.textContent ?? "",
        select: document.querySelector('select[aria-label="下單商品"]')?.value ?? null,
        bid: document.querySelector('.td-book-cell[data-side="bid"][data-level="1"] .td-book-price')?.textContent?.trim(),
      }));
      if (!ticket.line.includes("鴻海") || ticket.select !== "2317") fail(`order tab not synced ${JSON.stringify(ticket)}`);
      if (ticket.bid !== synced.bid) fail(`order tab 買1 ${ticket.bid} differs from hero 買進 ${synced.bid}`);
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
  // The lobby keeps the desk's 11px floor.
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 20000 });
    await page.waitForTimeout(1200);
    const lobbySmall = await page.evaluate(() => {
      const small = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (el.closest(".sr-only, [hidden]") || ["SCRIPT", "STYLE"].includes(el.tagName)) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(el).visibility !== "visible") continue;
        if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 11) small.push(`${size}px ${(el.textContent ?? "").trim().slice(0, 16)}`);
      }
      return small;
    });
    if (lobbySmall.length) fail(`lobby: ${lobbySmall.length} texts below 11px (${lobbySmall.slice(0, 3).join(" | ")})`);
  } catch (error) {
    fail(`lobby check stopped: ${error.message.split("\n")[0]}`);
  }
  if (errors.length) fail(`console/page errors: ${errors.slice(0, 3).join(" | ")}`);
  // The only broker request a desk may send is the owner's access check, once per desk opened (the desk and the
  // lobby round trip open it at most twice); no quotes are polled from the practice desk.
  const access = broker.filter((url) => new URL(url).search === "?access=1");
  const other = broker.filter((url) => new URL(url).search !== "?access=1");
  if (other.length) fail(`broker requests sent: ${other.join(", ")}`);
  if (access.length > 2) fail(`the owner's access check ran ${access.length} times`);
  if (thirdPartyFonts.length) fail(`fonts fetched from Google: ${thirdPartyFonts.slice(0, 2).join(", ")}`);
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
