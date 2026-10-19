// Screenshots of the other pages that share classroom-refresh.css, for before/after comparison, and a check
// that every icon on them sits on its 15px grid (desktop, phone and large text).
// Usage: node scripts/qa/desk-pages.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { iconGrid, iconGridFailures } from "./icon-grid.mjs";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const failures = [];
for (const [width, height, senior] of [
  [1366, 900, false],
  [375, 812, false],
  [375, 812, true],
]) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  const size = `${width}${senior ? "-large" : ""}`;
  for (const [name, path] of [
    ["lobby", "/"],
    ["try", "/try"],
    ["manual", "/manual"],
    ["login", "/login"],
    ["license", "/license"],
  ]) {
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}page-${name}-${size}.png`, fullPage: true });
    for (const message of iconGridFailures(await page.evaluate(iconGrid, null), { requireIcons: true }))
      failures.push(`${name} ${size}: ${message}`);
  }
  await context.close();
}
await browser.close();
console.log(`Saved page screenshots to ${out}`);
if (failures.length) {
  console.log(`ICON FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("All icons sit on their 15px grid.");
