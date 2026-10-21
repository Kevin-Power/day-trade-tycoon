// 江波 ±10% and EMA11/EMA24 on a disposable classroom after desk-seed (09:27, 台積電 held): the desk
// opens on 江波; both EMAs are drawn on 江波 and K線; the 漲停／跌停 lines frame the ±10% plot; the
// watch table's 江波圖 minis use the fixed ±10% scale; the crosshair readout lists the EMAs; phones
// open on 江波 too; and replaying a minute raises no page error.
// Usage: node scripts/qa/desk-jiangbo.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "jiangbo"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const DPR = 2;
const BAND = 0.1;
const MINI_HALF = 10; // the 24px mini, 2px padding: ±10% spans 10 CSS px each way from the previous close
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
async function rest(page) {
  await page
    .waitForFunction(
      () => {
        const clock = document.querySelector(".td-clock strong")?.textContent?.trim() ?? "";
        const stamp = document.querySelector(".td-hero-stamp")?.textContent ?? "";
        return clock.endsWith(":00") && !stamp.includes("模擬成交");
      },
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}
const api = async () => (await (await fetch(`${base}/api/morning`)).json());
const chart = (page) => page.locator('.td-chart canvas[role="img"]');
const pressedMode = (page) =>
  page.locator('nav[aria-label="看盤分頁"] button[aria-pressed="true"]').first().textContent({ timeout: 4000 });

// The chart's own colours (the spec's values when a token is missing).
async function palette(page) {
  return chart(page).evaluate((element) => {
    const style = getComputedStyle(element);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
      bg: read("--color-bg", "#0d131b"),
      up: read("--color-up", "#ff5468"),
      down: read("--color-down", "#1cd78a"),
      fast: read("--color-ema-fast", "#7dd3fc"),
      slow: read("--color-ema-slow", "#c084fc"),
    };
  });
}

// Pixels within 40 of each colour, inside the plot (below the readout strip, left of the price tags).
async function colourCounts(page, png, colours) {
  return page.evaluate(
    async ({ b64, colours }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const x0 = Math.round(image.width * 0.1);
      const x1 = Math.round(image.width * 0.85);
      const y0 = Math.round(image.height * 0.14);
      const y1 = Math.round(image.height * 0.93);
      const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const targets = colours.map(rgb);
      const counts = targets.map(() => 0);
      for (let i = 0; i < data.length; i += 4)
        targets.forEach((c, k) => {
          if (Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2])) <= 40)
            counts[k]++;
        });
      return counts;
    },
    { b64: png.toString("base64"), colours },
  );
}

// The fullest pixel row of a colour within a vertical band of the image, as a share of the plot width.
async function bestRow(page, png, hex, fromFraction, toFraction) {
  return page.evaluate(
    async ({ b64, hex, fromFraction, toFraction }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      const target = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const x0 = Math.round(image.width * 0.1);
      const x1 = Math.round(image.width * 0.85);
      let best = 0;
      for (let y = Math.round(image.height * fromFraction); y < Math.round(image.height * toFraction); y++) {
        let hits = 0;
        for (let x = x0; x < x1; x++) {
          const i = (y * image.width + x) * 4;
          if (Math.max(Math.abs(target[0] - data[i]), Math.abs(target[1] - data[i + 1]), Math.abs(target[2] - data[i + 2])) <= 12)
            hits++;
        }
        best = Math.max(best, hits / (x1 - x0));
      }
      return Number(best.toFixed(3));
    },
    { b64: png.toString("base64"), hex, fromFraction, toFraction },
  );
}

const blend = (hex, bg, alpha) => {
  const rgb = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const [a, b] = [rgb(hex), rgb(bg)];
  return `#${a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const pageErrors = [];

/* ── desktop 1440×900 ── */
const desktop = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR })).newPage();
desktop.on("pageerror", (error) => pageErrors.push(`desktop: ${error.message}`));
await desktop.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
await chart(desktop).waitFor({ timeout: 20000 });
await desktop.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
await rest(desktop);
const colours = await palette(desktop);

await check("1-default-jiangbo", async () => {
  const mode = (await pressedMode(desktop))?.trim();
  if (mode !== "江波") throw new Error(`the desk opens on 「${mode}」, not 江波`);
});

await check("2-watch-header", async () => {
  const header = (await desktop.locator(".td-watch-cols span").last().textContent())?.trim();
  if (header !== "江波圖") throw new Error(`the watch table's last column is 「${header}」`);
});

await check("3-ema-lines", async () => {
  const png = await chart(desktop).screenshot();
  writeFileSync(`${out}jiangbo-chart.png`, png);
  const [fast, slow] = await colourCounts(desktop, png, [colours.fast, colours.slow]);
  if (fast < 15 || slow < 15) throw new Error(`EMA pixels on 江波: EMA11 ${fast}, EMA24 ${slow}`);
  return { fast, slow };
});

await check("4-limit-lines", async () => {
  const png = await chart(desktop).screenshot();
  const up = await bestRow(desktop, png, blend(colours.up, colours.bg, 0.7), 0, 0.15);
  const down = await bestRow(desktop, png, blend(colours.down, colours.bg, 0.7), 0.75, 1);
  if (up < 0.4 || down < 0.4) throw new Error(`漲停 row ${up}, 跌停 row ${down} of the plot width`);
  return { up, down };
});

await check("5-kline-ema", async () => {
  await desktop.getByRole("button", { name: "K線", exact: true }).first().click();
  await desktop.waitForTimeout(600);
  const png = await chart(desktop).screenshot();
  writeFileSync(`${out}kline-chart.png`, png);
  const [fast, slow] = await colourCounts(desktop, png, [colours.fast, colours.slow]);
  await desktop.getByRole("button", { name: "江波", exact: true }).first().click().catch(() => {});
  await desktop.waitForTimeout(400);
  if (fast < 15 || slow < 15) throw new Error(`EMA pixels on K線: EMA11 ${fast}, EMA24 ${slow}`);
  return { fast, slow };
});

await check("6-mini-scale", async () => {
  const data = await api();
  const state = data.state;
  const problems = [];
  const report = {};
  for (const row of await desktop.locator(".td-watch-row").all()) {
    const code = await row.getAttribute("data-code");
    const canvas = row.locator("canvas.td-mini");
    if (!(await canvas.count())) {
      problems.push(`${code}: no mini canvas`);
      continue;
    }
    const index = code === "TAIEX";
    const previous = index ? state.index?.previousClose : data.catalog.symbols.find((s) => s.code === code)?.previousClose;
    const bars = (index ? state.index?.bars : state.bars?.[code]) ?? [];
    const dev = Math.max(0, ...bars.flatMap((bar) => [Math.abs(bar.h / previous - 1), Math.abs(bar.l / previous - 1)]));
    const allowed = 3 + (MINI_HALF * dev) / BAND;
    const png = await canvas.screenshot();
    writeFileSync(`${out}mini-${code}.png`, png);
    const reach = await desktop.evaluate(
      async ({ b64, colours, dpr }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + b64;
        await image.decode();
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        const ctx = surface.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, image.width, image.height);
        const targets = colours.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
        const centre = image.height / dpr / 2;
        let far = 0;
        let seen = 0;
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const i = (y * image.width + x) * 4;
            const hit = targets.some(
              (c) => Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2])) <= 60,
            );
            if (!hit) continue;
            seen++;
            far = Math.max(far, Math.abs((y + 0.5) / dpr - centre));
          }
        return { far: Number(far.toFixed(2)), seen };
      },
      { b64: png.toString("base64"), colours: [colours.up, colours.down], dpr: DPR },
    );
    report[code] = { ...reach, allowed: Number(allowed.toFixed(2)) };
    if (!reach.seen) problems.push(`${code}: no line drawn`);
    else if (reach.far > allowed) problems.push(`${code}: reaches ${reach.far}px from the centre, ±10% allows ${allowed.toFixed(2)}px`);
  }
  if (problems.length) throw new Error(problems.join("; "));
  return report;
});

await check("7-readout-ema", async () => {
  await chart(desktop).focus();
  await desktop.keyboard.press("ArrowLeft");
  await desktop.waitForTimeout(300);
  const text = (await desktop.locator(".td-chart output").first().textContent()) ?? "";
  await desktop.keyboard.press("Escape");
  if (!text.includes("EMA11") || !text.includes("EMA24")) throw new Error(`the readout says 「${text}」`);
  return text;
});

await check("9-replay", async () => {
  await desktop.getByRole("button", { name: "前進 1 分鐘" }).click({ timeout: 4000 });
  for (let i = 0; i < 3; i++) {
    await desktop.waitForTimeout(600);
    await chart(desktop).screenshot();
  }
  await rest(desktop);
  await chart(desktop).focus();
  await desktop.keyboard.press("ArrowRight");
  await desktop.waitForTimeout(300);
  const text = (await desktop.locator(".td-chart output").first().textContent()) ?? "";
  await desktop.keyboard.press("Escape");
  const hero = (await desktop.locator(".td-hero").first().textContent()) ?? "";
  if (/NaN|undefined/.test(text + hero)) throw new Error(`after the replay: 「${text}」 / 「${hero}」`);
  if (pageErrors.length) throw new Error(pageErrors.join("; "));
});

/* ── phone 390×844 ── */
const phone = await (
  await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true })
).newPage();
phone.on("pageerror", (error) => pageErrors.push(`phone: ${error.message}`));
await check("8-phone", async () => {
  await phone.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
  await phone.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await phone.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
  await rest(phone);
  const tabs = phone.getByRole("navigation", { name: "主要分頁" });
  await tabs.getByRole("button", { name: /行情/ }).first().click({ timeout: 4000 });
  await phone.waitForTimeout(400);
  const mode = (await pressedMode(phone))?.trim();
  await phone.screenshot({ path: `${out}phone-market.png` });
  await tabs.getByRole("button", { name: /自選/ }).first().click({ timeout: 4000 });
  await phone.waitForTimeout(400);
  const header = (await phone.locator(".td-watch-cols span").last().textContent())?.trim();
  await phone.screenshot({ path: `${out}phone-watch.png` });
  const problems = [];
  if (mode !== "江波") problems.push(`行情 opens on 「${mode}」`);
  if (header !== "江波") problems.push(`自選's last column is 「${header}」`);
  if (problems.length) throw new Error(problems.join("; "));
});

await browser.close();
if (pageErrors.length && !failures.some((line) => line.startsWith("9-replay")))
  failures.push(`page errors: ${pageErrors.join("; ")}`);
writeFileSync(`${out}jiangbo.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 2));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("江波 ±10%, EMA and mini scale: all checks pass.");
