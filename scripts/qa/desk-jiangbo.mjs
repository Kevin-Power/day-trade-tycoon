// 江波 ±10% and EMA11/EMA24 on a disposable classroom after desk-seed (09:27, 台積電 held): the desk
// opens on 江波; both EMAs are drawn on 江波 and K線; the 漲停／跌停 lines frame the ±10% plot; the
// watch table's 江波圖 minis use the fixed ±10% scale; the crosshair readout lists the EMAs; phones
// open on 江波 too; replaying a minute moves the EMAs on with the revealed closes and raises no page
// error; a price just under 漲停 stays visible where the 漲停 label sits, which keeps its own background under the
// line; and a 前高 level at that height stays off the label.
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
      warn: read("--color-warn", "#e7b549"),
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

// The readout of the newest completed minute: from the middle, enough ArrowRight presses reach the right edge.
async function newestReadout(page) {
  await chart(page).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const text = (await page.locator(".td-chart output").first().textContent()) ?? "";
  await page.keyboard.press("Escape");
  const ema = (period) => Number(text.match(new RegExp(`EMA${period} (-?\\d+\\.\\d+)`))?.[1]);
  return { text, minute: text.match(/\b\d{2}:\d{2}\b/)?.[0], ema11: ema(11), ema24: ema(24) };
}
// EMA as the spec defines it: seeded with the first close, α = 2/(N+1).
const emaOf = (closes, period) =>
  closes.reduce((average, close, index) => (index ? average + (2 / (period + 1)) * (close - average) : close), 0);
// TWSE price ticks and the ±10% limits, rounded inside the band.
const tickOf = (price) => (price < 10 ? 0.01 : price < 50 ? 0.05 : price < 100 ? 0.1 : price < 500 ? 0.5 : price < 1000 ? 1 : 5);
const limitOf = (previous, factor, round) => {
  const raw = previous * factor;
  const tick = tickOf(raw);
  return Number((round(raw / tick - (round === Math.floor ? -1e-9 : 1e-9)) * tick).toFixed(2));
};
const shownCode = async (page, symbols) => {
  const name = (await chart(page).getAttribute("aria-label")) ?? "";
  return symbols.find((symbol) => name.includes(` ${symbol.code} `));
};

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

await check("10-prev-label-clear", async () => {
  // A flat line hugs the previous close at ±10%: 昨 sits in the price gutter, so the first minutes stay visible.
  const png = await chart(desktop).screenshot();
  const tape = await chart(desktop).evaluate((element) => getComputedStyle(element).getPropertyValue("--color-tape").trim() || "#e6c25a");
  const counts = await desktop.evaluate(
    async ({ b64, colours }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const near = (i, c, limit) =>
        Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2])) <= limit;
      const [tape, up, down] = colours.map(rgb);
      const count = (x0, x1, y0, y1, test) => {
        let hits = 0;
        for (let y = Math.round(image.height * y0); y < Math.round(image.height * y1); y++)
          for (let x = Math.round(image.width * x0); x < Math.round(image.width * x1); x++)
            if (test((y * image.width + x) * 4)) hits++;
        return hits;
      };
      // The 昨 row: tape-coloured text in the price gutter (a volume pane below the plot moves it off the middle).
      const rows = [];
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < Math.round(image.width * 0.055); x++)
          if (near((y * image.width + x) * 4, tape, 40)) {
            rows.push(y);
            break;
          }
      if (!rows.length) return { gutter: 0, lineStart: 0 };
      const middle = rows[Math.floor(rows.length / 2)] / image.height;
      return {
        gutter: count(0, 0.055, middle - 0.04, middle + 0.04, (i) => near(i, tape, 40)),
        lineStart: count(0.075, 0.135, middle - 0.06, middle + 0.06, (i) => near(i, up, 60) || near(i, down, 60)),
        middle: Number(middle.toFixed(3)),
      };
    },
    { b64: png.toString("base64"), colours: [tape, colours.up, colours.down] },
  );
  // A fully visible line over those minutes is about 150-250 device pixels at 2x; the old label left ~20.
  if (counts.gutter < 10 || counts.lineStart < 100)
    throw new Error(`昨 in the gutter: ${counts.gutter} px; price line in 09:01–09:08: ${counts.lineStart} px`);
  return counts;
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
  const before = await newestReadout(desktop);
  await desktop.getByRole("button", { name: "前進 1 分鐘" }).click({ timeout: 4000 });
  for (let i = 0; i < 3; i++) {
    await desktop.waitForTimeout(600);
    await chart(desktop).screenshot();
  }
  await rest(desktop);
  const after = await newestReadout(desktop);
  const hero = (await desktop.locator(".td-hero").first().textContent()) ?? "";
  if (/NaN|undefined/.test(after.text + hero)) throw new Error(`after the replay: 「${after.text}」 / 「${hero}」`);
  if (pageErrors.length) throw new Error(pageErrors.join("; "));
  // The EMAs follow the replay: the newest completed minute moved on, and its EMAs are those of every
  // close the classroom has revealed up to it, never the minute still being replayed.
  const data = await api();
  const symbol = await shownCode(desktop, data.catalog.symbols);
  if (!symbol) throw new Error("cannot tell which stock the chart shows");
  const closes = (data.state.bars[symbol.code] ?? []).filter((bar) => bar.t + 60 <= data.state.cursor * 60).map((bar) => bar.c);
  const expected = { ema11: emaOf(closes, 11), ema24: emaOf(closes, 24) };
  const problems = [];
  if (!before.minute || before.minute === after.minute) problems.push(`the newest minute stayed at ${after.minute}`);
  for (const key of ["ema11", "ema24"])
    if (!(Math.abs(after[key] - expected[key]) <= 0.006))
      problems.push(`${key} reads ${after[key]}, the revealed closes give ${expected[key].toFixed(2)}`);
  if (problems.length) throw new Error(`${problems.join("; ")} (readout 「${after.text}」)`);
  return { before: before.minute, after: after.minute, ema11: after.ema11, ema24: after.ema24 };
});

// Where the 漲停 label sits on an unmodified chart: the 漲停 and 跌停 lines (rows), and the label's text box
// (up-coloured pixels just under the 漲停 line, in the left third).
async function limitLabelGeometry(page) {
  return page.evaluate(
    async ({ b64, upText, upLine, downLine, dpr }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const near = (i, c, limit) =>
        Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2])) <= limit;
      const fullestRow = (colour, y0, y1) => {
        const x0 = Math.round(image.width * 0.1);
        const x1 = Math.round(image.width * 0.85);
        let best = { row: -1, share: 0 };
        for (let y = y0; y < y1; y++) {
          let hits = 0;
          for (let x = x0; x < x1; x++) if (near((y * image.width + x) * 4, colour, 12)) hits++;
          if (hits / (x1 - x0) > best.share) best = { row: y, share: hits / (x1 - x0) };
        }
        return best.row;
      };
      const upRow = fullestRow(rgb(upLine), 0, Math.round(image.height * 0.3));
      const downRow = fullestRow(rgb(downLine), Math.round(image.height * 0.5), image.height);
      const text = rgb(upText);
      const box = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity };
      for (let y = upRow + 1; y < upRow + 30 * dpr; y++)
        for (let x = 0; x < Math.round(image.width * 0.35); x++)
          if (near((y * image.width + x) * 4, text, 40)) {
            box.top = Math.min(box.top, y);
            box.bottom = Math.max(box.bottom, y);
            box.left = Math.min(box.left, x);
            box.right = Math.max(box.right, x);
          }
      return { upRow, downRow, box };
    },
    {
      b64: (await chart(page).screenshot()).toString("base64"),
      upText: colours.up,
      upLine: blend(colours.up, colours.bg, 0.7),
      downLine: blend(colours.down, colours.bg, 0.7),
      dpr: DPR,
    },
  );
}

// A desk in its own context whose shown stock replays rewritten minutes: rewrite(bar, index, prices) returns the
// fields to change; prices.through is a tick price whose line runs through the middle of the 漲停 label.
async function limitScenario(name, rewrite) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
  const open = async () => {
    await chart(page).waitFor({ timeout: 20000 });
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
    await rest(page);
  };
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await open();
    const data = await api();
    const symbol = await shownCode(page, data.catalog.symbols);
    if (!symbol) throw new Error("cannot tell which stock the chart shows");
    const up = limitOf(symbol.previousClose, 1.1, Math.floor);
    const down = limitOf(symbol.previousClose, 0.9, Math.ceil);
    const geometry = await limitLabelGeometry(page);
    const { upRow, downRow, box } = geometry;
    if (!(upRow > 0 && downRow > upRow && box.bottom > box.top && box.right > box.left))
      throw new Error(`cannot find the 漲停 line and label: ${JSON.stringify(geometry)}`);
    const perRow = (up - down) / (downRow - upRow);
    const tick = tickOf(up);
    const through = Number((Math.round((up - ((box.top + box.bottom) / 2 - upRow) * perRow) / tick) * tick).toFixed(2));
    const prices = { up, through, previous: symbol.previousClose, tick };
    await page.route("**/api/morning*", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      (body.state?.bars?.[symbol.code] ?? []).forEach((bar, index) => Object.assign(bar, rewrite(bar, index, prices)));
      return route.fulfill({ response, json: body });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await open();
    const png = await chart(page).screenshot();
    writeFileSync(`${out}${name}.png`, png);
    return { context, page, png, prices, box, offsets: { top: box.top - upRow, bottom: box.bottom - upRow } };
  } catch (error) {
    await context.close();
    throw error;
  }
}

await check("12-limit-label-under-line", async () => {
  // A price just under 漲停 from 09:00 runs through the 漲停 label: the line stays visible over the label, and under
  // the line the label keeps the chart's background (the shading down to 昨 is not drawn over it). Measured on the
  // label's right half, which the line covers whenever it starts by 09:01.
  const scenario = await limitScenario("limit-label", (bar, index, { through }) => ({ o: through, h: through, l: through, c: through }));
  try {
    const seen = await scenario.page.evaluate(
      async ({ b64, upText, upLine, bg, offsets, left, right }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + b64;
        await image.decode();
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        const ctx = surface.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, image.width, image.height);
        const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const at = (x, y) => (y * image.width + x) * 4;
        const near = (i, c, limit) =>
          Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2])) <= limit;
        const line = rgb(upLine);
        const x0 = Math.round(image.width * 0.1);
        const x1 = Math.round(image.width * 0.85);
        let upRow = -1;
        let most = 0;
        for (let y = 0; y < Math.round(image.height * 0.3); y++) {
          let hits = 0;
          for (let x = x0; x < x1; x++) if (near(at(x, y), line, 12)) hits++;
          if (hits > most) [upRow, most] = [y, hits];
        }
        const text = rgb(upText);
        const ground = rgb(bg);
        const from = left + Math.round((right - left) * 0.5);
        let share = 0;
        let lineRow = -1;
        for (let y = upRow + offsets.top; y <= upRow + offsets.bottom; y++) {
          let hits = 0;
          for (let x = from; x <= right; x++) if (near(at(x, y), text, 40)) hits++;
          if (hits / (right - from + 1) > share) [share, lineRow] = [hits / (right - from + 1), y];
        }
        // Under the line: the label's own box between the text strokes.
        let plain = 0;
        let other = 0;
        for (let y = lineRow + 4; y <= upRow + offsets.bottom; y++)
          for (let x = from; x <= right; x++) {
            if (near(at(x, y), text, 40)) continue;
            if (near(at(x, y), ground, 8)) plain++;
            else other++;
          }
        return { share: Number(share.toFixed(3)), plain: Number((plain / Math.max(1, plain + other)).toFixed(3)) };
      },
      {
        b64: scenario.png.toString("base64"),
        upText: colours.up,
        upLine: blend(colours.up, colours.bg, 0.7),
        bg: colours.bg,
        offsets: scenario.offsets,
        left: scenario.box.left,
        right: scenario.box.right,
      },
    );
    const problems = [];
    // A line drawn over the label fills a whole row of it; the label's text alone never does.
    if (seen.share < 0.95)
      problems.push(`a price line at ${scenario.prices.through} (漲停 ${scenario.prices.up}) shows on ${Math.round(seen.share * 100)}% of the 漲停 label's width`);
    if (seen.plain < 0.4)
      problems.push(`under the line only ${Math.round(seen.plain * 100)}% of the 漲停 label is the chart background: the shading is drawn over it`);
    if (problems.length) throw new Error(problems.join("; "));
    return { price: scenario.prices.through, up: scenario.prices.up, ...seen };
  } finally {
    await scenario.context.close();
  }
});

await check("13-limit-label-clear-of-level-lines", async () => {
  // A 前高 (swing high at 09:02) at the 漲停 label's height: its dashed level runs right from 09:02, but not through
  // the label's text box.
  const scenario = await limitScenario("limit-label-level", (bar, index, { through, previous, tick }) => {
    const low = Number((Math.round((through - previous * 0.03) / tick) * tick).toFixed(2));
    return { o: low, h: index === 2 ? through : low, l: low, c: low };
  });
  try {
    const counts = await scenario.page.evaluate(
      async ({ b64, warn, upLine, offsets, left, right }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + b64;
        await image.decode();
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        const ctx = surface.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, image.width, image.height);
        const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const at = (x, y) => (y * image.width + x) * 4;
        const near = (i, c, limit) =>
          Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2])) <= limit;
        const line = rgb(upLine);
        const x0 = Math.round(image.width * 0.1);
        const x1 = Math.round(image.width * 0.85);
        let upRow = -1;
        let most = 0;
        for (let y = 0; y < Math.round(image.height * 0.3); y++) {
          let hits = 0;
          for (let x = x0; x < x1; x++) if (near(at(x, y), line, 12)) hits++;
          if (hits > most) [upRow, most] = [y, hits];
        }
        const level = rgb(warn);
        const count = (from, to) => {
          let hits = 0;
          for (let y = upRow + offsets.top - 2; y <= upRow + offsets.bottom + 2; y++)
            for (let x = from; x <= to; x++) if (near(at(x, y), level, 40)) hits++;
          return hits;
        };
        return { inLabel: count(left, right), beside: count(right + 20, right + 220) };
      },
      {
        b64: scenario.png.toString("base64"),
        warn: colours.warn,
        upLine: blend(colours.up, colours.bg, 0.7),
        offsets: scenario.offsets,
        left: scenario.box.left,
        right: scenario.box.right,
      },
    );
    if (counts.beside < 20) throw new Error(`no 前高 level beside the label (${counts.beside} px): the scenario made no swing high`);
    if (counts.inLabel > 2) throw new Error(`the 前高 dashed level crosses the 漲停 label (${counts.inLabel} px inside it)`);
    return { price: scenario.prices.through, ...counts };
  } finally {
    await scenario.context.close();
  }
});

await check("11-ema-copy", async () => {
  // Students read 教材 → 先讀背景與教材規則; it must agree with the EMA lines the desk now draws.
  const button = desktop.getByRole("button", { name: "教材" }).first();
  await button.click({ timeout: 4000 });
  const drawer = desktop.locator("#td-resources");
  await drawer.waitFor({ timeout: 4000 });
  const text = (await drawer.textContent()) ?? "";
  await button.click({ timeout: 4000 }).catch(() => {});
  const stale = text.match(/[^。]*(尚未計算|僅作教材說明)[^。]*。?/);
  if (stale) throw new Error(`the 教材 drawer still says 「${stale[0]}」`);
  if (!text.includes("EMA11") || !text.includes("EMA24")) throw new Error("the 教材 drawer does not describe EMA11 and EMA24");
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
  const bar = await phone.locator(".td-chartbar").first().boundingBox();
  await phone.screenshot({ path: `${out}phone-market.png` });
  await tabs.getByRole("button", { name: /自選/ }).first().click({ timeout: 4000 });
  await phone.waitForTimeout(400);
  const header = (await phone.locator(".td-watch-cols span").last().textContent())?.trim();
  await phone.screenshot({ path: `${out}phone-watch.png` });
  const problems = [];
  if (mode !== "江波") problems.push(`行情 opens on 「${mode}」`);
  if (header !== "江波") problems.push(`自選's last column is 「${header}」`);
  if (!bar || bar.height > 70) problems.push(`the chart bar takes ${bar?.height}px (wraps onto a second row)`);
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
