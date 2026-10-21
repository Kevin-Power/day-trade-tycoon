// Native form controls on the dark desk, in Chromium or in WebKit (a Safari approximation), after desk-seed:
// every <select> the desk shows is drawn dark with readable text, on desktop (課程, 圖表股票, 下單商品) and on a
// phone's 下單 tab (下單商品). Safari draws native controls light unless the page asks for a dark color scheme,
// which hid the desk's light text on light menus.
// Usage: node scripts/qa/desk-controls.mjs <baseUrl> <label> [chromium|webkit]
import { chromium, webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "controls", engineName = "chromium"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const results = {};
const failures = [];
async function check(name, run) {
  try {
    results[name] = (await run()) ?? "pass";
  } catch (error) {
    results[name] = `FAIL: ${error.message}`;
    failures.push(`${name}: ${error.message}`);
  }
}

// Shares of light (text) and dark (background) pixels in a screenshot of one control.
async function tones(page, png) {
  return page.evaluate(async (b64) => {
    const image = new Image();
    image.src = "data:image/png;base64," + b64;
    await image.decode();
    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const ctx = surface.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let light = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (luminance > 0.55) light++;
      else if (luminance < 0.25) dark++;
    }
    const total = data.length / 4;
    return { light: Number((light / total).toFixed(3)), dark: Number((dark / total).toFixed(3)) };
  }, png.toString("base64"));
}

// A dark control with readable light text: mostly dark pixels, and some light ones (a 44px phone menu's
// text covers only a few percent of it).
async function readable(page, locator, name) {
  await locator.waitFor({ timeout: 8000 });
  // In the middle of the viewport, clear of the phone's fixed tab bar.
  await locator.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  const text = await locator.evaluate((node) => node.selectedOptions?.[0]?.textContent?.trim() ?? "");
  const png = await locator.screenshot();
  writeFileSync(`${out}${name}.png`, png);
  const share = await tones(page, png);
  if (!(share.dark >= 0.5 && share.light >= 0.01))
    throw new Error(`「${text}」 is drawn ${Math.round(share.dark * 100)}% dark and ${Math.round(share.light * 100)}% light, not dark with light text`);
  return { text, ...share };
}

async function open(page) {
  await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
  await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
  await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
}

const browser =
  engineName === "webkit"
    ? await webkit.launch()
    : await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));

const desktop = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await open(desktop);
for (const [name, selector] of [
  ["desktop-lesson", ".td-lesson select"],
  ["desktop-chart", ".td-stepper select"],
  ["desktop-ticket", ".sim-ticket-header select"],
])
  await check(name, () => readable(desktop, desktop.locator(selector).first(), name));

const phone = await (
  await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
).newPage();
await open(phone);
await check("phone-ticket", async () => {
  await phone.getByRole("navigation", { name: "主要分頁" }).getByRole("button", { name: /下單/ }).first().click({ timeout: 4000 });
  await phone.waitForTimeout(400);
  return readable(phone, phone.locator(".sim-ticket-header select").first(), "phone-ticket");
});

await browser.close();
writeFileSync(`${out}controls.json`, JSON.stringify({ engine: engineName, results, failures }, null, 2));
console.log(JSON.stringify({ engine: engineName, results }, null, 2));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Native controls on the dark desk (${engineName}): all checks pass.`);
