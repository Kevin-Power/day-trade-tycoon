// 自動出場 (2026-11-02, 石大哥 via the owner): a plan's 停利／停損 sell the whole holding at market by themselves.
// Disposable QA run of the owner on the newest day (it gives up any unfinished run first), on a phone (390×844):
//   1. A first run, by the API only, finds the minute an exit fires: 停利 最低獲利檔／停損 3 檔 on 1 張 bought at 09:01,
//      tried stock by stock (the hot five) until one fires. It is given up.
//   1b. The same run, its buy sent and waiting: 前進 1 分鐘 on the desk fills it, and the fill said across the top
//      says the 觸價單 it set (2026-11-06, 石大哥: 「下單後，直接會設觸價單來停損、停利嗎?」).
//   2. The same run again (the same orders give the same fills), to the minute before: 庫存 shows the holding's
//      觸價單 prices, the API's, and lists the two under 委託 as 等待觸發; 委託回報 heads with them; the 江波圖 draws
//      停利觸價 and 停損觸價; 行情 says the holding.
//   3. 前進 1 分鐘 on the desk: once the replay reaches it, 停利出場／停損出場 is said across the top with what the sell
//      made, 委託回報 says 成交 · 停利觸價單／停損觸價單 and no 觸價單 waits any more, and 行情 no longer says a holding.
//   4. The run given up, the plan card offers its 觸價單 on, 停利 最低獲利檔, 停損 10 檔 (ticks since 2026-11-09), in 16px
//      menus, and says about what % the chosen ticks are; picking +2 檔／6 檔 changes what it says.
// Usage: node scripts/qa/desk-exit.mjs <baseUrl> <label> [chromium|webkit]
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { breakoutsOf, freshBreakout } from "../../src/lib/morning-alerts.ts";
import { deriveSwingHighs } from "../../src/lib/market/swing-highs.ts";
import { formatPrice } from "../../src/lib/market/ticks.ts";
import { exitNote, stopLossExampleText, takeProfitExampleText } from "../../src/lib/morning-exit.ts";

const [base = "http://127.0.0.1:18886", label = "exit", engineName = "chromium"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const HOT = ["2308", "2317", "2330", "2382", "2454"];
const EXIT = { takeProfitTicks: 0, stopLossTicks: 3 };
const failures = [];
const results = {};
const fail = (text) => failures.push(text);

async function call(action) {
  const response = await fetch(
    base + "/api/morning",
    action
      ? {
          method: "POST",
          headers: { origin: base, "content-type": "application/json" },
          body: JSON.stringify({ ...action, requestId: randomUUID() }),
        }
      : {},
  );
  assert.equal(response.status, 200, `/api/morning ${action?.action ?? "GET"}: HTTP ${response.status}`);
  return response.json();
}
async function giveUp() {
  const data = await call();
  if (data.state && !data.state.completed) await call({ action: "abandon", id: data.state.id, expectedRevision: data.state.revision });
}
/** A run of the hot five with 自動出場, 1 張 of `code` bought at 09:01 and filled; it stops at `until` or at 10:30. */
async function runTo(code, until = 90) {
  await giveUp();
  let data = await call({
    action: "start",
    codes: HOT,
    plan: {
      focusCode: code,
      bias: "bullish",
      reason: "驗收自動出場。",
      entry: "09:01 市價買進 1 張。",
      stop: "停利最低獲利檔、停損 3 檔由教室自動賣出。",
      exit: EXIT,
    },
  });
  const advance = async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, data.state.nextAdvanceAt - Date.now()) + 30));
    data = await call({ action: "advance", id: data.state.id, expectedRevision: data.state.revision });
  };
  await advance();
  data = await call({ action: "order", id: data.state.id, expectedRevision: data.state.revision, code, side: "buy", lots: 1 });
  while (data.state.cursor < until && !data.state.orders.some((order) => order.auto)) await advance();
  return data.state;
}

// 1. Which stock's exit fires, and at which minute (the cell revealed by the advance from cursor − 1).
let found = null;
for (const code of HOT) {
  const state = await runTo(code);
  const exit = state.orders.find((order) => order.auto);
  if (exit) {
    found = { code, cursor: exit.submittedCursor, kind: exit.auto, filled: exit.status === "filled" };
    break;
  }
}
results.found = found;
if (!found) fail("no hot stock's 自動出場 (最低獲利檔／3 檔) fired on the newest day");
else if (!found.filled) fail(`${found.code}'s exit at cell ${found.cursor} did not fill in its minute`);

const browser =
  engineName === "webkit"
    ? await webkit.launch()
    : await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const dock = page.getByRole("navigation", { name: "主要分頁" });
const clean = (text) => (text ?? "").replace(/\s+/g, " ").trim();
try {
  if (found) {
    // 1b. The buy sent and waiting; the desk's next minute fills it and says the 觸價單 it set.
    await runTo(found.code, 1);
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
    await page.getByRole("button", { name: "前進 1 分鐘" }).click();
    const bought = page.locator(".td-order-notice");
    await bought.waitFor({ timeout: 15000 }).catch(() => {});
    const boughtText = clean(await bought.textContent().catch(() => ""));
    results.buyNotice = boughtText;
    // 2026-11-09: 「停利 X（最低獲利檔，約 +0.5%）／停損 Y（-3 檔，約 -0.6%）」.
    if (!/^成交 ?買進 .+ 1 張 @ [\d.]+ · 庫存 1 張 成本 [\d.]+ ?已送出觸價單：停利 [\d.]+（最低獲利檔，約 \+[\d.]+%）／停損 [\d.]+（-3 檔，約 -[\d.]+%）$/.test(boughtText))
      fail(`the buy's fill notice reads 「${boughtText}」, without the 觸價單 it set`);
    await page.screenshot({ path: `${out}buy-notice.png` });

    // 2. The minute before it fires.
    const before = await runTo(found.code, found.cursor);
    assert.equal(before.cursor, found.cursor);
    const held = before.positions.find((position) => position.code === found.code);
    results.exitPrices = held?.exit ?? null;
    if (!held?.exit) fail("the holding has no 自動出場 prices before its exit fires");
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
    await dock.getByRole("button", { name: /^庫存/ }).click();
    await page.waitForTimeout(400);
    const card = clean(await page.locator(".trading-desk").textContent());
    // 2026-11-09: each price with its ticks and about what % they are, from the API's prices and cost.
    const shown = card.match(/觸價單 ?停利 ([\d.]+)（最低獲利檔，約 \+[\d.]+%）／停損 ([\d.]+)（-\d+ 檔，約 -[\d.]+%）/);
    results.card = shown?.[0] ?? null;
    if (!shown) fail("庫存 does not show the holding's 觸價單 prices");
    else if (held?.exit) {
      const { takeProfit, stopLoss, takeProfitTicks } = held.exit;
      const expected = `觸價單 停利 ${formatPrice(takeProfit)}${exitNote("takeProfit", held.averageCost, takeProfit, takeProfitTicks)}／停損 ${formatPrice(stopLoss)}${exitNote("stopLoss", held.averageCost, stopLoss)}`;
      if (shown[0].replace(/^觸價單 ?/, "觸價單 ") !== expected) fail(`庫存 shows 「${shown[0]}」, the run's is 「${expected}」`);
    }
    // On the phone card the 觸價單 takes the full width, 停利 and 停損 each on a line (2026-11-09).
    const wide = await page.evaluate(() => {
      const cell = document.querySelector(".sim-card dl > [data-wide]");
      const lines = [...(cell?.querySelectorAll(".sim-exit-line") ?? [])].map((line) => line.getBoundingClientRect());
      const list = cell?.parentElement?.getBoundingClientRect();
      return cell && list ? { cell: cell.getBoundingClientRect().width, list: list.width, tops: lines.map((line) => line.top), lefts: lines.map((line) => line.left) } : null;
    });
    results.wideExit = wide;
    if (!wide) fail("the phone card has no full-width 觸價單");
    else if (Math.abs(wide.cell - wide.list) > 1 || wide.tops.length !== 2 || !(wide.tops[1] > wide.tops[0]) || Math.abs(wide.lefts[0] - wide.lefts[1]) > 1)
      fail(`the phone card's 觸價單 is not full width with 停利 and 停損 on their own lines: ${JSON.stringify(wide)}`);
    await page.screenshot({ path: `${out}armed-positions.png` });
    // 委託 lists the two 觸價單 as 等待觸發, 停利 first.
    await page.locator(".trading-desk").getByRole("button", { name: /^委託/ }).first().click();
    await page.waitForTimeout(300);
    const listed = clean(await page.locator(".trading-desk").textContent());
    const armedRows = [...listed.matchAll(/(停利|停損)觸價單.{0,40}?觸價 (≥|≤) ([\d.]+)（(?:最低獲利檔(?: \+\d+ 檔)?|-\d+ 檔)，約 [+-][\d.]+%） · 市價.{0,12}?等待觸發/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
    results.armedRows = armedRows;
    if (held?.exit && armedRows.join(", ") !== `停利 ≥ ${held.exit.takeProfit}, 停損 ≤ ${held.exit.stopLoss}`)
      fail(`委託 lists 觸價單 「${armedRows.join(", ")}」, the run has 停利 ${held.exit.takeProfit}／停損 ${held.exit.stopLoss}`);
    await page.screenshot({ path: `${out}armed-orders.png` });
    // 委託回報 heads with them.
    await dock.getByRole("button", { name: /下單/ }).click();
    await page.waitForTimeout(400);
    const heads = (await page.locator(".sim-reports li").allTextContents()).slice(0, 2).map(clean);
    results.armedReports = heads;
    if (!heads[0]?.includes("停利觸價單 · 成交價 ≥") || !heads[1]?.includes("停損觸價單 · 成交價 ≤") || !heads.every((text) => text.endsWith("等待觸發")))
      fail(`委託回報 begins 「${heads.join("」「")}」, not the two waiting 觸價單`);
    await page.screenshot({ path: `${out}armed-reports.png` });
    await dock.getByRole("button", { name: /行情/ }).click();
    await page.locator(".td-hero").getByText(/^庫存 1 張$/).first().waitFor({ timeout: 4000 }).catch(() => fail("行情 does not say the holding"));
    // 2026-11-08: the stamp under 成本 names the waiting 觸價單, on the one phone screen.
    const stampText = clean(await page.locator(".td-hero-stamp[data-holding]").first().textContent().catch(() => ""));
    results.armedStamp = stampText;
    if (held?.exit && !stampText.includes(`停利 ${held.exit.takeProfit}／停損 ${held.exit.stopLoss}`))
      fail(`行情's stamp reads 「${stampText}」, without 停利 ${held.exit.takeProfit}／停損 ${held.exit.stopLoss}`);
    // data-levels: what the chart drew (it paints on the next frame).
    await page
      .waitForFunction(() => document.querySelector('main canvas[role="img"]')?.dataset.levels?.includes("觸價"), null, { timeout: 3000 })
      .catch(() => {});
    const levels = ((await page.locator('main canvas[role="img"]').first().getAttribute("data-levels")) ?? "").split("|");
    results.chartLevels = levels;
    if (held?.exit && !(levels.includes(`停利觸價 ${held.exit.takeProfit}`) && levels.includes(`停損觸價 ${held.exit.stopLoss}`)))
      fail(`the 江波圖 draws ${levels.join(", ")}, not 停利觸價／停損觸價`);
    await page.screenshot({ path: `${out}armed-chart.png` });
    // 2026-11-08: 過前高 beside the price exactly when a breakout's minute completed within the last five minutes —
    // the desk's own rule, worked out here from the API's bars, so the flag is checked present and absent alike.
    // (An advance answers with the new cell only; the GET the desk reloads from carries every revealed minute.)
    const shownState = (await call()).state;
    const settledBars = (shownState.bars?.[found.code] ?? []).filter((bar) => bar.t + 60 <= shownState.cursor * 60).sort((a, b) => a.t - b.t);
    const expectedBreakout = freshBreakout(
      breakoutsOf(settledBars, deriveSwingHighs(settledBars, shownState.cursor * 60, 0, 90 * 60).confirmed),
      shownState.cursor * 60,
    );
    const expectedFlag = expectedBreakout ? formatPrice(expectedBreakout.high) : null;
    const shownFlag = await page.locator(".td-hero").first().getAttribute("data-breakout");
    results.breakoutFlag = { expected: expectedFlag, shown: shownFlag };
    if (expectedFlag !== shownFlag) fail(`行情 flags 過前高 「${shownFlag}」, the bars say 「${expectedFlag ?? "none"}」`);
    if (expectedFlag && !clean(await page.locator(".td-hero-flag").textContent().catch(() => "")).includes(`過前高 ${expectedFlag}`))
      fail("the 過前高 flag is not shown beside the price");

    // 3. The minute it fires, on the desk.
    await page.getByRole("button", { name: "前進 1 分鐘" }).click();
    const notice = page.locator(".td-order-notice");
    await notice.waitFor({ timeout: 15000 });
    const said = clean(await notice.textContent());
    results.notice = said;
    const name = found.kind === "takeProfit" ? "停利" : "停損";
    if (!new RegExp(`^${name}出場 ?賣出 .+ 1 張 @ [\\d.]+ ?這筆 [+-]?[\\d,]+$`).test(said)) fail(`the notice reads 「${said}」, not ${name}出場`);
    if ((await notice.evaluate((node) => getComputedStyle(node).pointerEvents)) !== "none") fail("the notice catches taps");
    await page.screenshot({ path: `${out}fired-notice.png` });
    const stamp = await page.locator(".td-hero-stamp[data-holding]").count();
    if (stamp) fail("行情 still says a holding after the exit sold it");
    await dock.getByRole("button", { name: /下單/ }).click();
    await page.getByText(new RegExp(`成交 · ${name}觸價單 · 賣出 .+ 1 張 @`)).first().waitFor({ timeout: 4000 })
      .catch(() => fail(`委託回報 does not say 成交 · ${name}觸價單`));
    const stillArmed = await page.locator('.sim-reports li[data-tone="armed"]').count();
    if (stillArmed) fail(`${stillArmed} 觸價單 still wait after the holding was sold`);
    await page.screenshot({ path: `${out}fired-reports.png` });
  }

  // 4. The plan card.
  await giveUp();
  await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
  const row = page.locator(".td-exit-plan");
  await row.waitFor({ timeout: 20000 });
  const plan = await row.evaluate((node) => ({
    on: node.querySelector('input[type="checkbox"]')?.checked ?? null,
    picks: [...node.querySelectorAll("select")].map((select) => ({ value: select.value, size: parseFloat(getComputedStyle(select).fontSize) })),
    text: node.textContent?.replace(/\s+/g, " ").trim(),
  }));
  results.plan = plan;
  if (plan.on !== true) fail("自動出場 is not on by default");
  if (plan.picks.map((pick) => pick.value).join(" ") !== "0 10") fail(`the plan card offers ${plan.picks.map((pick) => pick.value).join(" / ")}, not 停利 最低獲利檔 (0) / 停損 10 檔`);
  if (!plan.text?.includes("最低獲利檔")) fail(`the plan card does not name 最低獲利檔: 「${plan.text}」`);
  if (!plan.text?.includes("手續費和當沖證交稅")) fail("the plan card does not say what 最低獲利檔 covers");
  if (!plan.text?.includes(takeProfitExampleText(0)) || !plan.text?.includes(stopLossExampleText(10)))
    fail(`the plan card does not say what 最低獲利檔／10 檔 are in %: 「${plan.text}」`);
  if (plan.picks.some((pick) => pick.size < 16)) fail("a 自動出場 menu is under 16px");
  await row.screenshot({ path: `${out}plan-row.png` });
  // Picking 最低獲利檔 +2 檔 and 6 檔 changes what the card says they are.
  const menus = row.locator("select");
  await menus.nth(0).selectOption("2");
  await menus.nth(1).selectOption("6");
  const picked = await row.evaluate((node) => node.textContent?.replace(/\s+/g, " ").trim());
  results.planPicked = picked;
  if (!picked?.includes(takeProfitExampleText(2)) || !picked?.includes(stopLossExampleText(6)))
    fail(`after picking +2 檔／6 檔 the plan card reads 「${picked}」`);
  await row.screenshot({ path: `${out}plan-row-picked.png` });
} catch (error) {
  fail(String(error.message ?? error).split("\n")[0]);
  await page.screenshot({ path: `${out}error.png` }).catch(() => {});
}
await giveUp().catch(() => {});
await browser.close();
writeFileSync(`${out}results.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify({ results, failures }, null, 2));
if (failures.length) process.exit(1);
