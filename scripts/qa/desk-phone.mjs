// Phone desk (2026-10-31, docs/superpowers/specs/2026-10-31-phone-desk-design.md), after desk-seed: at six phone
// sizes and in 大字, held upright:
//   0. Around the desk the page is the desk's ink: the browser's bar colour (theme-color, Android's address bar) and
//      the page behind the desk (what an iPhone shows when the page bounces, and beside it held sideways); the
//      manual, a platform page, keeps the platform's light grey for both.
//   1. 行情: without scrolling, at least 240px of the 江波圖 above the bottom tabs (200px on screens up to 700px tall,
//      140px up to 600px, 160px in 大字); 快訊 in at most two lines, no sideways scroll, every button at least 44px
//      (大字 56px).
//   2. 自選: one card a stock, its 江波圖 at least 70px tall and four tenths of the card wide.
//   3. 行情's 買進 opens 下單 on 買進 with 市價 chosen, the page's heading focused (the button that had focus is gone),
//      and 核對模擬買進 on screen without scrolling (pinned above the tabs); 賣出 likewise, or, when it cannot be
//      pressed (no holdings), the line saying why on screen instead.
//   4. Once (390×844): a 市價 1 張 order is sent from there, and the next minute fills it; the fill is then said
//      across the top (taps go through it) and goes by itself, 本輪損益 shows under 庫存, and 行情 says the holding.
// Runs in chromium or webkit (Safari's engine). Usage: node scripts/qa/desk-phone.mjs <baseUrl> <label> [chromium|webkit]
import { chromium, webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "phone", engineName = "chromium"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const browser =
  engineName === "webkit"
    ? await webkit.launch()
    : await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const results = {};
const failures = [];

const sizes = [
  [320, 568, false],
  [360, 800, false],
  [375, 667, false],
  [414, 896, false],
  [430, 932, false],
  [390, 844, true],
  // Last: the order is sent here.
  [390, 844, false],
];

// Buttons and links on screen that are smaller than `min` in either direction.
const smallTargets = (page, min) =>
  page.evaluate((min) => {
    const visible = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && box.bottom > 0 && box.top < innerHeight;
    };
    return [...document.querySelectorAll(".td-bar :is(a, button), .td-hero button, .td-dock button, .td-chartbar button")]
      .filter(visible)
      .map((node) => ({ name: (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 20), box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.height < min - 0.5 || box.width < min - 0.5)
      .map(({ name, box }) => `${name} ${Math.round(box.width)}×${Math.round(box.height)}`);
  }, min);

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const box = (locator) => locator.first().evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
});
const dockTop = (page) => page.locator(".td-dock").evaluate((node) => node.getBoundingClientRect().top);
const INK = "rgb(11, 14, 19)";
const CLEAR = "rgba(0, 0, 0, 0)";
// The browser's bar colour(s), the page's own background (the canvas an iPhone shows past the page's edges) and the
// backgrounds of everything between the page and `inside` (or the body, when it is not given).
const around = (page, inside) =>
  page.evaluate((inside) => {
    const behind = [];
    for (let node = inside ? document.querySelector(inside)?.parentElement : document.body; node && node !== document.documentElement; node = node.parentElement)
      behind.push(getComputedStyle(node).backgroundColor);
    return {
      themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.content),
      page: getComputedStyle(document.documentElement).backgroundColor,
      behind,
    };
  }, inside);

for (const [width, height, senior] of sizes) {
  const name = `${width}x${height}${senior ? "-senior" : ""}`;
  const result = {};
  const fail = (text) => failures.push(`${name}: ${text}`);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  const min = senior ? 56 : 44;
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);

    // 0. Around the desk
    result.around = await around(page, ".trading-desk");
    if (result.around.themeColors.join(" + ") !== "#0e1218")
      fail(`the browser's bar colour is ${result.around.themeColors.join(" + ") || "unset"} (the desk's #0e1218)`);
    if (result.around.page !== INK || result.around.behind.some((colour) => colour !== INK && colour !== CLEAR))
      fail(`the page behind the desk is ${[result.around.page, ...result.around.behind].join(" › ")} (the desk's ink ${INK})`);

    const dock = page.getByRole("navigation", { name: "主要分頁" });
    await dock.getByRole("button", { name: /行情/ }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(400);

    // 1. 行情
    const chart = await box(page.locator(".td-chart-canvas"));
    const alert = await page.locator(".td-hints .td-alert").count() ? await box(page.locator(".td-hints .td-alert")) : null;
    // How much of the 江波圖 shows above the bottom tabs as the page opens, without scrolling.
    const shown = Math.round(Math.min(chart.bottom, await dockTop(page)) - chart.top);
    const need = senior ? 160 : height <= 600 ? 140 : height <= 700 ? 200 : 240;
    result.chart = { top: Math.round(chart.top), height: Math.round(chart.height), shown, need };
    result.alertHeight = alert && Math.round(alert.height);
    result.sideways = await sideways(page);
    result.smallTargets = await smallTargets(page, min);
    if (shown < need) fail(`only ${shown}px of the 江波圖 shows above the tabs without scrolling (at least ${need}px)`);
    if (alert && alert.height > (senior ? 56 : 48)) fail(`快訊 takes ${Math.round(alert.height)}px (more than two lines)`);
    if (result.sideways > 1) fail(`the page scrolls sideways by ${result.sideways}px on 行情`);
    if (result.smallTargets.length) fail(`buttons under ${min}px: ${result.smallTargets.join(", ")}`);
    await page.screenshot({ path: `${out}${name}-market.png` });

    // 2. 自選
    await dock.getByRole("button", { name: /自選/ }).click();
    await page.waitForTimeout(600);
    const cards = page.locator('.td-watch-table[data-cards="true"] .td-watch-rows .td-watch-row');
    if (!(await cards.count())) fail("自選 has no cards");
    else {
      const row = await box(cards);
      const mini = await box(cards.first().locator(".td-mini"));
      result.card = { height: Math.round(row.height), miniHeight: Math.round(mini.height), miniShare: +(mini.width / row.width).toFixed(2) };
      if (mini.height < 70) fail(`a card's 江波圖 is ${Math.round(mini.height)}px tall`);
      if (mini.width < row.width * 0.4) fail(`a card's 江波圖 is ${Math.round((mini.width / row.width) * 100)}% of the card`);
      const painted = await cards.first().locator("canvas.td-mini").getAttribute("data-painted").catch(() => null);
      if (painted !== "true") fail("the first card's 江波圖 was not drawn");
    }
    result.watchSideways = await sideways(page);
    if (result.watchSideways > 1) fail(`the page scrolls sideways by ${result.watchSideways}px on 自選`);
    await page.screenshot({ path: `${out}${name}-watch.png` });
    // A card opens its stock on 行情.
    await cards.nth(1).click();
    await page.waitForTimeout(400);
    if ((await dock.getByRole("button", { name: /行情/ }).getAttribute("aria-pressed")) !== "true") fail("a card does not open 行情");

    // 3. 買進／賣出 from the quote
    for (const [button, side, label] of [[/^買進，/, "buy", "買進"], [/^賣出，/, "sell", "賣出"]]) {
      await dock.getByRole("button", { name: /行情/ }).click();
      await page.waitForTimeout(300);
      await page.locator(".td-hero").getByRole("button", { name: button }).click();
      await page.waitForTimeout(500);
      const onTrade = (await dock.getByRole("button", { name: /下單/ }).getAttribute("aria-pressed")) === "true";
      const ticketSide = await page.locator('.sim-ticket[data-pane="ticket"]').first().getAttribute("data-side");
      const market = await page.getByRole("button", { name: "市價", exact: true }).first().getAttribute("aria-pressed");
      const focused = await page.evaluate(() => document.activeElement?.tagName ?? null);
      const review = page.getByRole("button", { name: new RegExp(`^核對模擬${label}`) }).first();
      const reviewBox = (await review.count()) ? await box(review) : null;
      const usable = reviewBox ? await review.isEnabled() : false;
      // A button that cannot be pressed is not pinned: the line saying why must be on screen instead.
      const why = page.locator(".sim-ticket .sim-ticket-message").first();
      const target = usable || !(await why.count()) ? reviewBox : await box(why);
      const reach = target ? Math.round((await dockTop(page)) - target.bottom) : null;
      result[side] = { onTrade, ticketSide, market, focused, usable, belowDock: reach };
      if (!onTrade) fail(`${label} does not open 下單`);
      if (ticketSide !== side) fail(`${label} opens the ticket on ${ticketSide}`);
      if (market !== "true") fail(`${label} leaves 市價 unchosen`);
      if (focused !== "H1") fail(`after ${label} the focus is on ${focused}, not the page's heading`);
      if (reach === null || reach < 0 || (target && target.top < 0))
        fail(`${usable ? `核對模擬${label}` : `why 核對模擬${label} cannot be pressed`} is not on screen without scrolling (${reach})`);
      if (side === "buy") await page.screenshot({ path: `${out}${name}-trade.png` });
    }
    result.tradeSideways = await sideways(page);
    if (result.tradeSideways > 1) fail(`the page scrolls sideways by ${result.tradeSideways}px on 下單`);

    // 4. Send one 市價 order, once, and let the next minute fill it.
    if (name === "390x844") {
      await page.getByRole("navigation", { name: "主要分頁" }).getByRole("button", { name: /行情/ }).click();
      await page.locator(".td-hero").getByRole("button", { name: /^買進，/ }).click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /^核對模擬買進/ }).first().click();
      await page.getByRole("button", { name: "確認送出模擬買進" }).click();
      await page.getByText(/委託成功 · 買進 .* 1 張 市價/).first().waitFor({ timeout: 8000 });
      await page.getByRole("button", { name: "前進 1 分鐘" }).click();
      await page.getByText(/成交 · 買進 .* 1 張 @/).first().waitFor({ timeout: 12000 });
      result.sent = "委託成功 → 成交";
      await page.screenshot({ path: `${out}${name}-filled.png` });
      // 2026-11-02: once the replay reaches the fill it is said across the top, where taps go through it; 本輪損益 is
      // under 庫存 on every tab; the held stock's quote block says the holding; the notice goes by itself.
      const notice = page.locator(".td-order-notice");
      await notice.waitFor({ timeout: 8000 });
      const noticeText = ((await notice.textContent()) ?? "").replace(/\s+/g, " ").trim();
      result.notice = noticeText;
      if (!/^成交 ?買進 .+ 1 張 @ [\d.]+ · 庫存 \d+ 張 均 [\d.]+$/.test(noticeText)) fail(`the fill notice reads 「${noticeText}」`);
      if ((await notice.evaluate((node) => getComputedStyle(node).pointerEvents)) !== "none") fail("the fill notice catches taps");
      const noticeAt = await box(notice);
      if (noticeAt.top < 0 || noticeAt.top > 40) fail(`the fill notice is not across the top (its top at ${Math.round(noticeAt.top)}px)`);
      await page.screenshot({ path: `${out}${name}-notice.png` });
      const profit = ((await page.locator(".td-dock .td-dock-profit").textContent()) ?? "").trim();
      result.dockProfit = profit;
      if (!/^[+-]?[\d,]+$/.test(profit)) fail(`under 庫存 it says 「${profit}」, not 本輪損益`);
      await page.getByRole("navigation", { name: "主要分頁" }).getByRole("button", { name: /行情/ }).click();
      const stamp = ((await page.locator(".td-hero-stamp[data-holding]").textContent({ timeout: 4000 }).catch(() => "")) ?? "").trim();
      result.holding = stamp;
      if (!/^庫存 \d+ 張 · 均 [\d.]+ · [+-]?[\d,]+$/.test(stamp)) fail(`the held stock's quote block says 「${stamp}」`);
      await page.screenshot({ path: `${out}${name}-holding.png` });
      await notice.waitFor({ state: "detached", timeout: 9000 }).catch(() => fail("the fill notice stays on screen"));
    }
  } catch (error) {
    fail(String(error.message ?? error).split("\n")[0]);
    await page.screenshot({ path: `${out}${name}-error.png` }).catch(() => {});
  }
  results[name] = result;
  await context.close();
}

// 0, the other side: the manual, a platform page, keeps the platform's light grey.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/manual`, { waitUntil: "domcontentloaded" });
    results.manual = await around(page);
    if (results.manual.themeColors.join(" + ") !== "#f5f7fb" || results.manual.page !== "rgb(245, 247, 251)")
      failures.push(`manual: the bar colour ${results.manual.themeColors.join(" + ") || "unset"} and the page ${results.manual.page} are not the platform's light grey`);
  } catch (error) {
    failures.push(`manual: ${String(error.message ?? error).split("\n")[0]}`);
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}phone.json`, JSON.stringify({ engine: engineName, results, failures }, null, 1));
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`Phone desk (${engineName}): 行情, 自選 cards and 買進／賣出 to 下單 pass at every size.`);
