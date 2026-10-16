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
  [1366, 900, false],
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
    const column = submit.closest(".td-trade");
    const bottom = Math.min(innerHeight, column ? column.getBoundingClientRect().bottom : innerHeight);
    submitVisible = rect.bottom <= bottom + 1;
  }
  const main = document.querySelector("main");
  const canvas = document.querySelector('main canvas[role="img"]');
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
    sparkSize: (() => {
      const spark = document.querySelector(".td-watch-item .td-spark");
      if (!spark) return null;
      const rect = spark.getBoundingClientRect();
      return [Math.round(rect.width), Math.round(rect.height)];
    })(),
    ledgerExpanded: document.querySelector(".td-ledger .sim-ledger-toggle")?.getAttribute("aria-expanded") ?? null,
    ledgerHeight: Math.round(document.querySelector(".td-ledger")?.getBoundingClientRect().height ?? 0),
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
  let ledgerToggle = null;
  const toggle = page.locator(".td-ledger .sim-ledger-toggle");
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(200);
    ledgerToggle = await page.evaluate(() => ({
      expanded: document.querySelector(".td-ledger .sim-ledger-toggle")?.getAttribute("aria-expanded"),
      height: Math.round(document.querySelector(".td-ledger")?.getBoundingClientRect().height ?? 0),
    }));
  }
  rows.push({ name, width, height, senior, ...report, ledgerToggle });
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
    chartPx: row.chartHeight,
  })),
);
const failures = [];
for (const row of rows) {
  if (row.small.length) failures.push(`${row.name}: ${row.small.length} text elements below 11px`);
  if (row.clipped.length || row.offscreen.length || row.pageOverflowX > 0)
    failures.push(`${row.name}: horizontal overflow or clipped text`);
  if (row.width < 768 && row.smallTargets.length)
    failures.push(`${row.name}: ${row.smallTargets.length} controls below 44px (${row.smallTargets.slice(0, 4).join(" | ")})`);
  const minChart = { "1366x900": 700, "1920x1080": 880 }[row.name];
  if (minChart && !(row.chartHeight >= minChart))
    failures.push(`${row.name}: chart ${row.chartHeight}px, needs ${minChart}px`);
  if (!row.senior && row.width >= 1200 && !(row.sparkSize && row.sparkSize[0] >= 200 && row.sparkSize[1] >= 48))
    failures.push(`${row.name}: sparkline ${JSON.stringify(row.sparkSize)}, needs 200x48`);
  if (!row.senior && row.width >= 768) {
    if (row.ledgerExpanded !== "false" || row.ledgerHeight > 40)
      failures.push(`${row.name}: ledger not collapsed by default (${row.ledgerExpanded}, ${row.ledgerHeight}px)`);
    if (row.ledgerToggle?.expanded !== "true" || row.ledgerToggle.height < 150)
      failures.push(`${row.name}: ledger did not expand (${JSON.stringify(row.ledgerToggle)})`);
  }
  if (!row.senior && row.width >= 1200 && row.height >= 800) {
    if (row.submitVisible === false) failures.push(`${row.name}: order button below the fold`);
    if (row.documentScroll > 1 || (row.mainScroll ?? 0) > 1) failures.push(`${row.name}: page scrolls`);
    if (!(row.chartRatio >= 0.5)) failures.push(`${row.name}: chart height ratio ${row.chartRatio}`);
  }
}
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  if (strict) process.exitCode = 1;
} else console.log("All layout checks passed.");
