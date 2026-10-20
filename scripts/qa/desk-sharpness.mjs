// Chart and icon sharpness at genuine device scale factors (Chrome flag, not CDP emulation).
// Counts anti-aliased blend pixels inside the plot of the real trading-desk chart, checks every icon sits
// on its 15px grid, and saves the replay toolbar for an icon before/after comparison.
// Usage: node scripts/qa/desk-sharpness.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { iconGrid, iconGridFailures } from "./icon-grid.mjs";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const launch = (args) =>
  chromium.launch({ args }).catch(() => chromium.launch({ channel: "chrome", args }));

// Dashed reference lines must have no blended pixels: rows that carry a line colour inside a column
// band of empty plot (no price data, no labels) are checked pixel by pixel. palette[0] is the
// background; null samples it from the image's top-right corner.
async function dashRowSoft(page, png, palette, lines, x0f, x1f) {
  return page.evaluate(
    async ({ b64, palette, lines, x0f, x1f }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height).data;
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const at = (x, y) => data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
      const colours = palette.map((hex) => (hex ? rgb(hex) : [...at(image.width - 1, 0)]));
      const lineColours = lines.map(rgb);
      const distance = (p, c) => Math.max(Math.abs(c[0] - p[0]), Math.abs(c[1] - p[1]), Math.abs(c[2] - p[2]));
      const x0 = Math.round(image.width * x0f);
      const x1 = Math.round(image.width * x1f);
      let rows = 0;
      let soft = 0;
      for (let y = 0; y < image.height; y++) {
        let onLine = 0;
        for (let x = x0; x < x1; x++) if (lineColours.some((c) => distance(at(x, y), c) <= 6)) onLine++;
        if (onLine < 3) continue;
        rows++;
        for (let x = x0; x < x1; x++) if (Math.min(...colours.map((c) => distance(at(x, y), c))) > 6) soft++;
      }
      return { rows, soft };
    },
    { b64: png.toString("base64"), palette, lines, x0f, x1f },
  );
}

const rows = [];
const dashFailures = [];
const iconFailures = [];
for (const ratio of [1, 1.25, 1.5, 2]) {
  const browser = await launch([`--force-device-scale-factor=${ratio}`, "--window-size=1400,1000"]);
  const page = await (await browser.newContext({ viewport: null })).newPage();
  await page.goto(`${base}/morning?panel=trade`, { waitUntil: "domcontentloaded" });
  // The stock chart; the 大盤 pane has its own canvas with an image role.
  const canvas = page.locator('.td-chart canvas[role="img"]');
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
  for (const message of iconGridFailures(await page.evaluate(iconGrid, null), { requireIcons: true }))
    iconFailures.push(`dpr ${ratio}: ${message}`);
  const toolbar = page.locator(".td-replay").first();
  if (await toolbar.count()) writeFileSync(`${out}icons-dpr${ratio}.png`, await toolbar.screenshot());
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
  const spark = page.locator('.td-watch-row[aria-pressed="false"] canvas.td-mini').first();
  let sparkDash = null;
  if (await spark.count()) {
    const sparkPng = await spark.screenshot();
    writeFileSync(`${out}spark-dpr${ratio}.png`, sparkPng);
    // The right part of the sparkline is the not-yet-replayed session: only the previous-close dash.
    sparkDash = await dashRowSoft(page, sparkPng, [null, palette[4], palette[2], palette[3]], [palette[4]], 0.55, 0.98);
  }
  // 大盤 pane: past the revealed minutes only the previous-close dash crosses the plot (hour grid lines may cross it).
  const indexChart = page.locator(".td-index-chart");
  let indexDash = null;
  if (await indexChart.count()) {
    const indexPng = await indexChart.screenshot();
    writeFileSync(`${out}index-dpr${ratio}.png`, indexPng);
    // The pane sits on the window's right edge, so its corner pixel can be outside the page: use the panel colour.
    indexDash = await dashRowSoft(page, indexPng, [palette[0], palette[4], palette[1]], [palette[4]], 0.45, 0.8);
  }
  // Intraday (分時) tab: the previous close, 前高 and current-price dashes cross the empty future area.
  await page.getByRole("button", { name: "分時", exact: true }).first().click();
  await page.waitForTimeout(800);
  const quotePng = await canvas.screenshot();
  writeFileSync(`${out}quote-dpr${ratio}.png`, quotePng);
  const quoteDash = await dashRowSoft(page, quotePng, palette, [palette[4], palette[6], palette[2], palette[3]], 0.5, 0.75);
  for (const [name, dash] of [["sparkline", sparkDash], ["index", indexDash], ["intraday", quoteDash]])
    if (!dash || dash.rows === 0 || dash.soft > 0) dashFailures.push(`dpr ${ratio} ${name}: ${JSON.stringify(dash)}`);
  rows.push({
    dpr: ratio,
    ...stats,
    softPct: Number(((100 * stats.soft) / Math.max(1, stats.drawn)).toFixed(1)),
    sparkDashSoft: sparkDash?.soft ?? null,
    indexDashRows: indexDash?.rows ?? null,
    indexDashSoft: indexDash?.soft ?? null,
    quoteDashRows: quoteDash.rows,
    quoteDashSoft: quoteDash.soft,
  });
  await browser.close();
}
writeFileSync(`${out}sharpness.json`, JSON.stringify(rows, null, 2));
console.table(rows);
if (dashFailures.length) {
  console.log(`DASH FAILURES:\n${dashFailures.join("\n")}`);
  process.exitCode = 1;
} else console.log("All dashed reference lines are sharp.");
if (iconFailures.length) {
  console.log(`ICON FAILURES:\n${iconFailures.join("\n")}`);
  process.exitCode = 1;
} else console.log("All icons sit on their 15px grid.");
