// Chart sharpness at genuine device scale factors (Chrome flag, not CDP emulation).
// Counts anti-aliased blend pixels inside the plot of the real trading-desk chart.
// Usage: node scripts/qa/desk-sharpness.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const launch = (args) =>
  chromium.launch({ args }).catch(() => chromium.launch({ channel: "chrome", args }));

const rows = [];
for (const ratio of [1, 1.25, 1.5, 2]) {
  const browser = await launch([`--force-device-scale-factor=${ratio}`, "--window-size=1400,1000"]);
  const page = await (await browser.newContext({ viewport: null })).newPage();
  await page.goto(`${base}/morning?panel=trade`, { waitUntil: "domcontentloaded" });
  const canvas = page.locator('main canvas[role="img"]');
  await canvas.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const palette = await canvas.evaluate((el) => {
    const style = getComputedStyle(el);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return [
      read("--color-bg", "#080d14"),
      read("--color-border", "#243040"),
      read("--color-up", "#ff3b3b"),
      read("--color-down", "#17c964"),
      read("--color-tape", "#e8c547"),
      read("--color-muted", "#8b9bb0"),
      read("--color-warn", "#e7b549"),
    ];
  });
  const png = await canvas.screenshot();
  writeFileSync(`${out}sharp-dpr${ratio}.png`, png);
  const stats = await page.evaluate(
    async ({ b64, ratio, palette }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const cssW = image.width / ratio;
      const cssH = image.height / ratio;
      // Plot interior: skip both axes and the time axis.
      const x0 = Math.round(80 * ratio);
      const x1 = Math.round((cssW - 90) * ratio);
      const y0 = Math.round(14 * ratio);
      const y1 = Math.round((cssH - 30) * ratio);
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const colours = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
      let drawn = 0;
      let soft = 0;
      for (let i = 0; i < data.length; i += 4) {
        const distance = (c) =>
          Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2]));
        if (distance(colours[0]) > 4) drawn++;
        if (Math.min(...colours.map(distance)) > 6) soft++;
      }
      return { drawn, soft };
    },
    { b64: png.toString("base64"), ratio, palette },
  );
  rows.push({ dpr: ratio, ...stats, softPct: Number(((100 * stats.soft) / Math.max(1, stats.drawn)).toFixed(1)) });
  await browser.close();
}
writeFileSync(`${out}sharpness.json`, JSON.stringify(rows, null, 2));
console.table(rows);
