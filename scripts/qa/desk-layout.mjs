// Layout checks and screenshots for the trading desk at every target size.
// Usage: node scripts/qa/desk-layout.mjs <baseUrl> <label> [--strict]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run", ...flags] = process.argv.slice(2);
const strict = flags.includes("--strict");
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const cases = [
  [1920, 1080, false],
  [1440, 900, false],
  [1366, 900, false],
  [1366, 768, false],
  [1280, 800, false],
  [1200, 800, false],
  // Real laptop viewports: 1080p at 125% and at 150% (with and without a bookmarks bar), 1366x768 and
  // 1280x800 screens, each minus the browser's bars and the taskbar.
  [1536, 730, false],
  [1280, 689, false],
  [1366, 657, false],
  [1280, 600, false],
  [1280, 568, false],
  // The narrowest short desktop, where the one-line hero is tightest.
  [1200, 700, false],
  [820, 900, false],
  [375, 812, false],
  [320, 700, false],
  [1366, 900, true],
  [320, 700, true],
];

const scan = () => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.opacity !== "0";
  };
  const id = (el) =>
    `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}` +
    `[${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 14)}]`;
  const small = [];
  const clipped = [];
  const offscreen = [];
  let minFont = Infinity;
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(".sr-only, [hidden]") || ["SCRIPT", "STYLE", "CANVAS"].includes(el.tagName)) continue;
    if (!visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    minFont = Math.min(minFont, size);
    if (size < 11) small.push(`${size}px ${id(el)}`);
    if (
      (style.overflowX === "hidden" || style.overflowX === "clip") &&
      style.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1
    )
      clipped.push(id(el));
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1 || rect.left < -1) offscreen.push(id(el));
  }
  // Controls shorter than 44px (checked on phone-width cases only).
  const smallTargets = [];
  for (const el of document.querySelectorAll(
    '.trading-desk :is(button, select, input:not([type="hidden"]), [role="switch"], summary)',
  )) {
    if (el.closest(".sr-only, [hidden]") || !visible(el)) continue;
    const height = el.getBoundingClientRect().height;
    if (height < 44) smallTargets.push(`${Math.round(height)}px ${id(el)}`);
  }
  // Desktop click targets that shrink on short screens: 自選 rows and the plan chip (WCAG 2.2 SC 2.5.8, 24px).
  const desktopTargets = [...document.querySelectorAll("button.td-watch-row, .td-plan-chip")]
    .filter((el) => visible(el))
    .map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);
  // The main order button must be visible without scrolling its column.
  const submit = [...document.querySelectorAll("button")].find((el) =>
    (el.textContent ?? "").trim().startsWith("核對模擬"),
  );
  let submitVisible = null;
  if (submit && visible(submit)) {
    const rect = submit.getBoundingClientRect();
    const column = submit.closest('[data-pane="ticket"]') ?? submit.closest(".td-mobile-ticket");
    const bottom = Math.min(innerHeight, column ? column.getBoundingClientRect().bottom : innerHeight);
    submitVisible = rect.bottom <= bottom + 1;
  }
  const main = document.querySelector("main");
  // The stock chart; the 大盤 pane has its own canvas with an image role.
  const canvas = document.querySelector('.td-chart canvas[role="img"]');
  return {
    minFont: minFont === Infinity ? null : minFont,
    smallTargets: [...new Set(smallTargets)],
    desktopTargets,
    submitVisible,
    small,
    clipped,
    offscreen,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollHeight - innerHeight,
    mainScroll: main ? main.scrollHeight - main.clientHeight : null,
    chartRatio: canvas ? Number((canvas.getBoundingClientRect().height / innerHeight).toFixed(3)) : null,
    chartHeight: canvas ? Math.round(canvas.getBoundingClientRect().height) : null,
    chartWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
    miniSize: (() => {
      const mini = document.querySelector('.td-watch-row:not([data-code="TAIEX"]) .td-mini');
      if (!mini) return null;
      const rect = mini.getBoundingClientRect();
      return [Math.round(rect.width), Math.round(rect.height)];
    })(),
    ledgerHeight: Math.round(document.querySelector(".td-ledger")?.getBoundingClientRect().height ?? 0),
    // 自選 rows cut off by the watch pane (headless Chrome hides scrollbars). A short list (its table does not scroll)
    // shows every row inside the pane. A long list scrolls inside its own table (2026-10-28, up to 80 stocks): then
    // the table itself must sit inside the pane, so that every row can be scrolled to, and the rows in its visible
    // window (below the sticky bars) must not reach past the pane.
    watchOutside: (() => {
      const pane = document.querySelector(".td-watch");
      if (!pane) return null;
      const box = pane.getBoundingClientRect();
      const outside = (rect) => rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
      const table = pane.querySelector(".td-watch-table");
      const rows = [...pane.querySelectorAll(".td-watch-row")];
      if (!table || table.scrollHeight <= table.clientHeight + 1)
        return rows.filter((row) => outside(row.getBoundingClientRect())).length;
      const view = table.getBoundingClientRect();
      const window = { top: view.top, bottom: view.top + table.clientHeight };
      return (
        (outside(view) ? 1 : 0) +
        rows.filter((row) => {
          const rect = row.getBoundingClientRect();
          const shown = { top: Math.max(rect.top, window.top), bottom: Math.min(rect.bottom, window.bottom) };
          return shown.bottom > shown.top && outside(shown);
        }).length
      );
    })(),
    watchRows: document.querySelectorAll(".td-watch .td-watch-row").length,
  };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const rows = [];
for (const [width, height, senior] of cases) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (senior)
    await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  await page.goto(`${base}/morning?panel=trade`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 20000 });
  await page.waitForSelector('main canvas[role="img"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const report = await page.evaluate(scan);
  const name = `${width}x${height}${senior ? "-senior" : ""}`;
  await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
  // The narrowest short desktop: the one-line hero keeps its price clear of 買進／賣出, for every stock and for the
  // widest plausible quote (a five-digit price near the limit; fallback fonts can be wider than ours).
  let heroSlack = null;
  if (width === 1200 && height <= 760 && !senior) {
    const slack = () =>
      page.evaluate(() => {
        const price = document.querySelector(".td-hero .td-hero-price");
        const book = document.querySelector(".td-hero .td-hero-book");
        if (!price || !book) return null;
        const right = Math.max(...[...price.querySelectorAll("*")].map((node) => node.getBoundingClientRect().right));
        return Math.round(book.getBoundingClientRect().left - right);
      });
    const codes = await page
      .locator(".td-watch-row[data-code]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-code")).filter((code) => code !== "TAIEX"));
    const stocks = {};
    for (const code of codes) {
      await page.locator(`.td-watch-row[data-code="${code}"]`).click();
      await page.waitForTimeout(250);
      stocks[code] = await slack();
    }
    await page.evaluate(() => {
      const price = document.querySelector(".td-hero-price strong");
      const parts = document.querySelectorAll(".td-hero-change > span");
      const book = document.querySelectorAll(".td-hero-book dd");
      if (price) price.textContent = "10,550";
      if (parts[0]) parts[0].textContent = "▲955";
      if (parts[1]) parts[1].textContent = "+9.95%";
      if (book[0]) book[0].textContent = "10,545";
      if (book[1]) book[1].textContent = "10,550";
    });
    heroSlack = { stocks, widest: await slack() };
    await page.screenshot({ path: `${out}${name}-widest-hero.png` });
  }
  // Phones and large text: the 大盤 view (自選 → 加權指數) fits the screen too.
  let indexView = null;
  const dock = page.locator("nav.td-dock");
  if (await dock.count()) {
    await dock.getByRole("button", { name: /^自選/ }).click();
    await page.locator('.td-watch-row[data-code="TAIEX"]').click();
    await page.locator(".td-index-panel").first().waitFor({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    // The widest plausible quote (a big opening move) must still fit: values change every minute.
    await page.evaluate(() => {
      const value = document.querySelector(".td-index-value");
      const change = document.querySelector(".td-index-change");
      if (value) value.textContent = "49,932.26";
      if (change) change.textContent = "▲1,220.22 +2.51%";
    });
    const view = await page.evaluate(scan);
    indexView = { offscreen: view.offscreen, small: view.small, overflowX: view.pageOverflowX };
    await page.screenshot({ path: `${out}${name}-index.png`, fullPage: true });
  }
  rows.push({ name, width, height, senior, ...report, indexView, heroSlack });
  await context.close();
}
await browser.close();
writeFileSync(`${out}layout.json`, JSON.stringify(rows, null, 2));
console.table(
  rows.map((row) => ({
    case: row.name,
    minFont: row.minFont,
    "<11px": row.small.length,
    clipped: row.clipped.length,
    offscreen: row.offscreen.length,
    overflowX: row.pageOverflowX,
    docScroll: row.documentScroll,
    mainScroll: row.mainScroll,
    chart: row.chartRatio,
    chartPx: row.chartHeight && `${row.chartWidth}x${row.chartHeight}`,
    ledger: row.ledgerHeight,
  })),
);
const failures = [];
for (const row of rows) {
  if (row.small.length) failures.push(`${row.name}: ${row.small.length} text elements below 11px`);
  if (row.clipped.length || row.offscreen.length || row.pageOverflowX > 0)
    failures.push(`${row.name}: horizontal overflow or clipped text`);
  if (!row.senior && row.width >= 1200 && row.desktopTargets.some((height) => height < 24))
    failures.push(`${row.name}: 自選 rows or plan chip below 24px (${Math.min(...row.desktopTargets)}px)`);
  if (row.width < 768 && row.smallTargets.length)
    failures.push(`${row.name}: ${row.smallTargets.length} controls below 44px (${row.smallTargets.slice(0, 4).join(" | ")})`);
  // The stock chart's floor on desktops (spec 4.1), and it stays wider than tall.
  const minChart = {
    "1920x1080": 600,
    "1440x900": 420,
    "1366x900": 420,
    "1366x768": 300,
    "1280x800": 360,
    "1200x800": 340,
    "1536x730": 380,
    "1280x689": 340,
    "1366x657": 300,
    // 24px 自選 rows (WCAG 2.2 SC 2.5.8) cost these two about 12px against the first short-desk targets.
    "1280x600": 250,
    "1280x568": 220,
  }[row.name];
  if (minChart && !(row.chartHeight >= minChart))
    failures.push(`${row.name}: chart ${row.chartHeight}px, needs ${minChart}px`);
  if (minChart && !(row.chartWidth >= 1.2 * row.chartHeight))
    failures.push(`${row.name}: chart ${row.chartWidth}x${row.chartHeight} is not 1.2 times wider than tall`);
  // The 江波圖 mini takes the row's height less 2px: desktops 26px (24px up to 860px tall, 22px up to 760px), tablets 36px.
  const miniHeight = row.width >= 1200 ? (row.height <= 760 ? 22 : row.height <= 860 ? 24 : 26) : 36;
  if (!row.senior && row.width >= 768 && !(row.miniSize && row.miniSize[0] >= 100 && row.miniSize[1] >= miniHeight))
    failures.push(`${row.name}: 江波圖 ${JSON.stringify(row.miniSize)}, needs 100x${miniHeight}`);
  if (row.indexView && (row.indexView.offscreen.length || row.indexView.overflowX > 0 || row.indexView.small.length))
    failures.push(`${row.name}: the 大盤 view runs off the screen (${row.indexView.offscreen.slice(0, 3).join(" | ")})`);
  // Every stock (and the TAIEX) in 自選 is in view without scrolling the pane.
  if (!row.senior && row.width >= 768 && row.watchOutside !== 0)
    failures.push(`${row.name}: ${row.watchOutside} 自選 rows outside the watch pane`);
  // The ledger is always open on desks and tablets; desks keep at least 150px for it.
  if (!row.senior && row.width >= 768 && !(row.ledgerHeight >= (row.width >= 1200 ? 150 : 100)))
    failures.push(`${row.name}: ledger ${row.ledgerHeight}px`);
  if (row.heroSlack) {
    const tight = Object.entries(row.heroSlack.stocks).filter(([, gap]) => !(gap >= 16));
    if (tight.length || !(row.heroSlack.widest >= 16))
      failures.push(`${row.name}: the hero's price is within 16px of 買進／賣出 (${JSON.stringify(row.heroSlack)})`);
  }
  // Every desktop size fits without page scroll and keeps the send button in its pane (Review Focus 5).
  if (!row.senior && row.width >= 1200) {
    if (row.submitVisible !== true) failures.push(`${row.name}: order button not visible (${row.submitVisible})`);
    if (row.documentScroll > 1 || (row.mainScroll ?? 0) > 1) failures.push(`${row.name}: page scrolls`);
  }
}
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  if (strict) process.exitCode = 1;
} else console.log("All layout checks passed.");
