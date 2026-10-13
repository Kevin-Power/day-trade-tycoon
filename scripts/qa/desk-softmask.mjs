// Paints every anti-aliased ("soft") pixel of a chart screenshot magenta and dims the rest, so you
// can see whether blending is confined to text and markers. Pass the chart's colour tokens in order.
// Usage: node scripts/qa/desk-softmask.mjs <in.png> <out.png> <bg> <grid> <up> <down> <tape> <muted> <warn>
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const [input, output, ...palette] = process.argv.slice(2);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage();
const b64 = readFileSync(input).toString("base64");
const out = await page.evaluate(async ({ b64, palette }) => {
  const image = new Image();
  image.src = "data:image/png;base64," + b64;
  await image.decode();
  const c = document.createElement("canvas");
  c.width = image.width; c.height = image.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const colours = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (let i = 0; i < d.data.length; i += 4) {
    const dist = (k) => Math.max(Math.abs(k[0] - d.data[i]), Math.abs(k[1] - d.data[i + 1]), Math.abs(k[2] - d.data[i + 2]));
    const soft = Math.min(...colours.map(dist)) > 6;
    if (soft) { d.data[i] = 255; d.data[i + 1] = 0; d.data[i + 2] = 255; }
    else { d.data[i] = d.data[i] * 0.35; d.data[i + 1] = d.data[i + 1] * 0.35; d.data[i + 2] = d.data[i + 2] * 0.35; }
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL("image/png").split(",")[1];
}, { b64, palette });
writeFileSync(output, Buffer.from(out, "base64"));
await browser.close();
