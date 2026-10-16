// Renders the home-screen icons from the brand mark (src/components/brand-mark.tsx).
// Usage: node scripts/generate-icons.mjs   → public/icons/*.png (commit the output)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(out, { recursive: true });

// Same artwork as BrandMark: a teaching book framed by two market candles.
const ARTWORK = `
  <path d="M12 15.5C16.5 14.5 20.3 16 24 19C27.7 16 31.5 14.5 36 15.5V32C31.5 31 27.7 32.5 24 35C20.3 32.5 16.5 31 12 32V15.5Z"
    stroke="#f3eee0" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
  <path d="M24 19V35" stroke="#f3eee0" stroke-width="1.6"/>
  <path d="M18 20V28M30 19V27" stroke="#d7bc7c" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M16.5 22H19.5V26H16.5V22ZM28.5 21H31.5V24.5H28.5V21Z" fill="#d7bc7c"/>`;
// "any": the rounded tile itself on a transparent background.
const rounded = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none">
  <rect x="1" y="1" width="46" height="46" rx="14" fill="#233e61"/>
  <rect x="1.5" y="1.5" width="45" height="45" rx="13.5" stroke="#ffffff" stroke-opacity=".12"/>${ARTWORK}</svg>`;
// Maskable and Apple: full-bleed colour (the platform rounds the corners); the artwork already
// sits inside the central 80% safe zone.
const fullBleed = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none">
  <rect width="48" height="48" fill="#233e61"/>${ARTWORK}</svg>`;

const icons = [
  ["icon-192.png", 192, rounded],
  ["icon-512.png", 512, rounded],
  ["icon-maskable-512.png", 512, fullBleed],
  ["apple-touch-icon.png", 180, fullBleed],
];

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, draw] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${draw(size)}</body></html>`);
  await page.locator("svg").screenshot({ path: out + name, omitBackground: true });
  console.log(`${name} ${size}x${size}`);
}
await browser.close();
