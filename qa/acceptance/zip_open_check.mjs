// Opens index.html from a freshly extracted folder via file:// in Chrome and
// checks the entry, CSS, JS, every image (lazy ones forced) and the web fonts; also lists every relative reference
// in index.html and web.css and whether that file exists in the folder.
//   node qa/acceptance/zip_open_check.mjs <freshly extracted folder> <out.json>
import { chromium } from "playwright";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, outFile] = process.argv.slice(2);
const html = readFileSync(join(root, "index.html"), "utf8");
const refs = new Set([...html.matchAll(/(?:src|href)="(?!https?:|#|data:|mailto:)([^"]+)"/g)].map((match) => decodeURIComponent(match[1].split("#")[0].split("?")[0])).filter(Boolean));
for (const css of [...refs].filter((ref) => ref.endsWith(".css")))
  for (const match of readFileSync(join(root, css), "utf8").matchAll(/url\(["']?(?!data:|https?:)([^"')]+)["']?\)/g)) refs.add(join(css, "..", decodeURIComponent(match[1])).replace(/\\/g, "/"));
const missing = [...refs].filter((ref) => !existsSync(join(root, ref)));
const files = [];
const walk = (dir) => readdirSync(join(root, dir)).forEach((name) => (statSync(join(root, dir, name)).isDirectory() ? walk(join(dir, name)) : files.push(join(dir, name).replace(/\\/g, "/"))));
walk("");

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failed = [];
page.on("requestfailed", (request) => failed.push(`${request.url()} ${request.failure()?.errorText}`));
page.on("response", (response) => response.status() >= 400 && failed.push(`${response.url()} ${response.status()}`));
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(pathToFileURL(join(root, "index.html")).href);
await page.waitForFunction(() => window.ACADEMY && window.ACADEMY_DEBUG, null, { timeout: 15000 });
const views = await page.evaluate(() => [...document.querySelectorAll("[data-view]")].map((view) => view.dataset.view));
for (const view of views) {
  await page.evaluate((id) => (location.hash = id), view);
  await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
  await page.evaluate(() => document.querySelectorAll("img").forEach((img) => (img.loading = "eager")));
  await page.waitForTimeout(80);
}
await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 60000 }).catch(() => {});
const result = await page.evaluate(async () => {
  await document.fonts.ready;
  const images = [...document.images];
  const bar = document.querySelector(".w-bar"); const barStyle = bar ? getComputedStyle(bar) : null;
  const sheets = [...document.styleSheets].map((sheet) => ({ href: sheet.href, applied: Boolean(barStyle) && barStyle.position !== "static" && barStyle.display !== "inline", barPosition: barStyle?.position ?? null, bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60) }));
  const faces = [...document.fonts].map((face) => `${face.family} ${face.weight} ${face.status}`);
  return {
    entry: { title: document.title, academy: Boolean(window.ACADEMY), edition: window.ACADEMY?.edition ?? null },
    css: sheets,
    js: [...document.scripts].map((script) => script.src || "(inline)"),
    images: { total: images.length, unique: new Set(images.map((img) => img.currentSrc)).size, broken: images.filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute("src")) },
    fonts: { faces, loaded: faces.filter((face) => face.endsWith("loaded")).length, failed: faces.filter((face) => face.endsWith("error")) },
    internalLinks: (() => {
      const ids = new Set([...document.querySelectorAll("[data-view]")].map((view) => view.dataset.view));
      const bad = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => id && !ids.has(id) && !document.getElementById(id));
      return { checked: document.querySelectorAll('a[href^="#"]').length, broken: [...new Set(bad)] };
    })(),
  };
});
await browser.close();
const report = { root, opening: "file://", browser: "Google Chrome via Playwright", files: files.length, references: refs.size, missingReferences: missing, views: views.length, failedRequests: failed, pageErrors: errors, ...result };
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ files: report.files, references: report.references, missing: missing.length, views: report.views, failedRequests: failed.length, pageErrors: errors.length, css: result.css.map((sheet) => `${sheet.href?.split("/").pop()} applied=${sheet.applied} (.w-bar ${sheet.barPosition}; ${sheet.bodyFont})`), js: result.js.length, images: { total: result.images.total, unique: result.images.unique, broken: result.images.broken.length }, fonts: { loaded: result.fonts.loaded, failed: result.fonts.failed.length }, internalLinks: result.internalLinks, edition: result.entry.edition?.version }, null, 1));
