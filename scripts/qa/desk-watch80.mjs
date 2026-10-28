// 自選報價 with a long list (the default list of a radar day, 60-70 stocks; up to 80 are allowed): the table scrolls in
// place under its sticky title bar, column names and TAIEX row, and it paints a 江波圖 only for the rows near the
// visible part. Needs a running desk-server whose newest lesson day has a default 自選 of 40+ stocks (Task 16's
// 70-stock fixture), and an owner session (the server's own proxy has one). It starts a run on that default list,
// plays a few minutes so the rows have bars, then checks at every size:
//   - the table scrolls (its content is taller than the table) and is no taller than the layout allows (desktops:
//     the top row stays near a quarter of the screen; others: at most half of it);
//   - scrolled to the bottom, the bars and the TAIEX row are still in view, and the last row sits below them;
//   - a mini is painted (`data-painted`) for every row within a row of the visible part and for no other row: not
//     at the top of the list, not at the bottom, and none in between;
//   - the table and the page have no sideways scroll (1366x900, 1200x700, 820x900, 375x812, 320x700, both 大字);
//   - the title bar says where the list came from (the server's note), with its detail on the next line;
//   - the chosen stock stays chosen and in view: after it is picked far down the list, when its page is opened
//     again (phones), after the lesson moves a minute (no scroll jump), and when it is chosen elsewhere (the chart's
//     stock menu);
//   - desktops: the ticket, its send button and the ledger are inside the first screen, and the page does not scroll.
// Usage: node scripts/qa/desk-watch80.mjs [label] [proxyPort]   (proxyPort defaults to 18811, as desk-server's)
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [label = "watch80", proxyPort = "18811"] = process.argv.slice(2);
const statePath = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url));
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (!state.appBase) throw new Error("Restart desk-server.mjs: its state file has no appBase");
const base = `http://127.0.0.1:${proxyPort}`;
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const MIN_STOCKS = 40;
const FAR = 55; // the stock picked far down the list (0-based)
const failures = [];
const results = {};
const fail = (name, message) => failures.push(`${name}: ${message}`);

// ── The run: the newest day's default list, a few minutes in ───────────────────────────────────────────────────────
async function call(action) {
  const response = await fetch(
    base + "/api/morning",
    action
      ? {
          method: "POST",
          headers: { origin: state.appBase, "content-type": "application/json" },
          body: JSON.stringify({ ...action, requestId: randomUUID() }),
        }
      : {},
  );
  if (response.status !== 200) throw new Error(`/api/morning ${action?.action ?? "GET"}: HTTP ${response.status}`);
  return response.json();
}
let data = await call();
if (!data.state || data.state.completed) {
  const codes = data.picker?.defaults ?? data.catalog.symbols.map((symbol) => symbol.code);
  if (codes.length < MIN_STOCKS)
    throw new Error(`The newest day's default 自選 has ${codes.length} stocks; this check needs ${MIN_STOCKS}+ (Task 16's 70-stock fixture).`);
  data = await call({
    action: "start",
    codes,
    plan: {
      exerciseId: "first-order",
      focusCode: codes[0],
      bias: "observe",
      reason: "驗收自選表放到 80 列。",
      entry: "只看自選表，不下單。",
      stop: "完成檢查後停止。",
    },
  });
}
if ((data.state.codes ?? data.catalog.symbols).length < MIN_STOCKS)
  throw new Error(`The open run has ${(data.state.codes ?? data.catalog.symbols).length} stocks; this check needs ${MIN_STOCKS}+. Abandon it, or use a fresh desk-server.`);
for (let minute = data.state.cursor; minute < 12; minute++) {
  await new Promise((done) => setTimeout(done, Math.max(0, data.state.nextAdvanceAt - Date.now()) + 30));
  data = await call({ action: "advance", id: data.state.id, expectedRevision: data.state.revision });
}
const note = data.catalog.note ?? null;
const codes = data.catalog.symbols.map((symbol) => symbol.code);
results.run = { stocks: codes.length, cursor: data.state.cursor, note };

// ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────────
const CASES = [
  { name: "1366x900", width: 1366, height: 900, senior: false },
  { name: "1200x700", width: 1200, height: 700, senior: false },
  { name: "820x900", width: 820, height: 900, senior: false },
  { name: "375x812", width: 375, height: 812, senior: false },
  { name: "320x700", width: 320, height: 700, senior: false },
  { name: "375x812-senior", width: 375, height: 812, senior: true },
  { name: "320x700-senior", width: 320, height: 700, senior: true },
];

// What the table looks like now, in the page: its box, the bars on top, and every stock row with its mini.
const look = (page) =>
  page.evaluate(() => {
    const table = document.querySelector(".td-watch-table");
    const box = table.getBoundingClientRect();
    const fixed = table.querySelector(".td-watch-fixed").getBoundingClientRect();
    const taiex = table.querySelector('.td-watch-row[data-code="TAIEX"]').getBoundingClientRect();
    const rows = [...table.querySelectorAll(".td-watch-rows .td-watch-row")].map((row) => {
      const rect = row.getBoundingClientRect();
      const canvas = row.querySelector("canvas.td-mini");
      return {
        code: row.dataset.code,
        top: rect.top - box.top,
        bottom: rect.bottom - box.top,
        pressed: row.getAttribute("aria-pressed") === "true",
        canvas: Boolean(canvas),
        painted: Boolean(canvas?.dataset.painted),
      };
    });
    const style = getComputedStyle(table);
    return {
      layout: document.querySelector(".trading-desk")?.dataset.layout,
      box: { height: box.height, top: box.top },
      scrollTop: table.scrollTop,
      scrollHeight: table.scrollHeight,
      clientHeight: table.clientHeight,
      overflowY: style.overflowY,
      fixedTop: fixed.top - box.top,
      fixedBottom: fixed.bottom - box.top,
      taiexTop: taiex.top - box.top,
      taiexBottom: taiex.bottom - box.top,
      inViewport: fixed.top >= 0 && fixed.bottom <= innerHeight + 1,
      rows,
      innerHeight,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableOverflowX: table.scrollWidth - table.clientWidth,
    };
  });
const rowHeightOf = (view) => view.rows[0].bottom - view.rows[0].top;
// The minis are painted for the rows within one row of the table's scrollport (the bars sit over its top, and rows
// under them count). Rows within `slack` px of that edge may go either way, so only clear cases are checked.
const slack = 4;
const mustPaint = (row, view) => row.bottom > -rowHeightOf(view) + slack && row.top < view.clientHeight + rowHeightOf(view) - slack;
const mustNotPaint = (row, view) => row.bottom < -rowHeightOf(view) - slack || row.top > view.clientHeight + rowHeightOf(view) + slack;
// In view: whole, below the bars and above the table's bottom.
const visible = (row, view) => row.top >= view.fixedBottom - 1 && row.bottom <= view.clientHeight + 1;

async function scrollTable(page, to) {
  await page.evaluate((target) => {
    const table = document.querySelector(".td-watch-table");
    table.scrollTop = target === "bottom" ? table.scrollHeight : target;
  }, to);
  await page.waitForTimeout(900);
}

const dock = (page) => page.locator("nav.td-dock");
async function openWatch(page) {
  if (await dock(page).count()) await dock(page).getByRole("button", { name: /^自選/ }).click();
  await page.locator(".td-watch-table").waitFor({ timeout: 8000 });
  await page.waitForTimeout(700);
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const c of CASES) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
  if (c.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const report = {};
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
    await openWatch(page);
    await page.waitForTimeout(900);

    // At the top of the list.
    const top = await look(page);
    const rowH = rowHeightOf(top);
    const desktop = top.layout === "desktop";
    report.layout = top.layout;
    report.tableHeight = Math.round(top.box.height);
    report.rows = top.rows.length;
    report.barsHeight = Math.round(top.fixedBottom);
    if (top.rows.length < MIN_STOCKS) fail(c.name, `only ${top.rows.length} 自選 rows`);
    if (!(top.scrollHeight > top.clientHeight + 1 && top.overflowY !== "visible"))
      fail(c.name, `the table does not scroll (content ${top.scrollHeight}px in ${top.clientHeight}px, overflow-y ${top.overflowY})`);
    if (top.pageOverflowX > 0) fail(c.name, `the page scrolls sideways by ${top.pageOverflowX}px`);
    if (top.tableOverflowX > 1) fail(c.name, `the table scrolls sideways by ${top.tableOverflowX}px`);
    // Layout limits: a table on any layout but a desktop is at most half the screen; the desktop's pane (the grid's
    // top row) stays near a quarter of it however many stocks there are.
    if (!desktop && top.box.height > c.height * 0.5 + 1) fail(c.name, `the table is ${Math.round(top.box.height)}px tall, over half of ${c.height}px`);
    if (desktop && top.box.height > c.height * 0.4) fail(c.name, `the top row is ${Math.round(top.box.height)}px of ${c.height}px: the table's content set it`);
    await page.screenshot({ path: `${out}${c.name}-top.png` });

    // The title bar says where the list came from, and nothing about 模擬.
    const head = await page.evaluate(() => {
      const bar = document.querySelector(".td-watch-head");
      const title = document.querySelector(".td-watch-note");
      const detail = document.querySelector(".td-watch-detail");
      return {
        text: bar.textContent,
        title: title?.textContent ?? null,
        titleCut: title ? title.scrollWidth > title.clientWidth + 1 && getComputedStyle(title).whiteSpace !== "nowrap" : null,
        detail: detail?.textContent ?? null,
        detailBelow: detail ? detail.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 1 : null,
        titleLines: bar.firstElementChild.getBoundingClientRect().height,
      };
    });
    report.head = { title: head.title, detail: head.detail };
    if (note) {
      if (head.title !== note.title) fail(c.name, `the title line says 「${head.title}」, not the server's 「${note.title}」`);
      if ((head.detail ?? null) !== (note.detail ?? null)) fail(c.name, `the detail line says 「${head.detail}」, not 「${note.detail}」`);
      if (note.detail && !head.detailBelow) fail(c.name, "the detail is not on the line below the title bar");
    }
    if (head.text.includes("模擬")) fail(c.name, `the title bar still says 模擬 (「${head.text}」)`);
    if (c.width < 768 && head.titleCut) fail(c.name, "the title line is cut off on a phone: it must wrap onto its own line");

    // Painting: a mini for every row near the visible part, none for the rest. First the top of the list…
    const mayBeNear = new Set();
    const checkPaint = (view, where) => {
      for (const row of view.rows) {
        if (!row.canvas) continue;
        if (!mustNotPaint(row, view)) mayBeNear.add(row.code);
        if (mustPaint(row, view) && !row.painted) fail(c.name, `${where}: ${row.code} is within a row of the visible part but its mini is not painted`);
      }
      return view.rows.filter((row) => row.canvas && mustNotPaint(row, view) && row.painted).map((row) => row.code);
    };
    const paintedFar = checkPaint(top, "top");
    if (paintedFar.length) fail(c.name, `top: painted minis far from the visible part: ${paintedFar.slice(0, 5).join(",")}`);
    report.paintedAtTop = top.rows.filter((row) => row.painted).length;

    // …then the bottom: the bars and the TAIEX row stay on top, the last row sits below them, and the rows between
    // (never near the visible part in either position) were never painted.
    await scrollTable(page, "bottom");
    const bottom = await look(page);
    const last = bottom.rows.at(-1);
    report.bottom = { fixedTop: Math.round(bottom.fixedTop), lastBottom: Math.round(last.bottom), clientHeight: bottom.clientHeight };
    if (Math.abs(bottom.fixedTop) > 1) fail(c.name, `scrolled to the bottom, the bars are ${Math.round(bottom.fixedTop)}px from the table's top`);
    if (!bottom.inViewport) fail(c.name, "scrolled to the bottom, the bars are outside the screen");
    if (bottom.taiexTop < bottom.fixedTop - 1 || bottom.taiexBottom > bottom.fixedBottom + 1) fail(c.name, "the TAIEX row left the bars");
    if (!visible(last, bottom)) fail(c.name, `the last row is not fully in view (top ${Math.round(last.top)}, bottom ${Math.round(last.bottom)}, bars end ${Math.round(bottom.fixedBottom)}, table ${bottom.clientHeight})`);
    // Rows painted at the top stay painted: only a row that is far from the visible part now and was never near it
    // before counts as painted wrongly.
    const paintedFarBottom = checkPaint(bottom, "bottom").filter((code) => !mayBeNear.has(code));
    if (paintedFarBottom.length) fail(c.name, `bottom: painted minis far from the visible part: ${paintedFarBottom.slice(0, 5).join(",")}`);
    const between = bottom.rows.filter((row) => row.canvas && !mayBeNear.has(row.code) && mustNotPaint(row, bottom));
    report.neverNear = between.length;
    if (between.length < 10) fail(c.name, `only ${between.length} rows were never near the visible part: the list is too short to prove the rest is not painted`);
    const paintedBetween = between.filter((row) => row.painted);
    if (paintedBetween.length) fail(c.name, `${paintedBetween.length} minis were painted that were never near the visible part (${paintedBetween.slice(0, 5).map((row) => row.code).join(",")})`);
    await page.screenshot({ path: `${out}${c.name}-bottom.png` });
    await scrollTable(page, 0);

    // The chosen stock: picked far down the list, kept chosen and in view.
    const far = codes[FAR];
    await page.locator(`.td-watch-rows .td-watch-row[data-code="${far}"]`).click();
    await page.waitForTimeout(500);
    if (!desktop && c.width < 768) {
      // A phone shows the stock's page; the watch page opened again has it chosen and in view.
      await openWatch(page);
      await page.waitForTimeout(500);
    }
    let picked = await look(page);
    let row = picked.rows.find((item) => item.code === far);
    if (!row?.pressed) fail(c.name, `${far} is not chosen after it was picked`);
    if (!row || !visible(row, picked)) fail(c.name, `${far} is chosen but not in view below the bars (top ${Math.round(row?.top)}, bars end ${Math.round(picked.fixedBottom)})`);
    if (picked.rows.filter((item) => item.pressed).length !== 1) fail(c.name, "not exactly one row is chosen");
    report.pickedScrollTop = Math.round(picked.scrollTop);
    if (c.width >= 768) {
      // The lesson moves a minute: still chosen, and the table does not jump.
      const before = picked.scrollTop;
      const cursor = (await call()).state?.cursor;
      await page.getByRole("button", { name: "前進 1 分鐘" }).click();
      await page.waitForTimeout(2800);
      const after = await look(page);
      row = after.rows.find((item) => item.code === far);
      if (!row?.pressed) fail(c.name, `${far} is no longer chosen after the lesson moved on`);
      if (Math.abs(after.scrollTop - before) > 2) fail(c.name, `the table scrolled from ${Math.round(before)} to ${Math.round(after.scrollTop)} when the lesson moved on`);
      report.advancedFrom = cursor;
      // Chosen elsewhere (the chart's stock menu): the table scrolls to the row, and back to the first.
      const menu = page.locator('select[aria-label="選擇股票"]').first();
      for (const code of [codes.at(-1), codes[0]]) {
        await menu.selectOption(code);
        await page.waitForTimeout(500);
        picked = await look(page);
        row = picked.rows.find((item) => item.code === code);
        if (!row?.pressed) fail(c.name, `${code} chosen in the stock menu is not chosen in the table`);
        if (!row || !visible(row, picked)) fail(c.name, `${code} chosen in the stock menu is not in view in the table (top ${Math.round(row?.top)})`);
      }
    }

    // Desktops: the order area, the ledger and the chart are in the first screen, and the page does not scroll.
    if (desktop) {
      const screen = await page.evaluate(() => {
        const submit = [...document.querySelectorAll("button")].find((el) => (el.textContent ?? "").trim().startsWith("核對模擬"));
        const ledger = document.querySelector(".td-ledger");
        const chart = document.querySelector('.td-chart canvas[role="img"]');
        const main = document.querySelector("main");
        return {
          submitBottom: submit?.getBoundingClientRect().bottom ?? null,
          ledgerBottom: ledger?.getBoundingClientRect().bottom ?? null,
          ledgerHeight: ledger?.getBoundingClientRect().height ?? 0,
          chartHeight: chart?.getBoundingClientRect().height ?? 0,
          documentScroll: document.documentElement.scrollHeight - innerHeight,
          mainScroll: main ? main.scrollHeight - main.clientHeight : 0,
        };
      });
      report.screen = screen;
      if (!(screen.submitBottom !== null && screen.submitBottom <= c.height + 1)) fail(c.name, `the order button is not in the first screen (${screen.submitBottom})`);
      if (!(screen.ledgerBottom !== null && screen.ledgerBottom <= c.height + 1 && screen.ledgerHeight >= 100)) fail(c.name, `the ledger is not in the first screen (bottom ${screen.ledgerBottom}, ${Math.round(screen.ledgerHeight)}px tall)`);
      if (!(screen.chartHeight >= (c.height >= 800 ? 300 : 200))) fail(c.name, `the chart is only ${Math.round(screen.chartHeight)}px tall`);
      if (screen.documentScroll > 1 || screen.mainScroll > 1) fail(c.name, `the page scrolls (document ${screen.documentScroll}px, main ${screen.mainScroll}px)`);
    }
    await page.screenshot({ path: `${out}${c.name}-picked.png` });
    if (pageErrors.length) fail(c.name, `page errors: ${pageErrors.join("; ")}`);
  } catch (error) {
    fail(c.name, error.message.split("\n")[0]);
    await page.screenshot({ path: `${out}${c.name}-stopped.png` }).catch(() => {});
  }
  results[c.name] = report;
  await context.close();
}
await browser.close();

writeFileSync(`${out}watch80.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("自選 with a long list: all checks pass.");
