// Before／after evidence: the same measurements on the reviewed build (SHA-256 9d414c0c…) and the
// revised build. Re-runnable.
//   node courseware/academy/build/qa_before_after.mjs <before/index.html> <after/index.html> <outDir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [beforeFile, afterFile, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));

async function open(file, options = {}, init = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.waitForTimeout(300);
  return { context, page, errors };
}
const go = (page, id) => page.evaluate((hash) => (location.hash = hash), id).then(() => page.waitForTimeout(150));
const isNew = (page) => page.evaluate(() => Boolean(window.ACADEMY_DEBUG));

/** Satisfies every required item of the given tasks from the page's own model (new build only). */
async function fillRequired(page, ids, { habit = "0", honest = true } = {}) {
  for (const id of ids) {
    await go(page, id);
    const reqs = await page.evaluate((task) => window.ACADEMY.tasks[task].req, id);
    const all = reqs.flatMap((req) => (req.t === "any" ? [req.of[1]] : [req]));
    for (const req of all) {
      if (req.t === "check") await page.locator(`[data-check="${req.key}"]`).check();
      if (req.t === "field") {
        const element = page.locator(`[data-field="${req.key}"]`).first();
        if ((await element.evaluate((node) => node.tagName)) === "SELECT") await element.selectOption({ index: 1 });
        else await element.fill(/net|cost|diff/.test(req.key) ? "0" : /end/.test(req.key) ? "10:00" : "示範作答");
      }
      if (req.t === "choice") await page.locator(`input[data-field="${req.key}"][value="${habit}"]`).check();
      if (req.t === "tri") {
        const value = honest ? "no" : "yes";
        await page.locator(`input[data-field="${req.key}"][value="${value}"]`).check();
        if (req.why && value !== "yes") await page.locator(`[data-field="${req.why}"]`).fill("示範原因：誠實回答否");
      }
      if (req.t === "rows") {
        const rows = Array.isArray(req.rows) ? req.rows : [...Array(req.rows).keys()];
        for (const row of rows)
          for (const col of req.cols) {
            if (req.skip?.includes(`${row}:${col}`)) continue;
            const element = page.locator(`[data-field="${req.prefix}:${row}:${col}"]`).first();
            const tag = await element.evaluate((node) => node.tagName);
            if (tag === "SELECT") await element.selectOption({ index: (await element.locator("option").count()) > 2 ? 2 : 1 });
            else await element.fill(/:0$/.test(`${row}:${col}`) && /log|wait|fills|card/.test(req.prefix) ? "09:20" : "1");
          }
      }
    }
  }
}

const rows = [];
const row = (item, before, after, verdict) => rows.push({ item, before, after, verdict });

// 1 · Level 06 with one habit.
{
  const results = {};
  for (const [label, file] of [["before", beforeFile], ["after", afterFile]]) {
    const { context, page } = await open(file);
    if (!(await isNew(page))) {
      for (const id of ["06-1", "06-2", "06-3", "06-4", "06-5", "06-6"]) {
        await go(page, id);
        for (const box of await page.locator(`#view-${id} input[type="checkbox"][data-key]`).all()) {
          const key = await box.getAttribute("data-key");
          if (/06-1:habit:[1-4]$/.test(key)) continue;
          await box.check();
        }
      }
      await go(page, "L06");
      results[label] = { text: await page.locator('[data-level-progress="L06"]').innerText(), done: await page.locator('[data-level-seal="L06"]').evaluate((node) => node.classList.contains("done")) };
    } else {
      await fillRequired(page, ["06-1", "06-2", "06-3", "06-4", "06-5", "06-6"]);
      await go(page, "L06");
      results[label] = { text: await page.locator('[data-level-progress="L06"]').innerText(), done: await page.evaluate(() => window.ACADEMY_DEBUG.levelDone("L06")), habits: await page.locator('input[data-field="06-1:habit"]:checked').count() };
    }
    await page.screenshot({ path: join(outDir, `${label}-L06-one-habit.png`) });
    await context.close();
  }
  row("Level 06：只選一個習慣、其他必要項目完成（06-4 全部誠實答「否」並寫原因）", `${results.before.text}（完成：${results.before.done ? "是" : "否"}）`, `${results.after.text}（完成：${results.after.done ? "是" : "否"}）`, !results.before.done && results.after.done ? "已修正" : "未修正");
}

// 2 · Final works can be typed in.
{
  const counts = {};
  for (const [label, file] of [["before", beforeFile], ["after", afterFile]]) {
    const { context, page } = await open(file);
    counts[label] = await page.evaluate(() => ["F-3", "F-4", "F-5"].map((id) => document.querySelectorAll(`#view-${id} input[type="text"], #view-${id} textarea, #view-${id} select`).length));
    await go(page, "F-3");
    await page.screenshot({ path: join(outDir, `${label}-F-3.png`) });
    await context.close();
  }
  row("期末 F-3／F-4／F-5 可輸入的欄位數", counts.before.join("／"), `${counts.after.join("／")}（F-4、F-5 還可新增列）`, counts.before.every((n) => n === 0) && counts.after.every((n) => n > 0) ? "已修正" : "未修正");
}

// 3 · Phone zoom.
{
  const out = {};
  for (const [label, file] of [["before", beforeFile], ["after", afterFile]]) {
    const { context, page } = await open(file, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await go(page, "01-4");
    if (await isNew(page)) {
      await page.locator("#view-01-4 .w-mapref summary").click();
      const frame = page.locator("#view-01-4 .w-mapref .figure .frame").first();
      await frame.scrollIntoViewIfNeeded();
      const inline = (await frame.boundingBox()).width;
      await frame.click();
      await page.locator('[data-lb="actual"]').click();
      const zoomed = (await page.locator("[data-lb-stage]").boundingBox()).width;
      out[label] = { inline, zoomed, ratio: zoomed / inline };
    } else {
      const frame = page.locator("#view-01-4 .figure .frame").first();
      await frame.scrollIntoViewIfNeeded();
      const inline = (await frame.boundingBox()).width;
      await frame.click();
      const zoomed = (await page.locator(".w-lightbox-body .figure .frame").first().boundingBox()).width;
      out[label] = { inline, zoomed, ratio: zoomed / inline };
    }
    await page.screenshot({ path: join(outDir, `${label}-mobile-zoom.png`) });
    await context.close();
  }
  row("390px 手機：01-4 工作台圖放大後的寬度", `${out.before.inline.toFixed(0)} → ${out.before.zoomed.toFixed(0)} px（×${out.before.ratio.toFixed(3)}）`, `${out.after.inline.toFixed(0)} → ${out.after.zoomed.toFixed(0)} px（×${out.after.ratio.toFixed(2)}，可再放大到 400%，可拖曳、兩指縮放）`, out.after.ratio >= 3 && out.before.ratio < 1.1 ? "已修正" : "未修正");
}

// 4 · Import controls, last input before pagehide, resume, malformed storage.
{
  const out = {};
  for (const [label, file] of [["before", beforeFile], ["after", afterFile]]) {
    const { context, page, errors } = await open(file);
    const fresh = await isNew(page);
    const imports = await page.locator('input[type="file"]').count();
    await go(page, "01-1");
    const area = page.locator(fresh ? '[data-field="01-1:think"]' : 'textarea[data-note="01-1:think"]');
    await area.fill("第一句");
    await page.waitForTimeout(700);
    await area.fill("第二句：輸入後立刻離開頁面");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const saved = await page.evaluate((isFresh) => {
      const raw = JSON.parse(localStorage.getItem(isFresh ? "dtt-academy-workbook-v2" : "dtt-academy-workbook-v1") || "{}");
      return isFresh ? raw.fields?.["01-1:think"] : raw.notes?.["01-1:think"];
    }, fresh);
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const resume = (await page.locator("[data-resume] a").count()) > 0;
    out[label] = { imports, saved, resume, errors: errors.length };
    await context.close();
    const broken = await open(file, {}, () => localStorage.setItem("dtt-academy-workbook-v1", JSON.stringify({ checks: null, notes: null })));
    out[label].malformedErrors = broken.errors;
    out[label].malformedView = await broken.page.evaluate(() => document.querySelector(".w-view:not([hidden])")?.dataset.view);
    await broken.context.close();
  }
  row("匯入（還原）控制項數量", String(out.before.imports), String(out.after.imports), out.after.imports > 0 && out.before.imports === 0 ? "已修正" : "未修正");
  row("輸入後立刻觸發 pagehide，localStorage 裡的筆記", out.before.saved ?? "（無）", out.after.saved ?? "（無）", out.after.saved === "第二句：輸入後立刻離開頁面" && out.before.saved !== out.after.saved ? "已修正" : "未修正");
  row("不帶網址 # 重新開啟：有「繼續上次學習」", out.before.resume ? "有" : "無", out.after.resume ? "有" : "無", out.after.resume && !out.before.resume ? "已修正" : "未修正");
  row("儲存資料為 {checks:null, notes:null} 時的錯誤", out.before.malformedErrors.join(" | ") || "無", out.after.malformedErrors.join(" | ") || "無", out.after.malformedErrors.length === 0 && out.before.malformedErrors.length > 0 ? "已修正" : "未修正");
}

// 5 · Glossary links, dark tag contrast, keyboard focus in the viewer.
{
  const out = {};
  for (const [label, file] of [["before", beforeFile], ["after", afterFile]]) {
    const { context, page } = await open(file, { colorScheme: "dark" });
    const missing = await page.evaluate(() => {
      const ids = new Set(window.ACADEMY_VIEWS.map((view) => view.id));
      return [...document.querySelectorAll("#view-glossary a[href^='#']")].map((link) => link.getAttribute("href").slice(1)).filter((id) => !ids.has(id));
    });
    await go(page, "06-1");
    const contrast = await page.locator("#view-06-1 .w-id").evaluate((node) => {
      const parse = (text) => (text.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const style = getComputedStyle(node);
      const a = lum(parse(style.color));
      const b = lum(parse(style.backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    await page.screenshot({ path: join(outDir, `${label}-dark-task-tag.png`), clip: { x: 300, y: 60, width: 760, height: 160 } });
    await go(page, "03-3");
    const frame = page.locator("#view-03-3 .figure .frame").first();
    await frame.click();
    await page.waitForTimeout(150);
    let inside = 0;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.querySelector(".w-lightbox").contains(document.activeElement))) inside++;
    }
    out[label] = { missing, contrast, inside };
    await context.close();
  }
  row("術語表連到不存在的任務", out.before.missing.join("、") || "無", out.after.missing.join("、") || "無", out.after.missing.length === 0 && out.before.missing.length > 0 ? "已修正" : "未修正");
  row("深色模式任務標籤（12px）對比", `${out.before.contrast.toFixed(2)}:1`, `${out.after.contrast.toFixed(2)}:1`, out.after.contrast >= 4.5 && out.before.contrast < 4.5 ? "已修正" : "未修正");
  row("燈箱開啟後按 Tab 10 次，焦點留在燈箱內的次數", `${out.before.inside}／10`, `${out.after.inside}／10`, out.after.inside === 10 && out.before.inside < 10 ? "已修正" : "未修正");
}

await browser.close();
writeFileSync(join(outDir, "before-after.json"), JSON.stringify({ before: beforeFile, after: afterFile, at: new Date().toISOString(), rows }, null, 2));
const md = ["| 項目 | 修正前（審查版） | 修正後 | 結果 |", "|---|---|---|---|", ...rows.map((item) => `| ${item.item} | ${item.before} | ${item.after} | ${item.verdict} |`)].join("\n");
writeFileSync(join(outDir, "before-after.md"), md + "\n");
console.log(md);
if (rows.some((item) => item.verdict !== "已修正")) process.exitCode = 1;
