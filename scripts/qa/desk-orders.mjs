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
// The fill must show as the latest 快訊 after a manual step, and reach the polite live region.
await until(async () => /你的委託成交/.test((await page.locator(".td-alert").textContent().catch(() => "")) ?? ""), "fill alert not visible after a manual step");
const announced = await page.locator('.td-hints [aria-live="polite"]').textContent();
assert.match(announced ?? "", /你的委託成交/);

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
// The ledger starts collapsed; a pending order is flagged, and the 委託 tab opens it.
const ledger = page.locator(".td-ledger");
const ledgerToggle = ledger.locator(".sim-ledger-toggle");
assert.equal(await ledgerToggle.getAttribute("aria-expanded"), "false");
await until(
  async () => /1 待成交/.test((await ledger.locator(".sim-pending-badge").textContent().catch(() => "")) ?? ""),
  "pending badge missing while the ledger is collapsed",
);
await ledger.getByRole("button", { name: /^委託/ }).click();
await until(async () => (await ledgerToggle.getAttribute("aria-expanded")) === "true", "ledger did not open");
await page.getByRole("button", { name: "撤回委託" }).first().click();
state = await until(async () => {
  const next = await api();
  return next.orders.at(-1)?.status === "cancelled" && next;
}, "lightning order not cancelled");
result.lightning = {
  side: state.orders.at(-1).side,
  status: state.orders.at(-1).status,
  entryMode: state.orders.at(-1).entryMode,
  ledgerOpenedFromTab: true,
};

// 3. Selling a symbol without holdings is refused before submission.
await page.getByRole("combobox", { name: "下單商品" }).selectOption("2317");
await page.getByRole("button", { name: "賣出", exact: true }).click();
await page.getByText("這檔目前沒有庫存，先模擬買進後才能賣出。").waitFor();
result.sellWithoutHolding = {
  submitDisabled: await page.getByRole("button", { name: /^核對模擬賣出/ }).isDisabled(),
};
assert.equal(result.sellWithoutHolding.submitDisabled, true);

// 4. The send fails once (network) and 「重試這次操作」 resends it: one order only, and the reviewed confirm card
//    closes instead of staying open as 「行情或帳戶已更新」 over the ticket (found by the workbook acceptance, B-07).
// 鴻海 (about 259,000 a lot): the fixture has already spent most of the cash on 台積電.
await page.getByRole("combobox", { name: "下單商品" }).selectOption("2317");
await page.getByRole("button", { name: "買進", exact: true }).click();
state = await api();
const ordersBefore = state.orders.length;
let aborted = 0;
await page.route("**/api/morning**", (route) => {
  if (route.request().method() === "POST" && aborted === 0) {
    aborted += 1;
    return route.abort("internetdisconnected");
  }
  return route.continue();
});
await page.getByRole("button", { name: /^核對模擬買進/ }).click();
await page.getByRole("button", { name: "確認送出模擬買進" }).click();
await page.getByRole("button", { name: "重試這次操作" }).click();
state = await until(async () => {
  const next = await api();
  return next.orders.length > ordersBefore && next;
}, "retried order missing").catch(async (error) => {
  await page.screenshot({ path: `${out}retried-send-failed.png` });
  throw error;
});
await page.unroute("**/api/morning**");
await page.waitForTimeout(800);
result.retriedSend = {
  newOrders: state.orders.length - ordersBefore,
  confirmCardOpen: await page.locator(".sim-confirm").isVisible(),
  pendingShown: await page.getByText("委託已送出 · 等待撮合").isVisible(),
};
assert.equal(result.retriedSend.newOrders, 1);
assert.equal(result.retriedSend.confirmCardOpen, false, "the confirm card stayed open after the retried send");
assert.equal(result.retriedSend.pendingShown, true, "the waiting order is not shown after the retried send");
// Withdraw it so the scripts that run after this one see the same desk as before this case was added.
await page.locator(".sim-pending").getByRole("button", { name: "撤回委託" }).click();
state = await until(async () => {
  const next = await api();
  return next.orders.at(-1)?.status === "cancelled" && next;
}, "retried order not withdrawn");
result.retriedSend.withdrawn = state.orders.at(-1).status;

await page.screenshot({ path: `${out}orders-final.png` });
await browser.close();
writeFileSync(`${out}orders.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
