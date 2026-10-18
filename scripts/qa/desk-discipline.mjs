// Discipline points on a disposable desk-server runtime: a brand-new visitor answers the daily
// question (celebration +points, first badge), finishes a practice round (level-up to Lv2), sees the
// lobby strip and 我的紀律. Checks overflow, 11px text, 44/56px targets, contrast, reduced motion,
// and that no audio starts while sound is off.
// Usage: node scripts/qa/desk-discipline.mjs [label] [proxyPort]
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [label = "discipline", proxyPort = "18811"] = process.argv.slice(2);
const state = JSON.parse(
  readFileSync(fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url)), "utf8"),
);
if (!state.appBase || !state.gateCode) throw new Error("Restart desk-server.mjs: its state file has no appBase/gateCode");
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const cases = [
  { name: "375", width: 375, height: 812, senior: false, speech: true },
  { name: "320", width: 320, height: 700, senior: false, reducedMotion: true },
  { name: "375-large", width: 375, height: 812, senior: true },
  { name: "820", width: 820, height: 1100, senior: false, soundOn: true },
  { name: "1366", width: 1366, height: 900, senior: false },
  { name: "1366-large", width: 1366, height: 900, senior: true },
];
const CONTROLS = ".td-celebrate :is(a, button), .level-strip, .td-progress-card a, .td-progress-sound button, .td-daily-head .td-home, .academy-header :is(button, a)";
const LARGE = ".td-celebrate :is(a, button), .level-strip, .td-progress-card a, .td-progress-sound button";

const scan = ({ controls, large, scope }) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.opacity !== "0";
  };
  const id = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}[${(el.textContent ?? "").trim().slice(0, 14)}]`;
  const channels = (value) => {
    const srgb = value.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
    if (srgb) return [srgb[1] * 255, srgb[2] * 255, srgb[3] * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
    const rgb = value.match(/^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)$/);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
    return null;
  };
  // Composite background layers from the element up to the first opaque one.
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const color = channels(getComputedStyle(node).backgroundColor);
      if (color && color[3] > 0) layers.push(color);
      if (color && color[3] >= 1) break;
    }
    let base = [0, 0, 0];
    for (const [r, g, b, a] of layers.reverse()) base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
    return base;
  };
  const luminance = ([r, g, b]) =>
    [r, g, b].map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const small = [];
  const offscreen = [];
  const lowContrast = [];
  for (const el of document.body.querySelectorAll(scope ? `:is(${scope}) *` : "*")) {
    if (el.closest(".sr-only, [hidden]") || ["SCRIPT", "STYLE", "CANVAS"].includes(el.tagName) || !visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    if (size < 11) small.push(id(el));
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1 || rect.left < -1) offscreen.push(id(el));
    const fg = channels(style.color);
    if (fg) {
      const bg = backdrop(el);
      const text = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
      const [a, b] = [luminance(text), luminance(bg)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const largeText = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (largeText ? 3 : 4.5)) lowContrast.push(`${ratio.toFixed(2)} ${id(el)}`);
    }
  }
  const short = [];
  for (const el of document.querySelectorAll(controls))
    if (visible(el) && el.getBoundingClientRect().height < 44) short.push(`${Math.round(el.getBoundingClientRect().height)}px ${id(el)}`);
  const shortLarge = [];
  if (large)
    for (const el of document.querySelectorAll(large))
      if (visible(el) && el.getBoundingClientRect().height < 56) shortLarge.push(`${Math.round(el.getBoundingClientRect().height)}px ${id(el)}`);
  return { small, offscreen, lowContrast, short, shortLarge, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const failures = [];
const rows = [];
for (const item of cases) {
  const context = await browser.newContext({
    viewport: { width: item.width, height: item.height },
    ...(item.reducedMotion ? { reducedMotion: "reduce" } : {}),
  });
  if (item.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  // Count audio contexts: none may start while sound is off.
  await context.addInitScript(() => {
    window.__audioContexts = 0;
    const Original = window.AudioContext;
    if (Original)
      window.AudioContext = class extends Original {
        constructor(...args) {
          super(...args);
          window.__audioContexts++;
        }
      };
  });
  // Read-aloud on with a recording voice: the points must be spoken after the page's own line.
  if (item.speech)
    await context.addInitScript(() => {
      window.__spoken = [];
      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
        }
      };
      const voice = { getVoices: () => [{ lang: "zh-TW", name: "recorder" }], speak: (utterance) => window.__spoken.push(utterance.text),
        cancel: () => window.__spoken.push("<cancel>"), addEventListener() {}, removeEventListener() {} };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, get: () => voice });
      localStorage.setItem("day-tycoon-speech-v1", "on");
    });
  const page = await context.newPage();
  const fail = (message) => failures.push(`${item.name}: ${message}`);
  /** What is still being read: everything after the last interruption. */
  const spokenTail = () => page.evaluate(() => window.__spoken.slice(window.__spoken.lastIndexOf("<cancel>") + 1));
  const check = async (screen, scope = null) => {
    const report = await page.evaluate(scan, { controls: CONTROLS, large: item.senior ? LARGE : null, scope });
    rows.push({ case: item.name, screen, ...report });
    if (report.small.length) fail(`${screen}: ${report.small.length} texts below 11px (${report.small.slice(0, 3).join(" | ")})`);
    if (report.offscreen.length || report.overflowX > 0) fail(`${screen}: horizontal overflow ${report.overflowX}px (${report.offscreen.slice(0, 3).join(" | ")})`);
    if (report.lowContrast.length) fail(`${screen}: low contrast (${report.lowContrast.slice(0, 4).join(" | ")})`);
    if (item.width < 1200 && report.short.length) fail(`${screen}: controls below 44px (${report.short.slice(0, 4).join(" | ")})`);
    if (report.shortLarge.length) fail(`${screen}: large-text controls below 56px (${report.shortLarge.slice(0, 4).join(" | ")})`);
  };
  const shoot = async (screen, locator = null) => {
    if (locator) await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}${item.name}-${screen}.png` });
  };
  const celebrationMotion = () =>
    page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.target?.closest?.(".td-celebrate")).length);
  try {
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByLabel("教室入場碼", { exact: true }).fill(state.gateCode);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "進入教室" }).click();
    await page.getByRole("link", { name: "開始作答" }).waitFor({ timeout: 20000 });
    await check("lobby-header", ".academy-header");
    // Phones keep the header to one row of display controls; the sound switch lives elsewhere there.
    const soundInHeader = await page.locator(".academy-header .display-sound-switch").isVisible();
    if (item.width < 480 && soundInHeader) fail("sound switch adds a row to the phone lobby header");
    if (item.width >= 480 && !soundInHeader) fail("sound switch missing from the lobby header");
    await shoot("lobby-header");

    // Daily question: watch, with a reason.
    await page.getByRole("link", { name: "開始作答" }).click();
    const choices = page.getByRole("radiogroup", { name: "你的選擇" });
    await choices.waitFor({ timeout: 20000 });
    await choices.getByRole("radio", { name: /觀望/ }).click();
    await page.getByRole("button", { name: "看不清楚先等" }).click();
    await page.getByRole("button", { name: "送出答案" }).click();
    const card = page.locator(".td-celebrate");
    await card.waitFor({ timeout: 15000 });
    const motion = await celebrationMotion();
    if (item.reducedMotion && motion) fail(`daily celebration runs ${motion} animations with reduced motion`);
    if (!item.reducedMotion && !motion) fail("daily celebration has no animation");
    await page.waitForTimeout(1600);
    const headline = (await card.locator("h3").textContent()) ?? "";
    if (!/^這次拿到 \+(15|18) 分$/.test(headline)) fail(`daily headline "${headline}"`);
    if (!(await card.getByText("說出理由").isVisible())) fail("reason line missing");
    if (!(await card.getByText("拿到徽章：第一題").isVisible())) fail("first-daily badge missing");
    if (await card.getByText(/答錯|眼力 \+?0/).count()) fail("the card mentions a wrong answer or zero 眼力");
    if (item.speech) {
      const tail = await spokenTail();
      if (!tail.some((line) => /^拿到 1[58] 分。$/.test(line))) fail(`daily points not read aloud after the headline (queue: ${tail.join(" / ")})`);
    }
    await check("daily", ".td-celebrate");
    await shoot("daily", card);

    if (item.soundOn) {
      await card.getByRole("switch", { name: /音效/ }).click();
      if ((await page.evaluate(() => window.__audioContexts)) !== 1) fail("turning sound on did not start audio");
      if ((await card.getByRole("switch", { name: /音效/ }).getAttribute("aria-checked")) !== "true") fail("sound switch did not turn on");
    } else if (await page.evaluate(() => window.__audioContexts)) fail("audio started while sound is off");

    // Practice: start with the template, finish with a reflection → Lv2.
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    const strip = page.locator(".level-strip");
    await strip.waitFor({ timeout: 15000 });
    if (!(await strip.getByText("新手學員").isVisible())) fail("lobby strip does not show 新手學員 after the first answer");
    await check("lobby-strip", ".level-strip");
    await shoot("lobby-strip", strip);
    await page.getByRole("link", { name: "開始今天的練習" }).click();
    await page.getByRole("button", { name: "用這個計畫開始" }).click();
    const coach = page.getByRole("dialog");
    await coach.waitFor({ timeout: 20000 });
    for (let step = 1; step <= 3; step++) await coach.getByRole("button", { name: step === 3 ? "完成" : "下一步" }).click();
    await page.getByRole("button", { name: "復盤", exact: true }).click();
    await page.locator("textarea").last().fill("條件沒有成立，先不交易。");
    await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
    const practice = page.locator(".td-celebrate");
    await practice.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1600);
    if (!(await practice.getByText("升級！").isVisible())) fail("no level-up banner after the first round");
    if (!(await practice.getByText("Lv2 準時報到").isVisible())) fail("level-up does not name Lv2 準時報到");
    if (!(await practice.getByText("拿到徽章：第一輪").isVisible())) fail("first-practice badge missing");
    if (!(await page.getByText("收盤前不留倉").first().isVisible())) fail("completion checks do not include 收盤前不留倉");
    if (await page.getByText("先觀察，再決定是否操作").count()) fail("the always-true 先觀察 check is still shown");
    if (item.speech) {
      const tail = await spokenTail();
      if (!tail.includes("拿到 25 分。升級了，第 2 級，準時報到。")) fail(`practice level-up not read aloud (queue: ${tail.join(" / ")})`);
    }
    await check("practice", ".td-celebrate");
    await shoot("practice", practice);
    if (!item.soundOn && (await page.evaluate(() => window.__audioContexts))) fail("audio started while sound is off");

    // 我的紀律.
    await practice.getByRole("link", { name: "看我的紀律" }).click();
    await page.getByRole("heading", { name: "我的紀律", level: 1 }).waitFor({ timeout: 15000 });
    await page.locator(".td-progress-level").waitFor({ timeout: 15000 });
    if (!(await page.locator("#progress-level-title").textContent())?.includes("準時報到")) fail("progress page level is not 準時報到");
    if ((await page.locator(".td-progress-badges li[data-earned='true']").count()) !== 2) fail("progress page does not show two earned badges");
    if ((await page.locator(".td-progress-recent li").count()) !== 2) fail("recent points are not the answer and the round");
    if ((await page.locator(".td-progress-levels li[aria-current='step']").textContent())?.includes("準時報到") !== true) fail("level table does not mark Lv2");
    if (!(await page.locator(".td-progress-sound").getByRole("switch", { name: /音效/ }).isVisible())) fail("sound switch missing on 我的紀律");
    await check("progress");
    await page.screenshot({ path: `${out}${item.name}-progress-full.png`, fullPage: true });
  } catch (error) {
    fail(`flow stopped: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}${item.name}-stopped.png` }).catch(() => {});
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}discipline.json`, JSON.stringify(rows, null, 2));
console.table(rows.map((row) => ({ case: row.case, screen: row.screen, "<11px": row.small.length, overflowX: row.overflowX, lowContrast: row.lowContrast.length, "<44": row.short.length, "<56": row.shortLarge.length })));
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("All discipline checks passed.");
