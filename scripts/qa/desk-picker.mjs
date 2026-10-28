// The lesson picker, 練習紀錄 and 放棄這局 on a running desk-server (③ §7, decisions G and R; 當沖 list design D–F
// and L). Needs Task 16's fixture: a newest day whose picker offers 80+ stocks, and the owner session of the
// server's proxy. Checks:
//   - the picker comes in with the day's default list (the server's `picker.defaults`, by code), with the server's
//     note: its title exactly, and its detail line exactly (or none);
//   - stocks can be removed down to one, and the last one's 移除 is then disabled;
//   - stocks found by code can be added up to 80, and then 「最多 80 檔」 shows and nothing more can be added;
//   - the date menu lists the open days as 「M/D 早盤」, menus and the search field are 16px or more on phones, and
//     nothing scrolls sideways; on phones the start button is still on the plan's first screen;
//   - tap targets: the picker's day menu, stocks button, 移除 / 加入, the 練習紀錄 rows and 放棄這局 / 確定放棄 / 取消
//     are 44px or taller on phones (the day menu and stocks button 48px) and 56px in 大字;
//   - a run started from the picker can be given up (asked first, with ruling R10's words) from the 教材 drawer
//     (desktop) and from 復盤 (phone, 大字), and the picker then opens again on the day's default list, the run listed
//     in 練習紀錄 as 已放棄;
//   - a guest (a fresh visitor through the gate) sees 「預設：成交值前 5 名」 and at most five stocks;
//   - a retired lesson's run opens from 練習紀錄 as text: 「舊課（已停用）」, no chart, and 完成並復盤 / 放棄這局 while
//     unfinished. A classroom with no retired run gets one record and its page answered in the browser
//     (`retired: "mocked"` in the results); the server side of retired runs is covered by morning-retired.test.ts.
// Usage: node scripts/qa/desk-picker.mjs [label] [proxyPort]   (proxyPort defaults to 18811, as desk-server's)
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [label = "picker", proxyPort = "18811"] = process.argv.slice(2);
const statePath = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url));
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (!state.appBase || !state.gateCode) throw new Error("Restart desk-server.mjs: its state file has no appBase/gateCode");
const base = `http://127.0.0.1:${proxyPort}`;
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const MAX = 80;
const FULL = "最多 80 檔";
const GUEST_NOTE = "預設：成交值前 5 名";
const CONFIRM = "確定放棄這局？放棄後不計紀律分數，可以重新選股。";
const RETIRED = "舊課（已停用）";
const RETIRED_LESSON = "morning-20261005-v1-bd566804b809";
const failures = [];
const results = {};
const fail = (name, message) => failures.push(`${name}: ${message}`);

// ── The classroom, through the proxy's owner session ───────────────────────────────────────────────────────────────
async function call(action, lesson) {
  const url = base + "/api/morning" + (lesson ? `?lesson=${encodeURIComponent(lesson)}` : "");
  const response = await fetch(
    url,
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
/** Every unfinished run given up, so the page opens on the newest day's picker. */
async function clearRuns() {
  for (let round = 0; round < 10; round++) {
    const data = await call();
    if (data.unavailable) throw new Error(`the classroom has no daily lessons: ${data.unavailable}`);
    if (data.blockedRun)
      await call({ action: "abandon", id: data.blockedRun.id, expectedRevision: data.blockedRun.revision }, data.blockedRun.lessonId);
    else if (data.state && !data.state.completed)
      await call({ action: "abandon", id: data.state.id, expectedRevision: data.state.revision }, data.state.lessonId);
    else return data;
  }
  throw new Error("unfinished runs keep coming back");
}
const newest = await clearRuns();
if (!newest.picker) throw new Error("the newest day sent no picker");
const picker = newest.picker;
results.day = { lessonId: picker.lessonId, stocks: picker.symbols.length, defaults: picker.defaults.length, note: picker.note };
const label16 = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} 早盤`;

// ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────────
const CASES = [
  { name: "1366x900", width: 1366, height: 900, senior: false },
  { name: "375x812", width: 375, height: 812, senior: false },
  { name: "375x812-senior", width: 375, height: 812, senior: true },
];

async function open(browser, c, path = "/morning?new=1") {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
  await context.addInitScript((senior) => {
    localStorage.setItem("day-tycoon-coach-v1", "seen");
    if (senior) localStorage.setItem("day-tycoon-display-v1", "senior");
  }, c.senior);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  await page.locator(".td-picker").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  return { context, page, errors };
}
const folded = (page) => page.locator('.td-picker[data-folded="true"]').count().then(Boolean);
async function unfold(page) {
  const toggle = page.locator(".td-picker-toggle");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.locator(".td-picker-editor").waitFor({ timeout: 4000 });
}
const chosen = (page) =>
  page.$$eval(".td-picker-list:not(.td-picker-found) .td-picker-row", (rows) => rows.map((row) => row.dataset.code));
const sameList = (a, b) => a.length === b.length && a.every((code, index) => code === b[index]);

/** The heights of what `selectors` (name → CSS selector) find on the page, each one's smallest visible box. */
const heights = (page, selectors) =>
  page.evaluate((map) => {
    const out = {};
    for (const [name, selector] of Object.entries(map)) {
      const boxes = [...document.querySelectorAll(selector)]
        .map((node) => node.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      out[name] = boxes.length ? Math.round(Math.min(...boxes.map((box) => box.height)) * 10) / 10 : null;
    }
    return out;
  }, selectors);
/** Touch layouts: every target at least `floor` px (大字 56, phones 44; the day menu and stocks button 48 there). */
function checkTargets(name, c, measured, where) {
  if (c.width >= 768) return;
  results[name][`targets-${where}`] = measured;
  for (const [target, height] of Object.entries(measured)) {
    const floor = c.senior ? 56 : ["dayMenu", "stocksButton"].includes(target) ? 48 : 44;
    if (height === null) fail(name, `${where}: no ${target} to measure`);
    else if (height < floor - 0.5) fail(name, `${where}: ${target} is ${height}px tall, under ${floor}px`);
  }
}

async function addByCode(page, code) {
  const search = page.locator(".td-picker-search input");
  await search.fill(code);
  await page.locator(`.td-picker-found .td-picker-row[data-code="${code}"] .td-picker-add`).click({ timeout: 4000 });
}

/** Starts a run from the picker as it is; a stock the day's strict check refuses is removed and the start retried. */
async function startFromPicker(page, name) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole("button", { name: "用這個計畫開始" }).click();
    const outcome = await Promise.race([
      page.locator(".td-workbench:not([data-plan-open='true'])").waitFor({ timeout: 20000 }).then(() => "started"),
      page.getByText("資料對不起來").first().waitFor({ timeout: 20000 }).then(() => "refused"),
    ]);
    if (outcome === "started") return true;
    const text = await page.getByText("資料對不起來").first().textContent();
    const codes = (text.match(/對不起來：([^，]+)/)?.[1] ?? "").split("、").map((code) => code.trim()).filter(Boolean);
    if (!codes.length) break;
    if (await folded(page)) await unfold(page);
    for (const code of codes)
      await page.locator(`.td-picker-list:not(.td-picker-found) .td-picker-row[data-code="${code}"] .td-picker-remove`).click().catch(() => {});
    results[name].refusedAtStart = [...(results[name].refusedAtStart ?? []), ...codes];
  }
  fail(name, "the run did not start from the picker");
  return false;
}

async function waitForRun() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const data = await call();
    if (data.state && !data.state.completed && data.state.cursor >= 1) return data;
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error("09:00 was not revealed after the start");
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const c of CASES) {
  const name = c.name;
  results[name] = {};
  let session;
  try {
    session = await open(browser, c);
    const { page } = session;
    const phone = c.width < 768;

    // The day: its menu lists the open days as 「M/D 早盤」, the newest chosen.
    const menu = page.locator(".td-picker select");
    const options = await menu.locator("option").allTextContents();
    results[name].dates = options;
    const lessons = newest.lessons ?? [];
    if (!sameList(options, lessons.map((lesson) => label16(lesson.date))))
      fail(name, `the date menu lists ${JSON.stringify(options)}, not the open days ${JSON.stringify(lessons.map((lesson) => label16(lesson.date)))}`);
    if ((await menu.inputValue()) !== picker.lessonId) fail(name, `the date menu is on ${await menu.inputValue()}, not the newest day ${picker.lessonId}`);

    // The default list and the server's words for it (phones and large text: behind the stocks button).
    if (await folded(page)) await unfold(page);
    const title = (await page.locator(".td-picker-note-title").textContent())?.trim();
    if (title !== picker.note.title) fail(name, `the note says 「${title}」, not 「${picker.note.title}」`);
    const details = (await page.locator(".td-picker-note-detail").allTextContents()).map((text) => text.trim());
    if (picker.note.detail ? !sameList(details, [picker.note.detail]) : details.length)
      fail(name, `the detail line is ${JSON.stringify(details)}, not ${JSON.stringify(picker.note.detail)}`);
    const defaults = await chosen(page);
    if (!sameList(defaults, picker.defaults)) fail(name, `the picker starts with ${defaults.join(",")}, not the defaults ${picker.defaults.join(",")}`);
    const disposition = picker.symbols.find((symbol) => symbol.disposition && picker.defaults.includes(symbol.code));
    if (disposition && !(await page.locator(`.td-picker-row[data-code="${disposition.code}"] .td-picker-flag`).textContent())?.includes("處置（分盤交易）"))
      fail(name, `${disposition.code} is under disposition but not marked 處置（分盤交易）`);
    for (const word of ["推薦", "勝率", "漲停雷達", "分數", "等級"])
      if ((await page.locator(".td-picker").textContent()).includes(word)) fail(name, `the picker says 「${word}」`);

    // Phones: 16px fields, the start button on the plan's first screen (the list folded again), nothing sideways.
    const layout = await page.evaluate(() => ({
      fields: [...document.querySelectorAll(".td-picker :is(select, input)")].map((node) => parseFloat(getComputedStyle(node).fontSize)),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    results[name].fieldSizes = layout.fields;
    if (layout.fields.some((size) => size < 16)) fail(name, `a picker field is under 16px (${layout.fields.join(", ")})`);
    if (layout.overflowX > 0) fail(name, `the page scrolls sideways by ${layout.overflowX}px`);
    if (phone) {
      await page.locator(".td-picker-toggle").click();
      await page.locator(".td-plan").evaluate((node) => node.scrollIntoView({ block: "start" }));
      const box = await page.getByRole("button", { name: "用這個計畫開始" }).boundingBox();
      results[name].startBottom = box && Math.round(box.y + box.height);
      if (!box || box.y + box.height > c.height) fail(name, `the start button is not on the plan's first screen (bottom ${box && Math.round(box.y + box.height)}px)`);
      await page.screenshot({ path: `${out}${name}-plan.png` });
      await unfold(page);
    }
    await page.screenshot({ path: `${out}${name}-picker.png`, fullPage: phone });

    // Tap targets on touch layouts: the folded row, the list's buttons, a search result's 加入, the records.
    await page.locator(".td-picker-search input").fill(picker.symbols.find((symbol) => !defaults.includes(symbol.code))?.code ?? "");
    await page.waitForTimeout(300);
    checkTargets(name, c, await heights(page, {
      dayMenu: ".td-picker-date",
      stocksButton: ".td-picker-toggle",
      remove: ".td-picker-list:not(.td-picker-found) .td-picker-remove",
      add: ".td-picker-found .td-picker-add",
      record: ".td-records .td-record-open",
    }), "picker");
    await page.locator(".td-picker-search input").fill("");

    // Down to one stock: the last one stays.
    for (let guard = 0; guard < 100 && (await chosen(page)).length > 1; guard++)
      await page.locator(".td-picker-list:not(.td-picker-found) .td-picker-remove").first().click();
    const one = await chosen(page);
    const lastRemove = page.locator(".td-picker-list:not(.td-picker-found) .td-picker-remove");
    results[name].afterRemoving = one;
    if (one.length !== 1) fail(name, `${one.length} stocks left after removing, not 1`);
    if (!(await lastRemove.isDisabled())) fail(name, "the last stock's 移除 is not disabled");

    // Up to 80 (desktop only: every add is a search and a tap).
    if (!phone) {
      const others = picker.symbols.map((symbol) => symbol.code).filter((code) => !one.includes(code));
      if (others.length + one.length < MAX) fail(name, `the day offers ${others.length + one.length} stocks: 80 cannot be reached (Task 16's fixture has 80+)`);
      else {
        for (const code of others.slice(0, MAX - one.length)) await addByCode(page, code);
        const full = await chosen(page);
        results[name].added = full.length;
        if (full.length !== MAX) fail(name, `${full.length} stocks after adding, not ${MAX}`);
        if (!(await page.getByText(FULL, { exact: true }).isVisible())) fail(name, `「${FULL}」 is not shown at ${MAX} stocks`);
        const extra = others[MAX - one.length];
        if (extra) {
          await page.locator(".td-picker-search input").fill(extra);
          const add = page.locator(`.td-picker-found .td-picker-row[data-code="${extra}"] .td-picker-add`);
          if (!(await add.isDisabled())) fail(name, `${extra} can still be added at ${MAX} stocks`);
        }
        await page.screenshot({ path: `${out}${name}-full.png` });
      }
    }
    if (session.errors.length) fail(name, `page errors: ${session.errors.join("; ")}`);
    await session.context.close();

    // 放棄這局, then the picker again on the default list (desktop: from 教材; phones: from 復盤).
    session = await open(browser, c);
    if (!(await startFromPicker(session.page, name))) continue;
    await waitForRun();
    const run = (await call()).state;
    const { page: desk } = session;
    await desk.waitForTimeout(1500);
    if (phone) await desk.getByRole("button", { name: "復盤" }).click();
    else {
      await desk.getByRole("button", { name: "教材" }).click();
      await desk.locator(".td-resources").waitFor({ timeout: 4000 });
    }
    const abandonButton = desk.getByRole("button", { name: "放棄這局、重新選股" }).first();
    await abandonButton.scrollIntoViewIfNeeded();
    checkTargets(name, c, { abandon: Math.round(((await abandonButton.boundingBox())?.height ?? 0) * 10) / 10 }, "review");
    await abandonButton.click();
    const ask = desk.getByRole("alertdialog");
    checkTargets(name, c, await heights(desk, { confirm: ".td-abandon-confirm .td-button[data-variant='danger']", cancel: ".td-abandon-confirm .td-button:not([data-variant])" }), "confirm");
    const asked = (await ask.textContent())?.includes(CONFIRM);
    if (!asked) fail(name, `放棄這局 does not ask 「${CONFIRM}」`);
    await desk.screenshot({ path: `${out}${name}-abandon-ask.png` });
    if ((await call()).state?.completed) fail(name, "the run ended before the learner confirmed");
    await ask.getByRole("button", { name: "確定放棄" }).click();
    await desk.locator(".td-picker").waitFor({ timeout: 15000 });
    await desk.waitForTimeout(800);
    const after = await call(undefined, run.lessonId);
    if (!after.state?.abandoned || after.state.id !== run.id) fail(name, "the run was not given up");
    if (await folded(desk)) await unfold(desk);
    const again = await chosen(desk);
    if (!sameList(again, after.picker?.defaults ?? picker.defaults)) fail(name, `after giving up the picker shows ${again.join(",")}, not the day's defaults`);
    const record = desk.locator(".td-records li").first();
    const recordText = (await record.textContent()) ?? "";
    results[name].abandonedRecord = recordText;
    if (!recordText.includes("已放棄")) fail(name, `練習紀錄's newest run says 「${recordText}」, not 已放棄`);
    await desk.screenshot({ path: `${out}${name}-after-abandon.png`, fullPage: phone });
    if (session.errors.length) fail(name, `page errors: ${session.errors.join("; ")}`);
    await session.context.close();
  } catch (error) {
    fail(name, error.message.split("\n")[0]);
    await session?.page.screenshot({ path: `${out}${name}-stopped.png` }).catch(() => {});
    await session?.context.close().catch(() => {});
  }
}

// ── A guest: the top 5 and its own words, never the list ───────────────────────────────────────────────────────────
{
  const name = "guest-375";
  results[name] = {};
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await context.addInitScript(() => localStorage.setItem("day-tycoon-coach-v1", "seen"));
  const page = await context.newPage();
  try {
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByLabel("教室入場碼", { exact: true }).fill(state.gateCode);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "進入教室" }).click();
    await page.getByRole("link", { name: "開始今天的練習" }).click({ timeout: 20000 });
    await page.locator(".td-picker").waitFor({ timeout: 20000 });
    await unfold(page);
    const title = (await page.locator(".td-picker-note-title").textContent())?.trim();
    results[name].note = title;
    if (title !== GUEST_NOTE) fail(name, `the guest's note says 「${title}」, not 「${GUEST_NOTE}」`);
    const codes = await chosen(page);
    results[name].defaults = codes;
    if (!codes.length || codes.length > 5) fail(name, `the guest starts with ${codes.length} stocks, not 1–5`);
    if (await page.locator(".td-picker-note-detail").count()) fail(name, "the guest sees the list's detail line");
    await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
  } catch (error) {
    fail(name, error.message.split("\n")[0]);
    await page.screenshot({ path: `${out}${name}-stopped.png` }).catch(() => {});
  }
  await context.close();
}

// ── A retired lesson's run from 練習紀錄: text only ───────────────────────────────────────────────────────────────
const records = (await call()).records ?? [];
const realRetired = records.find((record) => record.retired);
results.retired = realRetired ? "real" : "mocked";
const MOCK_RECORD = {
  id: "00000000-0000-4000-8000-000000000005",
  lessonId: RETIRED_LESSON,
  date: "2026-10-05",
  codes: 5,
  pnl: -1234,
  reflected: false,
  abandoned: false,
  retired: true,
  completed: false,
};
const MOCK_RUN = {
  catalog: {
    lessonId: RETIRED_LESSON, title: RETIRED, date: "2026-10-05", start: "09:00", end: "10:30", maxCursor: 90,
    symbols: [["2330", "台積電"], ["2317", "鴻海"], ["2454", "聯發科"], ["2382", "廣達"], ["2308", "台達電"]]
      .map(([code, name]) => ({ code, name, previousClose: 0, previous5CloseMean: null })),
    context: [], strategy: [], notices: [], videoUrl: null,
  },
  state: {
    id: MOCK_RECORD.id, lessonId: RETIRED_LESSON, cursor: 42, revision: 9,
    plan: { exerciseId: "first-order", bias: "observe", focusCode: "2330", reason: "舊課的計畫。", entry: "等條件。", stop: "停止條件。" },
    bars: {}, startingCash: 10_000_000, cash: 8_998_766, equity: 9_998_766,
    positions: [{ code: "2330", shares: 1000, averageCost: 1000 }],
    orders: [{ id: "o1", code: "2330", side: "buy", shares: 1000, status: "filled", submittedCursor: 10, price: 1000 }],
    fills: [{ id: "f1", code: "2330", side: "buy", shares: 1000, price: 1000, fee: 1234, tax: 0, t: 660 }],
    completed: false, reflection: "", nextAdvanceAt: 0,
  },
  retired: true,
  records: [MOCK_RECORD],
};
for (const c of [CASES[0], CASES[1]]) {
  const name = `retired-${c.name}`;
  results[name] = {};
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height } });
  await context.addInitScript(() => localStorage.setItem("day-tycoon-coach-v1", "seen"));
  const page = await context.newPage();
  if (!realRetired)
    await page.route("**/api/morning**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET") return route.continue();
      if (url.searchParams.get("lesson") === RETIRED_LESSON)
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RUN) });
      const response = await route.fetch();
      const body = await response.json();
      if (Array.isArray(body.records)) body.records = [MOCK_RECORD, ...body.records];
      return route.fulfill({ response, body: JSON.stringify(body) });
    });
  try {
    await page.goto(base + "/morning?new=1", { waitUntil: "domcontentloaded" });
    await page.locator(".td-records").waitFor({ timeout: 20000 });
    const link = page.locator(".td-records button.td-record-open", { hasText: RETIRED }).first();
    results[name].record = (await link.textContent())?.trim();
    await link.click();
    await page.locator(".td-retired").waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const view = await page.evaluate(() => ({
      heading: document.querySelector(".td-retired h1")?.textContent ?? "",
      charts: document.querySelectorAll("main canvas").length,
      workbench: Boolean(document.querySelector(".td-workbench")),
      text: document.querySelector("main")?.textContent ?? "",
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    results[name].heading = view.heading;
    if (!view.heading.includes(RETIRED)) fail(name, `the page is headed 「${view.heading}」, without ${RETIRED}`);
    if (view.charts || view.workbench) fail(name, `a retired run shows a chart (${view.charts} canvases, workbench ${view.workbench})`);
    for (const part of ["委託", "成交", "損益"]) if (!view.text.includes(part)) fail(name, `the page does not show ${part}`);
    const run = realRetired ? (await call(undefined, realRetired.lessonId)).state : MOCK_RUN.state;
    if (!run.completed) {
      for (const button of ["完成並復盤", "放棄這局"])
        if (!(await page.getByRole("button", { name: button, exact: true }).isVisible())) fail(name, `no 「${button}」 on an unfinished retired run`);
      for (const word of ["播放", "+1 分", "核對模擬"])
        if (await page.getByRole("button", { name: word }).count()) fail(name, `a retired run offers 「${word}」`);
    }
    if (view.overflowX > 0) fail(name, `the page scrolls sideways by ${view.overflowX}px`);
    await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
  } catch (error) {
    fail(name, error.message.split("\n")[0]);
    await page.screenshot({ path: `${out}${name}-stopped.png` }).catch(() => {});
  }
  await context.close();
}
await browser.close();

writeFileSync(`${out}picker.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("Lesson picker, records, 放棄這局 and retired runs: all checks pass.");
