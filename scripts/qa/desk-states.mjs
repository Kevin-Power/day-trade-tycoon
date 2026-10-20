// Screenshots of trading states on a seeded desk-server: order review (with the large-order tick when one lot is
// half the cash or more), pending order and its cancel, flash order armed, limit price, the ledger's 委託 tab and
// the phone 教材 drawer.
// Leaves one cancelled order behind. Usage: node scripts/qa/desk-states.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [base = "http://127.0.0.1:18821", outArg = "artifacts/premium-ui/states"] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const failures = [];

for (const [width, height] of [
  [1440, 900],
  [390, 844],
]) {
  const name = `${width}x${height}`;
  const phone = width < 768;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const shot = (label) => page.screenshot({ path: `${out}/${name}-${label}.png` });
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    if (phone) await page.getByRole("button", { name: "下單", exact: true }).click();
    await page.getByRole("button", { name: "限價", exact: true }).click();
    await page.getByRole("button", { name: "提高一檔價格" }).click();
    await shot("limit");
    await page.getByRole("button", { name: "市價", exact: true }).click();
    await page.getByRole("button", { name: /^核對模擬買進/ }).click();
    await page.getByRole("button", { name: "確認送出模擬買進" }).waitFor();
    await shot("review");
    if (await page.locator("#sim-large-ack").isVisible()) await page.locator("#sim-large-ack").check();
    await page.getByRole("button", { name: "確認送出模擬買進" }).click();
    await page.getByText("委託已送出 · 等待撮合").waitFor();
    await shot("pending");
    await page.getByRole("button", { name: "撤回委託" }).first().click();
    await page.getByText("委託已送出 · 等待撮合").waitFor({ state: "detached" });
    await page.getByRole("switch", { name: "閃電即送" }).click();
    await shot("flash");
    await page.getByRole("switch", { name: "閃電即送" }).click();
    if (phone) {
      await page.getByRole("button", { name: /^庫存/ }).click();
      await page.getByRole("button", { name: /^委託/ }).click();
      await shot("orders");
      await page.getByRole("button", { name: "教材" }).click();
      await page.locator("#td-resources-title").waitFor();
      await shot("resources");
    } else {
      await page.locator(".td-ledger").getByRole("button", { name: /^委託/ }).click();
      await shot("ledger");
    }
  } catch (error) {
    failures.push(`${name}: ${error.message.split("\n")[0]}`);
    await shot("stopped").catch(() => {});
  }
  await context.close();
}
await browser.close();
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("State screenshots captured.");
