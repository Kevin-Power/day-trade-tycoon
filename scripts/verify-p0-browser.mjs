#!/usr/bin/env node
/**
 * Manual browser pass for P0-7/8/9. Not part of npm test.
 * Requires npm run dev on :8080.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "artifacts", "p0-verify");
mkdirSync(outDir, { recursive: true });

const GATE_KEY = "day-tycoon-gate-v1";
const base = "http://127.0.0.1:8080";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((key) => localStorage.setItem(key, "1"), GATE_KEY);
const page = await context.newPage();

async function shot(name) {
  await page.screenshot({ path: join(outDir, name), fullPage: false });
}

try {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  const lobby = await page.locator("body").innerText();
  if (!lobby.includes("自選 17 檔（上市 16、上櫃 1）")) {
    throw new Error(`lobby missing SSOT line. prefix=${lobby.slice(0, 240)}`);
  }
  await shot("01-lobby.png");

  await page.goto(`${base}/manual`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  const manual = await page.locator("body").innerText();
  for (const needle of ["2026-09-21", "閃電下單", "回大廳", "17 檔權值與觀察股"]) {
    if (!manual.includes(needle)) throw new Error(`/manual missing ${needle}`);
  }
  await shot("02-manual.png");

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByRole("button", { name: "進入盤室" }).first().click();
  await page.waitForTimeout(600);
  if (await page.getByRole("button", { name: "繼續盤勢" }).count()) {
    await page.getByRole("button", { name: "繼續盤勢" }).click();
    await page.waitForTimeout(300);
  }
  await page.getByRole("button", { name: "回大廳" }).click();
  await page.waitForTimeout(400);
  if (await page.getByRole("dialog", { name: "確定回大廳？" }).count()) {
    throw new Error("empty desk should leave without confirm");
  }
  if (!(await page.locator("body").innerText()).includes("本週課綱")) {
    throw new Error("empty-desk leave did not return to lobby");
  }

  await page.getByRole("button", { name: "進入盤室" }).first().click();
  await page.waitForTimeout(600);
  if (await page.getByRole("button", { name: "繼續盤勢" }).count()) {
    await page.getByRole("button", { name: "繼續盤勢" }).click();
    await page.waitForTimeout(300);
  }
  // 第 1 課本金 100 萬買不起 1 張台積電；改點較便宜的觀察股。
  await page.locator(".term-desk tr", { hasText: "聯電" }).click();
  await page.waitForTimeout(200);
  await page.locator(".term-desk").getByRole("button", { name: "送出買進" }).click();
  await page.waitForTimeout(800);
  await shot("03-desk-after-buy.png");
  await page.getByRole("button", { name: "回大廳" }).click();
  await page.waitForTimeout(300);
  const dlg = page.getByRole("dialog", { name: "確定回大廳？" });
  if (!(await dlg.count())) throw new Error("expected leave confirm after a fill");
  const dlgText = await dlg.innerText();
  if (!dlgText.includes("不會寫入戰績") || !dlgText.includes("不會自動平倉")) {
    throw new Error(`confirm copy off: ${dlgText}`);
  }
  await shot("04-leave-confirm.png");
  await page.getByRole("button", { name: "繼續上課" }).click();
  await page.waitForTimeout(300);
  if (!(await page.getByRole("button", { name: "送出買進" }).count())) {
    throw new Error("cancel should stay on the desk");
  }
  await page.getByRole("button", { name: "回大廳" }).click();
  await page.getByRole("button", { name: "確定離開" }).click();
  await page.waitForTimeout(400);
  if (!(await page.locator("body").innerText()).includes("本週課綱")) {
    throw new Error("confirm leave did not return to lobby");
  }
  if (await page.getByRole("dialog", { name: "確定回大廳？" }).count()) {
    throw new Error("dialog should close after confirm");
  }
  await shot("05-back-lobby.png");
  console.log(`ok ${outDir}`);
} finally {
  await browser.close();
}
