// Order flows on the real trading desk with API read-back. Accessible names must not change.
// Usage: node scripts/qa/desk-orders.mjs <baseUrl> <label>
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const api = async () => (await (await fetch(`${base}/api/morning`)).json()).state;
async function until(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
await page.goto(`${base}/morning?panel=trade`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /^核對模擬買進/ }).waitFor();
const result = {};

// 1. Market buy through the ticket: review, submit, advance, filled at the next open.
let state = await api();
const fillsBefore = state.fills.length;
await page.getByRole("button", { name: /^核對模擬買進/ }).click();
await page.getByRole("button", { name: "確認送出模擬買進" }).click();
await page.getByText("委託已送出 · 等待撮合").waitFor();
await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
state = await until(async () => {
  const next = await api();
  return next.fills.length > fillsBefore && next;
}, "market buy was not filled");
result.marketBuy = {
  newFills: state.fills.length - fillsBefore,
  side: state.fills.at(-1).side,
  shares: state.fills.at(-1).shares,
};

// 2. Lightning sell from the bid side of the ladder, then withdraw it.
const lightning = page.getByRole("switch", { name: "閃電即送" });
await lightning.click();
await until(async () => (await lightning.getAttribute("aria-checked")) === "true", "lightning did not arm");
await page.getByRole("button", { name: /^買1 價格/ }).click();
state = await until(async () => {
  const next = await api();
  const order = next.orders.at(-1);
  return order?.status === "pending" && order.entryMode === "lightning" && next;
}, "lightning order missing");
await page.getByRole("button", { name: "撤回委託" }).first().click();
state = await until(async () => {
  const next = await api();
  return next.orders.at(-1)?.status === "cancelled" && next;
}, "lightning order not cancelled");
result.lightning = {
  side: state.orders.at(-1).side,
  status: state.orders.at(-1).status,
  entryMode: state.orders.at(-1).entryMode,
};

// 3. Selling a symbol without holdings is refused before submission.
await page.getByRole("combobox", { name: "下單商品" }).selectOption("2317");
await page.getByRole("button", { name: "賣出", exact: true }).click();
await page.getByText("這檔目前沒有庫存，先模擬買進後才能賣出。").waitFor();
result.sellWithoutHolding = {
  submitDisabled: await page.getByRole("button", { name: /^核對模擬賣出/ }).isDisabled(),
};
assert.equal(result.sellWithoutHolding.submitDisabled, true);

await page.screenshot({ path: `${out}orders-final.png` });
await browser.close();
writeFileSync(`${out}orders.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
