#!/usr/bin/env node
/**
 * Manual browser pass for /license + lobby entry. Not part of npm test.
 * Requires npm run dev on :8080.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "artifacts", "license-verify");
mkdirSync(outDir, { recursive: true });

const GATE_KEY = "day-tycoon-gate-v1";
const base = "http://127.0.0.1:8080";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

async function shot(name) {
  await page.screenshot({ path: join(outDir, name), fullPage: false });
}

try {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  const gateText = await page.locator("body").innerText();
  if (!gateText.includes("教室授權說明") || !gateText.includes("不必入場密碼")) {
    throw new Error(`gate missing license entry. prefix=${gateText.slice(0, 240)}`);
  }
  await shot("01-gate-license-entry.png");

  await page.getByRole("link", { name: "教室授權說明" }).click();
  await page.waitForTimeout(600);
  const publicLicense = await page.locator("body").innerText();
  for (const needle of [
    "教室授權／班級方案",
    "模擬教室",
    "課綱",
    "地端包",
    "說明書",
    "實盤下單",
    "投顧",
    "保證獲利",
    "洽教室／講師報價",
    "同一組入場密碼",
    "每人一個帳號",
  ]) {
    if (!publicLicense.includes(needle)) throw new Error(`public /license missing ${needle}`);
  }
  if (/NT\$|一班\s*\d/.test(publicLicense)) {
    throw new Error("license page invented a price");
  }
  if (!publicLicense.includes("回入場")) {
    throw new Error("locked /license should say 回入場");
  }
  await shot("02-license-public.png");

  await context.addInitScript((key) => localStorage.setItem(key, "1"), GATE_KEY);
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  const lobby = await page.locator("body").innerText();
  if (!lobby.includes("教室授權／班級方案") || !lobby.includes("打開授權說明")) {
    throw new Error(`lobby missing license card. prefix=${lobby.slice(0, 240)}`);
  }
  await shot("03-lobby-license.png");

  await page.getByRole("link", { name: "打開授權說明" }).click();
  await page.waitForTimeout(600);
  const unlocked = await page.locator("body").innerText();
  if (!unlocked.includes("回大廳")) throw new Error("unlocked /license should say 回大廳");
  if (!unlocked.includes("洽教室／講師報價")) throw new Error("unlocked /license missing quote");
  await shot("04-license-unlocked.png");

  console.log(`ok ${outDir}`);
} finally {
  await browser.close();
}
