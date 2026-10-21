// Broker-style desk (2026-10-21 meeting layout) on a disposable classroom, after desk-seed:
// four panes, the real TAIEX (values, replay, no leak), the watch table, left-buy/right-sell lightning,
// the large-order confirmation, order reports beside the ticket, the plan screen without NaN, and the phone
// flow (TAIEX in 自選, index view, display book handing a price to 下單).
// Usage: node scripts/qa/desk-broker.mjs <baseUrl> <label> [--strict]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "broker", ...flags] = process.argv.slice(2);
const strict = flags.includes("--strict");
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const OTHER_LESSON = "morning-20261005-v1-bd566804b809";
const api = async (query = "") => (await (await fetch(`${base}/api/morning${query}`)).json()).state;
const formatIndex = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (text) => (text ?? "").replace(/\s+/g, " ").trim();
async function until(check, message, timeout = 6000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
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
}
const pane = (page, name) => page.locator(`.td-workbench [data-pane="${name}"]`).first();
async function clearPending(page) {
  const state = await api();
  if (state?.orders.some((order) => order.status === "pending")) {
    await page.getByRole("button", { name: "撤回委託" }).click({ timeout: 4000 });
    await until(async () => !(await api()).orders.some((order) => order.status === "pending"), "pending order not withdrawn");
  }
}
async function selectStock(page, code) {
  await page.locator(`.td-watch-row[data-code="${code}"]`).click({ timeout: 4000 });
  await page.waitForTimeout(250);
}
async function setLots(page, target) {
  const output = page.locator("#sim-lots-value");
  for (let guard = 0; guard < 4; guard++) {
    const now = Number((await output.textContent({ timeout: 4000 }))?.replace(/\D/g, ""));
    if (now === target) return;
    await page.getByRole("button", { name: now < target ? "增加一張" : "減少一張" }).click();
  }
  throw new Error(`could not set ${target} lots`);
}
const lightning = (page) => page.getByRole("switch", { name: "閃電即送" });
async function arm(page, on) {
  const control = lightning(page);
  if ((await control.getAttribute("aria-checked", { timeout: 4000 })) !== String(on)) await control.click();
  await until(async () => (await control.getAttribute("aria-checked")) === String(on), `lightning did not turn ${on ? "on" : "off"}`);
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));

/* ── desktop 1440×900 ── */
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desktop.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
await desktop.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 }).catch(() => {});
await desktop.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
await rest(desktop);

await check("1-four-panes", async () => {
  const names = ["watch", "index", "center", "book", "ticket", "ledger"];
  const rects = {};
  for (const name of names) {
    const locator = pane(desktop, name);
    if (!(await locator.isVisible().catch(() => false))) throw new Error(`pane ${name} not visible`);
    rects[name] = await locator.boundingBox();
  }
  if (Math.abs(rects.watch.y - rects.index.y) > 2) throw new Error("watch and index are not on one row");
  for (const left of ["center", "book"])
    for (const right of ["ticket", "ledger"])
      if (rects[left].x + rects[left].width > rects[right].x + 1) throw new Error(`${left} reaches into ${right}`);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = rects[names[i]];
      const b = rects[names[j]];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 1 && overlapY > 1) throw new Error(`${names[i]} overlaps ${names[j]}`);
    }
  const scroll = await desktop.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - innerHeight,
  }));
  if (scroll.x > 0 || scroll.y > 1) throw new Error(`page scrolls ${JSON.stringify(scroll)}`);
  return Object.fromEntries(Object.entries(rects).map(([name, r]) => [name, [r.x, r.y, r.width, r.height].map(Math.round)]));
});

await check("2-index-real-values", async () => {
  const state = await api();
  if (!state?.index?.bars?.length) throw new Error("no index in /api/morning");
  const shown = clean(await desktop.locator(".td-index-value").first().textContent({ timeout: 4000 }));
  const expected = formatIndex(state.index.bars.at(-1).c);
  if (shown !== expected) throw new Error(`index shows ${shown}, expected ${expected}`);
  await clearPending(desktop);
  const before = state.index.bars.at(-1).c;
  await desktop.getByRole("button", { name: "前進 1 分鐘" }).click({ timeout: 4000 });
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(clean(await desktop.locator(".td-index-value").first().textContent()));
    await desktop.waitForTimeout(150);
  }
  await rest(desktop);
  const after = await api();
  const minute = after.index.bars.at(-1);
  const allowed = new Set([formatIndex(before), ...minute.p.map(formatIndex)]);
  const stray = samples.filter((value) => !allowed.has(value));
  if (stray.length) throw new Error(`replayed values not in the minute's real points: ${stray.join(", ")}`);
  const resting = clean(await desktop.locator(".td-index-value").first().textContent());
  if (resting !== formatIndex(minute.c)) throw new Error(`rests on ${resting}, expected ${formatIndex(minute.c)}`);
  return { samples: [...new Set(samples)].length, rest: resting };
});

await check("3-no-leak", async () => {
  const state = await api();
  if (state.index.bars.length !== state.cursor) throw new Error(`${state.index.bars.length} index bars at cursor ${state.cursor}`);
  return { cursor: state.cursor, bars: state.index.bars.length };
});

await check("4-watch-table", async () => {
  const codes = await desktop.locator(".td-watch-row").evaluateAll((rows) => rows.map((row) => row.dataset.code));
  if (codes.length !== 6 || codes[0] !== "TAIEX") throw new Error(`rows ${JSON.stringify(codes)}`);
  const indexText = clean(await desktop.locator('.td-watch-row[data-code="TAIEX"]').textContent());
  const indexValue = clean(await desktop.locator(".td-index-value").first().textContent());
  if (!indexText.includes(indexValue)) throw new Error(`TAIEX row "${indexText}" lacks ${indexValue}`);
  await selectStock(desktop, "2317");
  if (!clean(await desktop.locator("#morning-practice-title").textContent()).includes("鴻海")) throw new Error("2317 row did not select 鴻海");
  await desktop.locator('.td-watch-row[data-code="TAIEX"]').click();
  await desktop.waitForTimeout(250);
  if (!clean(await desktop.locator("#morning-practice-title").textContent()).includes("鴻海")) throw new Error("TAIEX row changed the selected stock");
  // Not a toggle that never toggles: a plain button whose click moves focus to the 大盤 pane it points at.
  const pressed = await desktop.locator('.td-watch-row[data-code="TAIEX"]').getAttribute("aria-pressed");
  if (pressed !== null) throw new Error(`the desktop TAIEX row is a toggle (aria-pressed=${pressed})`);
  if (!(await desktop.evaluate(() => Boolean(document.activeElement?.closest('[data-pane="index"]')))))
    throw new Error("the TAIEX row did not move focus to the 大盤 pane");
  return codes;
});

await check("5-lightning-left-buy", async () => {
  await clearPending(desktop);
  await selectStock(desktop, "2317");
  await arm(desktop, true);
  const cell = desktop.locator('.td-book-cell[data-side="bid"][data-level="1"]');
  // Armed, the book holds still under the pointer; holding must not move a single cell, or a click lands on
  // another price than the one aimed at.
  await desktop.mouse.move(5, 5);
  await desktop.waitForTimeout(300);
  const away = await cell.boundingBox();
  const head = await desktop.locator(".td-book-head").boundingBox();
  await desktop.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
  await desktop.waitForTimeout(300);
  const over = await cell.boundingBox();
  if (Math.abs(away.y - over.y) > 0.5 || Math.abs(away.x - over.x) > 0.5)
    throw new Error(`hovering the armed book moved 買1 from ${away.x},${away.y} to ${over.x},${over.y}`);
  const price = Number(await cell.getAttribute("data-price", { timeout: 4000 }));
  const before = (await api()).orders.length;
  await cell.click();
  const order = await until(async () => {
    const state = await api();
    return state.orders.length > before && state.orders.at(-1);
  }, "no lightning order from the left column");
  if (order.side !== "buy" || order.limitPrice !== price || order.entryMode !== "lightning")
    throw new Error(`left column sent ${order.side} @ ${order.limitPrice} (${order.entryMode}), expected buy @ ${price}`);
  await clearPending(desktop);
  await arm(desktop, false);
  return { side: order.side, price };
});

await check("6-right-column-needs-holdings", async () => {
  await selectStock(desktop, "2454");
  const state = await api();
  if (state.positions.some((position) => position.code === "2454")) return "skipped: 2454 is held";
  const asks = desktop.locator('.td-book-cell[data-side="ask"]');
  const count = await asks.count();
  if (!count) throw new Error("no ask cells");
  const enabled = await asks.evaluateAll((cells) => cells.filter((cell) => !cell.disabled).length);
  if (enabled) throw new Error(`${enabled} ask cells clickable without holdings`);
  return { askCells: count };
});

await check("7-large-order", async () => {
  await clearPending(desktop);
  const state = await api();
  const tsmc = state.bars["2330"].at(-1).c * 1000;
  const lotsLarge = [1, 2, 3].find((lots) => tsmc * lots >= 0.5 * state.cash);
  if (!lotsLarge) throw new Error("no 台積電 size reaches half the cash");
  await selectStock(desktop, "2330");
  await desktop.getByRole("button", { name: "市價" }).first().click();
  await setLots(desktop, lotsLarge);
  await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
  await desktop.locator(".sim-large").waitFor({ timeout: 4000 });
  const send = desktop.getByRole("button", { name: "確認送出模擬買進" });
  if (await send.isEnabled()) throw new Error("large order can be sent before ticking the confirmation");
  // The send button is pinned over the card when it runs long: disabled, it must still hide what is under it.
  const opacity = await send.evaluate((button) => getComputedStyle(button).opacity);
  if (opacity !== "1") throw new Error(`the disabled pinned send button is see-through (opacity ${opacity})`);
  await desktop.locator("#sim-large-ack").check();
  if (!(await send.isEnabled())) throw new Error("ticking the confirmation did not enable sending");
  await desktop.getByRole("button", { name: "返回修改" }).click();
  // Small: one lot of 鴻海.
  await selectStock(desktop, "2317");
  await setLots(desktop, 1);
  await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
  await desktop.locator(".sim-confirm").waitFor({ timeout: 4000 });
  if (await desktop.locator(".sim-large").count()) throw new Error("a small order shows the large-order block");
  await desktop.getByRole("button", { name: "返回修改" }).click();
  // Reopening a large order starts unticked.
  await selectStock(desktop, "2330");
  await setLots(desktop, lotsLarge);
  await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
  await desktop.locator("#sim-large-ack").waitFor({ timeout: 4000 });
  if (await desktop.locator("#sim-large-ack").isChecked()) throw new Error("a reopened large order starts ticked");
  await desktop.getByRole("button", { name: "返回修改" }).click();
  // Same stock, so the ticket is not remounted: tick a large size, go back to a smaller one (no block), then
  // back to the large size, which starts unticked again.
  {
    const now = await api();
    let sizes = null;
    for (const symbol of ["2308", "2382", "2317", "2454", "2330"]) {
      const lot = now.bars[symbol].at(-1).c * 1000;
      for (const [small, large] of [[1, 2], [1, 3], [2, 3]])
        if (!sizes && lot * small < 0.5 * now.cash && lot * large >= 0.5 * now.cash) sizes = { symbol, small, large };
    }
    if (!sizes) throw new Error("no stock has both a small and a large size for the seeded cash");
    await selectStock(desktop, sizes.symbol);
    await desktop.getByRole("button", { name: "市價" }).first().click();
    await setLots(desktop, sizes.large);
    await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
    await desktop.locator("#sim-large-ack").check();
    await desktop.getByRole("button", { name: "返回修改" }).click();
    await setLots(desktop, sizes.small);
    await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
    await desktop.locator(".sim-confirm").waitFor({ timeout: 4000 });
    if (await desktop.locator(".sim-large").count())
      throw new Error(`${sizes.small} lot(s) of ${sizes.symbol} still show the large-order block`);
    await desktop.getByRole("button", { name: "返回修改" }).click();
    await setLots(desktop, sizes.large);
    await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
    await desktop.locator("#sim-large-ack").waitFor({ timeout: 4000 });
    if (await desktop.locator("#sim-large-ack").isChecked())
      throw new Error(`the large size of ${sizes.symbol} came back ticked after a smaller review`);
    await desktop.getByRole("button", { name: "返回修改" }).click();
    // Back to 台積電 for the lightning case below.
    await selectStock(desktop, "2330");
  }
  // Lightning does not send a large order: it opens the confirm card.
  await setLots(desktop, lotsLarge);
  await arm(desktop, true);
  const before = (await api()).orders.length;
  await desktop.locator('.td-book-cell[data-side="bid"][data-level="1"]').click();
  await desktop.locator(".sim-large").waitFor({ timeout: 4000 });
  await desktop.waitForTimeout(600);
  if ((await api()).orders.length !== before) throw new Error("lightning sent a large order without confirmation");
  await desktop.getByRole("button", { name: "返回修改" }).click();
  await arm(desktop, false);
  await setLots(desktop, 1);
  return { lotsLarge };
});

await check("8-order-reports", async () => {
  await clearPending(desktop);
  await selectStock(desktop, "2317");
  await setLots(desktop, 1);
  await desktop.getByRole("button", { name: "市價" }).first().click();
  await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
  await desktop.getByRole("button", { name: "確認送出模擬買進" }).click();
  await until(async () => /委託成功/.test(await desktop.locator('.sim-reports li[data-tone="sent"]').first().textContent().catch(() => "")), "no 委託成功 report");
  await desktop.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await until(async () => (await desktop.locator('.sim-reports li[data-tone="filled"]').count()) > 0, "no 成交 report");
  await rest(desktop);
  // A send the server refuses: more 台積電 than the cash allows.
  const state = await api();
  const tsmc = state.bars["2330"].at(-1).c * 1000;
  if (tsmc * 3 <= state.cash) return "skipped: cash covers 3 lots";
  await selectStock(desktop, "2330");
  await setLots(desktop, 3);
  await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
  if (await desktop.locator("#sim-large-ack").isVisible().catch(() => false)) await desktop.locator("#sim-large-ack").check();
  await desktop.getByRole("button", { name: "確認送出模擬買進" }).click();
  await until(async () => /資金不足/.test(await desktop.locator('.sim-reports li[data-tone="failed"]').first().textContent().catch(() => "")), "no failed report");
  await desktop.getByRole("button", { name: /重新載入進度/ }).first().click({ timeout: 4000 }).catch(() => {});
  await desktop.waitForTimeout(600);
  await clearPending(desktop);
  await selectStock(desktop, "2317");
  await setLots(desktop, 1);
  await desktop.getByRole("button", { name: "市價" }).first().click();
  await desktop.getByRole("button", { name: /^核對模擬買進/ }).click();
  await desktop.locator(".sim-confirm").waitFor({ timeout: 4000 });
  const failedBefore = await desktop.locator('.sim-reports li[data-tone="failed"]').count();
  const run = await api();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, run.nextAdvanceAt - Date.now()) + 60));
  const moved = await fetch(`${base}/api/morning`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action: "advance", id: run.id, expectedRevision: run.revision, requestId: crypto.randomUUID() }),
  });
  if (moved.status !== 200) throw new Error(`could not move the run on from another "tab" (${moved.status})`);
  await desktop.getByRole("button", { name: "確認送出模擬買進" }).click();
  await until(
    async () => (await desktop.locator('.sim-reports li[data-tone="failed"]').count()) > failedBefore,
    "a send the server refused with 409 left no 送出失敗 report",
  );
  return "pass";
});

await check("11-plan-chip", async () => {
  const chip = desktop.locator(".td-plan-chip");
  const label = clean(await chip.textContent({ timeout: 4000 }));
  if (!label.startsWith("本輪計畫：")) throw new Error(`the chip reads "${label}"`);
  await chip.click();
  const plan = desktop.locator("#td-resources details", {
    has: desktop.locator("summary", { hasText: "本輪作戰計畫" }),
  });
  await plan.waitFor({ timeout: 4000 });
  if (!(await plan.evaluate((element) => element.open))) throw new Error("the chip opened 教材 with the plan collapsed");
  if (!(await plan.isVisible())) throw new Error("the plan section is not in view");
  await desktop.locator("#td-resources .td-resources-head button").first().click().catch(() => {});
  return label;
});

await desktop.screenshot({ path: `${out}desktop-1440.png` });
await desktop.close();

await check("9-plan-screen", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/morning?lesson=${OTHER_LESSON}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const state = await api(`?lesson=${OTHER_LESSON}`);
  if (state) {
    await page.close();
    return "skipped: the seeded student already has a 10/05 run";
  }
  const text = clean(await pane(page, "index").textContent({ timeout: 4000 }));
  const body = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${out}plan-1440.png` });
  await page.close();
  if (!text.includes("開始練習後顯示大盤")) throw new Error(`index pane says "${text.slice(0, 40)}"`);
  if (/NaN/.test(body)) throw new Error("NaN on the plan screen");
  return "pass";
});

/* ── phone 390×844 ── */
await check("10-phone", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
  await page.locator("nav.td-dock").waitFor({ timeout: 20000 });
  const dock = (name) => page.locator("nav.td-dock").getByRole("button", { name: new RegExp(`^${name}`) });
  await dock("自選").click();
  const first = await page.locator(".td-watch-row").first().getAttribute("data-code", { timeout: 4000 });
  if (first !== "TAIEX") throw new Error(`first 自選 row is ${first}`);
  await page.locator('.td-watch-row[data-code="TAIEX"]').click();
  await page.locator(".td-index-value").first().waitFor({ timeout: 4000 });
  await dock("下單").click();
  await page.getByText("指數不能下單，請選一檔股票").waitFor({ timeout: 4000 });
  await dock("自選").click();
  await page.locator('.td-watch-row[data-code="2330"]').click();
  await dock("行情").click();
  if (await page.locator(".td-flash").count()) throw new Error("the 行情 book offers lightning");
  const cell = page.locator('.td-book-cell[data-side="bid"][data-level="1"]');
  await cell.waitFor({ timeout: 4000 });
  const price = await cell.getAttribute("data-price");
  await cell.click();
  await until(async () => (await dock("下單").getAttribute("aria-pressed")) === "true", "the price did not open 下單");
  const buyPressed = await page.locator('[aria-label="模擬買賣方向"] button[data-side="buy"]').getAttribute("aria-pressed");
  const limit = await page.locator("#morning-limit-price").inputValue({ timeout: 4000 });
  await page.screenshot({ path: `${out}phone-390.png` });
  const problems = [];
  if (buyPressed !== "true") problems.push("買進 not chosen after tapping a bid price");
  if (Number(limit) !== Number(price)) problems.push(`limit ${limit}, tapped ${price}`);
  // Switching the ticket to another stock does not carry 台積電's price over.
  await page.locator('select[aria-label="下單商品"]').selectOption("2317");
  await page.waitForTimeout(400);
  const carried = await page.locator("#morning-limit-price").inputValue({ timeout: 800 }).catch(() => null);
  if (carried !== null && Number(carried) === Number(price))
    problems.push(`鴻海's ticket kept 台積電's tapped price ${carried}`);
  // A waiting order stays visible and can be withdrawn while 行情 shows the index.
  await page.getByRole("button", { name: "市價", exact: true }).click();
  await page.getByRole("button", { name: /^核對模擬買進/ }).click();
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await page.getByText("委託已送出 · 等待撮合").first().waitFor({ timeout: 6000 });
  await dock("自選").click();
  await page.locator('.td-watch-row[data-code="TAIEX"]').click();
  await dock("下單").click();
  await page.getByText("指數不能下單，請選一檔股票").waitFor({ timeout: 4000 });
  if (!(await page.getByText("委託已送出 · 等待撮合").first().isVisible()))
    problems.push("the waiting order disappears from 下單 while the index is shown");
  else {
    await page.getByRole("button", { name: "撤回委託" }).first().click();
    await until(async () => (await api()).orders.at(-1)?.status === "cancelled", "the waiting order was not withdrawn");
  }
  await page.close();
  if (problems.length) throw new Error(problems.join("; "));
  return { price };
});

await browser.close();
writeFileSync(`${out}broker.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  if (strict) process.exitCode = 1;
} else console.log("All broker-desk checks passed.");
