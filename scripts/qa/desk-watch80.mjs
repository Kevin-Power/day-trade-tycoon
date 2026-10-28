// 自選報價 with a long list (the default list of a radar day, 60-70 stocks; up to 80 are allowed): the table scrolls in
// place under its sticky title bar, column names and TAIEX row, and it paints a 江波圖 only for the rows near the
// visible part. Needs a running desk-server whose newest lesson day has a default 自選 of 40+ stocks (Task 16's
// 70-stock fixture), and an owner session (the server's own proxy has one). It starts a run on that default list,
// plays a few minutes so the rows have bars, then checks at every size:
//   - the table scrolls (its content is taller than the table) and is no taller than the layout allows (desktops:
//     the top row stays near a quarter of the screen; tablets, phones and 大字: the larger of half the screen and
//     the sticky block plus five rows, ruling R9, and exactly that tall when the list is long);
//   - scrolled to the bottom, the bars and the TAIEX row are still in view, and the last row sits below them;
//   - a mini is painted (`data-painted`) for every row within a row of the visible part and for no other row: not
//     at the top of the list, not at the bottom, and none in between;
//   - the table and the page have no sideways scroll (1366x900, 1200x700, 820x900, 375x812, 320x700, both 大字);
//   - the title bar says where the list came from (the server's note), with its detail on the next line;
//   - the chosen stock stays chosen and in view: after it is picked far down the list, when its page is opened
//     again (phones), after the lesson moves a minute (no scroll jump), and when it is chosen elsewhere (the chart's
//     stock menu);
//   - desktops: the ticket, its send button and the ledger are inside the first screen, and the page does not scroll.
//   - no row's columns run into each other (name, price, change, mini: the text as drawn, an ellipsis counted where it
//     cuts), at the top and the bottom of the list; 大字 at 320px is the tightest (a screenshot of the table each size).
// Then it gives the run up and starts one on five stocks: on tablets, phones and 大字 (820x900, 375x812, 320x700, both
// 大字) a list of five stocks or fewer does not scroll at all (R9), every row is whole in view, nothing scrolls
// sideways and no columns run into each other. That run is given up at the end, so no run is left open.
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
    // Columns of a row that run into each other (name, price, change, mini, left to right): the text as drawn, cut
    // where an ancestor clips it (an ellipsis), and the mini's box. Checked on every row, the TAIEX's too.
    const shown = (cell) => {
      if (cell.tagName === "CANVAS") {
        const box = cell.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }
      let left = Infinity;
      let right = -Infinity;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        let clip = { left: -Infinity, right: Infinity };
        for (let up = node.parentElement; up && up !== cell.parentElement; up = up.parentElement) {
          if (getComputedStyle(up).overflowX === "visible") continue;
          const box = up.getBoundingClientRect();
          clip = { left: Math.max(clip.left, box.left), right: Math.min(clip.right, box.right) };
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width) continue;
          left = Math.min(left, Math.max(rect.left, clip.left));
          right = Math.max(right, Math.min(rect.right, clip.right));
        }
      }
      return right === -Infinity ? null : { left, right };
    };
    const overlaps = [];
    for (const row of table.querySelectorAll(".td-watch-row")) {
      const cells = [...row.children]
        .filter((cell) => !cell.classList.contains("sr-only") && cell.getBoundingClientRect().width > 0)
        .map((cell) => ({ name: cell.className.split(" ").at(-1) || cell.tagName, box: shown(cell) }))
        .filter((cell) => cell.box);
      for (let i = 1; i < cells.length; i++)
        if (cells[i - 1].box.right > cells[i].box.left + 0.5)
          overlaps.push(`${row.dataset.code} ${cells[i - 1].name}→${cells[i].name} by ${(cells[i - 1].box.right - cells[i].box.left).toFixed(1)}px`);
    }
    return {
      overlaps,
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
    // Layout limits (R9): a table on any layout but a desktop is as tall as the larger of half the screen and the
    // sticky block plus five rows (a long list fills it); the desktop's pane (the grid's top row) stays near a
    // quarter of the screen however many stocks there are.
    if (!desktop) {
      const cap = Math.max(c.height * 0.5, top.fixedBottom + 5 * rowH);
      report.cap = Math.round(cap);
      if (top.box.height > cap + 1) fail(c.name, `the table is ${Math.round(top.box.height)}px tall, over its cap of ${Math.round(cap)}px (half of ${c.height}px, or the bars ${Math.round(top.fixedBottom)}px + 5 rows of ${rowH}px)`);
      if (top.box.height < cap - 2) fail(c.name, `a ${top.rows.length}-stock list fills ${Math.round(top.box.height)}px, short of its cap of ${Math.round(cap)}px`);
    }
    if (desktop && top.box.height > c.height * 0.4) fail(c.name, `the top row is ${Math.round(top.box.height)}px of ${c.height}px: the table's content set it`);
    // The columns stay apart (大字 at 320px was the tightest unverified case: prices against names and changes).
    report.overlaps = top.overlaps.length;
    if (top.overlaps.length) fail(c.name, `自選 columns run into each other: ${top.overlaps.slice(0, 4).join("; ")}`);
    await page.screenshot({ path: `${out}${c.name}-top.png` });
    await page.locator(".td-watch-table").screenshot({ path: `${out}${c.name}-table.png` });

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
    if (bottom.overlaps.length) fail(c.name, `bottom: 自選 columns run into each other: ${bottom.overlaps.slice(0, 4).join("; ")}`);
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
// ── Five stocks or fewer: the touch layouts show the whole list without scrolling (R9) ──────────────────────────────
{
  const current = await call();
  if (current.state && !current.state.completed)
    await call({ action: "abandon", id: current.state.id, expectedRevision: current.state.revision });
  const picked = (await call()).picker?.defaults?.slice(0, 5);
  if (!picked || picked.length < 5) throw new Error("the newest day's picker has no five default stocks for the short-list check");
  let few = await call({
    action: "start",
    codes: picked,
    plan: {
      exerciseId: "first-order",
      focusCode: picked[0],
      bias: "observe",
      reason: "驗收五檔以內的自選表不捲動。",
      entry: "只看自選表，不下單。",
      stop: "完成檢查後停止。",
    },
  });
  for (let minute = few.state.cursor; minute < 6; minute++) {
    await new Promise((done) => setTimeout(done, Math.max(0, few.state.nextAdvanceAt - Date.now()) + 30));
    few = await call({ action: "advance", id: few.state.id, expectedRevision: few.state.revision });
  }
  for (const c of CASES.filter((item) => item.width < 1200)) {
    const name = `few-${c.name}`;
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
    if (c.senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
    const page = await context.newPage();
    const report = {};
    try {
      await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("main", { timeout: 20000 });
      await page.waitForTimeout(1500);
      await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 2000 }).catch(() => {});
      await openWatch(page);
      await page.waitForTimeout(900);
      const view = await look(page);
      const rowH = rowHeightOf(view);
      report.layout = view.layout;
      report.rows = view.rows.length;
      report.tableHeight = Math.round(view.box.height);
      report.content = view.scrollHeight;
      report.bars = Math.round(view.fixedBottom);
      if (view.rows.length !== 5) fail(name, `${view.rows.length} 自選 rows, expected 5`);
      if (view.scrollHeight > view.clientHeight + 1) fail(name, `a 5-stock list scrolls: ${view.scrollHeight}px of content in ${view.clientHeight}px`);
      const last = view.rows.at(-1);
      if (!visible(last, view)) fail(name, `the 5th row is not whole in view (bottom ${Math.round(last.bottom)}px, table ${view.clientHeight}px)`);
      if (view.box.height > Math.max(c.height * 0.5, view.fixedBottom + 5 * rowH) + 1) fail(name, `the table is ${Math.round(view.box.height)}px tall, over its cap`);
      if (view.pageOverflowX > 0) fail(name, `the page scrolls sideways by ${view.pageOverflowX}px`);
      if (view.tableOverflowX > 1) fail(name, `the table scrolls sideways by ${view.tableOverflowX}px`);
      if (view.overlaps.length) fail(name, `自選 columns run into each other: ${view.overlaps.slice(0, 4).join("; ")}`);
      await page.screenshot({ path: `${out}${name}.png` });
    } catch (error) {
      fail(name, error.message.split("\n")[0]);
      await page.screenshot({ path: `${out}${name}-stopped.png` }).catch(() => {});
    }
    results[name] = report;
    await context.close();
  }
  // Leave no run open: the scripts after this one start their own.
  const open = await call();
  if (open.state && !open.state.completed)
    await call({ action: "abandon", id: open.state.id, expectedRevision: open.state.revision });
}
await browser.close();

writeFileSync(`${out}watch80.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("自選 with a long list, and with five stocks: all checks pass.");
