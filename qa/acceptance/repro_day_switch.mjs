#!/usr/bin/env node
// Repro (read only, disposable classroom): a guest finishes a 第 2 課 round on 2026-10-05, then starts a new
// 第 6 課 plan from the lobby card and switches the trading day to 2026-10-05, as the workbook's final mission says.
// Records what the page shows after the switch (a new plan form, or that day's last finished round).
//   node qa/acceptance/repro_day_switch.mjs [--app-entry <release>/server/index.mjs] --out <dir>
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const project = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const host = join(homedir(), "YilutekServices", "DayTradeTycoon");
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const appEntry = option("app-entry", JSON.parse(readFileSync(join(host, "hosting.json"), "utf8").replace(/^﻿/, "")).appEntry);
const out = resolve(option("out", join(project, "..", "..", "artifacts", "acceptance-20261018", "repro-day-switch")));
await mkdir(out, { recursive: true });
const market = await mkdtemp(join(tmpdir(), "repro-market-"));
await cp(join(host, "market-data", "index.json"), join(market, "index.json"));
await cp(join(host, "market-data", "days"), join(market, "days"), { recursive: true });
const server = spawn(process.execPath, [join(project, "scripts", "qa", "desk-server.mjs")], {
  cwd: project,
  env: { ...process.env, APP_ENTRY: appEntry, PORT_APP: "18882", PORT_PROXY: "18883", MARKET_DATA_DIR: market, DOWNLOADS: join(appEntry, "..", "..", "downloads") },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
await new Promise((done, fail) => {
  server.stdout.on("data", (chunk) => ((log += chunk), log.includes("QA ready") && done()));
  server.stderr.on("data", (chunk) => (log += chunk));
  server.on("exit", (code) => fail(new Error(`exit ${code}\n${log}`)));
});
const classroom = JSON.parse(await readFile(join(project, "artifacts", "trading-desk-qa", "server-18883.json"), "utf8"));
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const notes = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(classroom.appBase + "/");
  await page.getByLabel("教室入場碼", { exact: true }).fill(classroom.gateCode);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "進入教室" }).click();
  await page.getByRole("heading", { name: "今天三件事" }).waitFor({ timeout: 20000 });
  const startCourse = async (course) => {
    await page.locator(`article[data-course="${course}"]`).getByRole("link", { name: /開始第/ }).click();
    await page.waitForTimeout(2500);
  };
  // A guest's first plan needs the teaching statement; the plan form accepts it with 開始.
  await startCourse(2);
  const day = page.locator('select[aria-label="教材交易日"]');
  await day.selectOption(await day.locator("option", { hasText: "2026-10-05" }).getAttribute("value"));
  await page.getByRole("radio", { name: /自己寫/ }).click();
  await page.getByLabel(/我觀察的理由/).fill("第 2 課練習");
  await page.getByLabel(/什麼條件出現，我才考慮操作/).fill("不交易");
  await page.getByLabel(/什麼情況代表計畫失效/).fill("不交易");
  await page.getByRole("button", { name: /保存計畫，進入 09:00 練習|用這個計畫開始/ }).click();
  await page.locator(".td-clock strong", { hasText: "09:01" }).waitFor({ timeout: 20000 });
  // First round: close the three-step coach (下一步, 下一步, 完成) before using the desk.
  const coach = page.getByRole("dialog");
  if (await coach.isVisible().catch(() => false))
    for (const name of ["下一步", "下一步", "完成"]) await coach.getByRole("button", { name }).click();
  await page.locator('[aria-label="歷史行情重播控制"] button', { hasText: "復盤" }).click();
  await page.locator('section[aria-labelledby="morning-review-title"] textarea').fill("只看不做。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await page.getByText("已保存 · 這是操作足跡，不是獲利能力評分").last().waitFor({ timeout: 20000 });
  notes.push(`round 1: 第 2 課 on 2026-10-05 finished`);
  await page.getByRole("link", { name: /大廳/ }).first().click();
  await page.getByRole("heading", { name: "今天三件事" }).waitFor({ timeout: 20000 });
  await startCourse(6);
  await page.screenshot({ path: join(out, "1-course6-opened.png"), fullPage: true });
  notes.push(`after 第 6 課 card: subject=${await page.locator(".td-subject").textContent()} · day=${await day.locator("option:checked").textContent()} · planForm=${await page.getByRole("radio", { name: /自己寫/ }).isVisible().catch(() => false)}`);
  await day.selectOption(await day.locator("option", { hasText: "2026-10-05" }).getAttribute("value"));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(out, "2-after-day-switch.png"), fullPage: true });
  const subject = await page.locator(".td-subject").textContent();
  const planForm = await page.getByRole("radio", { name: /自己寫/ }).isVisible().catch(() => false);
  const restart = page.getByRole("button", { name: "寫新計畫，再練一輪" });
  const restartShown = await restart.isVisible().catch(() => false);
  notes.push(`after switching to 2026-10-05: subject=${subject} · planForm=${planForm} · 寫新計畫按鈕=${restartShown}`);
  if (restartShown) {
    await restart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, "3-restart-visible.png") });
    await restart.click();
    await page.waitForTimeout(2000);
    notes.push(`after 寫新計畫，再練一輪: subject=${await page.locator(".td-subject").textContent()} · planForm=${await page.getByRole("radio", { name: /自己寫/ }).isVisible().catch(() => false)}`);
    await page.screenshot({ path: join(out, "4-after-restart.png") });
  }
} finally {
  await browser.close();
  await writeFile(join(classroom.runtime, "stop-request"), "");
  await new Promise((done) => setTimeout(done, 4000));
}
await writeFile(join(out, "notes.json"), JSON.stringify({ appEntry, notes }, null, 2));
console.log(notes.join("\n"));
