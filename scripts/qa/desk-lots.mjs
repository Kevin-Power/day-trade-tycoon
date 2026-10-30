// 張數 quick picks and 量夠才成交 on the real desk (design 2026-10-30), on a disposable classroom with the QA fixture:
//   1. at 1366x900, 820x900, 375x812, 320x700 and both 大字 sizes, the ticket's 張數 field and the lightning book's
//      每筆張數: a number box of 1–400; 快選 opens XQ's four rows exactly (1–7, 10–70, 15–75, 100–400), seven to a row
//      (大字: four, the order kept), every pick inside the window, as large as the layout needs (phones 44px, 大字
//      56px), on top where it is (nothing covers it), and the page never scrolls sideways; a pick closes the grid
//      and puts the focus back in the box; Enter or Space on 快選 opens it on the current pick, Tab and Shift+Tab move
//      through the picks, Esc closes it; typing 999 gives 400; ticket and book share one count;
//   2. (1366x900) 400 lots of 台積電: the review shows the large-order block and cannot be sent unticked; ticked, the
//      server refuses it for the cash (送出失敗 … 目前模擬資金不足) and stores nothing; lightning with 400 lots opens
//      the confirm card instead of sending;
//   3. (1366x900) a large market order on a thin stock waits with 「已累計 n／N 張」 (0 < n < N, the server's count) in
//      the ticket and the 委託 tab, then fills at the average, reported as the desk writes it.
// Starts its own run (the hot five and the thinnest cheap stock of the newest day), so run it where the seed does
// not matter afterwards. Usage: node scripts/qa/desk-lots.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fillPriceText } from "../../src/lib/morning-ledger.ts";

const [base = "http://127.0.0.1:18811", label = "lots"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const HOT = ["2308", "2317", "2330", "2382", "2454"];
const ROWS = [
  [1, 2, 3, 4, 5, 6, 7],
  [10, 20, 30, 40, 50, 60, 70],
  [15, 25, 35, 45, 55, 65, 75],
  [100, 150, 200, 250, 300, 350, 400],
];
const CASES = [
  { name: "1366x900", width: 1366, height: 900, senior: false, minSide: 28 },
  { name: "820x900", width: 820, height: 900, senior: false, minSide: 44 },
  { name: "375x812", width: 375, height: 812, senior: false, minSide: 44 },
  { name: "320x700", width: 320, height: 700, senior: false, minSide: 44 },
  { name: "375x812-senior", width: 375, height: 812, senior: true, minSide: 56 },
  { name: "320x700-senior", width: 320, height: 700, senior: true, minSide: 56 },
];
const failures = [];
const results = {};
const fail = (where, message) => {
  failures.push(`${where}: ${message}`);
  console.log(`FAIL ${where}: ${message}`);
};
const clean = (text) => (text ?? "").replace(/\s+/g, " ").trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(message);
    await pause(150);
  }
}
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
  if (response.status !== 200) throw new Error(`/api/morning ${action?.action ?? "GET"}: HTTP ${response.status}`);
  return response.json();
}
const api = async () => (await call()).state;

// ── A fresh run: the hot five and the day's thinnest cheap stock ─────────────────────────────────────────────────
let data = await call();
if (data.unavailable) throw new Error(`the classroom has no daily lessons: ${data.unavailable}`);
if (data.state && !data.state.completed) {
  await call({ action: "abandon", id: data.state.id, expectedRevision: data.state.revision });
  data = await call();
}
if (!data.picker) throw new Error("the day sent no picker");
// Thin: among the ten stocks with the least turnover the day before (not the hot five, not under 處置), the cheapest
// at 10 or more, so the cash buys a few hundred lots that its trades take minutes to reach.
const thin = data.picker.symbols
  .filter((symbol) => !HOT.includes(symbol.code) && !symbol.disposition && symbol.referencePrice >= 10)
  .sort((a, b) => a.previousValue - b.previousValue)
  .slice(0, 10)
  .sort((a, b) => a.referencePrice - b.referencePrice)[0];
if (!thin) throw new Error("the picker has no thin stock");
const codes = [...HOT, thin.code].sort();
data = await call({
  action: "start",
  codes,
  plan: {
    exerciseId: "first-order",
    focusCode: "2330",
    bias: "observe",
    reason: "驗收張數快選與量夠才成交。",
    entry: "用快選格子選張數，核對大額委託與累計進度。",
    stop: "完成驗收後停止。",
  },
});
while (data.state.cursor < 3) {
  await pause(Math.max(0, data.state.nextAdvanceAt - Date.now()) + 40);
  data = await call({ action: "advance", id: data.state.id, expectedRevision: data.state.revision });
}
results.run = { codes, thin: { code: thin.code, name: thin.name, referencePrice: thin.referencePrice } };

// ── 1. The field and its grid at every size ──────────────────────────────────────────────────────────────────────

/** The open grid as it is on screen: its rows' values, every pick's box, whether it is the top element there. */
async function measure(page) {
  return page.evaluate(() => {
    const grid = document.querySelector(".td-lotpick-grid");
    if (!grid) return null;
    const rows = [...grid.querySelectorAll(".td-lotpick-row")].map((row) =>
      [...row.querySelectorAll("button[data-lots]")].map((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          lots: Number(button.dataset.lots),
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          onTop: hit === button || button.contains(hit),
        };
      }),
    );
    const box = grid.getBoundingClientRect();
    return {
      rows,
      grid: { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      sheet: grid.getAttribute("data-sheet") === "true",
      gridOverflowX: grid.scrollWidth - grid.clientWidth,
      pageOverflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      window: { width: window.innerWidth, height: window.innerHeight },
      layout: document.querySelector(".trading-desk")?.getAttribute("data-layout"),
      active: document.activeElement?.getAttribute("data-lots") || document.activeElement?.id || null,
    };
  });
}
function judgeGrid(where, look, c) {
  if (!look) return fail(where, "快選 did not open a grid");
  const values = look.rows.map((row) => row.map((pick) => pick.lots));
  if (JSON.stringify(values) !== JSON.stringify(ROWS)) fail(where, `the rows are ${JSON.stringify(values)}`);
  const picks = look.rows.flat();
  const outside = picks.filter((pick) => pick.x < -0.5 || pick.y < -0.5 || pick.right > look.window.width + 0.5 || pick.bottom > look.window.height + 0.5);
  if (outside.length) fail(where, `picks outside the window: ${outside.map((pick) => pick.lots).join(", ")}`);
  const small = picks.filter((pick) => pick.width < c.minSide - 0.5 || pick.height < c.minSide - 0.5);
  if (small.length)
    fail(where, `picks under ${c.minSide}px: ${small.map((pick) => `${pick.lots} ${pick.width.toFixed(1)}x${pick.height.toFixed(1)}`).join(", ")}`);
  const covered = picks.filter((pick) => !pick.onTop);
  if (covered.length) fail(where, `picks covered by something else: ${covered.map((pick) => pick.lots).join(", ")}`);
  if (look.pageOverflowX > 0) fail(where, `the page scrolls sideways by ${look.pageOverflowX}px`);
  if (look.gridOverflowX > 0) fail(where, `the grid scrolls sideways by ${look.gridOverflowX}px`);
  // Seven to a row (大字: four, then three), in order, left to right.
  const perLine = c.senior ? 4 : 7;
  for (const row of look.rows) {
    const lines = [];
    for (const pick of row) {
      const line = lines.find((items) => Math.abs(items[0].y - pick.y) < 2);
      if (line) line.push(pick);
      else lines.push([pick]);
    }
    const sizes = lines.map((line) => line.length);
    const want = c.senior ? [4, 3] : [7];
    if (JSON.stringify(sizes) !== JSON.stringify(want)) fail(where, `row ${row[0].lots}… lays out as ${sizes.join("+")} (want ${want.join("+")})`);
    for (const line of lines)
      if (line.some((pick, index) => index > 0 && pick.x <= line[index - 1].x)) fail(where, `row ${row[0].lots}… is not left to right`);
    if (lines.length && lines[0].length > perLine) fail(where, `more than ${perLine} picks on a line`);
  }
  const phoneLike = look.layout === "phone" || look.layout === "senior";
  if (look.sheet !== phoneLike) fail(where, `layout ${look.layout} but the grid is ${look.sheet ? "a bottom sheet" : "a drop-down"}`);
}
const fieldValue = (page, id) => page.locator(`#${id}`).inputValue();
const activeId = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute("data-lots") || document.activeElement?.id || "");

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const c of CASES) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
  if (c.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const where = c.name;
  const report = {};
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
    const layout = await page.locator(".trading-desk").getAttribute("data-layout");
    report.layout = layout;
    if (layout === "phone" || layout === "senior") await page.getByRole("button", { name: "下單", exact: true }).click();
    const box = page.locator("#sim-lots-value");
    await box.waitFor({ timeout: 6000 });
    const attributes = await box.evaluate((input) => ({ type: input.type, min: input.min, max: input.max, step: input.step }));
    if (JSON.stringify(attributes) !== JSON.stringify({ type: "number", min: "1", max: "400", step: "1" }))
      fail(where, `the 張數 box is ${JSON.stringify(attributes)}`);
    const ticketToggle = page.locator(".sim-ticket .td-lotpick-toggle");
    await ticketToggle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${c.name}-field.png` });

    // Mouse: open, measure, pick 400.
    await ticketToggle.click();
    await page.locator(".td-lotpick-grid").waitFor({ timeout: 4000 });
    const look = await measure(page);
    judgeGrid(`${where} ticket`, look, c);
    report.ticketGrid = look && { sheet: look.sheet, grid: look.grid, pick: { width: look.rows[0][0].width, height: look.rows[0][0].height } };
    if (look?.active !== "1") fail(where, `opening put the focus on ${look?.active}, not the current pick (1)`);
    await page.screenshot({ path: `${out}/${c.name}-ticket-grid.png` });
    await page.locator('.td-lotpick-grid button[data-lots="400"]').click();
    await page.locator(".td-lotpick-grid").waitFor({ state: "detached", timeout: 3000 });
    if ((await fieldValue(page, "sim-lots-value")) !== "400") fail(where, `picking 400 left ${await fieldValue(page, "sim-lots-value")}`);
    if ((await activeId(page)) !== "sim-lots-value") fail(where, `after a pick the focus is on ${await activeId(page)}, not the 張數 box`);

    // Keyboard: Enter opens on the current pick, Shift+Tab / Tab move, Esc closes back to the box.
    await ticketToggle.focus();
    await page.keyboard.press("Enter");
    await page.locator(".td-lotpick-grid").waitFor({ timeout: 3000 });
    if ((await activeId(page)) !== "400") fail(where, `Enter opened with the focus on ${await activeId(page)}, not 400`);
    await page.keyboard.press("Shift+Tab");
    if ((await activeId(page)) !== "350") fail(where, `Shift+Tab from 400 went to ${await activeId(page)}`);
    await page.keyboard.press("Tab");
    if ((await activeId(page)) !== "400") fail(where, `Tab from 350 went to ${await activeId(page)}`);
    await page.keyboard.press("Escape");
    await page.locator(".td-lotpick-grid").waitFor({ state: "detached", timeout: 3000 });
    if ((await activeId(page)) !== "sim-lots-value") fail(where, `Esc left the focus on ${await activeId(page)}`);
    // Space opens too; Shift+Tab three times from 400 is 250, and Enter picks it.
    await ticketToggle.focus();
    await page.keyboard.press(" ");
    await page.locator(".td-lotpick-grid").waitFor({ timeout: 3000 });
    for (let step = 0; step < 3; step++) await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await page.locator(".td-lotpick-grid").waitFor({ state: "detached", timeout: 3000 });
    if ((await fieldValue(page, "sim-lots-value")) !== "250") fail(where, `the keyboard pick gave ${await fieldValue(page, "sim-lots-value")}, not 250`);
    if ((await activeId(page)) !== "sim-lots-value") fail(where, `after the keyboard pick the focus is on ${await activeId(page)}`);

    // Typing: past 400 is 400; the arrow key steps by one.
    await box.fill("999");
    await until(async () => (await box.inputValue()) === "400", `typing 999 left ${await box.inputValue()}`, 3000).catch((error) => fail(where, error.message));
    // Both boxes (ticket and book) show 400 whole: its digits fit inside the box.
    const fits = await page.evaluate(() =>
      ["sim-lots-value", "td-lots-value"].flatMap((id) => {
        const input = document.getElementById(id);
        if (!input) return [];
        const style = getComputedStyle(input);
        const context = document.createElement("canvas").getContext("2d");
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return [{ id, value: input.value, text: Math.ceil(context.measureText(input.value).width), room: Math.floor(room) }];
      }),
    );
    for (const item of fits) if (item.text > item.room) fail(where, `${item.id} shows ${item.value} in ${item.room}px, it needs ${item.text}px`);
    report.boxes = fits;
    await box.fill("12");
    await box.press("ArrowUp");
    if ((await box.inputValue()) !== "13") fail(where, `ArrowUp from 12 gave ${await box.inputValue()}`);

    // The lightning book's 每筆張數: the same field and grid, one count with the ticket.
    const bookBox = page.locator("#td-lots-value");
    if (await bookBox.count()) {
      if ((await bookBox.inputValue()) !== "13") fail(where, `the book shows ${await bookBox.inputValue()} lots, the ticket 13`);
      const bookToggle = page.locator(".td-lots .td-lotpick-toggle");
      await bookToggle.scrollIntoViewIfNeeded();
      await bookToggle.click();
      await page.locator(".td-lotpick-grid").waitFor({ timeout: 4000 });
      const bookLook = await measure(page);
      judgeGrid(`${where} book`, bookLook, c);
      await page.screenshot({ path: `${out}/${c.name}-book-grid.png` });
      await page.locator('.td-lotpick-grid button[data-lots="7"]').click();
      await page.locator(".td-lotpick-grid").waitFor({ state: "detached", timeout: 3000 });
      if ((await bookBox.inputValue()) !== "7" || (await box.inputValue()) !== "7")
        fail(where, `picking 7 in the book gave book ${await bookBox.inputValue()}, ticket ${await box.inputValue()}`);
      if ((await activeId(page)) !== "td-lots-value") fail(where, `after a book pick the focus is on ${await activeId(page)}`);
      report.book = true;
    } else fail(where, "no 每筆張數 field in the lightning book");
    // A press outside closes the grid.
    await ticketToggle.click();
    await page.locator(".td-lotpick-grid").waitFor({ timeout: 3000 });
    await page.mouse.click(2, Math.round(c.height / 3));
    await page.locator(".td-lotpick-grid").waitFor({ state: "detached", timeout: 3000 }).catch(() => fail(where, "a press outside left the grid open"));
    await box.fill("1");
  } catch (error) {
    fail(where, error.message.split("\n")[0]);
    await page.screenshot({ path: `${out}/${c.name}-stopped.png` }).catch(() => {});
  }
  if (errors.length) fail(where, `page errors: ${errors.join(" | ")}`);
  results[c.name] = report;
  await context.close();
}

// ── 2 and 3. Orders at 1366x900 ──────────────────────────────────────────────────────────────────────────────────
{
  const where = "1366x900 orders";
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const reportsText = async () => clean(await page.locator(".sim-reports").textContent({ timeout: 4000 }).catch(() => ""));
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
    const box = page.locator("#sim-lots-value");

    // 2. 400 lots of 台積電: large-order block, then refused for the cash; lightning opens the card.
    await page.locator('.td-watch-row[data-code="2330"]').click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "市價", exact: true }).click();
    await page.locator(".sim-ticket .td-lotpick-toggle").click();
    await page.locator('.td-lotpick-grid button[data-lots="400"]').click();
    await page.getByRole("button", { name: /^核對模擬買進/ }).click();
    const large = page.locator(".sim-large");
    await large.waitFor({ timeout: 4000 });
    const largeText = clean(await large.textContent());
    if (!largeText.includes("大額委託")) fail(where, `the large-order block reads "${largeText}"`);
    const confirmMain = clean(await page.locator(".sim-confirm-main").textContent());
    if (!confirmMain.includes("400")) fail(where, `the review shows "${confirmMain}", not 400 lots`);
    const send = page.getByRole("button", { name: "確認送出模擬買進" });
    if (await send.isEnabled()) fail(where, "400 lots can be sent before ticking the large-order confirmation");
    await page.locator("#sim-large-ack").check();
    const before = (await api()).orders.length;
    await send.click();
    await until(async () => /送出失敗 · 買進 台積電 400 張 · 目前模擬資金不足，無法委託/.test(await reportsText()), "no 送出失敗 report for 400 lots of 台積電");
    if ((await api()).orders.length !== before) fail(where, "the refused 400-lot order was stored");
    await page.getByRole("button", { name: /重新載入進度/ }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "返回修改" }).click({ timeout: 1500 }).catch(() => {});
    results.refused = { report: (await reportsText()).match(/送出失敗 · 買進 台積電 400 張 · [^。]*無法委託/)?.[0] ?? null, large: largeText };
    // Lightning with 400 lots: the card opens, nothing is sent.
    await box.fill("400");
    const lightning = page.getByRole("switch", { name: "閃電即送" });
    await lightning.click();
    const sent = (await api()).orders.length;
    await page.locator('.td-book-cell[data-side="bid"][data-level="1"]').click();
    await page.locator(".sim-large").waitFor({ timeout: 4000 });
    await page.waitForTimeout(600);
    if ((await api()).orders.length !== sent) fail(where, "lightning sent 400 lots without the confirmation");
    if (!clean(await page.locator(".sim-large").textContent()).includes("閃電即送不會直接送出"))
      fail(where, "the lightning card does not say it was not sent");
    await page.screenshot({ path: `${out}/1366x900-lightning-400.png` });
    await page.getByRole("button", { name: "返回修改" }).click();
    if ((await lightning.getAttribute("aria-checked")) === "true") await lightning.click();

    // 3. A large market order on the thin stock: progress, then a fill at the average.
    await page.locator(`.td-watch-row[data-code="${thin.code}"]`).click();
    await page.waitForTimeout(300);
    let state = await api();
    const last = state.bars[thin.code]?.at(-1)?.c ?? thin.referencePrice;
    const lots = Math.max(2, Math.min(400, Math.floor((0.9 * state.cash) / (last * 1000))));
    await page.getByRole("button", { name: "市價", exact: true }).click();
    await box.fill(String(lots));
    await page.getByRole("button", { name: /^核對模擬買進/ }).click();
    await page.locator(".sim-confirm").waitFor({ timeout: 4000 });
    if (await page.locator("#sim-large-ack").isVisible().catch(() => false)) await page.locator("#sim-large-ack").check();
    await page.getByRole("button", { name: "確認送出模擬買進" }).click();
    const pending = page.locator(".sim-pending");
    await pending.waitFor({ timeout: 6000 });
    const startText = clean(await pending.locator(".sim-progress").textContent());
    if (startText !== `已累計 0／${lots} 張`) fail(where, `a new order shows "${startText}"`);
    let progress = null;
    for (let step = 0; step < 30 && !progress; step++) {
      const cursor = (await api()).cursor;
      await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
      state = await until(async () => {
        const next = await api();
        return next.cursor > cursor && next;
      }, "an advance did not land");
      const order = state.orders.at(-1);
      if (order.status !== "pending") break;
      if ((order.filledLots ?? 0) > 0) progress = order;
      else await page.waitForTimeout(1100);
    }
    if (!progress) fail(where, `the ${lots}-lot order on ${thin.code} never waited with lots counted (${state.orders.at(-1).status})`);
    else {
      const want = `已累計 ${progress.filledLots}／${lots} 張`;
      await until(async () => clean(await pending.locator(".sim-progress").textContent()) === want, `the ticket does not show "${want}"`).catch((error) => fail(where, error.message));
      await page.screenshot({ path: `${out}/1366x900-progress.png` });
      await page.locator(".td-ledger").getByRole("button", { name: /^委託/ }).click();
      const ledger = clean(await page.locator(".td-ledger").textContent());
      if (!ledger.includes(want)) fail(where, `the 委託 tab does not show "${want}"`);
      await page.screenshot({ path: `${out}/1366x900-progress-ledger.png` });
      results.progress = { code: thin.code, lots, counted: progress.filledLots, cursor: state.cursor, text: want };
      // Advance until it fills (or 10:30 cancels it): a fill is reported at the average as the desk writes it.
      for (let step = 0; step < 90 && state.orders.at(-1).status === "pending" && state.cursor < 90; step++) {
        await page.waitForTimeout(1100);
        const cursor = state.cursor;
        await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
        state = await until(async () => {
          const next = await api();
          return next.cursor > cursor && next;
        }, "an advance did not land");
      }
      const order = state.orders.at(-1);
      results.outcome = { status: order.status, reason: order.reason ?? null, price: order.price ?? null };
      if (order.status === "filled") {
        const fill = state.fills.find((item) => item.id === order.id);
        const text = `成交 · 買進 ${thin.name} ${lots} 張 @ ${fillPriceText(fill.price)}`;
        await until(async () => (await reportsText()).includes(text), `委託回報 does not read "${text}"`).catch((error) => fail(where, error.message));
        results.outcome.report = text;
        results.outcome.fillMs = fill.ms;
      } else if (order.reason !== "成交量不足") fail(where, `the order ended ${order.status} (${order.reason})`);
      await page.screenshot({ path: `${out}/1366x900-outcome.png` });
    }
  } catch (error) {
    fail(where, error.message.split("\n")[0]);
    await page.screenshot({ path: `${out}/1366x900-orders-stopped.png` }).catch(() => {});
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}/summary.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else console.log("\nAll lot quick-pick checks passed.");
