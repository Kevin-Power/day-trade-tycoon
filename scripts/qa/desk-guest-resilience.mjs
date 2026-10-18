// Guest sign-in on a congested shared connection (a whole class behind one school IP): the first
// session refreshes after the guest account is created fail with 429. The page must reach the
// question or the desk, or offer 再試一次 — never wait forever on 「正在準備…」.
// Usage: node scripts/qa/desk-guest-resilience.mjs [label] [proxyPort] [failedRefreshes]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [label = "guest-resilience", proxyPort = "18811", failArg = "3"] = process.argv.slice(2);
const FAILED_REFRESHES = Number(failArg);
const state = JSON.parse(
  readFileSync(fileURLToPath(new URL(`../../artifacts/trading-desk-qa/server-${proxyPort}.json`, import.meta.url)), "utf8"),
);
if (!state.appBase || !state.gateCode) throw new Error("Restart desk-server.mjs: its state file has no appBase/gateCode");
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });

const pages = [
  { name: "daily", path: "/daily", ready: (page) => page.getByRole("radiogroup", { name: "你的選擇" }) },
  { name: "morning", path: "/morning", ready: (page) => page.locator(".td-workbench, .td-plan").first() },
];
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const failures = [];
for (const target of pages) {
  const fail = (message) => failures.push(`${target.name}: ${message}`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let signedIn = false;
  let refused = 0;
  let congested = true;
  page.on("response", (response) => {
    if (response.url().includes("/api/auth/sign-in/anonymous") && response.ok()) signedIn = true;
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    if (signedIn && congested && refused < FAILED_REFRESHES) {
      refused++;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "retry-after": "1" },
        body: JSON.stringify({ message: "Too many requests" }),
      });
    }
    return route.continue();
  });
  try {
    await page.goto(state.appBase + "/", { waitUntil: "domcontentloaded" });
    await page.getByLabel("教室入場碼", { exact: true }).fill(state.gateCode);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "進入教室" }).click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.goto(state.appBase + target.path, { waitUntil: "domcontentloaded" });
    const ready = target.ready(page);
    const retry = page.getByRole("button", { name: "再試一次" });
    const outcome = await Promise.race([
      ready.waitFor({ timeout: 15000 }).then(() => "ready"),
      retry.waitFor({ timeout: 15000 }).then(() => "retry"),
    ]).catch(() => "stuck");
    await page.screenshot({ path: `${out}${target.name}-${outcome}.png` });
    if (outcome === "stuck") fail(`still waiting after 15 s (${refused} session refreshes refused)`);
    if (outcome === "retry") {
      // The retry button is readable: white text on its fill at WCAG AA (4.5:1).
      const ratio = await retry.evaluate((el) => {
        const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = (c) =>
          c
            .map((v) => v / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const style = getComputedStyle(el);
        const [a, b] = [lum(rgb(style.color)), lum(rgb(style.backgroundColor))];
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      if (ratio < 4.5) fail(`再試一次 contrast ${ratio.toFixed(2)}:1, needs 4.5:1`);
      // The connection has cleared; 再試一次 must bring the learner in.
      congested = false;
      await retry.click();
      await ready.waitFor({ timeout: 15000 }).catch(() => fail("再試一次 did not recover"));
      await page.screenshot({ path: `${out}${target.name}-after-retry.png` });
    }
    console.log(`${target.name}: ${outcome}${outcome === "retry" ? " → recovered" : ""} (${refused} refreshes refused)`);
  } catch (error) {
    fail(`flow stopped: ${error.message.split("\n")[0]}`);
  }
  await context.close();
}
await browser.close();
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("Guest sign-in recovers from refused session refreshes.");
