// New-visitor onboarding on a disposable desk-server runtime: gate → lobby → two taps to 09:00 →
// coach marks → guest prompts → review → lobby shows today done. Fresh browser, no injected cookie.
// Usage: node scripts/qa/desk-guest.mjs [label] [proxyPort]
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [label = "guest", proxyPort = "18811"] = process.argv.slice(2);
const state = JSON.parse(
  readFileSync(fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url)), "utf8"),
);
if (!state.appBase || !state.gateCode) throw new Error("Restart desk-server.mjs: its state file has no appBase/gateCode");
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const cases = [
  { name: "375", width: 375, height: 812, senior: false, iphone: true },
  // The phone clock runs 500 ms fast here: the 09:00 reveal must not depend on it.
  { name: "320", width: 320, height: 700, senior: false, iphone: false, fastClock: true },
  { name: "375-large", width: 375, height: 812, senior: true, iphone: true },
  { name: "820", width: 820, height: 1100, senior: false, iphone: false },
  { name: "1366", width: 1366, height: 900, senior: false, iphone: false },
];
const NEW_CONTROLS =
  '.today-card :is(a, button), .install-card button, :is(.td-guest, .td-guest-save) :is(a, button), .td-coach-dialog button, [role="radiogroup"] button, .td-template';
const LARGE_PRIMARY = ".today-primary, .td-coach-dialog button, :is(.td-guest, .td-guest-save) :is(a, button)";

// Same text rules as desk-layout.mjs, plus target sizes for the controls this work added.
const scan = ({ controls, large, scope }) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.opacity !== "0";
  };
  const id = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}[${(el.textContent ?? "").trim().slice(0, 12)}]`;
  const small = [];
  const offscreen = [];
  // The lobby's older content keeps its own sizes; there only the new cards are checked.
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
for (const item of cases) {
  const context = await browser.newContext({
    viewport: { width: item.width, height: item.height },
    ...(item.iphone ? { userAgent: IPHONE_UA } : {}),
  });
  if (item.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  if (item.fastClock)
    await context.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 500;
    });
  const page = await context.newPage();
  const fail = (message) => failures.push(`${item.name}: ${message}`);
  const check = async (screen, scope = null) => {
    const report = await page.evaluate(scan, { controls: NEW_CONTROLS, large: item.senior ? LARGE_PRIMARY : null, scope });
    rows.push({ case: item.name, screen, ...report });
    if (report.small.length) fail(`${screen}: ${report.small.length} texts below 11px (${report.small.slice(0, 3).join(" | ")})`);
    if (report.offscreen.length || report.overflowX > 0) fail(`${screen}: horizontal overflow (${report.offscreen.slice(0, 3).join(" | ")})`);
    // Phones and tablets are touch screens; the desktop desk bar keeps its compact 28px controls.
    if (item.width < 1200 && report.short.length) fail(`${screen}: controls below 44px (${report.short.slice(0, 4).join(" | ")})`);
    if (report.shortLarge.length) fail(`${screen}: large-text primary controls below 56px (${report.shortLarge.slice(0, 4).join(" | ")})`);
    await page.screenshot({ path: `${out}${item.name}-${screen}.png` });
  };
  const morning = () => page.evaluate(async () => (await (await fetch("/api/morning", { cache: "no-store" })).json()).state);
  try {
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByLabel("教室入場碼", { exact: true }).fill(state.gateCode);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "進入教室" }).click();
    const startLink = page.getByRole("link", { name: "開始今天的練習" });
    await startLink.waitFor({ timeout: 20000 });
    if (item.iphone && !(await page.locator(".install-card").isVisible())) fail("iPhone install guide missing");
    await check("lobby", ".today-card, .install-card");

    let taps = 0;
    await startLink.click();
    taps++;
    const breakout = page.getByRole("radio", { name: /突破前高/ });
    await breakout.waitFor({ timeout: 20000 });
    if ((await breakout.getAttribute("aria-checked")) !== "true") fail("突破前高 is not preselected");
    if (!(await page.getByText("按下開始，表示你了解").isVisible())) fail("guest statement not visible above start");
    const startButton = page.getByRole("button", { name: "用這個計畫開始" });
    if (item.width < 768) {
      const box = await startButton.boundingBox();
      const viewport = page.viewportSize();
      if (!box || box.y + box.height > viewport.height) fail(`start button is not on the first screen of the plan (bottom ${box && Math.round(box.y + box.height)}px)`);
    }
    await check("plan");
    if (item.name === "320") {
      await page.locator("nav.td-dock").getByRole("button", { name: /^自選/ }).click();
      await page.locator('.td-watch-row[data-code="TAIEX"]').click();
      await page.locator(".td-index-panel").first().waitFor({ timeout: 4000 });
    }
    await startButton.click();
    taps++;
    const deadline = Date.now() + 15000;
    let run = null;
    while (Date.now() < deadline && !(run && run.cursor >= 1)) {
      await page.waitForTimeout(300);
      run = await morning().catch(() => null);
    }
    if (!(run && run.cursor >= 1)) fail(`09:00 not revealed after start (cursor ${run?.cursor})`);
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 10000 });
    if (taps !== 2) fail(`taps from lobby to 09:00 = ${taps}`);
    if (await page.getByText("請稍候一秒").count()) fail("the 09:00 reveal was refused as too early");
    if (item.name === "320" && !(await page.locator('.td-chart canvas[role="img"]').isVisible()))
      fail("the run opened on the 大盤 view picked before it started (no stock chart for the coach)");

    const coach = page.getByRole("dialog");
    await coach.waitFor({ timeout: 10000 });
    if ((await page.locator("#td-coach-title").textContent()) !== "看走勢圖") fail("coach does not start at 看走勢圖");
    // The dialog must never sit on top of what the step is pointing at.
    const coversRing = () =>
      page.evaluate(() => {
        const dialog = document.querySelector(".td-coach-dialog")?.getBoundingClientRect();
        return [...document.querySelectorAll(".td-coach-ring")].some((ring) => {
          const box = ring.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          return dialog && x >= dialog.left && x <= dialog.right && y >= dialog.top && y <= dialog.bottom;
        });
      });
    for (let step = 1; step <= 3; step++) {
      await page.waitForTimeout(400);
      if (await coversRing()) fail(`coach step ${step} dialog covers its target`);
      if (step === 1) await check("coach");
      await coach.getByRole("button", { name: step === 3 ? "完成" : "下一步" }).click();
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".td-workbench").waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    if (await page.locator(".td-coach").count()) fail("coach shows again after it was finished");
    if (!(await page.getByText("目前是訪客").isVisible())) fail("guest banner missing");
    if (!(await page.getByRole("radiogroup", { name: "文字大小" }).first().isVisible())) fail("text size switch missing on the desk");
    await check("desk");
    // The guest reminder must not push the chart below its floors or make a desktop page scroll (spec 4.1).
    if (item.width >= 1200) {
      for (const [width, height, floor] of [
        [1920, 1080, 600],
        [1440, 900, 420],
        [1366, 900, 420],
        [1366, 768, 300],
        [1280, 800, 360],
        [1200, 800, 340],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(700);
        const measured = await page.evaluate(() => ({
          chart: Math.round(document.querySelector('.td-chart canvas[role="img"]')?.getBoundingClientRect().height ?? 0),
          scroll: document.documentElement.scrollHeight - innerHeight,
          main: (() => {
            const main = document.querySelector("main");
            return main ? main.scrollHeight - main.clientHeight : 0;
          })(),
        }));
        if (measured.chart < floor) fail(`desk ${width}x${height}: guest chart ${measured.chart}px, needs ${floor}px`);
        if (measured.scroll > 1 || measured.main > 1) fail(`desk ${width}x${height}: the guest desk scrolls`);
        await page.screenshot({ path: `${out}${item.name}-desk-${width}x${height}.png` });
      }
      await page.setViewportSize({ width: item.width, height: item.height });
      await page.waitForTimeout(400);
    }

    await page.getByRole("button", { name: "復盤", exact: true }).click();
    await page.locator("textarea").last().fill("第一次練習，先看懂畫面。");
    await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
    const save = page.getByRole("heading", { name: "建立帳號，保存這次的練習" });
    await save.waitFor({ timeout: 15000 });
    await save.scrollIntoViewIfNeeded();
    await check("saved");

    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "再練一輪" }).waitFor({ timeout: 15000 });
    if (!(await page.getByText("今天完成了，明天再來").isVisible())) fail("lobby does not say today is done");
    await check("lobby-done", ".today-card, .install-card");
    await page.getByRole("link", { name: "再練一輪" }).click();
    await page
      .getByRole("radio", { name: /突破前高/ })
      .waitFor({ timeout: 15000 })
      .catch(() => fail("再練一輪 does not open a new plan"));
  } catch (error) {
    fail(`flow stopped: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}${item.name}-stopped.png` }).catch(() => {});
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}guest.json`, JSON.stringify(rows, null, 2));
console.table(rows.map((row) => ({ case: row.case, screen: row.screen, "<11px": row.small.length, overflowX: row.overflowX, "<44": row.short.length, "<56": row.shortLarge.length })));
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("All guest onboarding checks passed.");
