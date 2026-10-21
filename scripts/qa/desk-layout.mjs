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
    // 自選 rows cut off by the watch pane (the pane scrolls, and headless Chrome hides its scrollbar).
    watchOutside: (() => {
      const pane = document.querySelector(".td-watch");
      if (!pane) return null;
      const box = pane.getBoundingClientRect();
      return [...document.querySelectorAll(".td-watch .td-watch-row")].filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
      }).length;
    })(),
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
  rows.push({ name, width, height, senior, ...report, indexView });
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
  }[row.name];
  if (minChart && !(row.chartHeight >= minChart))
    failures.push(`${row.name}: chart ${row.chartHeight}px, needs ${minChart}px`);
  if (minChart && !(row.chartWidth >= 1.2 * row.chartHeight))
    failures.push(`${row.name}: chart ${row.chartWidth}x${row.chartHeight} is not 1.2 times wider than tall`);
  if (!row.senior && row.width >= 768 && !(row.miniSize && row.miniSize[0] >= 100 && row.miniSize[1] >= 24))
    failures.push(`${row.name}: 簡易K線 ${JSON.stringify(row.miniSize)}, needs 100x24`);
  if (row.indexView && (row.indexView.offscreen.length || row.indexView.overflowX > 0 || row.indexView.small.length))
    failures.push(`${row.name}: the 大盤 view runs off the screen (${row.indexView.offscreen.slice(0, 3).join(" | ")})`);
  // Every stock (and the TAIEX) in 自選 is in view without scrolling the pane.
  if (!row.senior && row.width >= 768 && row.watchOutside !== 0)
    failures.push(`${row.name}: ${row.watchOutside} 自選 rows outside the watch pane`);
  // The ledger is always open on desks and tablets; desks keep at least 150px for it.
  if (!row.senior && row.width >= 768 && !(row.ledgerHeight >= (row.width >= 1200 ? 150 : 100)))
    failures.push(`${row.name}: ledger ${row.ledgerHeight}px`);
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
