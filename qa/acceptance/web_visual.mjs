#!/usr/bin/env node
// Visual acceptance of the workbook's interactive edition (read only): every view at five window sizes, light
// and dark, after fonts and every image (lazy ones included) have decoded. Saves full-page screenshots and a
// per-view scan: horizontal overflow, text under 11px, WCAG contrast of text on its opaque background, images
// that failed, and in-page links that point nowhere.
//
//   node qa/acceptance/web_visual.mjs <web dir with index.html> <out dir> [--sizes 1440x900,390x844] [--themes light,dark]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, resolve, normalize } from "node:path";

const [webDir, outDir] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!webDir || !outDir) throw new Error("usage: web_visual.mjs <web dir> <out dir>");
const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const SIZES = flag("sizes", "1440x900,1920x1080,768x1024,390x844,360x740").split(",").map((size) => size.split("x").map(Number));
const THEMES = flag("themes", "light,dark").split(",");
const root = resolve(webDir);
mkdirSync(outDir, { recursive: true });

// A tiny static server: file:// would change storage and font behaviour.
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer((request, response) => {
  const path = normalize(join(root, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  const file = path.endsWith("\\") || path.endsWith("/") ? join(path, "index.html") : path;
  if (!file.startsWith(root) || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/`;

const scan = () => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
  };
  const id = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}[${(el.textContent ?? "").trim().slice(0, 14)}]`;
  const channels = (value) => {
    const srgb = value.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
    if (srgb) return [srgb[1] * 255, srgb[2] * 255, srgb[3] * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
    const rgb = value.match(/^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)$/);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : null;
  };
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return null; // gradient or image: not measurable
      const color = channels(style.backgroundColor);
      if (color && color[3] > 0) layers.push(color);
      if (color && color[3] >= 1) break;
    }
    let result = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) result = [r * a + result[0] * (1 - a), g * a + result[1] * (1 - a), b * a + result[2] * (1 - a)];
    return result;
  };
  const luminance = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const view = document.querySelector(".w-view:not([hidden])") ?? document.body;
  const small = [];
  const offscreen = [];
  const lowContrast = [];
  for (const el of view.querySelectorAll("*")) {
    if (el.closest("[hidden], .sr-only, .w-table, svg") || !visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    if (size < 11) small.push(`${size}px ${id(el)}`);
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1 || rect.left < -1) offscreen.push(id(el));
    const fg = channels(style.color);
    const bg = backdrop(el);
    if (fg && bg) {
      const text = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
      const [a, b] = [luminance(text), luminance(bg)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) lowContrast.push(`${ratio.toFixed(2)} ${size}px ${id(el)}`);
    }
  }
  const brokenImages = [...view.querySelectorAll("img")].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute("src"));
  const deadLinks = [...view.querySelectorAll('a[href^="#"]')]
    .map((a) => a.getAttribute("href").slice(1))
    .filter((target) => target && !document.getElementById(target) && !document.getElementById(`view-${target}`) && !(window.ACADEMY_VIEWS ?? []).some((v) => v.id === target));
  return { small, offscreen, lowContrast, brokenImages, deadLinks, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, height: document.documentElement.scrollHeight };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const results = [];
try {
  for (const [width, height] of SIZES) {
    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(base + "index.html", { waitUntil: "load" });
      const views = await page.evaluate(() => (window.ACADEMY_VIEWS ?? []).map((view) => view.id));
      for (const view of views) {
        await page.evaluate((id) => (location.hash = id), view);
        await page.waitForTimeout(150);
        // Lazy images: load them all before the screenshot, and wait for fonts.
        await page.evaluate(async () => {
          const shown = document.querySelector(".w-view:not([hidden])") ?? document.body;
          const images = [...shown.querySelectorAll("img")];
          images.forEach((img) => (img.loading = "eager"));
          await Promise.all(images.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
          await document.fonts.ready;
        });
        const report = await page.evaluate(scan);
        const file = `${width}x${height}-${theme}-${view}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        results.push({ width, height, theme, view, file, ...report });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const summary = {
  checkedAt: new Date().toISOString(),
  web: root,
  combinations: results.length,
  overflow: results.filter((row) => row.overflowX > 0 || row.offscreen.length).length,
  smallText: results.filter((row) => row.small.length).length,
  lowContrast: results.filter((row) => row.lowContrast.length).length,
  brokenImages: results.filter((row) => row.brokenImages.length).length,
  deadLinks: results.filter((row) => row.deadLinks.length).length,
};
writeFileSync(join(outDir, "web-visual.json"), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
