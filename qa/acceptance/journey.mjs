#!/usr/bin/env node
// Independent student-journey acceptance for the Trading Academy workbook (written separately from the
// workbook's own capture script). A brand-new student follows the workbook's written steps on the release the
// classroom host serves: every step keeps a before and an after screenshot, compares the screen with the
// workbook's expected result, and each level also tries a wrong operation and its recovery.
// Nothing here talks to production: a disposable classroom (scripts/qa/desk-server.mjs) on loopback ports.
//
// The same student also keeps the digital workbook (--web, the package's output/web) in a browser profile of its
// own: after each level it writes what it actually saw, and at the end the works are reopened, exported,
// restored into an empty browser and checked against bad files.
//
//   node qa/acceptance/journey.mjs [--content <workbook content dir>] [--web <workbook web dir>] [--out <dir>]
//        [--levels L01,L02,...]
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const project = resolve(here, "../..");
const host = join(homedir(), "YilutekServices", "DayTradeTycoon");
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const contentDir = resolve(option("content", join(project, "courseware", "academy", "content")));
const out = resolve(option("out", join(project, "..", "..", "artifacts", "acceptance-20261018", "journey")));
const onlyLevels = option("levels", "L01,L02,L03,L04,L05,L06,FINAL").split(",");
const portApp = option("port-app", "18880");
const portProxy = option("port-proxy", "18881");
const VIEW = { width: 1440, height: 900 };

/* ── workbook text (read only) ── */
const workbook = {};
for (const file of ["l01", "l02", "l03", "l04", "l05", "l06", "final"]) {
  const level = (await import(pathToFileURL(join(contentDir, `${file}.mjs`)).href)).default;
  for (const task of level.tasks) workbook[task.id] = { level: level.id, title: task.title, steps: task.steps ?? [], expect: task.expect ?? "", trouble: task.trouble ?? [] };
}
const instruction = (taskId, n) => {
  const step = workbook[taskId]?.steps.find((item) => String(item.n) === String(n));
  return step ? `${step.text}${step.sub ? `〔${step.sub}〕` : ""}`.replace(/\s+/g, " ") : `(workbook ${taskId} has no step ${n})`;
};

/* ── the release and a disposable classroom ── */
function hostedEntry() {
  try {
    const hosting = JSON.parse(readFileSync(join(host, "hosting.json"), "utf8").replace(/^﻿/, ""));
    if (hosting.appEntry && existsSync(hosting.appEntry)) return hosting.appEntry;
  } catch {
    /* no host */
  }
  throw new Error("No classroom host release found (hosting.json)");
}
const appEntry = resolve(option("app-entry", hostedEntry()));
const release = appEntry.match(/releases[\\/]([^\\/]+)[\\/]server/)?.[1] ?? "unknown";
const marketCopy = await mkdtemp(join(tmpdir(), "journey-market-data-"));
await cp(join(host, "market-data", "index.json"), join(marketCopy, "index.json"));
await cp(join(host, "market-data", "days"), join(marketCopy, "days"), { recursive: true });
await mkdir(out, { recursive: true });

/* ── the fixed trading days, read from the published files: expected fill prices come from here, not from the
      classroom server's own records (those are only a cross-check) ── */
const barCache = {};
function barsOf(date, code) {
  barCache[`${date}/${code}`] ??= JSON.parse(gunzipSync(readFileSync(join(marketCopy, "days", date, "symbols", `${code}.json.gz`))).toString()).bars;
  return barCache[`${date}/${code}`];
}
const minuteOf = (seconds) => {
  const total = 9 * 60 + Math.floor(seconds / 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
/** [seconds, open, high, low, close, volume, vwap] of one minute of the fixed day. */
const barAt = (date, code, time) => barsOf(date, code).find(([seconds]) => minuteOf(seconds) === time);
/** The close the desk shows at clock `time` (「09:03 收價」 is the minute that ends at 09:03). */
const shownClose = (date, code, time) => barsOf(date, code).find(([seconds]) => minuteOf(seconds + 60) === time)?.[4];
const previousClose = (date, code) => JSON.parse(readFileSync(join(marketCopy, "days", date, "index.json"), "utf8")).symbols.find((item) => item.code === code).referencePrice;

const server = spawn(process.execPath, [join(project, "scripts", "qa", "desk-server.mjs")], {
  cwd: project,
  env: { ...process.env, APP_ENTRY: appEntry, PORT_APP: portApp, PORT_PROXY: portProxy, MARKET_DATA_DIR: marketCopy, DOWNLOADS: join(appEntry, "..", "..", "downloads") },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverLog = "";
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("classroom did not start:\n" + serverLog)), 90000);
  server.stdout.on("data", (chunk) => {
    serverLog += chunk;
    if (serverLog.includes("QA ready")) {
      clearTimeout(timer);
      done();
    }
  });
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  server.on("exit", (code) => fail(new Error(`classroom exited (${code}):\n${serverLog}`)));
});
const classroom = JSON.parse(await readFile(join(project, "artifacts", "trading-desk-qa", `server-${portProxy}.json`), "utf8"));

/* ── the record ── */
const records = [];
let seq = 0;
let currentLevel = "";
const slug = (text) => text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 28);
function verdict(ok, actual) {
  return { ok: Boolean(ok), actual: String(actual ?? "").replace(/\s+/g, " ").trim().slice(0, 300) };
}
/**
 * One workbook step: screenshot, act, screenshot, compare. `kind` is "step", "recovery" or "completion".
 * `verify` returns { ok, actual }. The step text comes from the workbook when `n` is given.
 */
async function step(page, { task, n, does, expected, kind = "step", act, verify }) {
  seq += 1;
  const base = `${String(seq).padStart(3, "0")}-${task}-${slug(does)}`;
  const before = `${base}-before.png`;
  const after = `${base}-after.png`;
  const text = n !== undefined ? instruction(task, n) : does;
  let result;
  await page.screenshot({ path: join(out, before) }).catch(() => {});
  try {
    if (act) await act();
    result = verify ? await verify() : verdict(true, "");
  } catch (error) {
    result = verdict(false, `error: ${error.message.split("\n")[0]}`);
  }
  await page.screenshot({ path: join(out, after) }).catch(() => {});
  records.push({ seq, level: currentLevel, task, n: n ?? null, kind, instruction: text, does, expected, ...result, before, after });
  console.log(`${result.ok ? "PASS" : "FAIL"} [${task}${n !== undefined ? ` #${n}` : ""}] ${does} — ${result.actual.slice(0, 120)}`);
  return result;
}
const flat = (value) => String(value).replace(/\s+/g, "");
const text = async (locator) => ((await locator.first().textContent({ timeout: 15000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const has = (locator, needle) => async () => {
  const value = await text(locator);
  return verdict(value.includes(needle), value);
};
const visible = (locator) => async () => {
  const ok = await locator.first().waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false);
  return verdict(ok, ok ? "visible" : "not visible");
};

/* ── desk helpers (accessible names, as a student reads them) ── */
const desk = (page) => ({
  clock: page.locator(".td-clock strong"),
  subject: page.locator(".td-subject"),
  alert: page.locator(".td-alert"),
  feedback: page.locator(".td-feedback"),
  account: page.locator("dl.td-account"),
  heroName: page.locator("#morning-practice-title"),
  heroPrice: page.locator(".td-hero-price"),
  heroChange: page.locator(".td-hero-change"),
  heroStamp: page.locator(".td-hero-stamp"),
  heroBook: page.locator(".td-hero-book"),
  watch: page.locator("aside.td-watch"),
  ledger: page.locator("#sim-ledger-content"),
  pending: page.locator(".sim-pending"),
  confirm: page.locator(".sim-confirm"),
  facts: page.locator("section.sim-ticket dl.sim-order-facts").first(),
  submit: page.locator("button.sim-submit"),
  side: page.locator('[aria-label="模擬買賣方向"]'),
  type: page.locator('[aria-label="委託價格類型"]'),
  review: page.locator('section[aria-labelledby="morning-review-title"]'),
});
async function clock(page) {
  return text(page.locator(".td-clock strong"));
}
async function plusOne(page) {
  const before = await clock(page);
  await page.getByRole("button", { name: "前進 1 分鐘" }).click({ timeout: 15000 });
  await page.waitForFunction((previous) => document.querySelector(".td-clock strong")?.textContent?.trim() !== previous, before, { timeout: 15000 });
}
async function advanceTo(page, target) {
  for (let guard = 0; guard < 120; guard++) {
    const now = await clock(page);
    if (now === target) return;
    if (now > target) throw new Error(`clock ${now} is past ${target}`);
    try {
      await plusOne(page);
    } catch (error) {
      if ((await clock(page)) === target) return;
      const retry = page.getByRole("button", { name: /重新載入進度|已核對，載入目前進度/ }).first();
      if (await retry.isVisible().catch(() => false)) await retry.click();
      else throw error;
    }
  }
  throw new Error(`could not reach ${target}`);
}
async function ledgerTab(page, label) {
  await page.locator('nav[aria-label="交易紀錄分類"] button').filter({ hasText: new RegExp(`^\\s*${label}`) }).first().click();
  const toggle = page.locator(".sim-ledger-toggle");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await page.waitForTimeout(250);
}
/** The run the desk shows: the selected trading day decides which lesson's run the API returns. */
async function serverRun(page) {
  return page.evaluate(async () => {
    const lesson = document.querySelector('select[aria-label="教材交易日"]')?.value;
    const url = lesson ? `/api/morning?lesson=${encodeURIComponent(lesson)}` : "/api/morning";
    return (await fetch(url, { cache: "no-store" })).json();
  });
}
async function serverState(page) {
  return (await serverRun(page)).state;
}
async function finishRound(page, reflection) {
  const d = desk(page);
  if (!(await d.review.isVisible().catch(() => false))) {
    const now = page.getByRole("button", { name: "現在寫復盤" });
    if (await now.isVisible().catch(() => false)) await now.click();
    else await page.locator('[aria-label="歷史行情重播控制"] button', { hasText: "復盤" }).click();
  }
  await d.review.locator("textarea").fill(reflection);
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await page.getByText("已保存 · 這是操作足跡，不是獲利能力評分").last().waitFor({ timeout: 20000 });
}

/* ── what the student reads on the screen: quote, watch list, the three ledger tabs ── */
const money = (value) => Number(String(value ?? "").replace(/[−–]/g, "-").replace(/[^\d.-]/g, ""));
const observed = { quotes: [], fees: [], waits: [] }; // what the journey saw, for the student's own workbook
let roundOrders = []; // orders this student sent in the current round: { code, side, lots, at } (at = clock when confirmed)
async function heroQuote(page) {
  const d = desk(page);
  const change = await text(d.heroChange);
  return {
    code: await page.locator('select[aria-label="選擇股票"]').inputValue(),
    name: await text(d.heroName),
    time: await clock(page),
    price: await text(d.heroPrice),
    change: (change.match(/[▲▼]?\s*[\d,.]+/)?.[0] ?? "").replace(/\s+/g, ""),
    percent: change.match(/[+\-−]?[\d.]+%/)?.[0] ?? "",
  };
}
const watchList = (page) =>
  page.locator(".td-watch-item").evaluateAll((items) =>
    items.map((item) => ({
      name: item.querySelector(".td-watch-name span")?.textContent.trim(),
      code: item.querySelector(".td-watch-name small")?.textContent.trim(),
      price: item.querySelector(".td-watch-price")?.textContent.trim(),
      tone: item.dataset.tone,
      percent: item.querySelector(".td-watch-change span:last-child")?.textContent.trim(),
    })),
  );
async function screenLedger(page) {
  const read = async (label) => {
    await ledgerTab(page, label);
    return page.locator("#sim-ledger-content").evaluate((root) => ({
      empty: root.querySelector(".sim-ledger-empty strong")?.textContent.trim() ?? null,
      rows: [...root.querySelectorAll("tbody tr")].map((row) => {
        const [code, time] = (row.querySelector("th small")?.textContent ?? "").split("·").map((part) => part.trim());
        const cells = {};
        for (const cell of row.querySelectorAll("td[data-label]")) cells[cell.dataset.label] = (cell.querySelector(".sim-status") ?? cell).textContent.replace(/\s+/g, " ").trim();
        return { name: row.querySelector("th strong")?.textContent.trim() ?? "", code, time, reason: row.querySelector(".sim-record-reason")?.textContent.trim() ?? "", ...cells };
      }),
    }));
  };
  return { orders: await read("委託"), fills: await read("成交"), positions: await read("庫存") };
}
const tradingDay = async (page) => (await text(page.locator('select[aria-label="教材交易日"] option:checked'))).match(/\d{4}-\d{2}-\d{2}/)?.[0];
/** The latest order on screen: 成交 row (stock, time, side, lots, price = that minute's open in the fixed day file)
 *  and its 委託 row (status, time sent). The server's own fill is listed as a cross-check only. */
async function fillOnScreen(page) {
  const order = roundOrders.at(-1);
  const date = await tradingDay(page);
  const open = barAt(date, order.code, order.at)?.[1];
  const ledger = await screenLedger(page);
  const fill = ledger.fills.rows[0];
  const sent = ledger.orders.rows[0];
  const want = `${order.side} ${order.lots} 張`;
  const server = (await serverState(page)).fills.at(-1)?.price;
  const ok =
    fill?.code === order.code && fill.time === order.at && fill["方向 / 張數"] === want && money(fill["成交價"]) === open &&
    sent?.code === order.code && sent.time === order.at && sent["方向 / 張數"] === want && sent["狀態"] === "已成交" && server === open;
  return {
    ...verdict(ok, `成交 ${fill?.name} ${fill?.code} ${fill?.time} ${fill?.["方向 / 張數"]} @ ${fill?.["成交價"]} · 委託 ${sent?.time} ${sent?.["方向 / 張數"]} ${sent?.["狀態"]} · expected ${want} at ${order.at}, ${date} ${order.code} open ${open} · server ${server}`),
    ledger,
  };
}
/** The whole round on screen: every fill against the fixed day's open at the minute it was sent, every order
 *  settled, 庫存 empty, and 本輪損益 equal to the fills' own arithmetic (price × shares − fee − tax). */
async function roundOnScreen(page, expected = roundOrders) {
  const date = await tradingDay(page);
  const ledger = await screenLedger(page);
  const fills = [...ledger.fills.rows].reverse();
  const problems = [];
  if (fills.length !== expected.length) problems.push(`${fills.length} fills on screen, ${expected.length} orders sent`);
  expected.forEach((order, index) => {
    const fill = fills[index];
    const open = barAt(date, order.code, order.at)?.[1];
    const want = `${order.side} ${order.lots} 張`;
    if (!fill || fill.code !== order.code || fill.time !== order.at || fill["方向 / 張數"] !== want || money(fill["成交價"]) !== open)
      problems.push(`fill ${index + 1} screen ${fill?.code} ${fill?.time} ${fill?.["方向 / 張數"]} @ ${fill?.["成交價"]} ≠ ${order.code} ${order.at} ${want} @ ${open}`);
  });
  const unsettled = ledger.orders.rows.filter((row) => !["已成交", "已撤回"].includes(row["狀態"]));
  if (unsettled.length) problems.push(`${unsettled.length} orders not settled`);
  if (ledger.positions.empty !== "目前沒有庫存") problems.push(`庫存 has ${ledger.positions.rows.length} rows`);
  let net = 0;
  for (const fill of fills) {
    const [fee, tax] = String(fill["手續費 / 稅費"]).split("/").map(money);
    net += (fill["方向 / 張數"].startsWith("賣出") ? 1 : -1) * money(fill["成交價"]) * money(fill["方向 / 張數"]) * 1000 - fee - tax;
  }
  const shown = money((await text(desk(page).account)).match(/本輪損益\s*([+\-−]?[\d,.]+)/)?.[1]);
  const tolerance = 2 * fills.length; // fees and taxes are shown rounded to the yuan
  if (Math.abs(shown - net) > tolerance) problems.push(`本輪損益 ${shown} ≠ fills ${net}`);
  const state = await serverState(page);
  const server = Math.round((state.equity - state.startingCash) * 100) / 100;
  if (Math.abs(server - shown) > 0.5) problems.push(`server pnl ${server} ≠ screen ${shown}`);
  const summary = fills.map((fill) => `${fill.time} ${fill["方向 / 張數"]} @ ${fill["成交價"]}`).join(", ") || "no fills";
  return { ...verdict(!problems.length, `${problems.join("; ") || "ok"} · ${date} ${summary} · 本輪損益 ${shown} · fills net ${Math.round(net)} · 庫存 ${ledger.positions.empty ?? "rows"} · server ${server}`), ledger, net, shown, date };
}

/* ── LEVEL 01 ── */
async function level01(page, context) {
  currentLevel = "L01";
  await page.goto(classroom.appBase + "/", { waitUntil: "domcontentloaded" });
  const gate = page.getByLabel("教室入場碼", { exact: true });
  await gate.waitFor({ timeout: 20000 });
  await step(page, {
    task: "01-1", does: "輸入錯誤的入場碼", kind: "recovery", expected: "顯示錯誤，不進入大廳",
    act: async () => {
      await gate.fill("WRONG-CODE-0000");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "進入教室" }).click();
      await page.waitForTimeout(1500);
    },
    verify: async () => {
      const inLobby = await page.getByRole("heading", { name: "今天三件事" }).isVisible().catch(() => false);
      const message = await text(page.locator('[role="alert"], .text-up, .gate-error, form p').filter({ hasText: /入場碼|錯誤|不正確|無法/ }));
      return verdict(!inLobby && message.length > 0, inLobby ? "entered the lobby with a wrong code" : message);
    },
  });
  await step(page, {
    task: "01-1", n: 1, does: "改輸入正確的入場碼", expected: "欄位填入講師給的入場碼",
    act: () => gate.fill(classroom.gateCode),
    verify: async () => verdict((await gate.inputValue()) === classroom.gateCode, "filled"),
  });
  await step(page, {
    task: "01-1", n: 3, does: "按「進入教室」", expected: workbook["01-1"].expect,
    act: async () => {
      const box = page.getByRole("checkbox");
      if (!(await box.isChecked())) await box.check();
      await page.getByRole("button", { name: "進入教室" }).click();
    },
    verify: async () => {
      const ok = await page.getByRole("heading", { name: "今天三件事" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
      const daily = await page.getByRole("heading", { name: /今天的一題/ }).isVisible().catch(() => false);
      return verdict(ok && daily, `今天三件事=${ok} 今天的一題=${daily}`);
    },
  });

  // 01-2 account (with a too-short password first)
  await page.locator("#my-learning").getByRole("link", { name: /登入／建立帳號/ }).click();
  await page.getByRole("button", { name: "首次註冊" }).click();
  await page.getByRole("heading", { name: "建立學員帳號" }).waitFor({ timeout: 20000 });
  const email = `journey-${randomBytes(4).toString("hex")}@example.invalid`;
  await page.locator("#learner-name").fill("驗收學員");
  await page.locator("#learner-email").fill(email);
  await step(page, {
    task: "01-2", does: "密碼只輸入 5 個字", kind: "recovery", expected: "不建立帳號，提示密碼長度",
    act: async () => {
      await page.locator("#learner-password").fill("abc12");
      await page.getByRole("button", { name: "建立帳號，繼續下一步" }).click();
      await page.waitForTimeout(1200);
    },
    verify: async () => {
      const moved = await page.getByRole("button", { name: "儲存資料，進入教室" }).isVisible().catch(() => false);
      const invalid = await page.locator("#learner-password").evaluate((input) => !input.checkValidity() || input.getAttribute("aria-invalid") === "true").catch(() => false);
      const hint = await text(page.locator("form").filter({ hasText: /10/ }));
      return verdict(!moved && (invalid || /10/.test(hint)), moved ? "account created with a 5-character password" : `invalid=${invalid}`);
    },
  });
  await step(page, {
    task: "01-2", n: 4, does: "改用 10 字元以上的密碼，按「建立帳號，繼續下一步」", expected: "進入第 2 步班級資料",
    act: async () => {
      await page.locator("#learner-password").fill(randomBytes(12).toString("base64url"));
      await page.getByRole("button", { name: "建立帳號，繼續下一步" }).click();
    },
    verify: visible(page.getByRole("button", { name: "儲存資料，進入教室" })),
  });
  await step(page, {
    task: "01-2", n: 7, does: "勾選教學聲明，按「儲存資料，進入教室」", expected: workbook["01-2"].expect,
    act: async () => {
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "儲存資料，進入教室" }).click();
    },
    verify: async () => {
      const mine = await page.getByRole("link", { name: "我的學習" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
      await page.locator(".daily-card", { hasText: "連續" }).waitFor({ timeout: 15000 }).catch(() => {});
      const streak = await text(page.locator(".daily-card"));
      return verdict(mine && /連續 0 天/.test(streak), `我的學習=${mine} · ${streak.slice(0, 80)}`);
    },
  });

  // 01-3 first round, look only
  const card1 = page.locator('article[data-course="1"]');
  await card1.scrollIntoViewIfNeeded();
  await step(page, {
    task: "01-3", n: 2, does: "按第 1 課卡片的「開始這個練習」", expected: "打開第 1 課的作戰計畫",
    act: () => card1.getByRole("link", { name: /開始第 1 課|開始這個練習/ }).click(),
    verify: async () => {
      const subject = await text(desk(page).subject);
      const day = await text(page.locator('select[aria-label="教材交易日"] option:checked'));
      return verdict(subject.includes("第一筆有計畫的委託") && day.includes("2026-10-06"), `${subject} · ${day}`);
    },
  });
  await step(page, {
    task: "01-3", n: 4, does: "選「先看不做」", expected: "範本切換為先看不做",
    act: () => page.getByRole("radio", { name: /先看不做/ }).click(),
    verify: async () => verdict((await page.getByRole("radio", { name: /先看不做/ }).getAttribute("aria-checked")) === "true", "先看不做 selected"),
  });
  await step(page, {
    task: "01-3", n: 6, does: "按「用這個計畫開始」", expected: workbook["01-3"].expect,
    act: () => page.getByRole("button", { name: "用這個計畫開始" }).click(),
    verify: async () => {
      await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
      await page.waitForFunction(() => document.querySelector(".td-clock strong")?.textContent?.trim() === "09:01", null, { timeout: 15000 }).catch(() => {});
      const now = await clock(page);
      const plan = await text(page.locator(".td-plan-note"));
      const coach = await page.getByRole("dialog").isVisible().catch(() => false);
      return verdict(now === "09:01" && plan.includes("今天只觀察，不下單") && coach, `clock ${now} · plan ${plan.slice(0, 40)} · coach ${coach}`);
    },
  });

  // 01-4 coach marks and the clock
  const coach = page.getByRole("dialog");
  for (const [n, title, button] of [[1, "看走勢圖", "下一步"], [2, "讓行情動起來", "下一步"], [3, "成交與庫存", "完成"]]) {
    await step(page, {
      task: "01-4", n, does: `新手教學「${title}」按「${button}」`, expected: `第 ${n}／3 步是「${title}」`,
      act: async () => {
        const heading = await text(coach.locator("h2, #td-coach-title"));
        if (!heading.includes(title)) throw new Error(`coach shows "${heading}"`);
        await coach.getByRole("button", { name: button }).click();
        await page.waitForTimeout(400);
      },
      verify: async () => verdict(true, `step ${n} done`),
    });
  }
  await step(page, {
    task: "01-4", n: 4, does: "找到狀態列、重播控制與報價區", expected: "三個區塊都在畫面上",
    verify: async () => {
      const found = await Promise.all([page.locator("header.td-bar"), page.locator('[aria-label="歷史行情重播控制"]'), page.locator("header.td-hero")].map((locator) => locator.first().isVisible()));
      return verdict(found.every(Boolean), `status bar ${found[0]} · replay ${found[1]} · quote ${found[2]}`);
    },
  });
  await step(page, {
    task: "01-4", n: 5, does: "按兩次「+1 分」到 09:03", expected: workbook["01-4"].expect,
    act: () => advanceTo(page, "09:03"),
    verify: async () => {
      const account = await text(desk(page).account);
      const gone = (await page.locator(".td-coach").count()) === 0;
      return verdict((await clock(page)) === "09:03" && account.includes("10,000,000") && gone, `${await clock(page)} · ${account}`);
    },
  });

  // 01-5 switching stocks
  const d = desk(page);
  await step(page, {
    task: "01-5", n: 1, does: "自選報價點「鴻海」", expected: "報價區換成鴻海 2317",
    act: () => page.locator(".td-watch-item", { hasText: "鴻海" }).click(),
    verify: async () => {
      const quote = await heroQuote(page);
      if (quote.name.includes("鴻海")) observed.quotes.push(quote);
      return verdict(quote.name.includes("鴻海"), `${quote.name} ${quote.time} ${quote.price} ${quote.change} ${quote.percent}`);
    },
  });
  await step(page, {
    task: "01-5", n: 3, does: "按「›」下一檔股票", expected: "換到聯發科",
    act: () => page.getByRole("button", { name: "下一檔股票" }).click(),
    verify: has(d.heroName, "聯發科"),
  });
  await step(page, {
    task: "01-5", n: 4, does: "股票選單選「2330 台積電」", expected: workbook["01-5"].expect,
    act: () => page.locator('select[aria-label="選擇股票"]').selectOption("2330"),
    verify: async () => {
      const name = await text(d.heroName);
      return verdict(name.includes("台積電") && (await clock(page)) === "09:03", `${name} · ${await clock(page)}`);
    },
  });

  // 01-6 reading the quote
  await step(page, {
    task: "01-6", n: 2, does: "讀名稱下方的時間", expected: "「09:03 收價 · 歷史重播」",
    verify: async () => {
      const stamp = await text(d.heroStamp);
      return verdict(stamp.includes("09:03") && stamp.includes("收價") && stamp.includes("歷史重播"), stamp);
    },
  });
  await step(page, {
    task: "01-6", n: 4, does: "讀最新價、漲跌與漲跌幅", expected: workbook["01-6"].expect,
    verify: async () => {
      const price = await text(d.heroPrice);
      const change = await text(d.heroChange);
      observed.quotes.unshift(await heroQuote(page));
      return verdict(price.includes("2585") && change.includes("10") && change.includes("+0.39%"), `${price} · ${change}`);
    },
  });
  return { page, context };
}

/* ── LEVEL 02 ── */
async function level02(page) {
  currentLevel = "L02";
  const d = desk(page);
  await step(page, {
    task: "02-1", n: 1, does: "按兩次「+1 分」到 09:05", expected: "時鐘 09:05",
    act: () => advanceTo(page, "09:05"),
    verify: async () => verdict((await clock(page)) === "09:05", await clock(page)),
  });
  await step(page, {
    task: "02-1", n: 2, does: "讀自選報價的鴻海與聯發科", expected: "鴻海紅色 ▲8 +3.15%；聯發科綠色 ▼125 -2.42%",
    verify: async () => {
      const hon = await text(page.locator(".td-watch-item", { hasText: "鴻海" }));
      const mtk = await text(page.locator(".td-watch-item", { hasText: "聯發科" }));
      observed.watch0905 = await watchList(page);
      return verdict(hon.includes("+3.15%") && hon.includes("8") && mtk.includes("-2.42%") && mtk.includes("125"), `${hon} | ${mtk}`);
    },
  });
  await step(page, {
    task: "02-2", n: 1, does: "右側點「行情」分頁，讀開盤／昨收／最高／最低", expected: workbook["02-2"].expect,
    act: () => page.locator('nav[aria-label="下單行情分類"] button', { hasText: "行情" }).click(),
    verify: async () => {
      const detail = await text(page.locator("section.terminal-quote-detail"));
      return verdict(["2575", "2590"].every((value) => detail.includes(value)) && detail.includes("開盤") && detail.includes("最高") && detail.includes("最低"), detail.slice(0, 160));
    },
  });
  await step(page, {
    task: "02-3", n: 1, does: "圖表工具列按「分時」", expected: "分時被選取",
    act: () => page.locator('nav[aria-label="看盤分頁"]').getByRole("button", { name: "分時" }).click(),
    verify: async () => verdict((await page.locator('nav[aria-label="看盤分頁"]').getByRole("button", { name: "分時" }).getAttribute("aria-pressed")) === "true", "分時 pressed"),
  });
  await step(page, {
    task: "02-3", n: 2, does: "按「K線」", expected: "K線被選取",
    act: () => page.locator('nav[aria-label="看盤分頁"]').getByRole("button", { name: "K線" }).click(),
    verify: async () => verdict((await page.locator('nav[aria-label="看盤分頁"]').getByRole("button", { name: "K線" }).getAttribute("aria-pressed")) === "true", "K線 pressed"),
  });
  await step(page, {
    task: "02-3", n: 4, does: "按「+1 分」到 09:07，看快訊與前高", expected: "快訊「台積電 前高確認 2590」",
    act: () => advanceTo(page, "09:07"),
    verify: async () => {
      const alert = await text(d.alert);
      return verdict(alert.includes("前高確認") && alert.includes("2590"), alert);
    },
  });
  await step(page, {
    task: "02-4", n: 1, does: "右側點「五檔」，讀買1、賣1與最新分鐘收價", expected: workbook["02-4"].expect,
    act: () => page.locator('nav[aria-label="下單行情分類"] button', { hasText: "五檔" }).click(),
    verify: async () => {
      const tag = await text(page.locator(".td-book-head .td-chip"));
      const mid = await text(page.locator(".td-ladder-mid"));
      const book = await text(d.heroBook);
      return verdict(tag.includes("教學模擬五檔") && mid.includes("2580") && book.includes("2580") && book.includes("2585"), `${tag} · mid ${mid} · hero ${book}`);
    },
  });
  await step(page, {
    task: "02-5", n: 1, does: "右側點「分鐘明細」", expected: "列出已完成的分鐘，最新在最上面",
    act: () => page.locator('nav[aria-label="下單行情分類"] button', { hasText: "分鐘明細" }).click(),
    verify: async () => {
      const table = page.locator('[aria-label="最近已完成分鐘明細"]');
      const rows = await table.locator("tbody tr").count();
      const times = (await table.locator("tbody tr").allTextContents()).map((row) => row.match(/\d{2}:\d{2}/)?.[0] ?? "");
      const newestFirst = times.length > 1 && times[0] > times[1];
      return verdict(rows > 0 && rows <= 10 && newestFirst && times[0] >= "09:06", `${rows} rows · ${times.slice(0, 3).join(", ")}`);
    },
  });
  await step(page, {
    task: "02-6", does: "復盤欄空白就按保存", kind: "recovery", expected: "不能保存空白復盤",
    act: async () => {
      await page.locator('[aria-label="歷史行情重播控制"] button', { hasText: "復盤" }).click();
      await d.review.locator("textarea").fill("");
    },
    verify: async () => {
      const save = page.getByRole("button", { name: "保存復盤，完成這一輪" });
      const disabled = await save.isDisabled().catch(() => false);
      if (!disabled) await save.click().catch(() => {});
      await page.waitForTimeout(800);
      const saved = await page.getByText("已保存 · 這是操作足跡，不是獲利能力評分").isVisible().catch(() => false);
      return verdict(!saved, disabled ? "save disabled while empty" : saved ? "an empty review was saved" : "not saved");
    },
  });
  await step(page, {
    task: "02-6", n: 5, does: "寫 1–3 句觀察，按「保存復盤，完成這一輪」", expected: workbook["02-6"].expect, kind: "completion",
    act: () => finishRound(page, "台積電開在昨收附近，09:07 出現前高 2590；我會讀最新價、漲跌與五檔了。"),
    verify: async () => {
      const card = await text(page.locator("section", { hasText: "已保存 · 這是操作足跡，不是獲利能力評分" }).last());
      const ok = card.includes("寫下自己的計畫") && card.includes("完成這一輪復盤");
      return verdict(ok, card.slice(0, 260));
    },
  });
}

/* ── LEVEL 03 ── */
async function level03(page) {
  currentLevel = "L03";
  const d = desk(page);
  await step(page, {
    task: "03-1", n: 1, does: "完成卡按「寫新計畫，再練一輪」並選「回測平盤」", expected: "回測平盤、關注 2330",
    act: async () => {
      await page.getByRole("button", { name: "寫新計畫，再練一輪" }).click();
      await page.getByRole("radio", { name: /回測平盤/ }).click();
    },
    verify: async () => {
      const chosen = (await page.getByRole("radio", { name: /回測平盤/ }).getAttribute("aria-checked")) === "true";
      await page.locator(".td-plan-details summary").click().catch(() => {});
      const focus = await page.getByLabel("先關注哪一檔").inputValue().catch(() => "");
      observed.plan03 = {
        bias: await page.getByLabel("觀察偏多條件").inputValue().catch(() => ""),
        entry: await page.getByLabel(/什麼條件出現，我才考慮操作/).inputValue().catch(() => ""),
        stop: await page.getByLabel(/什麼情況代表計畫失效/).inputValue().catch(() => ""),
      };
      return verdict(chosen && focus === "2330", `回測平盤=${chosen} focus=${focus}`);
    },
  });
  await step(page, {
    task: "03-1", n: 6, does: "按「用這個計畫開始」", expected: workbook["03-1"].expect,
    act: () => page.getByRole("button", { name: "用這個計畫開始" }).click(),
    verify: async () => {
      await page.waitForFunction(() => document.querySelector(".td-clock strong")?.textContent?.trim() === "09:01", null, { timeout: 20000 }).catch(() => {});
      const plan = await text(page.locator(".td-plan-note"));
      return verdict((await clock(page)) === "09:01" && plan.includes("2330"), `${await clock(page)} · ${plan.slice(0, 60)}`);
    },
  });
  await step(page, {
    task: "03-2", n: 3, does: "逐分鐘前進到 09:20", expected: workbook["03-2"].expect,
    act: () => advanceTo(page, "09:20"),
    verify: async () => {
      const alert = await text(d.alert);
      const price = await text(d.heroPrice);
      return verdict(alert.includes("站上昨收") && alert.includes("2575") && price.includes("2580"), `${alert} · ${price}`);
    },
  });
  await step(page, {
    task: "03-3", n: 5, does: "讀下單票：買進、市價、1 張的金額", expected: workbook["03-3"].expect,
    verify: async () => {
      const buy = (await d.side.getByRole("button", { name: "買進" }).getAttribute("aria-pressed")) === "true";
      const market = (await d.type.getByRole("button", { name: "市價" }).getAttribute("aria-pressed")) === "true";
      const facts = await text(d.facts);
      const submit = await text(d.submit);
      return verdict(buy && market && facts.includes("2,580,000") && facts.includes("8,282") && facts.includes("10,000,000") && flat(submit).includes("核對模擬買進1張"), `${facts} · ${submit}`);
    },
  });
  await step(page, {
    task: "03-4", does: "確認卡按「返回修改」", kind: "recovery", expected: "回到下單票，沒有送出委託",
    act: async () => {
      await d.submit.click();
      await page.locator("#sim-confirm-title").waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "返回修改" }).click();
      await page.waitForTimeout(500);
    },
    verify: async () => {
      const state = await serverState(page);
      return verdict(state.orders.length === 0 && (await d.submit.isVisible()), `orders ${state.orders.length}`);
    },
  });
  await step(page, {
    task: "03-4", n: 5, does: "核對確認卡後按「確認送出模擬買進」", expected: workbook["03-4"].expect,
    act: async () => {
      await d.submit.click();
      const confirm = await text(d.confirm);
      if (!confirm.includes("1,000 股") || !confirm.includes("市價模擬")) throw new Error(`confirm card: ${confirm.slice(0, 120)}`);
      await page.getByRole("button", { name: "確認送出模擬買進" }).click();
    },
    verify: async () => {
      const pending = await page.getByText("委託已送出 · 等待撮合").waitFor({ timeout: 10000 }).then(() => true, () => false);
      const feedback = await text(d.feedback);
      return verdict(pending && feedback.includes("尚未代表成交"), feedback);
    },
  });
  await step(page, {
    task: "03-5", n: 3, does: "看委託、成交、庫存三個分頁", expected: workbook["03-5"].expect,
    act: () => ledgerTab(page, "委託"),
    verify: async () => {
      const orders = await text(d.ledger);
      await ledgerTab(page, "成交");
      const fills = await text(d.ledger);
      await ledgerTab(page, "庫存");
      const positions = await text(d.ledger);
      observed.l03 = await screenLedger(page);
      return verdict(orders.includes("待撮合") && fills.includes("尚無模擬成交") && positions.includes("目前沒有庫存"), `${orders.slice(0, 60)} | ${fills.slice(0, 30)} | ${positions.slice(0, 30)}`);
    },
  });
}

/* ── LEVEL 04 ── */
async function level04(page) {
  currentLevel = "L04";
  const d = desk(page);
  await step(page, {
    task: "04-1", n: 1, does: "按「前進一分鐘撮合」", expected: workbook["04-1"].expect,
    act: () => page.getByRole("button", { name: "前進一分鐘撮合" }).click(),
    verify: async () => {
      await page.waitForFunction(() => document.querySelector(".td-alert")?.textContent?.includes("成交"), null, { timeout: 15000 }).catch(() => {});
      const alert = await text(d.alert);
      const account = await text(d.account);
      return verdict(alert.includes("買進 1 張") && alert.includes("2575") && account.includes("-2,202") && account.includes("7,422,798"), `${alert} · ${account}`);
    },
  });
  await step(page, {
    task: "04-2", n: 2, does: "看成交與庫存分頁", expected: workbook["04-2"].expect,
    act: () => ledgerTab(page, "成交"),
    verify: async () => {
      const fills = await text(d.ledger);
      await ledgerTab(page, "庫存");
      const positions = await text(d.ledger);
      return verdict(fills.includes("2575") && fills.includes("2,202") && positions.includes("1 張") && positions.includes("2,575.00"), `${fills.slice(0, 80)} | ${positions.slice(0, 80)}`);
    },
  });
  await step(page, {
    task: "04-2", does: "重新整理頁面", kind: "recovery", expected: "回到同一輪：時鐘、庫存與損益都保留",
    act: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    },
    verify: async () => {
      const account = await text(d.account);
      return verdict((await clock(page)) === "09:21" && account.includes("-2,202"), `${await clock(page)} · ${account}`);
    },
  });
  // Overselling, two ways a student can try it; both must be refused on the ticket and send nothing.
  const sentBefore = { screen: 0, server: 0 };
  await step(page, {
    task: "04-3", does: "賣出時想把張數加到 2 張（只持有 1 張）", kind: "recovery", expected: "「增加一張」停用、張數停在 1、可賣出庫存 1 張；沒有送出任何委託",
    act: async () => {
      sentBefore.screen = (await screenLedger(page)).orders.rows.length;
      sentBefore.server = (await serverState(page)).orders.length;
      await d.side.getByRole("button", { name: "賣出" }).click();
      const plus = page.getByRole("button", { name: "增加一張" });
      if (await plus.isEnabled()) await plus.click();
      await page.waitForTimeout(300);
    },
    verify: async () => {
      const plusDisabled = await page.getByRole("button", { name: "增加一張" }).isDisabled();
      const lots = number(await text(page.locator("#sim-lots-value")));
      const facts = await text(d.facts);
      const orders = (await screenLedger(page)).orders.rows.length;
      const server = (await serverState(page)).orders.length;
      return verdict(plusDisabled && lots === 1 && /可賣出庫存\s*1 張/.test(facts) && orders === sentBefore.screen && server === sentBefore.server, `lots ${lots} · 增加一張 disabled=${plusDisabled} · ${facts.match(/可賣出庫存[^張]*張/)?.[0]} · 委託 ${sentBefore.screen}→${orders} (server ${sentBefore.server}→${server})`);
    },
  });
  await step(page, {
    task: "04-3", does: "先在買進設成 2 張，再切到賣出", kind: "recovery", expected: "切到賣出時張數自動降為可賣出庫存 1 張，「增加一張」停用，不出現錯誤；沒有送出任何委託",
    act: async () => {
      await d.side.getByRole("button", { name: "買進" }).click();
      await page.getByRole("button", { name: "增加一張" }).click();
      page.__lotsOnBuy = number(await text(page.locator("#sim-lots-value")));
      await d.side.getByRole("button", { name: "賣出" }).click();
      await page.waitForTimeout(300);
    },
    verify: async () => {
      // morning-trading.tsx: the 賣出 button clamps the lots to the holding (changeLots(Math.min(lots, holdingLots))).
      const lots = number(await text(page.locator("#sim-lots-value")));
      const plusDisabled = await page.getByRole("button", { name: "增加一張" }).isDisabled();
      const ticket = await text(page.locator("section.sim-ticket"));
      const warned = ticket.includes("賣出張數超過庫存");
      const orders = (await screenLedger(page)).orders.rows.length;
      const server = (await serverState(page)).orders.length;
      return verdict(page.__lotsOnBuy === 2 && lots === 1 && plusDisabled && !warned && orders === sentBefore.screen && server === sentBefore.server, `買進端 ${page.__lotsOnBuy} 張 → 賣出端 ${lots} 張 · 增加一張 disabled=${plusDisabled} · warning ${warned} · 委託 ${sentBefore.screen}→${orders} (server ${sentBefore.server}→${server})`);
    },
  });
  await step(page, {
    task: "04-3", n: 3, does: "賣出、限價 2595、1 張，確認送出", expected: "留單等待：限價 2595",
    act: async () => {
      await d.side.getByRole("button", { name: "賣出" }).click();
      await d.type.getByRole("button", { name: "限價" }).click();
      await page.locator("#morning-limit-price").fill("2595");
      await d.submit.click();
      if (!(await text(d.confirm)).includes("限價 2595")) throw new Error("confirm card does not say 限價 2595");
      await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
    },
    verify: has(d.pending, "2595"),
  });
  await step(page, {
    task: "04-3", n: 5, does: "不前進，直接按「撤回委託」", expected: workbook["04-3"].expect,
    act: () => d.pending.getByRole("button", { name: "撤回委託" }).click(),
    verify: async () => {
      await ledgerTab(page, "委託");
      const orders = await text(d.ledger);
      return verdict(orders.includes("已撤回") && orders.includes("由學員取消") && orders.includes("已成交"), orders.slice(0, 160));
    },
  });
  await step(page, {
    task: "04-4", n: 2, does: "逐分鐘前進到 09:37", expected: "快訊「台積電 跌破昨收 2575」",
    act: () => advanceTo(page, "09:37"),
    verify: has(d.alert, "跌破昨收"),
  });
  await step(page, {
    task: "04-4", n: 5, does: "賣出、市價、1 張，確認送出後前進撮合", expected: workbook["04-4"].expect,
    act: async () => {
      await d.side.getByRole("button", { name: "賣出" }).click();
      await d.type.getByRole("button", { name: "市價" }).click();
      await d.submit.click();
      await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
      await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
      await page.waitForTimeout(1200);
    },
    verify: async () => {
      await ledgerTab(page, "成交");
      const fills = await text(d.ledger);
      const account = await text(d.account);
      await ledgerTab(page, "庫存");
      const positions = await text(d.ledger);
      return verdict(fills.includes("2570") && fills.includes("3,855") && account.includes("-13,254") && account.includes("9,986,746") && positions.includes("目前沒有庫存"), `${fills.slice(0, 90)} | ${account}`);
    },
  });
  await step(page, {
    task: "04-5", n: 4, does: "用成交紀錄算淨損益並和本輪損益對帳", expected: workbook["04-5"].expect,
    verify: async () => {
      // The workbook's round: market buy sent at 09:20 (03-4), market sell sent at 09:37 (04-4), 2026-10-06.
      const round = await roundOnScreen(page, [
        { code: "2330", side: "買進", lots: 1, at: "09:20" },
        { code: "2330", side: "賣出", lots: 1, at: "09:37" },
      ]);
      observed.l04 = round;
      const cancelled = round.ledger.orders.rows.some((row) => row["狀態"] === "已撤回" && row.reason.includes("由學員取消"));
      return verdict(round.ok && cancelled && round.date === "2026-10-06", `${round.actual} · 已撤回 ${cancelled}`);
    },
  });
  await step(page, {
    task: "04-6", n: 5, does: "前進到 10:00，按「現在寫復盤」並保存", expected: workbook["04-6"].expect, kind: "completion",
    act: async () => {
      await advanceTo(page, "10:00");
      await page.getByRole("heading", { name: "10:00，回看自己的計畫" }).waitFor({ timeout: 15000 });
      await finishRound(page, "09:20 站上昨收才送出市價買進 1 張，成交 2575；09:37 跌破昨收依計畫賣出，成交 2570。本輪 −13,254 元。");
    },
    verify: async () => {
      const card = await text(page.locator("section", { hasText: "已保存 · 這是操作足跡，不是獲利能力評分" }).last());
      return verdict(card.includes("完成這一輪復盤") && card.includes("照計畫的股票操作") && card.includes("收盤前不留倉"), card.slice(0, 200));
    },
  });
}

/* ── shared round helpers for LEVEL 05, 06 and FINAL ── */
const TICKS = [[10, 0.01], [50, 0.05], [100, 0.1], [500, 0.5], [1000, 1], [Infinity, 5]];
const tickOf = (price) => TICKS.find(([limit]) => price < limit)[1];
const number = (value) => Number(String(value).replace(/[^\d.-]/g, ""));
async function toLobby(page) {
  await page.getByRole("link", { name: /大廳/ }).first().click();
  await page.getByRole("heading", { name: "今天三件事" }).waitFor({ timeout: 20000 });
}
/** From the lobby course card, as the workbook says; a finished round of that course shows first. */
async function openCourse(page, course) {
  const card = page.locator(`article[data-course="${course}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("link", { name: /開始這個練習|開始第/ }).click();
  const restart = page.getByRole("button", { name: "寫新計畫，再練一輪" });
  const custom = page.getByRole("radio", { name: /自己寫/ });
  await Promise.race([restart.waitFor({ timeout: 20000 }), custom.waitFor({ timeout: 20000 })]).catch(() => {});
  if (await restart.isVisible().catch(() => false)) await restart.click();
  await custom.waitFor({ timeout: 20000 });
}
async function chooseDay(page, date) {
  const select = page.locator('select[aria-label="教材交易日"]');
  const value = await select.locator("option", { hasText: date }).getAttribute("value");
  await select.selectOption(value);
  await page.getByRole("radio", { name: /自己寫/ }).waitFor({ timeout: 20000 });
}
async function customPlan(page, { reason, entry, stop }) {
  roundOrders = [];
  await page.getByRole("radio", { name: /自己寫/ }).click();
  await page.getByLabel(/我觀察的理由/).fill(reason);
  await page.getByLabel(/什麼條件出現，我才考慮操作/).fill(entry);
  await page.getByLabel(/什麼情況代表計畫失效/).fill(stop);
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await page.waitForFunction(() => document.querySelector(".td-clock strong")?.textContent?.trim() === "09:01", null, { timeout: 20000 });
}
/** Market order of `lots` on the selected stock, confirmed, then one minute forward to fill. */
async function marketOrder(page, side, lots = 1) {
  const d = desk(page);
  await d.side.getByRole("button", { name: side }).click();
  await d.type.getByRole("button", { name: "市價" }).click();
  for (let i = 1; i < lots; i++) await page.getByRole("button", { name: "增加一張" }).click();
  roundOrders.push({ code: await page.locator('select[aria-label="選擇股票"]').inputValue(), side, lots, at: await clock(page) });
  await d.submit.click();
  await page.getByRole("button", { name: `確認送出模擬${side}` }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await page.waitForTimeout(1200);
}
function completionCard(page) {
  return page.locator("section", { hasText: "已保存 · 這是操作足跡，不是獲利能力評分" }).last();
}

/* ── LEVEL 05 ── */
async function level05(page) {
  currentLevel = "L05";
  const d = desk(page);
  await toLobby(page);
  await step(page, {
    task: "05-2", n: 1, does: "大廳第 2 課卡片按「開始這個練習」", expected: "第 2 課的作戰計畫",
    act: () => openCourse(page, 2),
    verify: has(d.subject, "核對部位與風險"),
  });
  await step(page, {
    task: "05-2", n: 2, does: "交易日改成 2026-10-05", expected: "作戰計畫直接打開，狀態列顯示「核對部位與風險」",
    act: () => chooseDay(page, "2026-10-05"),
    verify: async () => {
      const day = await text(page.locator('select[aria-label="教材交易日"] option:checked'));
      return verdict(day.includes("2026-10-05") && (await text(d.subject)).includes("核對部位與風險"), day);
    },
  });
  await step(page, {
    task: "05-2", n: 4, does: "「自己寫」三格後按「保存計畫，進入 09:00 練習」", expected: "時鐘 09:01，第 2 課開始",
    // The plan's own numbers (entry 2550, stop 2540, loss 20,000) go into the risk budget table; the first run used
    // a 30,000 budget with a stop one tick under 昨收, which the table would have turned into 0 lots (test data fixed).
    act: () => customPlan(page, { reason: "觀察台積電開盤後能不能站穩 2550", entry: "09:05 看到的收價站上 2550 就買 1 張；可承受損失 20,000 元，最多 1 張", stop: "跌破 2540 全部賣；沒跌破就在 09:40 賣出，10:00 前處理完部位" }),
    verify: async () => {
      observed.risk05 = { entry: 2550, stop: 2540, loss: 20000 };
      return verdict((await clock(page)) === "09:01", await clock(page));
    },
  });
  // 05-1: the fee threshold, read on the ticket of each stock (buy, market, 1 lot).
  const expectedTicks = { 2330: 2, 2317: 2, 2308: 2, 2382: 3, 2454: 4 };
  for (const code of ["2330", "2317", "2454", "2382", "2308"]) {
    await step(page, {
      task: "05-1", n: 4, does: `${code}：讀預估來回費稅，算至少幾檔`, expected: `參考表：至少 ${expectedTicks[code]} 檔（以昨收估算）`,
      act: () => page.locator('select[aria-label="選擇股票"]').selectOption(code),
      verify: async () => {
        const state = await serverState(page);
        const symbol = (await serverRun(page)).catalog.symbols.find((item) => item.code === code);
        const cost = number((await text(d.facts.locator("div").nth(1))).replace("預估來回費稅（假設同價出場）", ""));
        const ticks = Math.ceil(cost / 1000 / tickOf(symbol.previousClose) - 1e-9);
        observed.fees.push({ code, cost, tick: tickOf(symbol.previousClose), ticks });
        return verdict(ticks === expectedTicks[code], `來回費稅 ${cost} · 一檔 ${tickOf(symbol.previousClose)} · 至少 ${ticks} 檔 (昨收 ${symbol.previousClose}; 現價 ${state.bars[code].at(-1)?.c})`);
      },
    });
  }
  await page.locator('select[aria-label="選擇股票"]').selectOption("2330");
  await step(page, {
    task: "05-2", does: "張數按 4 次「增加一張」", kind: "recovery", expected: "每筆最多 3 張",
    act: async () => {
      for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "增加一張" }).click().catch(() => {});
    },
    verify: async () => {
      const lots = number(await text(page.locator("#sim-lots-value")));
      const plusDisabled = await page.getByRole("button", { name: "增加一張" }).isDisabled();
      for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "減少一張" }).click().catch(() => {});
      return verdict(lots === 3 && plusDisabled, `lots ${lots} · 增加一張 disabled=${plusDisabled}`);
    },
  });
  await step(page, {
    task: "05-2", n: 5, does: "09:05 依計畫買進 1 張並撮合", expected: "成交價是下一分鐘開盤價；庫存 1 張",
    act: async () => {
      await advanceTo(page, "09:05");
      await marketOrder(page, "買進");
    },
    verify: async () => {
      // The budget first: ⑧ = ⑦ ÷ (③ × 1,000 + ⑤), rounded down, at most 3 — the plan says at most 1 lot.
      const fee = observed.fees.find((item) => item.code === "2330").cost;
      const risk = observed.risk05;
      risk.fee = fee;
      risk.perLot = (risk.entry - risk.stop) * 1000 + fee;
      risk.maxLots = Math.min(3, Math.floor(risk.loss / risk.perLot));
      const fill = await fillOnScreen(page);
      const holding = fill.ledger.positions.rows[0]?.["持有張數"];
      return verdict(risk.maxLots >= 1 && fill.ok && holding === "1 張", `⑧ ${risk.maxLots} 張 (⑥ ${risk.perLot}) · ${fill.actual} · 庫存 ${holding}`);
    },
  });
  await step(page, {
    task: "05-2", n: 6, does: "09:40 依計畫賣出並核對庫存", expected: "庫存歸零",
    act: async () => {
      await advanceTo(page, "09:40");
      await marketOrder(page, "賣出");
    },
    verify: async () => {
      // The stop (跌破 2540) never came before 09:40 in the fixed day, so the time rule decided the exit.
      const date = await tradingDay(page);
      const broke = barsOf(date, "2330").find(([seconds, , , , close]) => seconds >= 5 * 60 && seconds < 40 * 60 && close < 2540);
      const round = await roundOnScreen(page);
      observed.l05_2 = round;
      return verdict(!broke && round.ok, `stop before 09:40: ${broke ? minuteOf(broke[0]) : "none"} · ${round.actual}`);
    },
  });
  await step(page, {
    task: "05-2", n: 7, does: "10:00 前按「復盤」，回答第 2 課問題並保存", expected: workbook["05-2"].expect, kind: "completion",
    act: () => finishRound(page, "09:05 依計畫買 1 張，09:40 依時間條件賣出；張數沒有超過計畫，成交後都核對了庫存。"),
    verify: async () => {
      const card = await text(completionCard(page));
      return verdict(card.includes("照計畫的股票操作") && card.includes("收盤前不留倉"), card.slice(0, 160));
    },
  });

  await toLobby(page);
  await step(page, {
    task: "05-3", n: 1, does: "大廳第 3 課卡片開始，寫價格＋時間兩種出場條件", expected: "第 3 課開始",
    act: async () => {
      await openCourse(page, 3);
      await customPlan(page, { reason: "練習條件成立就出場", entry: "09:05 買進台積電 1 張", stop: "跌破昨收一檔就賣；09:30 一到無論如何賣出" });
    },
    verify: async () => verdict((await clock(page)) === "09:01", `${await clock(page)} · ${await text(d.subject)}`),
  });
  await step(page, {
    task: "05-3", n: 5, does: "09:05 買進，09:30 時間條件成立就賣出", expected: workbook["05-3"].expect,
    act: async () => {
      await advanceTo(page, "09:05");
      await marketOrder(page, "買進");
      await advanceTo(page, "09:30");
      await marketOrder(page, "賣出");
    },
    verify: async () => {
      const date = await tradingDay(page);
      const stop = previousClose(date, "2330") - tickOf(previousClose(date, "2330"));
      // Closes the student saw while holding (clock 09:06 … 09:30 shows the closes of 09:05 … 09:29).
      const broke = barsOf(date, "2330").find(([seconds, , , , close]) => seconds >= 5 * 60 && seconds < 30 * 60 && close <= stop);
      const round = await roundOnScreen(page);
      observed.l05_3 = { ...round, stop };
      return verdict(!broke && round.ok, `price exit ≤ ${stop} before 09:30: ${broke ? minuteOf(broke[0]) : "none"} · ${round.actual}`);
    },
  });
  await step(page, {
    task: "05-3", n: 6, does: "寫第 3 課復盤並保存", expected: "完成卡出現", kind: "completion",
    act: () => finishRound(page, "09:30 時間條件成立就賣出，沒有把出場延後。"),
    verify: async () => verdict((await text(completionCard(page))).includes("完成這一輪復盤"), (await text(completionCard(page))).slice(0, 120)),
  });

  await toLobby(page);
  await step(page, {
    task: "05-4", n: 1, does: "大廳第 4 課卡片開始，交易日換成 2026-10-05，寫突破確認條件", expected: "先看到 10/05 上一輪的完成卡時往下捲按「寫新計畫，再練一輪」；狀態列回到第 4 課、計畫打開",
    act: async () => {
      await openCourse(page, 4);
      const subjectBefore = await text(d.subject);
      const select = page.locator('select[aria-label="教材交易日"]');
      await select.selectOption(await select.locator("option", { hasText: "2026-10-05" }).getAttribute("value"));
      await page.waitForTimeout(2500);
      const restart = page.getByRole("button", { name: "寫新計畫，再練一輪" });
      const sawCard = await restart.isVisible().catch(() => false);
      const subjectOnCard = await text(d.subject);
      if (sawCard) {
        await restart.scrollIntoViewIfNeeded();
        await restart.click();
      }
      await page.getByRole("radio", { name: /自己寫/ }).waitFor({ timeout: 20000 });
      const subjectAfter = await text(d.subject);
      page.__dayswitch = { subjectBefore, sawCard, subjectOnCard, subjectAfter };
      await customPlan(page, { reason: "觀察前高與突破", entry: "收價站上前高才買 1 張", stop: "跌回前高下方就賣；10:00 前處理完" });
    },
    verify: async () => {
      const info = page.__dayswitch ?? {};
      const day = await text(page.locator('select[aria-label="教材交易日"] option:checked'));
      return verdict((await clock(page)) === "09:01" && day.includes("2026-10-05") && info.subjectAfter === info.subjectBefore, `card shown ${info.sawCard} (status ${info.subjectOnCard}) → after 寫新計畫 ${info.subjectAfter} · ${day} · ${await clock(page)}`);
    },
  });
  const highs = [];
  await step(page, {
    task: "05-4", n: 3, does: "切到「K線」逐分鐘前進到 10:00，記下前高確認", expected: "記下前高的時間與價格",
    act: async () => {
      await page.locator('nav[aria-label="看盤分頁"]').getByRole("button", { name: "K線" }).click();
      for (let guard = 0; guard < 80 && (await clock(page)) < "10:00"; guard++) {
        await plusOne(page).catch(() => {});
        const alert = await text(d.alert);
        if (alert.includes("前高確認") && !highs.includes(alert)) highs.push(alert);
      }
    },
    verify: async () => {
      observed.highs = highs.map((alert) => alert.match(/(\d{2}:\d{2})\s*(\S+?)\s*前高確認\s*([\d.]+)/)).filter(Boolean).map(([, time, name, price]) => ({ time, name, price: Number(price) }));
      return verdict(highs.length > 0, highs.join(" | ") || "no 前高確認 alert before 10:00");
    },
  });
  await step(page, {
    task: "05-4", n: 6, does: "形態沒完成就不交易，保存復盤", expected: workbook["05-4"].expect, kind: "completion",
    act: () => finishRound(page, `前高：${highs.join("；")}。沒有看到收價站上前高，所以不交易。`),
    verify: async () => {
      // The plan watches the focus stock (2330): buy only when a close is above its 前高. Whether that ever happened
      // before 10:00 is read from the fixed day file (no 前高確認 for 2330 at all also means: no trade).
      const date = await tradingDay(page);
      const high = observed.highs.find((item) => item.name.includes("台積電"));
      const crossed = high && barsOf(date, "2330").find(([seconds, , , , close]) => minuteOf(seconds + 60) > high.time && seconds < 60 * 60 && close > high.price);
      observed.l05_4 = { date, high: high ?? null, crossed: crossed ? minuteOf(crossed[0] + 60) : null };
      const ledger = await screenLedger(page);
      const state = await serverState(page);
      return verdict(observed.highs.length > 0 && !crossed && ledger.orders.empty === "尚未送出委託" && state.orders.length === 0, `${date} 台積電 前高 ${high ? `${high.time} ${high.price}` : "none before 10:00"} · close above before 10:00: ${crossed ? minuteOf(crossed[0] + 60) : "none"} · other 前高 ${observed.highs.map((item) => `${item.time} ${item.name} ${item.price}`).join(", ")} · 委託 ${ledger.orders.empty ?? ledger.orders.rows.length} · server orders ${state.orders.length}`);
    },
  });

  await toLobby(page);
  await step(page, {
    task: "05-5", n: 1, does: "大廳第 5 課卡片開始（有完成卡就往下捲按寫新計畫），寫等待條件", expected: "狀態列是第 5 課，時鐘 09:01",
    act: async () => {
      await openCourse(page, 5);
      await customPlan(page, { reason: "練習等待", entry: "站上前高且回測不破才買", stop: "條件沒出現就不交易" });
    },
    verify: async () => {
      const subject = await text(d.subject);
      return verdict((await clock(page)) === "09:01" && subject.includes("第 5 課"), `${subject} · ${await clock(page)}`);
    },
  });
  await step(page, {
    task: "05-5", n: 3, does: "前進到 10:00，選「延伸觀察至 10:30」", expected: "可以延伸觀察到 10:30",
    act: async () => {
      for (const time of ["09:15", "09:30", "10:00"]) {
        await advanceTo(page, time);
        observed.waits.push({ ...(await heroQuote(page)), alert: await text(d.alert) });
      }
      await page.getByRole("button", { name: "延伸觀察至 10:30" }).click();
    },
    verify: async () => {
      const ok = await page.waitForFunction(() => !document.querySelector('button[aria-label="前進 1 分鐘"]')?.disabled, null, { timeout: 10000 }).then(() => true, () => false);
      return verdict(ok, `前進 1 分鐘 enabled after extending: ${ok}`);
    },
  });
  await step(page, {
    task: "05-5", n: 4, does: "前進到 10:30", expected: "畫面寫著「已到 10:30，本課沒有下一分鐘」",
    act: () => advanceTo(page, "10:30"),
    verify: async () => {
      const body = await text(page.locator("body"));
      return verdict(body.includes("本課沒有下一分鐘") && body.includes("10:30"), body.match(/[^。]{0,30}本課沒有下一分鐘[^。]*。/)?.[0] ?? "message not found");
    },
  });
  await step(page, {
    task: "05-5", n: 6, does: "保存第 5 課復盤，看完成卡", expected: instruction("05-5", 6), kind: "completion",
    act: () => finishRound(page, "整輪條件都沒有出現，所以沒有送單；等待也是決定。"),
    verify: async () => {
      const card = await text(completionCard(page));
      // The workbook's own sentence decides what the card must list (the old edition promised 先觀察…).
      const promised = [...instruction("05-5", 6).matchAll(/「([^」]+)」/g)].map((match) => match[1]).filter((item) => item !== "保存");
      return verdict(promised.length > 0 && promised.every((item) => card.includes(item)), `promised ${promised.join("／")} · card ${card.slice(0, 160)}`);
    },
  });
}

/* ── LEVEL 06 ── */
async function level06(page) {
  currentLevel = "L06";
  const d = desk(page);
  await toLobby(page);
  await step(page, {
    task: "06-1", n: 3, does: "第 6 課卡片開始，「自己寫」在理由寫下要檢查的一個習慣", expected: workbook["06-1"].expect,
    act: async () => {
      await openCourse(page, 6);
      await customPlan(page, { reason: "檢查的習慣：每次成交後立刻核對庫存", entry: "09:20 站上昨收才買 1 張", stop: "跌破昨收就賣出；10:00 前處理完" });
    },
    verify: async () => {
      const subject = await text(d.subject);
      const plan = await text(page.locator(".td-plan-note"));
      return verdict(subject.includes("用紀錄完成復盤") && (await clock(page)) === "09:01", `${subject} · ${plan.slice(0, 50)}`);
    },
  });
  await step(page, {
    task: "06-2", n: 4, does: "09:20 依條件買進、09:37 依失效條件賣出", expected: "每個決定都有時間與條件",
    act: async () => {
      await advanceTo(page, "09:20");
      await marketOrder(page, "買進");
      observed.l06AfterBuy = (await screenLedger(page)).positions.rows[0] ?? null; // the habit: 庫存 right after the fill
      await advanceTo(page, "09:37");
      await marketOrder(page, "賣出");
    },
    verify: async () => {
      const round = await roundOnScreen(page);
      observed.l06 = round;
      return verdict(round.ok && observed.l06AfterBuy?.["持有張數"] === "1 張", `庫存 after buy ${observed.l06AfterBuy?.["持有張數"]} · ${round.actual}`);
    },
  });
  await step(page, {
    task: "06-3", n: 1, does: "按「教材」→「本輪作戰計畫」讀計畫原文", expected: "看得到開始前寫的計畫",
    act: async () => {
      await advanceTo(page, "10:00");
      await page.locator('button.td-tool[aria-controls="td-resources"]').click();
      await page.locator("#td-resources summary", { hasText: "本輪作戰計畫" }).click();
    },
    verify: async () => {
      const drawer = await text(page.locator("#td-resources"));
      observed.plan06 = await text(page.locator("#td-resources details", { hasText: "本輪作戰計畫" }));
      await page.locator("#td-resources").getByRole("button", { name: "關閉" }).click();
      return verdict(drawer.includes("每次成交後立刻核對庫存"), drawer.slice(0, 120));
    },
  });
  await step(page, {
    task: "06-4", n: 2, does: "用成交紀錄算淨損益，和本輪損益對帳", expected: "算出的淨損益和狀態列一致",
    verify: () => roundOnScreen(page),
  });
  await step(page, {
    task: "06-6", n: 4, does: "回答第 6 課兩個問題，四段寫成復盤並保存", expected: workbook["06-6"].expect, kind: "completion",
    act: () => finishRound(page, "計畫：站上昨收再買。執行：09:20 買、09:37 跌破昨收賣。結果：淨損益與狀態列一致。改善：送單前先寫費稅門檻。"),
    verify: async () => {
      const card = await text(completionCard(page));
      return verdict(card.includes("先寫費稅門檻") && card.includes("完成這一輪復盤"), card.slice(0, 160));
    },
  });
  await step(page, {
    task: "06-6", does: "完成後想修改這一輪", kind: "recovery", expected: "已完成的一輪不能修改；只能寫新計畫再練一輪",
    verify: async () => {
      const edit = await page.getByRole("button", { name: /修改|編輯/ }).count();
      const again = await page.getByRole("button", { name: "寫新計畫，再練一輪" }).isVisible();
      return verdict(edit === 0 && again, `edit buttons ${edit} · 寫新計畫 ${again}`);
    },
  });
}

/* ── FINAL ── */
const FINAL_PLAN = { reason: "期末：觀察台積電開盤後能不能站穩 2560", entry: "09:03 看到的收價站上 2560 就買 1 張；可承受損失 20,000 元，最多 1 張", stop: "跌破 2550 全部賣；沒跌破就在 09:44 賣出，09:45 前處理完部位" };
async function finalMission(page) {
  currentLevel = "FINAL";
  const d = desk(page);
  await toLobby(page);
  await step(page, {
    task: "F-1", n: 1, does: "從大廳第 6 課卡片開始，先換交易日到 2026-10-05", expected: "新的作戰計畫，交易日 2026-10-05",
    act: async () => {
      await openCourse(page, 6);
      const select = page.locator('select[aria-label="教材交易日"]');
      await select.selectOption(await select.locator("option", { hasText: "2026-10-05" }).getAttribute("value"));
      await page.waitForTimeout(2500);
    },
    verify: async () => {
      // r2.1 step 1 sub-line: a finished round of that day may show first; 寫新計畫，再練一輪 then opens the plan.
      const planForm = await page.getByRole("radio", { name: /自己寫/ }).isVisible().catch(() => false);
      const restart = await page.getByRole("button", { name: "寫新計畫，再練一輪" }).isVisible().catch(() => false);
      const subject = await text(desk(page).subject);
      const promised = /往下捲按「寫新計畫，再練一輪」/.test(instruction("F-1", 1) + JSON.stringify(workbook["F-1"]));
      return verdict(planForm || (restart && promised), `plan form ${planForm} · finished-round card ${restart} (status ${subject}) · workbook explains the card ${promised}`);
    },
  });
  if (!(await page.getByRole("radio", { name: /自己寫/ }).isVisible().catch(() => false)))
    await step(page, {
      task: "F-1", does: "換日後出現那天上一輪的完成卡：按「寫新計畫，再練一輪」", kind: "recovery", expected: "回到第 6 課的新計畫（2026-10-05）",
      act: async () => {
        const restart = page.getByRole("button", { name: "寫新計畫，再練一輪" });
        await restart.scrollIntoViewIfNeeded();
        await restart.click();
        await page.getByRole("radio", { name: /自己寫/ }).waitFor({ timeout: 20000 });
      },
      verify: async () => {
        const subject = await text(desk(page).subject);
        const day = await text(page.locator('select[aria-label="教材交易日"] option:checked'));
        return verdict(subject.includes("用紀錄完成復盤") && day.includes("2026-10-05"), `${subject} · ${day}`);
      },
    });
  await step(page, {
    task: "F-1", n: 2, does: "寫好計畫，按「保存計畫，進入 09:00 練習」", expected: "時鐘 09:01",
    act: () => customPlan(page, FINAL_PLAN),
    verify: async () => {
      observed.planF1 = await text(page.locator(".td-plan-note"));
      return verdict((await clock(page)) === "09:01", `${await clock(page)} · ${observed.planF1.slice(0, 80)}`);
    },
  });
  let failed = 0;
  await step(page, {
    task: "F-1", does: "送出委託時網路中斷", kind: "recovery", expected: "畫面提示連不上，提供「重試這次操作」；重試後只送出一筆",
    act: async () => {
      await advanceTo(page, "09:03");
      await page.route("**/api/morning**", async (route) => {
        if (route.request().method() === "POST" && failed === 0) {
          failed += 1;
          return route.abort("internetdisconnected");
        }
        return route.continue();
      });
      await d.side.getByRole("button", { name: "買進" }).click();
      await d.type.getByRole("button", { name: "市價" }).click();
      roundOrders.push({ code: await page.locator('select[aria-label="選擇股票"]').inputValue(), side: "買進", lots: 1, at: await clock(page) });
      await d.submit.click();
      await page.getByRole("button", { name: "確認送出模擬買進" }).click();
      await page.getByRole("button", { name: "重試這次操作" }).waitFor({ timeout: 15000 });
    },
    verify: async () => {
      const message = await text(page.locator("main"));
      const shown = message.includes("暫時連不上教室");
      await page.getByRole("button", { name: "重試這次操作" }).click();
      await page.getByText("委託已送出 · 等待撮合").waitFor({ timeout: 15000 }).catch(() => {});
      await page.unroute("**/api/morning**");
      const ledger = await screenLedger(page);
      const state = await serverState(page);
      return verdict(shown && ledger.orders.rows.length === 1 && state.orders.length === 1, `message ${shown} · 委託 on screen ${ledger.orders.rows.length} · server ${state.orders.length}`);
    },
  });
  // Product defect B-07 (fixed on the acceptance branch, not deployed): the reviewed confirm card stays after the
  // retried send. The workbook's F-1 trouble entry says to press 「返回修改」; the student does exactly that.
  if (await d.confirm.isVisible().catch(() => false))
    await step(page, {
      task: "F-1", does: "重試成功後舊的確認卡還在：照「遇到問題」按「返回修改」", kind: "recovery", expected: "確認卡關閉，委託分頁仍只有一筆",
      act: () => d.confirm.getByRole("button", { name: "返回修改" }).click(),
      verify: async () => {
        const closed = !(await d.confirm.isVisible().catch(() => false));
        const ledger = await screenLedger(page);
        const told = /返回修改/.test(JSON.stringify(workbook["F-1"]));
        return verdict(closed && ledger.orders.rows.length === 1 && told, `card closed ${closed} · 委託 ${ledger.orders.rows.length} · workbook names 返回修改 ${told} · product defect B-07 seen on this release`);
      },
    });
  await step(page, {
    task: "F-1", n: 3, does: "前進撮合，成交後核對庫存", expected: "成交價是下一分鐘開盤價；庫存 1 張",
    act: async () => {
      await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
      await page.waitForTimeout(1200);
    },
    verify: async () => {
      const fill = await fillOnScreen(page);
      return verdict(fill.ok && fill.ledger.positions.rows[0]?.["持有張數"] === "1 張", `${fill.actual} · 庫存 ${fill.ledger.positions.rows[0]?.["持有張數"]}`);
    },
  });
  await step(page, {
    task: "F-1", n: 4, does: "09:45 前賣出，核對三個分頁", expected: "結束時庫存為 0",
    act: async () => {
      await advanceTo(page, "09:44");
      await marketOrder(page, "賣出");
    },
    verify: async () => {
      const date = await tradingDay(page);
      const broke = barsOf(date, "2330").find(([seconds, , , , close]) => seconds >= 3 * 60 && seconds < 44 * 60 && close < 2550);
      const round = await roundOnScreen(page);
      observed.f1 = round;
      return verdict(!broke && round.ok, `stop (跌破 2550) before 09:44: ${broke ? minuteOf(broke[0]) : "none"} · ${round.actual}`);
    },
  });
  await step(page, {
    task: "F-1", n: 5, does: "按「復盤」寫四段並保存", expected: workbook["F-1"].expect, kind: "completion",
    act: () => finishRound(page, "計畫：開盤守住昨收就買。執行：09:03 買 1 張、09:44 依時間條件賣出。結果：庫存 0，淨損益與狀態列一致。改善：送單前先寫下費稅門檻。"),
    verify: async () => {
      const card = await text(completionCard(page));
      return verdict(card.includes("完成這一輪復盤") && card.includes("收盤前不留倉"), card.slice(0, 160));
    },
  });
  await toLobby(page);
  await step(page, {
    task: "F-1", does: "回到大廳看今天的進度", expected: "大廳顯示今天完成了，並有等級列", kind: "completion",
    verify: async () => {
      const today = await text(page.locator(".today-card"));
      const strip = await text(page.locator(".level-strip"));
      return verdict(today.length > 0 && strip.includes("Lv"), `${today.slice(0, 60)} · ${strip}`);
    },
  });
}

/* ── the digital workbook: the same student writes what it saw, in a browser profile of its own ── */
const webDir = resolve(option("web", join(contentDir, "..", "output", "web")));
const portWeb = Number(option("port-web", "18886"));
const WEB_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const webServer = createServer((request, response) => {
  const path = normalize(join(webDir, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  const file = /[\\/]$/.test(path) ? join(path, "index.html") : path;
  if (!file.startsWith(webDir) || !existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": WEB_TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
const workbookUrl = `http://127.0.0.1:${portWeb}/index.html`;
const profiles = { student: await mkdtemp(join(tmpdir(), "journey-workbook-student-")), restore: await mkdtemp(join(tmpdir(), "journey-workbook-restore-")) };
const typed = {}; // data-field key → what the student wrote or chose
const ticked = new Set(); // data-check keys the student ticked
let wbContext = null;
let wb = null;
async function openWorkbook(profile = profiles.student) {
  const options = { viewport: VIEW, deviceScaleFactor: 1, acceptDownloads: true };
  wbContext = await chromium.launchPersistentContext(profile, options).catch(() => chromium.launchPersistentContext(profile, { ...options, channel: "chrome" }));
  wb = wbContext.pages()[0] ?? (await wbContext.newPage());
  await wb.goto(workbookUrl);
  await wb.waitForFunction(() => window.ACADEMY && window.ACADEMY_DEBUG);
  return wb;
}
const wbView = () => wb.locator(".w-view:not([hidden])");
/** Like a student: a visible link to the page (menu, level task list); the address only when none is on screen. */
async function wbGo(id) {
  const link = wb.locator(`a[href="#${id}"]:visible`).first();
  if (await link.count()) await link.click();
  else await wb.evaluate((target) => (location.hash = target), id);
  await wb.waitForFunction((target) => location.hash === `#${target}`, id, { timeout: 5000 });
  await wb.waitForTimeout(200);
}
async function put(key, value) {
  const field = wbView().locator(`[data-field="${key}"]`).first();
  const kind = await field.evaluate((node) => (node.tagName === "SELECT" ? "select" : node.type === "radio" ? "radio" : "text"));
  if (kind === "radio") await wbView().locator(`[data-field="${key}"][value="${value}"]`).check();
  else if (kind === "select") {
    const option = await field.locator("option").evaluateAll((options, wanted) => options.find((item) => item.value === wanted || item.textContent.includes(wanted))?.value ?? null, value);
    if (option === null) throw new Error(`${key}: no option "${value}"`);
    await field.selectOption(option);
    value = option;
  } else await field.fill(value);
  typed[key] = value;
}
const row = (prefix, index, cells) => cells.map((value, column) => (value === null ? null : [`${prefix}:${index}:${column}`, String(value)])).filter(Boolean);
const fillsOf = (round) => [...(round?.ledger.fills.rows ?? [])].reverse();
const feeTax = (fill) => String(fill["手續費 / 稅費"]).split("/").map(money);
const sideOf = (fill) => (fill["方向 / 張數"].startsWith("賣出") ? "賣出" : "買進");
const CODE = { 台積電: "2330", 鴻海: "2317", 聯發科: "2454", 廣達: "2382", 台達電: "2308" };
function totals(round) {
  const [buy, sell] = fillsOf(round);
  const diff = (money(sell["成交價"]) - money(buy["成交價"])) * money(buy["方向 / 張數"]) * 1000;
  const cost = [...feeTax(buy), ...feeTax(sell)].reduce((sum, value) => sum + value, 0);
  return { buy, sell, diff, cost, net: diff - cost };
}
/** The student's own work for each task, written from what the journey saw on the screen (and, for the 05-4
 *  pullback low, the minute data the chart draws). Self-checks are ticked only for tasks whose steps all passed. */
function worksOf(id) {
  const o = observed;
  switch (id) {
    case "01-6":
      return o.quotes.slice(0, 2).flatMap((quote, index) => row("01-6:quote", index, [quote.code, quote.time, money(quote.price), quote.change, quote.percent]));
    case "02-1":
      return (o.watch0905 ?? []).slice(0, 4).flatMap((item, index) => row("02-1:c0905", index, [item.code, money(item.price), { up: "漲", down: "跌" }[item.tone] ?? "平", item.percent]));
    case "03-1": {
      const close = previousClose("2026-10-06", "2330");
      const tick = tickOf(close);
      return [
        ...row("03-1:rule", 0, ["附近", `昨收 ${close} 上下一檔（${close - tick}–${close + tick}）`]),
        ...row("03-1:rule", 1, ["沒有跌破", `收價不低於 ${close - tick}`]),
        ...row("03-1:rule", 2, ["確認訊號", `收價回到昨收 ${close} 以上才送單`]),
      ];
    }
    case "03-5":
      return [...row("03-5:vs", 0, [null, o.l03?.fills.empty ?? ""]), ...row("03-5:vs", 1, [null, o.l03?.positions.empty ?? ""])];
    case "04-5": {
      const { buy, sell, diff, net } = totals(o.l04);
      const amounts = [money(buy["成交價"]) * 1000, money(sell["成交價"]) * 1000, diff, feeTax(buy)[0], feeTax(sell)[0], feeTax(buy)[1] + feeTax(sell)[1], feeTax(buy)[0] + feeTax(sell)[0] + feeTax(buy)[1] + feeTax(sell)[1], net];
      return amounts.flatMap((value, index) => row("04-5:ledger", index, [null, null, value]));
    }
    case "05-1":
      return o.fees.filter((item) => ["2330", "2317"].includes(item.code)).flatMap((item, index) => row("05-1:fee", index, [item.code, item.cost, (item.cost / 1000).toFixed(3), item.tick, item.ticks]));
    case "05-2": {
      const r = o.risk05;
      const values = [r.entry, r.stop, r.entry - r.stop, (r.entry - r.stop) * 1000, r.fee, r.perLot, r.loss, r.maxLots, `實際 1 張／${o.l05_2.shown.toLocaleString("en-US")} 元`];
      return values.flatMap((value, index) => row("05-2:risk", index, [null, value]));
    }
    case "05-3": {
      const sell = fillsOf(o.l05_3).find((fill) => sideOf(fill) === "賣出");
      return [
        ...row("05-3:exit", 0, [`跌破昨收一檔（${o.l05_3.stop}）就賣`, null, "沒有成立，繼續持有", "yes"]),
        ...row("05-3:exit", 1, ["09:30 一到無論如何賣出", sell.time, `${sell.time} 市價賣出 1 張，成交 ${sell["成交價"]}`, "yes"]),
        ...row("05-3:exit", 2, ["沒有部位時不為了練習進場", null, "09:05 依計畫買進後，09:30 賣出就不再進場", "yes"]),
      ];
    }
    case "05-4": {
      const date = o.l05_4.date;
      return o.highs
        .filter((high, index, list) => list.findIndex((item) => item.name === high.name) === index)
        .slice(0, 2)
        .flatMap((high, index) => {
          const code = CODE[high.name];
          const after = barsOf(date, code).filter(([seconds]) => minuteOf(seconds + 60) > high.time && seconds < 60 * 60);
          const low = after.reduce((best, bar) => (bar[3] < best[3] ? bar : best), after[0]);
          const crossed = after.find((bar) => bar[4] > high.price);
          return row("05-4:nshape", index, [code, `${high.time}／${high.price}`, `${minuteOf(low[0] + 60)}／${low[3]}`, crossed ? `是 ${minuteOf(crossed[0] + 60)}／${crossed[4]}` : "沒有（10:00 前收價沒有站上前高）", code !== "2330" ? "不是我計畫關注的股票，只觀察" : crossed ? "條件成立才考慮" : "形態沒完成，不交易"]);
        });
    }
    case "05-5":
      return o.waits.flatMap((wait, index) => row("05-5:wait", index, [wait.time, `${wait.name} ${wait.price} ${wait.change} ${wait.percent}${wait.alert ? `；${wait.alert}` : ""}`, "還沒有站上前高並回測不破", "不送單，繼續等", index === 1 ? "有點想追，但條件沒出現" : "還好，照計畫等"]));
    case "06-1":
      return [["06-1:habit", "1"]]; // 每次成交後立刻核對庫存 — the habit the journey wrote in the plan
    case "06-2": {
      const { buy, sell } = totals(o.l06);
      return [
        ...row("06-2:log", 0, ["09:01", "計畫：09:20 站上昨收才買 1 張", "先等", "還沒到 09:20"]),
        ...row("06-2:log", 1, [buy.time, `收價站上昨收 ${previousClose("2026-10-06", "2330")}`, "市價買進 1 張", `進場條件成立；成交後看庫存 ${o.l06AfterBuy?.["持有張數"]}`]),
        ...row("06-2:log", 2, [sell.time, "快訊：台積電 跌破昨收", "市價賣出 1 張", "失效條件成立"]),
      ];
    }
    case "06-3": {
      const orders = [...o.l06.ledger.orders.rows].reverse().map((item) => `${item.time} ${item["方向 / 張數"]} ${item["委託價"]} ${item["狀態"]}`).join("；");
      const fills = fillsOf(o.l06).map((item) => `${item.time} ${item["方向 / 張數"]} @ ${item["成交價"]}`).join("；");
      return [
        ...row("06-3:four", 0, [null, (o.plan06 || "").replace(/^本輪作戰計畫\s*/, "").slice(0, 80) || "09:20 站上昨收才買 1 張", null]),
        ...row("06-3:four", 1, [null, orders, "yes"]),
        ...row("06-3:four", 2, [null, fills, "yes"]),
        ...row("06-3:four", 3, [null, o.l06.ledger.positions.empty ?? "", "yes"]),
      ];
    }
    case "06-4": {
      const { diff, cost, net } = totals(o.l06);
      return [["06-4:pnl:diff", String(diff)], ["06-4:pnl:cost", String(cost)], ["06-4:pnl:net", String(net)], ["06-4:pnl:match", Math.abs(net - o.l06.shown) <= 2 ? "yes" : "no"], ...[0, 1, 2, 3, 4].map((index) => [`06-4:adh:${index}`, "yes"])];
    }
    case "06-5": {
      const { buy, cost } = totals(o.l04);
      return [
        ...row("06-5:fix", 0, [null, buy.time]),
        ...row("06-5:fix", 1, [null, `台積電收價站上昨收 ${previousClose("2026-10-06", "2330")}`]),
        ...row("06-5:fix", 2, [null, "市價買進 1 張，沒有先算費稅門檻"]),
        ...row("06-5:fix", 3, [null, `先算來回費稅約 ${cost.toLocaleString("en-US")} 元，要漲 2 檔才打平，再決定進不進場`]),
        ...row("06-5:fix", 4, [null, "送單前在計畫寫下費稅門檻（幾檔）"]),
        ...row("06-5:fix", 5, [null, "復盤時打開「本輪作戰計畫」，看有沒有寫門檻"]),
      ];
    }
    case "F-3": {
      const fee = o.fees.find((item) => item.code === "2330");
      const perLot = (2560 - 2550) * 1000 + fee.cost;
      return [
        ["F-3:plan:day", "2026-10-05"], ["F-3:plan:theme", "第 6 課"], ["F-3:plan:stock", "2330"],
        ["F-3:plan:reason", FINAL_PLAN.reason], ["F-3:plan:entry", FINAL_PLAN.entry], ["F-3:plan:exit", FINAL_PLAN.stop],
        ...[2560, 2550, 10, 10000, fee.cost, perLot, 20000, Math.min(3, Math.floor(20000 / perLot))].flatMap((value, index) => row("F-3:risk", index, [null, value])),
        ["F-3:th:perShare", (fee.cost / 1000).toFixed(3)], ["F-3:th:tick", String(fee.tick)], ["F-3:th:ticks", String(fee.ticks)], ["F-3:th:end", "09:45"],
      ];
    }
    case "F-4": {
      const { buy, sell } = totals(o.f1);
      const seen = shownClose("2026-10-05", "2330", buy.time);
      return [
        ...row("F-4:log", 0, ["09:01", "計畫：09:03 看到的收價站上 2560 才買", "先等", "還沒到 09:03"]),
        ...row("F-4:log", 1, [buy.time, `收價 ${seen} 站上 2560；送單時網路中斷`, "市價買進 1 張（只按一次重試）", "進場條件成立；委託分頁只有一筆"]),
        ...row("F-4:log", 2, [sell.time, "收價一直沒有跌破 2550", "市價賣出 1 張", "時間條件：09:45 前處理完部位"]),
      ];
    }
    case "F-5": {
      const { diff, cost, net } = totals(o.f1);
      return [
        ...fillsOf(o.f1).flatMap((fill, index) => row("F-5:fills", index, [fill.time, sideOf(fill), money(fill["方向 / 張數"]), money(fill["成交價"]), feeTax(fill)[0], feeTax(fill)[1]])),
        ["F-5:totals:diff", String(diff)], ["F-5:totals:cost", String(cost)], ["F-5:totals:net", String(net)],
        ["F-5:totals:match", Math.abs(net - o.f1.shown) <= 2 ? "yes" : "no"],
        ...[0, 1, 2, 3, 4].map((index) => [`F-5:adh:${index}`, "yes"]),
        ["F-5:reflect:mistake", "09:03 送單時網路中斷，我差點又按一次送出；重試成功後舊的確認卡還在"],
        ["F-5:reflect:change", "送單後先看委託分頁，確認只有一筆再前進"],
        ["F-5:reflect:proud", `${totals(o.f1).sell.time} 依時間條件賣出，沒有留倉`],
      ];
    }
    default:
      return [];
  }
}
const taskPassed = (id) => {
  const own = records.filter((item) => item.task === id && item.level !== "WORKBOOK");
  return own.length === 0 ? null : own.every((item) => item.ok);
};
/** One level of the workbook, right after the student finished it on the desk. */
async function workbookLevel(level) {
  const tasks = await wb.evaluate((id) => window.ACADEMY.levels[id]?.tasks ?? [], level);
  const saved = currentLevel;
  currentLevel = "WORKBOOK";
  for (const id of tasks) {
    const passed = taskPassed(id);
    await step(wb, {
      task: id, does: `數位版：寫下 ${id} 的作品並自評`, kind: "workbook", expected: "完成這一關：你現在會做什麼／你留下的成果／下一個小挑戰",
      act: async () => {
        await wbGo(level);
        await wbGo(id);
        for (const [key, value] of worksOf(id)) await put(key, value);
        const selfChecks = await wb.evaluate((task) => window.ACADEMY.tasks[task].req.filter((item) => item.t === "check" && item.self).map((item) => item.key), id);
        // Ticked only when the student really did it: every journey step of this task passed.
        if (passed !== false) for (const key of selfChecks) {
          await wbView().locator(`[data-check="${key}"]`).check();
          ticked.add(key);
        }
        await wb.waitForTimeout(300);
      },
      verify: async () => {
        const status = await wb.evaluate((task) => window.ACADEMY_DEBUG.taskStatus(task), id);
        const panel = await text(wb.locator(`[data-done="${id}"]`));
        const three = ["你現在會做什麼", "你留下的成果", "下一個小挑戰"].every((part) => panel.includes(part));
        const works = worksOf(id).length;
        return verdict(passed === false ? !status.done : status.done && three, `${status.done ? "完成" : `還差 ${status.missing.map((item) => item.label).join("、")}`} · 作品欄位 ${works} · journey steps ${passed === null ? "none" : passed ? "all passed" : "some failed (self-check left empty)"} · ${panel.slice(0, 90)}`);
      },
    });
  }
  await step(wb, {
    task: level, does: `數位版：${level} 關卡頁的進度與印章`, kind: "workbook", expected: "每個任務完成，關卡印章亮起",
    act: () => wbGo(level),
    verify: async () => {
      const progress = await text(wb.locator(`[data-level-progress="${level}"]`));
      const sealed = await wb.locator(`[data-level-seal="${level}"]`).first().evaluate((element) => element.classList.contains("done"));
      const done = await wb.evaluate((id) => window.ACADEMY_DEBUG.levelDone(id), level);
      const expectDone = tasks.every((id) => taskPassed(id) !== false);
      return verdict(done === expectDone && sealed === expectDone, `${progress} · seal ${sealed} · levelDone ${done}`);
    },
  });
  currentLevel = saved;
}
/** Everything the student wrote, as the workbook now shows it, compared with what was typed. */
async function worksOnScreen() {
  const state = await wb.evaluate(() => window.ACADEMY_DEBUG.state());
  const lostFields = Object.entries(typed).filter(([key, value]) => state.fields[key] !== value).map(([key]) => key);
  const lostChecks = [...ticked].filter((key) => state.checks[key] !== true);
  const tasks = await wb.evaluate(() => Object.keys(window.ACADEMY.tasks).map((id) => [id, window.ACADEMY_DEBUG.taskStatus(id).done]));
  const levels = await wb.evaluate(() => Object.keys(window.ACADEMY.levels).map((id) => [id, window.ACADEMY_DEBUG.levelDone(id)]));
  return { lostFields, lostChecks, done: tasks.filter(([, done]) => done).map(([id]) => id), levels: levels.filter(([, done]) => done).map(([id]) => id), fields: Object.keys(typed).length, checks: ticked.size, state };
}
/** A few fields read back from the page itself (what the student sees), per task. */
async function fieldsShown(keys) {
  const wrong = [];
  for (const key of keys) {
    const task = key.split(":")[0];
    if (wb.url().split("#")[1] !== task) await wbGo(task);
    const shown = await wbView().locator(`[data-field="${key}"]`).evaluateAll((nodes) => {
      const radio = nodes.find((node) => node.type === "radio" && node.checked);
      return radio ? radio.value : nodes[0]?.value ?? null;
    });
    if (shown !== typed[key]) wrong.push(`${key}: "${shown}"`);
  }
  return wrong;
}

/** The works after the course: latest input, reopen, export, bad files, restore into an empty browser. */
async function workbookFinish() {
  currentLevel = "WORKBOOK";
  const before = await worksOnScreen();
  const sample = [...new Set(Object.keys(typed).map((key) => key.split(":")[0]))].map((task) => Object.keys(typed).find((key) => key.startsWith(`${task}:`)));
  const latest = "09:44 依時間條件賣出，沒有留倉；這句是關掉分頁前最後打的字";
  await step(wb, {
    task: "F-5", does: "寫完最後一句立刻關掉分頁和瀏覽器，再重新打開", kind: "workbook", expected: "最後一句還在",
    act: async () => {
      await wbGo("F-5");
      await wbView().locator('[data-field="F-5:reflect:proud"]').fill(latest);
      typed["F-5:reflect:proud"] = latest;
      await wb.close({ runBeforeUnload: true });
      await wbContext.close();
      await openWorkbook(profiles.student);
      await wbGo("F-5");
    },
    verify: async () => {
      const shown = await wbView().locator('[data-field="F-5:reflect:proud"]').inputValue();
      return verdict(shown === latest, `after reopen: "${shown.slice(0, 40)}"`);
    },
  });
  await step(wb, {
    task: "FINAL", does: "重新打開後：所有作品、勾選、任務與關卡進度都在", kind: "workbook", expected: "和關閉前一字不差",
    act: () => wbGo("progress"),
    verify: async () => {
      const after = await worksOnScreen();
      const wrong = await fieldsShown(sample);
      const same = after.done.join() === before.done.join() && after.levels.join() === before.levels.join();
      return verdict(!after.lostFields.length && !after.lostChecks.length && !wrong.length && same, `fields ${after.fields} lost ${after.lostFields.length} · checks ${after.checks} lost ${after.lostChecks.length} · shown on page ${sample.length - wrong.length}/${sample.length}${wrong.length ? ` (${wrong.join("; ")})` : ""} · tasks done ${after.done.length} · levels ${after.levels.join(",")}`);
    },
  });
  const exportFile = join(out, "workbook-export.json");
  await step(wb, {
    task: "FINAL", does: "「我的進度與紀錄」按「匯出備份檔（JSON）」", kind: "workbook", expected: "下載的檔案裡有學生寫的每一項作品",
    act: async () => {
      await wbGo("progress");
      const [download] = await Promise.all([wb.waitForEvent("download"), wb.getByRole("button", { name: "匯出備份檔（JSON）" }).click()]);
      await download.saveAs(exportFile);
    },
    verify: async () => {
      const exported = JSON.parse(readFileSync(exportFile, "utf8"));
      const missing = Object.entries(typed).filter(([key, value]) => exported.data?.fields?.[key] !== value).map(([key]) => key);
      const checks = [...ticked].filter((key) => exported.data?.checks?.[key] !== true);
      return verdict(exported.schema && !missing.length && !checks.length, `${exported.schema} v${exported.version} · edition ${exported.edition?.version ?? JSON.stringify(exported.edition).slice(0, 40)} · fields missing ${missing.length} · checks missing ${checks.length}`);
    },
  });
  const unchanged = async () => {
    const now = await wb.evaluate(() => window.ACADEMY_DEBUG.state());
    return JSON.stringify([now.fields, now.checks, now.rows]) === JSON.stringify([before.state.fields, before.state.checks, before.state.rows].map((part, index) => (index === 0 ? { ...part, "F-5:reflect:proud": latest } : part)));
  };
  const BAD = [
    ["不是 JSON 的檔案", "not-a-backup.txt", "這不是備份檔，只是一段文字。", /不是有效的 JSON/],
    ["別的程式匯出的 JSON", "other-app.json", JSON.stringify({ schema: "another-app-export", data: { fields: { x: "y" } } }), /這不是闖關手冊的紀錄/],
    ["半個備份檔（下載中斷）", "cut-backup.json", readFileSync(exportFile, "utf8").slice(0, 400), /不是有效的 JSON/],
  ];
  for (const [label, name, body, expected] of BAD)
    await step(wb, {
      task: "FINAL", does: `匯入壞掉的檔案：${label}`, kind: "workbook", expected: "顯示匯入失敗、目前的紀錄沒有被更動",
      act: async () => {
        await wbGo("progress");
        await wb.getByLabel("匯入備份檔").setInputFiles({ name, mimeType: name.endsWith(".json") ? "application/json" : "text/plain", buffer: Buffer.from(body, "utf8") });
        await wb.waitForTimeout(500);
      },
      verify: async () => {
        const message = await text(wb.locator("[data-import-review]"));
        const dialog = await wb.locator("[data-dialog]").isVisible().catch(() => false);
        const same = await unchanged();
        return verdict(expected.test(message) && message.includes("目前的紀錄沒有被更動") && !dialog && same, `${message.slice(0, 90)} · dialog ${dialog} · records unchanged ${same}`);
      },
    });
  await step(wb, {
    task: "FINAL", does: "匯入一個沒有標示格式的 JSON（{\"hello\":\"world\"}），看到對話框後按「取消」", kind: "workbook", expected: "不會靜默取代：先問、列出兩邊內容；取消後紀錄不變",
    act: async () => {
      await wb.getByLabel("匯入備份檔").setInputFiles({ name: "hello.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') });
      await wb.waitForTimeout(500);
    },
    verify: async () => {
      const dialog = wb.locator("[data-dialog]");
      const shown = await dialog.isVisible().catch(() => false);
      const body = shown ? await text(dialog) : await text(wb.locator("[data-import-review]"));
      if (shown) await dialog.getByRole("button", { name: "取消" }).click();
      const same = await unchanged();
      return verdict(same, `dialog ${shown}: ${body.slice(0, 140)} · after 取消 records unchanged ${same}`);
    },
  });
  await step(wb, {
    task: "FINAL", does: "換一個全新的瀏覽器設定檔，匯入剛剛的備份檔並確認取代", kind: "workbook", expected: "先問再取代；作品、勾選、任務與關卡進度全部還原",
    act: async () => {
      await wbContext.close();
      await openWorkbook(profiles.restore);
      const empty = await wb.evaluate(() => Object.keys(window.ACADEMY_DEBUG.state().fields).length);
      if (empty) throw new Error(`the new profile already has ${empty} fields`);
      await wbGo("progress");
      await wb.getByLabel("匯入備份檔").setInputFiles(exportFile);
      const dialog = wb.locator("[data-dialog]");
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      wb.__importDialog = await text(dialog);
      await dialog.getByRole("button", { name: "取代目前紀錄" }).click();
      await wb.waitForTimeout(600);
    },
    verify: async () => {
      const after = await worksOnScreen();
      const wrong = await fieldsShown(sample);
      const same = after.done.join() === before.done.join() && after.levels.join() === before.levels.join();
      return verdict(!after.lostFields.length && !after.lostChecks.length && !wrong.length && same, `asked: ${String(wb.__importDialog).slice(0, 60)} · fields lost ${after.lostFields.length} · checks lost ${after.lostChecks.length} · shown on page ${sample.length - wrong.length}/${sample.length} · tasks done ${after.done.length} · levels ${after.levels.join(",")}`);
    },
  });
  for (const id of ["01-6", "05-2", "F-3", "F-4", "F-5", "portfolio"]) {
    await wbGo(id);
    await wb.screenshot({ path: join(out, `workbook-restored-${id}.png`), fullPage: true });
  }
}

const levels = { L01: level01, L02: level02, L03: level03, L04: level04, L05: level05, L06: level06, FINAL: finalMission };
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const startedAt = new Date().toISOString();
await new Promise((done) => webServer.listen(portWeb, "127.0.0.1", done));
const environment = {
  startedAt,
  classroom: { release, appEntry, ports: { app: portApp, proxy: portProxy }, gateCode: `read from artifacts/trading-desk-qa/server-${portProxy}.json (disposable, not recorded here)`, runtime: classroom.runtime, database: "new empty PGlite created by scripts/qa/desk-server.mjs for this run" },
  marketData: { copiedFrom: join(host, "market-data"), copy: marketCopy, days: JSON.parse(readFileSync(join(marketCopy, "index.json"), "utf8")).days.map((day) => ({ date: day.date, manifestSha256: day.manifestSha256 })) },
  workbook: { content: contentDir, web: webDir, indexSha256: createHash("sha256").update(readFileSync(join(webDir, "index.html"))).digest("hex"), url: workbookUrl, profiles },
  browsers: "desk: Playwright chromium (or Chrome channel), new context; workbook: persistent profiles in new temp folders",
  student: "new learner account created through the sign-up form with generated test values; nothing seeded, no database edits, no injected state",
  nonUi: "read-only GET /api/morning from the page for cross-checks; one deliberately aborted POST (page.route) for the network-failure recovery in F-1",
};
let completedAll = true;
try {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await openWorkbook();
  await step(wb, {
    task: "Q", does: "數位版：在新的瀏覽器設定檔打開講義", kind: "workbook", expected: "沒有任何舊紀錄；講義版本可查",
    verify: async () => {
      const state = await wb.evaluate(() => window.ACADEMY_DEBUG.state());
      const edition = await wb.evaluate(() => JSON.stringify(window.ACADEMY.edition ?? {}));
      environment.workbook.edition = edition;
      return verdict(!Object.keys(state.fields).length && !Object.keys(state.checks).length, `fields ${Object.keys(state.fields).length} · checks ${Object.keys(state.checks).length} · edition ${edition.slice(0, 80)}`);
    },
  });
  for (const id of Object.keys(levels)) {
    if (!onlyLevels.includes(id)) {
      completedAll = false;
      break;
    }
    try {
      await levels[id](page, context);
      await workbookLevel(id);
    } catch (error) {
      records.push({ seq: ++seq, level: id, task: id, kind: "step", instruction: "", does: "level stopped", expected: "", ok: false, actual: error.message.split("\n")[0], before: "", after: "" });
      console.log(`STOP ${id}: ${error.message.split("\n")[0]}`);
      completedAll = false;
      break;
    }
  }
  if (completedAll) {
    try {
      await workbookFinish();
    } catch (error) {
      records.push({ seq: ++seq, level: "WORKBOOK", task: "FINAL", kind: "workbook", instruction: "", does: "workbook checks stopped", expected: "", ok: false, actual: error.message.split("\n")[0], before: "", after: "" });
      console.log(`STOP WORKBOOK: ${error.message.split("\n")[0]}`);
    }
  }
} finally {
  await wbContext?.close().catch(() => {});
  webServer.close();
  await browser.close();
  await writeFile(join(classroom.runtime, "stop-request"), "");
  await new Promise((done) => {
    const timer = setTimeout(done, 30000);
    server.on("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}
const summary = {
  release,
  appEntry,
  content: contentDir,
  web: webDir,
  viewport: VIEW,
  browser: "chromium (Playwright) or Chrome channel",
  startedAt,
  finishedAt: new Date().toISOString(),
  steps: records.length,
  passed: records.filter((item) => item.ok).length,
  failed: records.filter((item) => !item.ok).map((item) => `${item.task} ${item.does}: ${item.actual}`),
  serverClosedCleanly: serverLog.includes("QA database closed cleanly"),
};
await writeFile(join(out, "journey.json"), JSON.stringify({ summary, records, observed, typed, ticked: [...ticked] }, null, 2));
writeFileSync(join(out, "environment.json"), JSON.stringify({ ...environment, finishedAt: summary.finishedAt }, null, 2));
console.log(JSON.stringify({ ...summary, failed: summary.failed.length }, null, 2));
if (summary.failed.length) {
  console.log("FAILED:\n" + summary.failed.join("\n"));
  process.exitCode = 1;
}
