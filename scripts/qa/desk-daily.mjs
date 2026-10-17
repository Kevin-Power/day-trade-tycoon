// Daily question on a disposable desk-server runtime: a brand-new visitor goes gate → lobby →
// 開始作答 → answer → reveal; an "enter" learner must pick a stop; the teacher sees the split.
// Usage: node scripts/qa/desk-daily.mjs [label] [proxyPort]
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [label = "daily", proxyPort = "18811"] = process.argv.slice(2);
const state = JSON.parse(
  readFileSync(fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url)), "utf8"),
);
if (!state.appBase || !state.gateCode) throw new Error("Restart desk-server.mjs: its state file has no appBase/gateCode");
const proxyBase = `http://127.0.0.1:${proxyPort}`;
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const cases = [
  { name: "375", width: 375, height: 812, senior: false, enter: true },
  { name: "320", width: 320, height: 700, senior: false, enter: false },
  { name: "375-large", width: 375, height: 812, senior: true, enter: false },
  { name: "820", width: 820, height: 1100, senior: false, enter: false },
  { name: "1366", width: 1366, height: 900, senior: false, enter: true },
];
const CONTROLS =
  '.td-daily-choice, .td-daily-option, .td-daily-chip, .td-daily-send, .td-daily-next .td-button, .td-daily-head .td-home, [role="radiogroup"][aria-label="文字大小"] button, .daily-card a';
const LARGE = ".td-daily-choice, .td-daily-send, .td-daily-option, .daily-card-primary";

const scan = ({ controls, large, scope }) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.opacity !== "0";
  };
  const id = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}[${(el.textContent ?? "").trim().slice(0, 12)}]`;
  const small = [];
  const offscreen = [];
  for (const el of document.body.querySelectorAll(scope ? `:is(${scope}) *` : "*")) {
    if (el.closest(".sr-only, [hidden]") || ["SCRIPT", "STYLE", "CANVAS"].includes(el.tagName) || !visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 11) small.push(id(el));
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1 || rect.left < -1) offscreen.push(id(el));
  }
  const short = [];
  for (const el of document.querySelectorAll(controls))
    if (visible(el) && el.getBoundingClientRect().height < 44) short.push(`${Math.round(el.getBoundingClientRect().height)}px ${id(el)}`);
  const shortLarge = [];
  if (large)
    for (const el of document.querySelectorAll(large))
      if (visible(el) && el.getBoundingClientRect().height < 56) shortLarge.push(`${Math.round(el.getBoundingClientRect().height)}px ${id(el)}`);
  return { small, offscreen, short, shortLarge, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const failures = [];
const rows = [];

async function visitor(item, fail) {
  const context = await browser.newContext({ viewport: { width: item.width, height: item.height } });
  if (item.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("教室入場碼", { exact: true }).fill(state.gateCode);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "進入教室" }).click();
  await page.getByRole("link", { name: "開始作答" }).waitFor({ timeout: 20000 });
  const check = async (screen, scope = null) => {
    const report = await page.evaluate(scan, { controls: CONTROLS, large: item.senior ? LARGE : null, scope });
    rows.push({ case: item.name, screen, ...report });
    if (report.small.length) fail(`${screen}: ${report.small.length} texts below 11px (${report.small.slice(0, 3).join(" | ")})`);
    if (report.offscreen.length || report.overflowX > 0) fail(`${screen}: horizontal overflow (${report.offscreen.slice(0, 3).join(" | ")})`);
    if (item.width < 1200 && report.short.length) fail(`${screen}: controls below 44px (${report.short.slice(0, 4).join(" | ")})`);
    if (report.shortLarge.length) fail(`${screen}: large-text controls below 56px (${report.shortLarge.slice(0, 4).join(" | ")})`);
    await page.screenshot({ path: `${out}${item.name}-${screen}.png` });
  };
  return { context, page, check };
}

for (const item of cases) {
  const fail = (message) => failures.push(`${item.name}: ${message}`);
  const { context, page, check } = await visitor(item, fail);
  try {
    await check("lobby", ".daily-card");
    let taps = 0;
    await page.getByRole("link", { name: "開始作答" }).click();
    taps++;
    const choices = page.getByRole("radiogroup", { name: "你的選擇" });
    await choices.waitFor({ timeout: 20000 });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 10000 });
    if (!(await page.getByText("按下開始，表示你了解").isVisible())) fail("guest statement not shown before the first answer");
    if (item.width < 768) {
      const bottom = await page.evaluate(() => {
        const parts = [document.querySelector("#daily-question-text"), document.querySelector('main canvas[role="img"]'), ...document.querySelectorAll(".td-daily-choice")];
        return Math.max(...parts.map((el) => el.getBoundingClientRect().bottom));
      });
      if (bottom > item.height) fail(`question, chart and choices end at ${Math.round(bottom)}px, below the first screen`);
    }
    await check("question");
    await choices.getByRole("radio", { name: /觀望/ }).click();
    taps++;
    await page.getByRole("button", { name: "送出答案" }).click();
    taps++;
    await page.locator("#daily-headline").waitFor({ timeout: 15000 });
    await page.waitForTimeout(700); // let the reveal finish fading in
    if (taps !== 3) fail(`taps from the lobby to the reveal = ${taps}`);
    if (!(await page.getByText(/已有 \d+ 人作答/).isVisible())) fail("class split missing");
    if (!(await page.getByText(/連續 1 天/).isVisible())) fail("streak missing after answering");
    await check("reveal");
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "看解說" }).waitFor({ timeout: 15000 });
    if (!(await page.getByText("今天的一題 · 已完成").isVisible())) fail("lobby card does not show the question as done");
    await check("lobby-done", ".daily-card");
  } catch (error) {
    fail(`flow stopped: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}${item.name}-stopped.png` }).catch(() => {});
  }
  await context.close();

  if (!item.enter) continue;
  const second = await visitor(item, fail);
  try {
    let taps = 0;
    await second.page.getByRole("link", { name: "開始作答" }).click();
    taps++;
    const choices = second.page.getByRole("radiogroup", { name: "你的選擇" });
    await choices.waitFor({ timeout: 20000 });
    await choices.getByRole("radio", { name: /進場/ }).click();
    taps++;
    const send = second.page.getByRole("button", { name: "送出答案" });
    if (!(await send.isDisabled())) fail("send is enabled before a stop is chosen");
    if (!(await second.page.getByText("先選一個停損").isVisible())) fail("stop hint missing");
    await second.page.getByRole("radiogroup", { name: "停損" }).getByRole("radio", { name: /回檔低點/ }).click();
    taps++;
    await second.check("enter");
    await send.click();
    taps++;
    await second.page.locator("#daily-headline").waitFor({ timeout: 15000 });
    await second.page.waitForTimeout(700);
    if (taps !== 4) fail(`enter taps = ${taps}`);
    if (!(await second.page.getByText(/^假設 /).isVisible())) fail("entry fact missing in the reveal");
    await second.check("enter-reveal");
  } catch (error) {
    fail(`enter flow stopped: ${error.message.split("\n")[0]}`);
    await second.page.screenshot({ path: `${out}${item.name}-enter-stopped.png` }).catch(() => {});
  }
  await second.context.close();
}

// Teacher (the proxy injects the signed-in teacher's cookie).
{
  const fail = (message) => failures.push(`teacher: ${message}`);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(proxyBase + "/teacher", { waitUntil: "domcontentloaded" });
    const card = page.locator(".daily-teacher-card");
    await card.getByText(/已有 \d+ 人作答/).waitFor({ timeout: 20000 });
    const total = Number((await card.getByText(/已有 \d+ 人作答/).textContent()).match(/已有 (\d+)/)[1]);
    if (total < 2) fail(`teacher sees ${total} answers`);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}teacher-card.png`, fullPage: false });
    await card.getByRole("link", { name: "看題目與解說" }).click();
    await page.locator("#daily-headline").waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}teacher-reveal.png` });
  } catch (error) {
    fail(`teacher flow stopped: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}teacher-stopped.png` }).catch(() => {});
  }
  await context.close();
}

await browser.close();
writeFileSync(`${out}daily.json`, JSON.stringify(rows, null, 2));
console.table(rows.map((row) => ({ case: row.case, screen: row.screen, "<11px": row.small.length, overflowX: row.overflowX, "<44": row.short.length, "<56": row.shortLarge.length })));
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("All daily question checks passed.");
