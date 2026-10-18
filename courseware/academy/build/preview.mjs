// Screenshots of individual workbook pages (print media) for design review, without printing a PDF.
//   node courseware/academy/build/preview.mjs <html> <outDir> [pageNumbers e.g. 1,4,9-12]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [html, outDir, pick = ""] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const wanted = new Set();
for (const part of pick.split(",").filter(Boolean)) {
  const [a, b] = part.split("-").map(Number);
  for (let n = a; n <= (b || a); n++) wanted.add(n);
}
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
await page.evaluate(async () => {
  await document.fonts.ready;
  for (const image of document.images) image.loading = "eager";
  await Promise.race([
    Promise.all([...document.images].map((image) => (image.complete ? null : new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; })))),
    new Promise((resolve) => setTimeout(resolve, 30000)),
  ]);
});
await page.emulateMedia({ media: "print" });
const pages = page.locator("section.page");
const count = await pages.count();
for (let index = 0; index < count; index++) {
  if (wanted.size && !wanted.has(index + 1)) continue;
  await pages.nth(index).screenshot({ path: `${outDir}/page-${String(index + 1).padStart(3, "0")}.png` });
}
console.log(`${wanted.size || count} pages → ${outDir}`);
await browser.close();
