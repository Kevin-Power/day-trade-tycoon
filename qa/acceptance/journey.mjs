#!/usr/bin/env node
// Independent student-journey acceptance for the Trading Academy workbook (written separately from the
// workbook's own capture script). A brand-new student follows the workbook's written steps on the release the
// classroom host serves: every step keeps a before and an after screenshot, compares the screen with the
// workbook's expected result, and each level also tries a wrong operation and its recovery.
// Nothing here talks to production: a disposable classroom (scripts/qa/desk-server.mjs) on loopback ports.
//
//   node qa/acceptance/journey.mjs [--content <workbook content dir>] [--out <dir>] [--levels L01,L02,...]
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
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
  for (const task of level.tasks) workbook[task.id] = { level: level.id, title: task.title, steps: task.steps ?? [], expect: task.expect ?? "" };
}
const instruction = (taskId, n) => {
  const step = workbook[taskId]?.steps.find((item) => String(item.n) === String(n));
  return step ? step.text.replace(/\s+/g, " ") : `(workbook ${taskId} has no step ${n})`;
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
    verify: has(d.heroName, "鴻海"),
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
  await step(page, {
    task: "04-3", does: "賣出時把張數加到 2 張（只持有 1 張）", kind: "recovery", expected: "不能賣出超過庫存",
    act: async () => {
      await d.side.getByRole("button", { name: "賣出" }).click();
      const plus = page.getByRole("button", { name: "增加一張" });
      if (await plus.isEnabled()) await plus.click();
      await page.waitForTimeout(300);
    },
    verify: async () => {
      // Either the ticket refuses the second lot (增加一張 disabled at the holding) or it warns and blocks sending.
      const plusDisabled = await page.getByRole("button", { name: "增加一張" }).isDisabled();
      const lots = number(await text(page.locator("#sim-lots-value")));
      const ticket = await text(page.locator("section.sim-ticket"));
      const warned = ticket.includes("賣出張數超過庫存") && (await d.submit.isDisabled().catch(() => false));
      if (lots > 1) await page.getByRole("button", { name: "減少一張" }).click();
      return verdict((plusDisabled && lots === 1) || warned, `lots ${lots} · 增加一張 disabled=${plusDisabled} · warning=${warned}`);
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
      const state = await serverState(page);
      const [buy, sell] = state.fills;
      const net = (sell.price - buy.price) * 1000 - (buy.fee + sell.fee + sell.tax + buy.tax);
      const account = await text(d.account);
      return verdict(account.includes(net.toLocaleString("en-US")), `computed ${net} · screen ${account}`);
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
  await d.submit.click();
  await page.getByRole("button", { name: `確認送出模擬${side}` }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await page.waitForFunction((count) => true, null);
  await page.waitForTimeout(1200);
}
/** The fill must be the next minute's open from the server's own bars — no numbers are assumed. */
async function fillMatchesOpen(page, code) {
  const state = await serverState(page);
  const fill = state.fills.at(-1);
  const bar = state.bars[code].find((item) => item.t === fill.t);
  return verdict(fill && bar && fill.price === bar.o, `fill ${fill?.side} ${fill?.shares} @ ${fill?.price} · bar ${fill?.t} open ${bar?.o}`);
}
async function netMatchesAccount(page) {
  const state = await serverState(page);
  const pnl = Math.round((state.equity - state.startingCash) * 100) / 100;
  const account = await text(desk(page).account);
  return verdict(state.positions.length === 0 && account.includes(Math.round(pnl).toLocaleString("en-US")), `server pnl ${pnl} · screen ${account}`);
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
    act: () => customPlan(page, { reason: "觀察台積電開盤後是否守住昨收", entry: "09:05 前沒有跌破昨收就買 1 張；可承受損失 30,000 元，最多 1 張", stop: "跌破昨收一檔就賣出；10:00 前處理完部位" }),
    verify: async () => verdict((await clock(page)) === "09:01", await clock(page)),
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
      const fill = await fillMatchesOpen(page, "2330");
      await ledgerTab(page, "庫存");
      const positions = await text(d.ledger);
      return verdict(fill.ok && positions.includes("1 張"), `${fill.actual} · ${positions.slice(0, 60)}`);
    },
  });
  await step(page, {
    task: "05-2", n: 6, does: "09:40 依計畫賣出並核對庫存", expected: "庫存歸零",
    act: async () => {
      await advanceTo(page, "09:40");
      await marketOrder(page, "賣出");
    },
    verify: async () => {
      const fill = await fillMatchesOpen(page, "2330");
      const net = await netMatchesAccount(page);
      return verdict(fill.ok && net.ok, `${fill.actual} · ${net.actual}`);
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
    verify: () => netMatchesAccount(page),
  });
  await step(page, {
    task: "05-3", n: 6, does: "寫第 3 課復盤並保存", expected: "完成卡出現", kind: "completion",
    act: () => finishRound(page, "09:30 時間條件成立就賣出，沒有把出場延後。"),
    verify: async () => verdict((await text(completionCard(page))).includes("完成這一輪復盤"), (await text(completionCard(page))).slice(0, 120)),
  });

  await toLobby(page);
  await step(page, {
    task: "05-4", n: 1, does: "大廳第 4 課卡片開始，寫突破確認條件", expected: "第 4 課開始",
    act: async () => {
      await openCourse(page, 4);
      await customPlan(page, { reason: "觀察前高與突破", entry: "收價站上前高才買 1 張", stop: "跌回前高下方就賣；10:00 前處理完" });
    },
    verify: async () => verdict((await clock(page)) === "09:01", await clock(page)),
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
    verify: async () => verdict(highs.length > 0, highs.join(" | ") || "no 前高確認 alert before 10:00"),
  });
  await step(page, {
    task: "05-4", n: 6, does: "形態沒完成就不交易，保存復盤", expected: workbook["05-4"].expect, kind: "completion",
    act: () => finishRound(page, `前高：${highs.join("；")}。沒有看到收價站上前高，所以不交易。`),
    verify: async () => {
      const state = await serverState(page);
      return verdict(state.completed && state.orders.length === 0, `orders ${state.orders.length}`);
    },
  });

  await toLobby(page);
  await step(page, {
    task: "05-5", n: 1, does: "大廳第 5 課卡片開始，寫等待條件", expected: "第 5 課開始",
    act: async () => {
      await openCourse(page, 5);
      await customPlan(page, { reason: "練習等待", entry: "站上前高且回測不破才買", stop: "條件沒出現就不交易" });
    },
    verify: async () => verdict((await clock(page)) === "09:01", await clock(page)),
  });
  await step(page, {
    task: "05-5", n: 3, does: "前進到 10:00，選「延伸觀察至 10:30」", expected: "可以延伸觀察到 10:30",
    act: async () => {
      await advanceTo(page, "10:00");
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
      await advanceTo(page, "09:37");
      await marketOrder(page, "賣出");
    },
    verify: () => netMatchesAccount(page),
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
      await page.locator("#td-resources").getByRole("button", { name: "關閉" }).click();
      return verdict(drawer.includes("每次成交後立刻核對庫存"), drawer.slice(0, 120));
    },
  });
  await step(page, {
    task: "06-4", n: 2, does: "用成交紀錄算淨損益，和本輪損益對帳", expected: "算出的淨損益和狀態列一致",
    verify: () => netMatchesAccount(page),
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
      const planForm = await page.getByRole("radio", { name: /自己寫/ }).isVisible().catch(() => false);
      const subject = await text(desk(page).subject);
      return verdict(planForm && subject.includes("用紀錄完成復盤"), `plan form ${planForm} · status bar ${subject}`);
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
    act: () => customPlan(page, { reason: "期末：觀察台積電開盤後走勢", entry: "09:03 收價在昨收之上就買 1 張；最多 1 張", stop: "跌破昨收就賣；09:45 前處理完部位" }),
    verify: async () => verdict((await clock(page)) === "09:01", await clock(page)),
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
      const state = await serverState(page);
      return verdict(shown && state.orders.length === 1, `message ${shown} · orders after retry ${state.orders.length}`);
    },
  });
  await step(page, {
    task: "F-1", n: 3, does: "前進撮合，成交後核對庫存", expected: "成交價是下一分鐘開盤價；庫存 1 張",
    act: async () => {
      await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
      await page.waitForTimeout(1200);
    },
    verify: () => fillMatchesOpen(page, "2330"),
  });
  await step(page, {
    task: "F-1", n: 4, does: "09:45 前賣出，核對三個分頁", expected: "結束時庫存為 0",
    act: async () => {
      await advanceTo(page, "09:44");
      await marketOrder(page, "賣出");
    },
    verify: () => netMatchesAccount(page),
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

const levels = { L01: level01, L02: level02, L03: level03, L04: level04, L05: level05, L06: level06, FINAL: finalMission };
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const startedAt = new Date().toISOString();
try {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const id of Object.keys(levels)) {
    if (!onlyLevels.includes(id)) break;
    try {
      await levels[id](page, context);
    } catch (error) {
      records.push({ seq: ++seq, level: id, task: id, kind: "step", instruction: "", does: "level stopped", expected: "", ok: false, actual: error.message.split("\n")[0], before: "", after: "" });
      console.log(`STOP ${id}: ${error.message.split("\n")[0]}`);
      break;
    }
  }
} finally {
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
  viewport: VIEW,
  browser: "chromium (Playwright) or Chrome channel",
  startedAt,
  finishedAt: new Date().toISOString(),
  steps: records.length,
  passed: records.filter((item) => item.ok).length,
  failed: records.filter((item) => !item.ok).map((item) => `${item.task} ${item.does}: ${item.actual}`),
  serverClosedCleanly: serverLog.includes("QA database closed cleanly"),
};
await writeFile(join(out, "journey.json"), JSON.stringify({ summary, records }, null, 2));
console.log(JSON.stringify({ ...summary, failed: summary.failed.length }, null, 2));
if (summary.failed.length) {
  console.log("FAILED:\n" + summary.failed.join("\n"));
  process.exitCode = 1;
}
