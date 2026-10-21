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
// Short desktops: the large-order confirm card's tick is never under the pinned 確認送出 button.
for (const [width, height] of [
  [1366, 768],
  [1200, 800],
  // Real laptop viewports in the short-desktop layout (760px or less).
  [1366, 657],
  [1280, 600],
]) {
  const name = `${width}x${height}`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('.td-chart canvas[role="img"]').waitFor({ timeout: 20000 });
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
    const state = await page.evaluate(async () => (await (await fetch("/api/morning")).json()).state);
    let choice = null;
    for (const code of ["2454", "2330", "2308", "2382", "2317"])
      for (const lots of [1, 2, 3])
        if (!choice && state.bars[code].at(-1).c * 1000 * lots >= 0.5 * state.cash) choice = { code, lots };
    if (!choice) throw new Error("no order reaches half the cash");
    await page.locator(`.td-watch-row[data-code="${choice.code}"]`).click();
    await page.getByRole("button", { name: "市價", exact: true }).click();
    for (let lots = 1; lots < choice.lots; lots++) await page.getByRole("button", { name: "增加一張" }).click();
    await page.getByRole("button", { name: /^核對模擬買進/ }).click();
    const tick = page.locator("#sim-large-ack");
    await tick.waitFor({ timeout: 4000 });
    await page.waitForTimeout(300);
    // As the card opens (no scrolling by the test), and again after Tab-style scrolling into view.
    const clearAt = () =>
      tick.evaluate((input) => {
        const box = input.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return Boolean(hit?.closest("#sim-large-ack, label[for='sim-large-ack']"));
      });
    const clearOnOpen = await clearAt();
    await tick.scrollIntoViewIfNeeded();
    const clear = clearOnOpen && (await clearAt());
    await page.screenshot({ path: `${out}/${name}-large-order.png` });
    if (!clear)
      failures.push(`${name}: the pinned send button covers the large-order tick (on open: ${clearOnOpen ? "clear" : "covered"})`);
    await page.getByRole("button", { name: "返回修改" }).click();
  } catch (error) {
    failures.push(`${name} large order: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}/${name}-large-order-stopped.png` }).catch(() => {});
  }
  await context.close();
}
await browser.close();
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("State screenshots captured.");
