// Before/after phone shots (390 px) of the r2.2 fixes in the digital edition: the table of contents drawer,
// the save status while changing pages, and the marker buttons of the zoom viewer. Writes <out dir>/*.png and
// web-before-after.json.   node courseware/academy/build/evidence_web.mjs <old index.html> <new index.html> <out dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [before, after, dir] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const report = {};
for (const [tag, file] of [["before", before], ["after", after]]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href + "#01-3", { waitUntil: "load" });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.locator(".w-menu").click();
  await page.waitForTimeout(400);
  const toc = await page.evaluate(() => ({ navTop: Math.round(document.querySelector(".w-nav").getBoundingClientRect().top), barBottom: Math.round(document.querySelector(".w-bar").getBoundingClientRect().bottom), closeButton: Boolean(document.querySelector("[data-nav-close]")), backdrop: Boolean(document.querySelector("[data-nav-backdrop]")) }));
  await page.screenshot({ path: join(dir, `${tag}-mobile-toc-390.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  toc.escapeCloses = !(await page.locator(".w-nav.open").count());
  // Save status while moving between pages after an answer was saved.
  await page.evaluate((hash) => (location.hash = hash), "01-1");
  await page.waitForTimeout(200);
  await page.locator('[data-field="01-1:think"]').first().fill("前後對照用的筆記");
  await page.evaluate(() => window.ACADEMY_DEBUG.flush());
  await page.locator('[data-field="01-1:think"]').first().evaluate((node) => node.blur());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__texts = [];
    const target = document.querySelector("[data-save-status]");
    new MutationObserver(() => window.__texts.push(target.textContent)).observe(target, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate((hash) => (location.hash = hash), "01-2");
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(dir, `${tag}-page-change-status.png`), clip: { x: 0, y: 0, width: 390, height: 70 } });
  await page.waitForTimeout(700);
  const saving = (await page.evaluate(() => window.__texts)).some((text) => /儲存中/.test(text));
  // Marker buttons in the zoom viewer (desk map, 12 markers).
  await page.evaluate((hash) => (location.hash = hash), "01-4");
  await page.waitForTimeout(200);
  await page.locator("#view-01-4 .w-mapref summary").click();
  await page.locator("#view-01-4 .w-mapref .figure .frame").first().click();
  await page.locator(".w-lightbox:not([hidden])").waitFor();
  await page.waitForTimeout(300);
  const marks = await page.evaluate(() => [...document.querySelectorAll(".w-lb-mark")].filter((button) => { const box = button.getBoundingClientRect(); return box.right > innerWidth || box.left < 0; }).map((button) => button.textContent));
  await page.screenshot({ path: join(dir, `${tag}-zoom-marker-buttons-390.png`), clip: { x: 0, y: 0, width: 390, height: 260 } });
  report[tag] = { toc, savingShownOnPageChange: saving, markerButtonsOffScreen: marks };
  await context.close();
}
await browser.close();
writeFileSync(join(dir, "web-before-after.json"), JSON.stringify({ before, after, at: new Date().toISOString(), report }, null, 2));
console.log(JSON.stringify(report, null, 1));
