// Text fields and menus on phones and tablets, after desk-seed: every one the desk shows on the 下單 page (with
// 限價) and in the review form is at least 16px. iOS Safari zooms the whole page when a smaller field is tapped,
// and it stays zoomed. Emulates an iPhone 13 (also with 大字), and an iPad (7th gen); the 教材 drawer is checked too.
// On the iPhone, which reports no hover, a 五檔 price must not take the mouse-hover outline: iOS turns a tap into a
// hover that stays on what was tapped. Runs in chromium or webkit (Safari's engine).
// Usage: node scripts/qa/desk-phone-fields.mjs <baseUrl> <label> [chromium|webkit]
import { chromium, devices, webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "phone-fields", engineName = "chromium"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const results = {};
const failures = [];
const browser =
  engineName === "webkit"
    ? await webkit.launch()
    : await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));

// Visible text fields and menus (not buttons, ticks or switches), with their font size.
const fields = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((node) => !["hidden", "checkbox", "radio", "button", "submit", "range"].includes(node.type))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((node) => ({
        field:
          node.getAttribute("aria-label") ||
          node.labels?.[0]?.textContent?.trim().slice(0, 24) ||
          node.name ||
          node.tagName.toLowerCase(),
        fontSize: parseFloat(getComputedStyle(node).fontSize),
      })),
  );

for (const [name, device, senior] of [
  ["iphone", devices["iPhone 13"], false],
  ["iphone-senior", devices["iPhone 13"], true],
  ["ipad", devices["iPad (gen 7)"], false],
]) {
  const context = await browser.newContext({ ...device });
  if (senior) await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  const seen = [];
  try {
    await page.goto(`${base}/morning`, { waitUntil: "domcontentloaded" });
    await page.locator('main canvas[role="img"]').first().waitFor({ timeout: 20000 });
    await page.locator(".td-notice").getByRole("button", { name: "知道了" }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    // Phones reach the ticket through the tab bar; tablets show it beside the chart.
    const tabs = page.getByRole("navigation", { name: "主要分頁" });
    if (await tabs.count()) await tabs.getByRole("button", { name: /下單/ }).first().click({ timeout: 4000 });
    await page.getByRole("button", { name: "限價", exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    seen.push(...(await fields(page)).map((field) => ({ ...field, where: "下單" })));
    await page.screenshot({ path: `${out}${name}-ticket.png` });
    if (name === "iphone") {
      // A phone reports no hover, so a mouse-hover outline must not apply: iOS turns a tap into a hover that stays.
      const cell = page.locator('.td-book[data-mode="trade"] .td-book-cell[data-side="bid"]:not(:disabled)').first();
      const hoverCapable = await page.evaluate(() => matchMedia("(hover: hover)").matches);
      if (!(await cell.count())) failures.push(`${name}: no tradable 五檔 price on the 下單 page`);
      else if (hoverCapable) failures.push(`${name}: the emulated phone reports (hover: hover), so this cannot be checked`);
      else {
        await cell.hover();
        await page.waitForTimeout(200);
        const ring = await cell.evaluate((node) => {
          const style = getComputedStyle(node);
          return { style: style.outlineStyle, width: style.outlineWidth };
        });
        await page.screenshot({ path: `${out}${name}-hovered-price.png` });
        if (ring.style !== "none" && ring.width !== "0px")
          failures.push(`${name}: on a touch screen a 五檔 price takes the mouse-hover outline (${ring.style} ${ring.width}), which a tap leaves stuck`);
        results[`${name}-hovered-price`] = ring;
        await page.mouse.move(1, 1);
      }
    }
    await page.getByRole("button", { name: "復盤", exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(600);
    seen.push(...(await fields(page)).map((field) => ({ ...field, where: "復盤" })));
    await page.getByRole("button", { name: "回看行情，保持暫停" }).click({ timeout: 4000 }).catch(() => {});
    await page.getByRole("button", { name: "教材" }).first().click({ timeout: 4000 });
    await page.locator("#td-resources-title").waitFor({ timeout: 4000 });
    seen.push(...(await fields(page)).map((field) => ({ ...field, where: "教材" })));
    await page.screenshot({ path: `${out}${name}-resources.png` });
    const small = seen.filter((field) => !(field.fontSize >= 16));
    if (!seen.some((field) => field.where === "下單")) failures.push(`${name}: no fields found on the 下單 page`);
    for (const field of small)
      failures.push(`${name}: ${field.where} 「${field.field}」 is ${field.fontSize}px; iOS zooms the page when it is tapped`);
    results[name] = seen;
  } catch (error) {
    failures.push(`${name}: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}${name}-stopped.png` }).catch(() => {});
  }
  await context.close();
}

await browser.close();
writeFileSync(`${out}phone-fields.json`, JSON.stringify({ engine: engineName, results, failures }, null, 2));
console.log(JSON.stringify({ engine: engineName, results }, null, 1));
if (failures.length) {
  console.log(`FAILURES:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Phone and tablet fields are 16px or more (${engineName}): all checks pass.`);
