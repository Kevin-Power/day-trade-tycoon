// Screenshots of the trading desk at the review sizes, plus every phone tab.
// Usage: node scripts/qa/desk-shots.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [base = "http://127.0.0.1:18821", outArg = "artifacts/premium-ui/shots"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const sizes = [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [360, 740],
];
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const [width, height] of sizes) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('main canvas[role="img"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const name = `${width}x${height}`;
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  const tabs = page.getByRole("navigation", { name: /看盤分頁|主要分頁/ }).getByRole("button");
  if (width < 768) {
    for (const label of await tabs.allTextContents()) {
      await tabs.filter({ hasText: label.trim() }).first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${name}-tab-${label.trim()}.png` });
    }
  }
  console.log(name, errors.length ? `page errors: ${errors.join(" | ")}` : "ok");
  await context.close();
}
await browser.close();
