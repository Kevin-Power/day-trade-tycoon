#!/usr/bin/env node
/**
 * Rebuild public/daytrade-tycoon-manual.pdf from the live /manual HTML.
 * There was no previous build script; the static PDF was a Chromium print
 * dated 2026-09-01 and lagged the HTML (徽章、閃電下單、回大廳確認).
 *
 *   npm run dev                     # already running on :8080
 *   npm run build:manual-pdf
 *
 *   npm run build:manual-pdf -- --start
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { isMainModule } from "./with-app-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "http://127.0.0.1:8080";
const GATE_KEY = "day-tycoon-gate-v1"; // src/lib/gate/storage.ts
const OUT = join(root, "public", "daytrade-tycoon-manual.pdf");

export function parsePdfArgs(argv, env = process.env) {
  const start = argv.includes("--start");
  const urlFlag = argv.indexOf("--url");
  const url = urlFlag === -1 ? env.MANUAL_PDF_URL || DEFAULT_URL : argv[urlFlag + 1];
  if (!url) return { error: "missing --url" };
  return { start, url };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.ok || res.status === 302 || res.status === 301) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err?.message || String(err);
    }
    await wait(400);
  }
  throw new Error(`server not ready at ${url}: ${last}`);
}

async function printManual(baseUrl, outPath) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await context.addInitScript((key) => {
      localStorage.setItem(key, "1");
    }, GATE_KEY);
    const page = await context.newPage();
    const url = new URL("/manual", baseUrl).href;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    const body = await page.locator("body").innerText();
    if (!body.includes("說明書") || !body.includes("2026-09-21")) {
      throw new Error(
        `printed page is not the current /manual HTML (gate still up, or stale?). prefix=${body.slice(0, 160)}`,
      );
    }
    if (!body.includes("閃電下單") || !body.includes("回大廳")) {
      throw new Error("printed /manual is missing 閃電下單 or 回大廳 copy");
    }
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

async function main(argv) {
  const parsed = parsePdfArgs(argv);
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }
  const baseUrl = checkedUrl(parsed.url.endsWith("/") ? parsed.url : `${parsed.url}/`).replace(/\/$/, "");
  const outPath = checkedOutputPath(OUT, [root], "manual PDF");

  let child = null;
  if (parsed.start) {
    child = spawn(process.execPath, [join(root, "scripts/with-app-env.mjs"), "vite", "dev", "--host", "127.0.0.1", "--port", "8080"], {
      cwd: root,
      stdio: "ignore",
      env: process.env,
    });
  }
  try {
    await waitForHttp(baseUrl, parsed.start ? 90000 : 8000);
    await printManual(`${baseUrl}/`, outPath);
    if (!existsSync(outPath) || statSync(outPath).size < 20_000) {
      throw new Error("PDF missing or too small");
    }
    console.log(`wrote ${outPath} (${statSync(outPath).size} bytes) from ${baseUrl}/manual`);
  } finally {
    if (child?.pid) child.kill("SIGTERM");
  }
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
