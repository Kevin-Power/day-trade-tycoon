// Screenshots of the other pages that share classroom-refresh.css, for before/after comparison.
// Usage: node scripts/qa/desk-pages.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const [width, height] of [
  [1366, 900],
  [375, 812],
]) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  for (const [name, path] of [
    ["lobby", "/"],
    ["try", "/try"],
    ["manual", "/manual"],
  ]) {
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}page-${name}-${width}.png`, fullPage: true });
  }
  await context.close();
}
await browser.close();
console.log(`Saved page screenshots to ${out}`);
