// Checks the interactive edition in Chromium at phone, tablet and desktop widths:
// every view without horizontal overflow, images load, pager and lightbox work, ticks survive reload.
//   node courseware/academy/build/qa_web.mjs <output/web/index.html> <reportDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [file, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(file).href;
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const sizes = [
  { name: "phone-375", width: 375, height: 812, mobile: true, dpr: 3 },
  { name: "phone-390", width: 390, height: 844, mobile: true, dpr: 3 },
  { name: "tablet-768", width: 768, height: 1024, mobile: true, dpr: 2 },
  { name: "desktop-1280", width: 1280, height: 800, mobile: false, dpr: 1 },
];
const report = { url, sizes: [], problems: [] };
for (const size of sizes) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  const views = await page.evaluate(() => window.ACADEMY_VIEWS.map((view) => view.id));
  let overflowViews = [];
  let brokenImages = 0;
  for (const id of views) {
    await page.evaluate((hash) => (location.hash = hash), id);
    await page.waitForTimeout(120);
    const result = await page.evaluate(async () => {
      const view = document.querySelector(".w-view:not([hidden])");
      for (const image of view.querySelectorAll("img")) image.loading = "eager";
      await Promise.race([
        Promise.all([...view.querySelectorAll("img")].map((image) => (image.complete ? null : new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; })))),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const broken = [...view.querySelectorAll("img")].filter((image) => !image.naturalWidth).length;
      return { overflow, broken };
    });
    if (result.overflow > 1) overflowViews.push(`${id}(+${result.overflow}px)`);
    brokenImages += result.broken;
  }
  // Pager, lightbox and stored ticks.
  await page.evaluate(() => (location.hash = "01-1"));
  await page.waitForTimeout(200);
  await page.locator('#view-01-1 a[data-next], [data-next]').first().click();
  await page.waitForTimeout(200);
  const afterNext = await page.evaluate(() => location.hash);
  await page.evaluate(() => (location.hash = "01-1"));
  await page.waitForTimeout(200);
  await page.locator("#view-01-1 .figure .frame").first().click();
  const lightbox = await page.locator(".w-lightbox").isVisible();
  await page.locator(".w-lightbox-close").click();
  const box = page.locator('#view-01-1 input[type="checkbox"][data-key]').first();
  await box.check();
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => (location.hash = "01-1"));
  await page.waitForTimeout(200);
  const kept = await page.locator('#view-01-1 input[type="checkbox"][data-key]').first().isChecked();
  const total = await page.locator("[data-total-text]").textContent();
  await page.screenshot({ path: join(outDir, `${size.name}-01-1.png`), fullPage: false });
  await page.evaluate(() => (location.hash = "start"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, `${size.name}-start.png`), fullPage: false });
  const row = { size: size.name, views: views.length, overflowViews, brokenImages, pagerNext: afterNext, lightbox, tickKeptAfterReload: kept, totalProgress: total, pageErrors: errors };
  report.sizes.push(row);
  if (overflowViews.length) report.problems.push(`${size.name}: horizontal overflow in ${overflowViews.join(", ")}`);
  if (brokenImages) report.problems.push(`${size.name}: ${brokenImages} broken images`);
  if (afterNext !== "#01-2") report.problems.push(`${size.name}: next page went to ${afterNext}`);
  if (!lightbox) report.problems.push(`${size.name}: lightbox did not open`);
  if (!kept) report.problems.push(`${size.name}: tick not kept after reload`);
  if (errors.length) report.problems.push(`${size.name}: page errors ${errors.join(" | ")}`);
  await context.close();
}
await browser.close();
writeFileSync(join(outDir, "web-qa.json"), JSON.stringify(report, null, 2));
console.table(report.sizes.map(({ size, views, overflowViews, brokenImages, lightbox, tickKeptAfterReload, totalProgress }) => ({ size, views, overflow: overflowViews.length, brokenImages, lightbox, tickKeptAfterReload, totalProgress })));
console.log(report.problems.length ? "PROBLEMS:\n" + report.problems.join("\n") : "All web checks passed.");
if (report.problems.length) process.exitCode = 1;
