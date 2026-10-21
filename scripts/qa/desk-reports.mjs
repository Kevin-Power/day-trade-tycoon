// 委託回報 for sends whose result is unclear, on a disposable classroom after desk-seed:
// 1. the connection drops on 確認送出 (the server may or may not have the order): a 「回覆不明」 row, not 送出失敗;
// 2. the server refuses with 409 and the reload after it also fails: the 送出失敗 row keeps the server's reason;
// 3. the classroom stores the order but its reply is lost: 回覆不明, and after 重新載入進度 that row drops out
//    while the order reads 委託成功 (one order, not two);
// 4. a 2xx reply that cannot be read, and 5. no reply within 20 s: both 回覆不明.
// The confirm button says 「正在處理…」 only while its order is sent: not while an error banner waits, nor while a
// minute advances with the card open (6); the review's 「正在保存…」 likewise (7).
// Usage: node scripts/qa/desk-reports.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "reports"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const results = {};
const failures = [];
async function check(name, run) {
  try {
    results[name] = (await run()) ?? "pass";
  } catch (error) {
    results[name] = `FAIL: ${error.message}`;
    failures.push(`${name}: ${error.message}`);
  }
}
const api = async () => (await (await fetch(`${base}/api/morning`)).json()).state;
async function rest(page) {
  await page
    .waitForFunction(
      () => {
        const clock = document.querySelector(".td-clock strong")?.textContent?.trim() ?? "";
        const stamp = document.querySelector(".td-hero-stamp")?.textContent ?? "";
        return clock.endsWith(":00") && !stamp.includes("模擬成交");
      },
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
}
const reportRows = (page) => page.locator(".sim-reports li");
async function newestReport(page, previous) {
  const end = Date.now() + 8000;
  for (;;) {
    const rows = await reportRows(page).allTextContents();
    if (rows.length && rows.join("|") !== previous) return rows[0].replace(/\s+/g, " ").trim();
    if (Date.now() > end) throw new Error(`no new 委託回報 row (rows: ${rows.slice(0, 3).join(" / ")})`);
    await page.waitForTimeout(150);
  }
}
async function openMarketBuy(page, code) {
  await page.locator(`.td-watch-row[data-code="${code}"]`).click({ timeout: 4000 });
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "市價", exact: true }).first().click();
  await page.getByRole("button", { name: /^核對模擬買進/ }).click();
  await page.locator(".sim-confirm").waitFor({ timeout: 4000 });
}
async function clearBanner(page) {
  await page.getByRole("button", { name: /重新載入進度/ }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(800);
  await rest(page);
  // The confirm card stays open after a send that did not go through.
  await page.getByRole("button", { name: "返回修改" }).first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 }).catch(() => {});
await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
await rest(page);

let bannerButton = null;
await check("1-dropped-connection", async () => {
  await openMarketBuy(page, "2317");
  const before = (await reportRows(page).allTextContents()).join("|");
  const drop = (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await page.route("**/api/morning*", drop);
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  const row = await newestReport(page, before);
  await page.unroute("**/api/morning*", drop);
  await page.screenshot({ path: `${out}dropped.png` });
  bannerButton = await page.locator(".sim-submit").first().evaluate((node) => ({
    text: node.textContent.trim(),
    disabled: node.disabled,
  }));
  await clearBanner(page);
  if (!row.includes("回覆不明")) throw new Error(`the newest report says 「${row}」`);
  if (row.includes("送出失敗")) throw new Error(`a dropped connection is reported as a failed send: 「${row}」`);
  return row;
});

await check("1b-confirm-button-while-banner", async () => {
  if (!bannerButton) throw new Error("check 1 did not reach the banner");
  if (bannerButton.text.includes("正在處理")) throw new Error(`the confirm button says 「${bannerButton.text}」 while nothing is being sent`);
  if (!bannerButton.text.includes("確認送出模擬買進") || !bannerButton.disabled)
    throw new Error(`the confirm button is 「${bannerButton.text}」, disabled ${bannerButton.disabled}`);
  return bannerButton;
});

await check("2-409-then-reload-fails", async () => {
  await openMarketBuy(page, "2317");
  // Another "tab" moves the run on, so this send gets 409.
  const run = await api();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, run.nextAdvanceAt - Date.now()) + 60));
  const moved = await fetch(`${base}/api/morning`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action: "advance", id: run.id, expectedRevision: run.revision, requestId: crypto.randomUUID() }),
  });
  if (moved.status !== 200) throw new Error(`could not move the run on from another "tab" (${moved.status})`);
  const before = (await reportRows(page).allTextContents()).join("|");
  let sent = false;
  const reloadFails = (route) => {
    if (route.request().method() === "POST") {
      sent = true;
      return route.continue();
    }
    return sent ? route.abort("failed") : route.continue();
  };
  await page.route("**/api/morning*", reloadFails);
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  const row = await newestReport(page, before);
  await page.unroute("**/api/morning*", reloadFails);
  await page.screenshot({ path: `${out}conflict.png` });
  await clearBanner(page);
  if (!row.includes("送出失敗") || !row.includes("練習已更新"))
    throw new Error(`the 送出失敗 row lost the server's reason: 「${row}」`);
  return row;
});

await check("4-unreadable-2xx", async () => {
  await openMarketBuy(page, "2317");
  const before = (await reportRows(page).allTextContents()).join("|");
  // A proxy page instead of the classroom's JSON: the reply says 200 but cannot be read.
  const garble = (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>gateway</body></html>" })
      : route.continue();
  await page.route("**/api/morning*", garble);
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  const row = await newestReport(page, before);
  await page.unroute("**/api/morning*", garble);
  await clearBanner(page);
  if (!row.includes("回覆不明")) throw new Error(`an unreadable 2xx reply is reported as 「${row}」`);
  return row;
});

await check("5-no-reply-within-20s", async () => {
  await openMarketBuy(page, "2317");
  const before = (await reportRows(page).allTextContents()).join("|");
  const held = [];
  const hang = (route) => (route.request().method() === "POST" ? void held.push(route) : route.continue());
  await page.route("**/api/morning*", hang);
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await page.waitForTimeout(800);
  const sending = (await page.locator(".sim-submit").first().textContent())?.trim() ?? "";
  const end = Date.now() + 30000;
  let row = "";
  for (;;) {
    const rows = await reportRows(page).allTextContents();
    if (rows.length && rows.join("|") !== before) {
      row = rows[0].replace(/\s+/g, " ").trim();
      break;
    }
    if (Date.now() > end) break;
    await page.waitForTimeout(500);
  }
  await page.unroute("**/api/morning*", hang);
  for (const route of held) await route.abort("failed").catch(() => {});
  await clearBanner(page);
  if (!sending.includes("正在處理")) throw new Error(`while the order was being sent its button said 「${sending}」`);
  if (!row) throw new Error("no 委託回報 row 30 s after a send that never got a reply");
  if (!row.includes("回覆不明") || !row.includes("20 秒")) throw new Error(`a send with no reply is reported as 「${row}」`);
  return row;
});

// Holds the classroom's answer to 前進 1 分鐘 while label() is read, then lets it through.
async function duringAdvance(label) {
  const held = [];
  const hold = (route) => {
    const request = route.request();
    if (request.method() === "POST" && (request.postData() ?? "").includes('"advance"')) return void held.push(route);
    return route.continue();
  };
  await page.route("**/api/morning*", hold);
  await page.getByRole("button", { name: "前進 1 分鐘" }).click({ timeout: 8000 });
  await page.waitForTimeout(600);
  const text = await label();
  await page.unroute("**/api/morning*", hold);
  for (const route of held) await route.continue().catch(() => {});
  await page.waitForTimeout(800);
  await rest(page);
  if (!held.length) throw new Error("前進 1 分鐘 sent no advance");
  return text;
}

await check("6-advance-while-reviewing-an-order", async () => {
  await openMarketBuy(page, "2317");
  const label = await duringAdvance(async () => (await page.locator(".sim-submit").first().textContent())?.trim() ?? "");
  await page.getByRole("button", { name: "返回修改" }).first().click({ timeout: 2000 }).catch(() => {});
  if (label.includes("正在處理")) throw new Error(`while a minute advanced, the order's confirm button said 「${label}」`);
  return label;
});

await check("7-advance-while-writing-the-review", async () => {
  await page.getByRole("button", { name: "復盤", exact: true }).click({ timeout: 4000 });
  const save = page.locator('#morning-review-title ~ form button[type="submit"]').first();
  await save.waitFor({ timeout: 4000 });
  const label = await duringAdvance(async () => (await save.textContent())?.trim() ?? "");
  await page.getByRole("button", { name: "回看行情，保持暫停" }).click({ timeout: 4000 }).catch(() => {});
  if (label.includes("正在保存")) throw new Error(`while a minute advanced, the review's save button said 「${label}」`);
  return label;
});

await check("3-reply-lost-after-the-order-landed", async () => {
  await openMarketBuy(page, "2382");
  const before = (await reportRows(page).allTextContents()).join("|");
  const lose = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    // The classroom gets and stores the order; its reply never reaches the page.
    await route.fetch();
    return route.abort("failed");
  };
  await page.route("**/api/morning*", lose);
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  const row = await newestReport(page, before);
  await page.unroute("**/api/morning*", lose);
  if (!row.includes("回覆不明") || !row.includes("廣達")) throw new Error(`the newest report says 「${row}」`);
  await page.getByRole("button", { name: /重新載入進度/ }).first().click({ timeout: 4000 });
  await page.waitForTimeout(800);
  await rest(page);
  const rows = (await reportRows(page).allTextContents()).map((text) => text.replace(/\s+/g, " ").trim());
  await page.screenshot({ path: `${out}landed.png` });
  await page.getByRole("button", { name: "返回修改" }).first().click({ timeout: 2000 }).catch(() => {});
  const ours = rows.filter((text) => text.includes("廣達"));
  if (ours.some((text) => text.includes("回覆不明")))
    throw new Error(`after 重新載入進度 委託回報 still lists 「回覆不明」 next to the order: ${ours.join(" / ")}`);
  if (!ours.some((text) => text.includes("委託成功"))) throw new Error(`the landed order is not listed: ${rows.join(" / ")}`);
  return ours;
});

await browser.close();
writeFileSync(`${out}reports.json`, JSON.stringify({ results, failures }, null, 2));
console.log(JSON.stringify(results, null, 2));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("委託回報 for unclear sends: all checks pass.");
