#!/usr/bin/env node
// Repro (read only, disposable classroom): the send of a confirmed order fails once (network), the student presses
// 「重試這次操作」. Records the order count and what the order ticket shows afterwards.
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
const out = resolve(option("out", join(project, "..", "..", "artifacts", "acceptance-20261018", "repro-retry-confirm")));
await mkdir(out, { recursive: true });
const market = await mkdtemp(join(tmpdir(), "repro-market-"));
await cp(join(host, "market-data", "index.json"), join(market, "index.json"));
await cp(join(host, "market-data", "days"), join(market, "days"), { recursive: true });
const server = spawn(process.execPath, [join(project, "scripts", "qa", "desk-server.mjs")], {
  cwd: project,
  env: { ...process.env, APP_ENTRY: appEntry, PORT_APP: "18884", PORT_PROXY: "18885", MARKET_DATA_DIR: market, DOWNLOADS: join(appEntry, "..", "..", "downloads") },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let log = "";
await new Promise((done, fail) => {
  server.stdout.on("data", (chunk) => ((log += chunk), log.includes("QA ready") && done()));
  server.stderr.on("data", (chunk) => (log += chunk));
  server.on("exit", (code) => fail(new Error(`exit ${code}\n${log}`)));
});
const classroom = JSON.parse(await readFile(join(project, "artifacts", "trading-desk-qa", "server-18885.json"), "utf8"));
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const notes = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(classroom.appBase + "/");
  await page.getByLabel("教室入場碼", { exact: true }).fill(classroom.gateCode);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "進入教室" }).click();
  await page.getByRole("link", { name: "開始今天的練習" }).click();
  await page.getByRole("button", { name: "用這個計畫開始" }).click();
  await page.locator(".td-clock strong", { hasText: "09:01" }).waitFor({ timeout: 20000 });
  const coach = page.getByRole("dialog");
  if (await coach.isVisible().catch(() => false)) for (const name of ["下一步", "下一步", "完成"]) await coach.getByRole("button", { name }).click();
  let failed = 0;
  await page.route("**/api/morning**", (route) => (route.request().method() === "POST" && failed++ === 0 ? route.abort("internetdisconnected") : route.continue()));
  await page.locator("button.sim-submit").click();
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await page.getByRole("button", { name: "重試這次操作" }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(out, "1-send-failed.png") });
  notes.push(`after the failed send: confirm card shown ${await page.locator(".sim-confirm").isVisible()}`);
  await page.getByRole("button", { name: "重試這次操作" }).click();
  await page.waitForTimeout(2500);
  await page.unroute("**/api/morning**");
  await page.screenshot({ path: join(out, "2-after-retry.png") });
  const orders = await page.evaluate(async () => (await (await fetch("/api/morning", { cache: "no-store" })).json()).state.orders.length);
  const confirmShown = await page.locator(".sim-confirm").isVisible().catch(() => false);
  const ticketText = ((await page.locator("section.sim-ticket").textContent()) ?? "").replace(/\s+/g, " ");
  const back = page.getByRole("button", { name: "返回修改" });
  notes.push(`after 重試這次操作: orders ${orders} · stale confirm card ${confirmShown} · pending panel ${await page.locator(".sim-pending").isVisible().catch(() => false)} · 返回修改 ${await back.isVisible().catch(() => false)}`);
  notes.push(`ticket says: ${ticketText.slice(0, 220)}`);
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, "3-after-back.png") });
    const state = await page.evaluate(async () => (await (await fetch("/api/morning", { cache: "no-store" })).json()).state);
    notes.push(`after 返回修改: orders ${state.orders.length} (${state.orders.map((o) => o.status).join(",")}) · side buttons ${await page.locator('[aria-label="模擬買賣方向"]').isVisible()}`);
  }
} finally {
  await browser.close();
  await writeFile(join(classroom.runtime, "stop-request"), "");
  await new Promise((done) => setTimeout(done, 4000));
}
await writeFile(join(out, "notes.json"), JSON.stringify({ appEntry, notes }, null, 2));
console.log(notes.join("\n"));
