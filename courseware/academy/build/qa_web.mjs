// Regression suite for the interactive edition (re-runnable; Playwright + installed Chrome).
//   node courseware/academy/build/qa_web.mjs <output/web/index.html> <reportDir>
//
// Each scenario maps to a finding of the 2026-10-18 independent review. Results go to
// <reportDir>/web-qa.json, evidence screenshots to <reportDir>/*.png. This is a browser test of the
// local files: it is not a test on a real phone, in Safari, or of the trading classroom itself.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as course from "../content/course.mjs";

const [file, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(file).href;
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const report = { url, browser: browser.version(), startedAt: new Date().toISOString(), scenarios: [], layout: [], contrast: [], problems: [] };
const KEY = "dtt-academy-workbook-v2";

function scenario(name, finding) {
  const entry = { name, finding, checks: [], ok: true };
  report.scenarios.push(entry);
  return {
    check(label, ok, detail = "") {
      entry.checks.push({ label, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
      if (!ok) {
        entry.ok = false;
        report.problems.push(`${name}: ${label}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
      }
      console.log(`${ok ? "PASS" : "FAIL"} [${name}] ${label}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
    },
  };
}

async function open(options = {}, init = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...options });
  if (init) await context.addInitScript(init.fn, init.arg);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.ACADEMY_DEBUG));
  return { context, page, errors };
}
const go = (page, id) => page.evaluate((hash) => (location.hash = hash), id).then(() => page.waitForTimeout(120));
const status = (page, id) => page.evaluate((task) => window.ACADEMY_DEBUG.taskStatus(task), id);
const field = (page, key) => page.locator(`[data-field="${key}"]`).first();
async function put(page, key, value) {
  const element = field(page, key);
  const tag = await element.evaluate((node) => node.tagName);
  if (tag === "SELECT") await element.selectOption(value);
  else await element.fill(value);
}
const choose = (page, key, value) => page.locator(`input[type="radio"][data-field="${key}"][value="${value}"]`).check();
async function checkAllSelf(page, id) {
  for (const box of await page.locator(`#view-${id} input[data-check*=":check:"]`).all()) await box.check();
}
const stored = (page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null"), KEY);

/* 0 · A new learner in order: start → first small win → its card → on to LEVEL 01 → reopen → resume. */
{
  const s = scenario("新手順序：開始 → 小任務 → 成果卡 → 保存 → 重新開啟 → 繼續", "建議：先有一次小成功");
  const { context, page, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  s.check("開始頁有「先做 5 分鐘課前小任務」入口", await page.locator("a.w-cta[href='#Q']").isVisible());
  await page.locator("a.w-cta[href='#Q']").click();
  await page.waitForTimeout(150);
  s.check("點入口後到課前小任務", await page.locator("#view-Q").isVisible());
  await put(page, "Q:card:0:0", "2330");
  await put(page, "Q:card:0:1", "2026-10-06");
  await put(page, "Q:card:0:2", "9:03");
  await put(page, "Q:card:0:3", "2,585");
  s.check("時間寫 9:03、價格寫 2,585 也能被核對（容許常見寫法）", /與教材資料一致/.test(await page.locator('[data-verify="Q:card"]').innerText()));
  s.check("成果卡完成：出現「你現在會做什麼」", /你現在會做什麼/.test(await page.locator('[data-done="Q"]').innerText()));
  await page.locator('[data-done="Q"] a[href="#L01"]').click();
  await page.waitForTimeout(150);
  s.check("「前往 LEVEL 01」帶到 LEVEL 01", await page.locator("#view-L01").isVisible());
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.ACADEMY_DEBUG));
  const resume = page.locator("[data-resume] a");
  s.check("重新開啟（網址沒有 #）：開始頁出現「繼續上次學習 · LEVEL 01」", (await resume.count()) === 1 && /LEVEL 01/.test(await resume.innerText()));
  await resume.click();
  await page.waitForTimeout(150);
  s.check("按「繼續上次學習」回到 LEVEL 01", await page.locator("#view-L01").isVisible());
  await go(page, "Q");
  s.check("小任務的成果還在", (await field(page, "Q:card:0:3").inputValue()) === "2,585" && (await status(page, "Q")).done);
  s.check("沒有 JavaScript 錯誤", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* 1 · Level 06: one habit, honest 否／不適用 answers, nothing forced. */
{
  const s = scenario("L06 只選一個習慣也能完成", "P1-01");
  const { context, page, errors } = await open();
  await go(page, "06-1");
  await choose(page, "06-1:habit", "2");
  s.check("06-1 的習慣是單選（選一個後，其他四個沒有被選）", (await page.locator('input[data-field="06-1:habit"]:checked').count()) === 1);
  await checkAllSelf(page, "06-1");
  s.check("06-1 只選一個習慣＋自我檢查 → 任務完成", (await status(page, "06-1")).done);
  await go(page, "06-2");
  for (let row = 0; row < 3; row++) {
    await put(page, `06-2:log:${row}:0`, ["09:16", "09:20", "09:37"][row]);
    await put(page, `06-2:log:${row}:2`, ["等待", "送出市價買進 1 張", "依失效條件賣出"][row]);
    await put(page, `06-2:log:${row}:3`, ["還沒站上昨收", "符合計畫的確認訊號", "跌破昨收，計畫失效"][row]);
  }
  await checkAllSelf(page, "06-2");
  s.check("06-2 決策日誌 3 列（其中一列是等待）→ 完成", (await status(page, "06-2")).done);
  await go(page, "06-3");
  for (let row = 0; row < 4; row++) await put(page, `06-3:four:${row}:1`, ["回測平盤；站上昨收買 1 張", "買進 1 張 市價 已成交", "2575 買、2570 賣", "0 張"][row]);
  await put(page, "06-3:four:1:2", "yes");
  await put(page, "06-3:four:2:2", "no");
  await put(page, "06-3:four:3:2", "na");
  await checkAllSelf(page, "06-3");
  s.check("06-3 對照表可答「否」「不適用」→ 完成", (await status(page, "06-3")).done);
  await go(page, "06-4");
  await put(page, "06-4:pnl:net", "-13254");
  await choose(page, "06-4:pnl:match", "yes");
  const answers = ["yes", "no", "yes", "na", "yes"];
  for (const [index, value] of answers.entries()) await choose(page, `06-4:adh:${index}`, value);
  await checkAllSelf(page, "06-4");
  const before = await status(page, "06-4");
  s.check("06-4 選「否」或「不適用」但還沒寫原因 → 未完成，並列出缺少的原因", !before.done && before.missing.length === 2, JSON.stringify(before.missing));
  await put(page, "06-4:adh:1:why", "進場比條件晚了一分鐘");
  await put(page, "06-4:adh:3:why", "這一輪 10:00 前已無部位，題目不適用");
  s.check("06-4 誠實回答「否／不適用」並寫原因 → 完成（不強迫全答是）", (await status(page, "06-4")).done);
  s.check("06-4 第 5 題改成「所有委託都在計畫之內嗎？」：答「是」＝照計畫，不需要寫原因", (await page.locator("#view-06-4 .w-tri-list li").nth(4).innerText()).includes("所有委託都在計畫之內嗎") && (await page.evaluate(() => window.ACADEMY_DEBUG.state().fields["06-4:adh:4"])) === "yes");
  await go(page, "06-5");
  for (const row of [2, 3, 4, 5]) await put(page, `06-5:fix:${row}:1`, ["進場前沒算費稅門檻", "先算至少幾檔才打平", "送單前先寫下『至少要漲幾檔才打平』", "下一輪的決策日誌第一列會寫門檻"][row - 2]);
  await checkAllSelf(page, "06-5");
  await go(page, "06-6");
  await checkAllSelf(page, "06-6");
  const done = await page.evaluate(() => window.ACADEMY_DEBUG.levelDone("L06"));
  s.check("Level 06 完成（只選一個習慣、有「否」與「不適用」）", done);
  await go(page, "L06");
  s.check("Level 06 成就章顯示完成", await page.locator('[data-level-seal="L06"]').evaluate((node) => node.classList.contains("done")));
  const ability = await page.locator('[data-ability-status="L06"]').innerText();
  s.check("能力卡：只有自評的 06-6 標出要講師核對的系統證據（F-13）", ability.includes("只有自評 · 請講師核對系統證據：第 7 輪的完成卡"), ability.slice(-160));
  await page.screenshot({ path: join(outDir, "after-L06-one-habit.png"), fullPage: false });
  await go(page, "06-4");
  await page.locator("[data-done='06-4']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, "after-06-4-done-card.png"), fullPage: false });
  s.check("沒有 JavaScript 錯誤", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* 2 · Final mission: three works on screen, export, import into a clean browser, cancel keeps data. */
let exported = null;
{
  const s = scenario("期末三份作品不用紙本，可匯出與匯入還原", "P1-02 / P1-04");
  const { context, page, errors } = await open();
  await go(page, "F-1");
  await checkAllSelf(page, "F-1");
  await go(page, "F-2");
  await checkAllSelf(page, "F-2");
  await go(page, "F-3");
  s.check("F-3 有可輸入的欄位（不是只有紙本提示）", (await page.locator("#view-F-3 [data-field]").count()) >= 15);
  s.check("F-3 開始時全部空白（沒有預先填好的答案）", await page.evaluate(() => [...document.querySelectorAll("#view-F-3 [data-field]")].every((node) => (node.type === "radio" ? !node.checked : node.value === ""))));
  await put(page, "F-3:plan:day", "2026-10-05");
  await put(page, "F-3:plan:theme", "第 6 課");
  await put(page, "F-3:plan:stock", "2317");
  await put(page, "F-3:plan:reason", "鴻海開在昨收之上，練習完整執行自己的規則。");
  await put(page, "F-3:plan:entry", "收價站穩 255（連續兩分鐘不低於 255）才買 1 張。");
  await put(page, "F-3:plan:exit", "收價跌破 254 就賣出；10:00 前處理完部位。");
  for (const [row, value] of ["255", "254", "1", "1000", "435", "1435", "3000", "2"].entries()) await put(page, `F-3:risk:${row}:1`, value);
  await put(page, "F-3:th:end", "10:00");
  await checkAllSelf(page, "F-3");
  s.check("F-3 期末計畫單完成", (await status(page, "F-3")).done);
  const riskVerify = await page.locator('[data-verify="F-3:risk"]').innerText();
  s.check("F-3 風險預算表的算式核對顯示結果（提示，不擋完成）", /⑧ 最多張數/.test(riskVerify), riskVerify.replace(/\s+/g, " "));
  await go(page, "F-4");
  await page.locator('[data-add-row="F-4:log"]').click();
  s.check("F-4 可以新增一列", (await page.locator('[data-table="F-4:log"] tbody tr').count()) === 4);
  const log = [["09:00", "等待", "還沒有兩分鐘站穩 255"], ["09:03", "送出市價買進 1 張", "09:01–09:02 收價都在 255"], ["09:25", "依條件賣出", "09:24 收在 253.5，跌破 254"]];
  for (const [row, [time, decision, reason]] of log.entries()) {
    await put(page, `F-4:log:${row}:0`, time);
    await put(page, `F-4:log:${row}:2`, decision);
    await put(page, `F-4:log:${row}:3`, reason);
  }
  s.check("F-4 三列（含等待）＋一列空白 → 完成", (await status(page, "F-4")).done);
  await page.locator('[data-del-row="F-4:log"][data-index="3"]').click();
  s.check("F-4 刪除空白列不需確認，剩 3 列", (await page.locator('[data-table="F-4:log"] tbody tr').count()) === 3);
  await go(page, "F-5");
  const fills = [["09:03", "買進", "1", "255", "218", "0"], ["09:25", "賣出", "1", "254", "217", "381"]];
  for (const [row, values] of fills.entries()) for (const [col, value] of values.entries()) await put(page, `F-5:fills:${row}:${col}`, value);
  await put(page, "F-5:totals:diff", "-1000");
  await put(page, "F-5:totals:cost", "816");
  await put(page, "F-5:totals:net", "-1816");
  await choose(page, "F-5:totals:match", "yes");
  for (const [index, value] of ["yes", "yes", "yes", "yes", "yes"].entries()) await choose(page, `F-5:adh:${index}`, value);
  await put(page, "F-5:reflect:mistake", "09:03 站穩只看兩分鐘就進場，太快。");
  await put(page, "F-5:reflect:change", "把站穩定義成三分鐘，寫進計畫單。");
  await checkAllSelf(page, "F-5");
  s.check("F-5 期末報告完成", (await status(page, "F-5")).done);
  const fillsVerify = await page.locator('[data-verify="F-5:fills"]').innerText();
  s.check("F-5 對帳核對：淨損益與成交一致", /✓[\s\S]*淨損益/.test(fillsVerify), fillsVerify.replace(/\s+/g, " "));
  s.check("期末關卡完成（F-1～F-5）", await page.evaluate(() => window.ACADEMY_DEBUG.levelDone("FINAL")));
  await page.screenshot({ path: join(outDir, "after-F-5-report.png"), fullPage: false });
  await go(page, "portfolio");
  const portfolio = await page.locator("[data-portfolio]").innerText();
  s.check("學習成果冊列出期末三份作品", /期末計畫單/.test(portfolio) && /決策日誌/.test(portfolio) && /期末報告/.test(portfolio) && /09:24 收在 253.5/.test(portfolio));
  await page.screenshot({ path: join(outDir, "after-portfolio.png"), fullPage: false });
  await go(page, "progress");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export]").click()]);
  const path = join(outDir, "export-sample.json");
  await download.saveAs(path);
  exported = JSON.parse(readFileSync(path, "utf8"));
  s.check("匯出檔有 schema 與版本", exported.schema === "dtt-academy-workbook" && exported.version === 2, `${exported.schema} v${exported.version}`);
  s.check("匯出檔包含作答（不只勾選）", exported.data.fields["F-4:log:2:3"] === "09:24 收在 253.5，跌破 254" && exported.data.fields["F-3:plan:stock"] === "2317");
  s.check("沒有 JavaScript 錯誤", errors.length === 0, errors.join(" | "));
  await context.close();

  const clean = await open();
  await go(clean.page, "progress");
  await clean.page.locator("[data-import]").setInputFiles(path);
  await clean.page.locator("[data-dialog]:not([hidden])").waitFor();
  const dialogText = await clean.page.locator("[data-dialog]").innerText();
  s.check("匯入前先顯示內容並要求確認", /取代目前的紀錄/.test(dialogText) && /完成任務/.test(dialogText));
  s.check("確認框寫明不會合併、整份取代、取代前自動備份（F-10）", dialogText.includes("不會合併：這台裝置上的作答會被整份取代（取代前會自動備份，可在下方還原）"), dialogText.slice(-80));
  await clean.page.locator('[data-dialog] [data-answer="0"]').click();
  await clean.page.waitForTimeout(200);
  s.check("清空的瀏覽器匯入後，期末三份作品完整還原", (await clean.page.evaluate(() => ["F-3", "F-4", "F-5"].every((id) => window.ACADEMY_DEBUG.taskStatus(id).done))));
  s.check("還原後欄位內容一致", (await clean.page.evaluate(() => window.ACADEMY_DEBUG.state().fields["F-5:reflect:change"])) === "把站穩定義成三分鐘，寫進計畫單。");
  s.check("匯入前自動建立了備份", (await clean.page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("dtt-academy-workbook-backup:before-import")))));
  await clean.context.close();

  const keep = await open();
  await go(keep.page, "01-1");
  await put(keep.page, "01-1:think", "這是匯入前就有的筆記");
  await keep.page.evaluate(() => window.ACADEMY_DEBUG.flush());
  await go(keep.page, "progress");
  await keep.page.locator("[data-import]").setInputFiles(path);
  await keep.page.locator("[data-dialog]:not([hidden])").waitFor();
  await keep.page.locator('[data-dialog] [data-answer="1"]').click();
  await keep.page.waitForTimeout(200);
  s.check("取消匯入：原本的紀錄沒有被覆蓋", (await stored(keep.page))?.fields["01-1:think"] === "這是匯入前就有的筆記");
  const bad = join(outDir, "not-a-workbook.json");
  writeFileSync(bad, JSON.stringify({ schema: "other-app", data: {} }));
  await keep.page.locator("[data-import]").setInputFiles(bad);
  await keep.page.waitForTimeout(200);
  s.check("格式不符的檔案：顯示錯誤，不更動紀錄", /匯入失敗/.test(await keep.page.locator("[data-import-review]").innerText()) && (await stored(keep.page))?.fields["01-1:think"] === "這是匯入前就有的筆記");
  await keep.context.close();
}

/* 3 · Latest input survives page change, export and reload; failures are visible. */
{
  const s = scenario("最新輸入在切頁、匯出、重新整理後仍在；保存失敗有提示", "P1-04");
  const { context, page } = await open();
  await go(page, "01-1");
  await field(page, "01-1:think").fill("第一句");
  await page.evaluate(() => (location.hash = "01-2"));
  s.check("輸入後立刻切頁：已寫入 localStorage", (await stored(page))?.fields["01-1:think"] === "第一句");
  await go(page, "01-1");
  await field(page, "01-1:think").fill("第二句，立刻重新整理");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.ACADEMY_DEBUG));
  await go(page, "01-1");
  s.check("輸入後立刻重新整理：內容還在", (await field(page, "01-1:think").inputValue()) === "第二句，立刻重新整理");
  await field(page, "01-1:think").fill("第三句，立刻匯出");
  await go(page, "progress");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export]").click()]);
  const path = join(outDir, "export-latest.json");
  await download.saveAs(path);
  s.check("輸入後立刻匯出：匯出檔有最新內容", JSON.parse(readFileSync(path, "utf8")).data.fields["01-1:think"] === "第三句，立刻匯出");
  s.check("畫面顯示「已保存」", /已保存/.test(await page.locator("[data-save-status]").innerText()));
  s.check("記住最後閱讀的頁面，開始頁出現「繼續上次學習」", await (async () => {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean(window.ACADEMY_DEBUG));
    return /繼續上次學習/.test(await page.locator("[data-resume]").innerText());
  })());
  await context.close();

  const failing = await open({}, {
    fn: (key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException("quota", "QuotaExceededError");
        return original.call(this, name, value);
      };
    },
    arg: KEY,
  });
  await go(failing.page, "01-1");
  await field(failing.page, "01-1:think").fill("保存會失敗的一句");
  await failing.page.evaluate(() => window.ACADEMY_DEBUG.flush());
  s.check("保存失敗：狀態列顯示「保存失敗」", /保存失敗/.test(await failing.page.locator("[data-save-status]").innerText()));
  s.check("保存失敗：出現提示與「匯出備份檔」按鈕", /保存失敗/.test(await failing.page.locator("[data-banner]").innerText()));
  s.check("保存失敗：畫面上的內容沒有被清掉", (await field(failing.page, "01-1:think").inputValue()) === "保存會失敗的一句");
  const [dl] = await Promise.all([failing.page.waitForEvent("download"), failing.page.locator("[data-banner] [data-banner-action='0']").click()]);
  const failedPath = join(outDir, "export-when-save-failed.json");
  await dl.saveAs(failedPath);
  s.check("保存失敗時仍可匯出暫存成果", JSON.parse(readFileSync(failedPath, "utf8")).data.fields["01-1:think"] === "保存會失敗的一句");
  await failing.page.screenshot({ path: join(outDir, "after-save-failed.png") });
  await failing.context.close();
}

/* 4 · Broken, partial or old stored data never stops the page and is never silently deleted. */
{
  const s = scenario("儲存資料異常不會中止，也不會被靜默刪除", "P2-04");
  const nulls = await open({}, { fn: (key) => localStorage.setItem(key, JSON.stringify({ schema: "dtt-academy-workbook", version: 2, checks: null, fields: null })), arg: KEY });
  await go(nulls.page, "01-1");
  s.check("checks／fields 為 null：正常載入、可切頁", nulls.errors.length === 0 && (await nulls.page.locator("#view-01-1").isVisible()), nulls.errors.join(" | "));
  await nulls.context.close();
  const corrupt = await open({}, { fn: (key) => localStorage.setItem(key, "{這不是 JSON"), arg: KEY });
  s.check("內容損壞：顯示提示", /無法讀取/.test(await corrupt.page.locator("[data-banner]").innerText()));
  s.check("內容損壞：原始內容另存一份備份", await corrupt.page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("dtt-academy-workbook-backup:unreadable") && localStorage.getItem(key) === "{這不是 JSON")));
  await go(corrupt.page, "01-1");
  await field(corrupt.page, "01-1:think").fill("損壞後的新筆記");
  await corrupt.page.evaluate(() => window.ACADEMY_DEBUG.flush());
  s.check("新作答可以保存", await corrupt.page.evaluate(() => JSON.parse(localStorage.getItem(window.ACADEMY_DEBUG.storageKey())).fields["01-1:think"] === "損壞後的新筆記"));
  s.check("沒有 JavaScript 錯誤", corrupt.errors.length === 0, corrupt.errors.join(" | "));
  await corrupt.context.close();
  const old = await open({}, {
    fn: () => localStorage.setItem("dtt-academy-workbook-v1", JSON.stringify({ checks: { "01-1:check:0": true, "06-1:habit:0": true, "06-1:habit:1": true }, notes: { "01-1:think": "舊版筆記" }, updatedAt: "2026-10-18T01:00:00Z" })),
  });
  await go(old.page, "01-1");
  s.check("舊版（v1）紀錄：勾選與筆記轉入新版", (await old.page.locator('[data-check="01-1:check:0"]').isChecked()) && (await field(old.page, "01-1:think").inputValue()) === "舊版筆記");
  s.check("舊版（v1）資料保留在瀏覽器中，沒有刪除", await old.page.evaluate(() => localStorage.getItem("dtt-academy-workbook-v1") !== null));
  s.check("舊版「習慣全勾」不被猜成答案，保留在 legacy", await old.page.evaluate(() => {
    const state = window.ACADEMY_DEBUG.state();
    return !state.fields["06-1:habit"] && state.legacy?.checks?.["06-1:habit:1"] === true;
  }));
  await old.context.close();
}

/* 4b · Import formats: only workbook records reach the replace dialog; anything else is refused before it (R21-02). */
{
  const s = scenario("匯入格式：不是闖關手冊紀錄的檔案，在取代確認之前就被拒絕", "R21-02");
  const { context, page, errors } = await open();
  await go(page, "01-1");
  await put(page, "01-1:think", "匯入測試前的筆記");
  await page.evaluate(() => window.ACADEMY_DEBUG.flush());
  await go(page, "progress");
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  const backups = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("dtt-academy-workbook-backup:")).length);
  const emptyState = { schema: "dtt-academy-workbook", version: 2, createdAt: "2026-10-18T00:00:00.000Z", updatedAt: null, lastView: null, checks: {}, fields: {}, rows: {}, legacy: null };
  const emptyExport = { schema: "dtt-academy-workbook", version: 2, exportedAt: "2026-10-18T00:00:00.000Z", edition: { version: "test" }, data: emptyState };
  const cases = [
    ["有效 v1（第一版的勾選與筆記）", JSON.stringify({ checks: { "01-1:check:0": true }, notes: { "01-1:think": "第一版的筆記" }, updatedAt: "2026-10-01T00:00:00.000Z" }), true],
    ["有效 v2（匯出檔）", JSON.stringify({ ...emptyExport, data: { ...emptyState, checks: { "01-1:check:0": true }, fields: { "01-1:think": "第二版的筆記" } } }), true],
    ['合法空白 v1 {"checks":{},"notes":{}}', JSON.stringify({ checks: {}, notes: {} }), true],
    ["合法空白 v2（沒有作答的匯出檔）", JSON.stringify(emptyExport), true],
    ["壞 JSON", "{這不是 JSON", false],
    ["{}", "{}", false],
    ['{"hello":"world"}', JSON.stringify({ hello: "world" }), false],
    ["錯誤 schema", JSON.stringify({ schema: "other-app", version: 2, data: { checks: {}, fields: {}, rows: {} } }), false],
    ["不支援的版本（3）", JSON.stringify({ ...emptyExport, version: 3, data: { ...emptyState, version: 3 } }), false],
    ["型別錯誤：v2 的 checks 是陣列", JSON.stringify({ ...emptyExport, data: { ...emptyState, checks: [] } }), false],
    ["型別錯誤：v1 的 notes 是字串", JSON.stringify({ checks: {}, notes: "筆記" }), false],
  ];
  const results = [];
  for (const [index, [label, text, accept]] of cases.entries()) {
    const path = join(outDir, `import-case-${String(index + 1).padStart(2, "0")}.json`);
    writeFileSync(path, text);
    const backupCount = await backups();
    await page.evaluate(() => (document.querySelector("[data-import-review]").textContent = ""));
    await page.locator("[data-import]").setInputFiles(path);
    await page
      .waitForFunction(() => !document.querySelector("[data-dialog]").hidden || /匯入失敗/.test(document.querySelector("[data-import-review]").textContent), null, { timeout: 3000 })
      .catch(() => {});
    const dialog = await page.locator("[data-dialog]:not([hidden])").count();
    const review = (await page.locator("[data-import-review]").innerText()).trim();
    if (dialog) await page.locator('[data-dialog] [data-answer="1"]').click();
    await page.waitForTimeout(150);
    const unchanged = (await page.evaluate((key) => localStorage.getItem(key), KEY)) === before;
    const noBackup = (await backups()) === backupCount;
    const ok = accept ? dialog === 1 && unchanged : dialog === 0 && /匯入失敗/.test(review) && /目前的紀錄沒有被更動/.test(review) && unchanged && noBackup;
    results.push({ case: label, expected: accept ? "取代確認" : "拒絕", dialog: Boolean(dialog), message: review.slice(0, 160), recordUnchanged: unchanged, backupCreated: !noBackup });
    s.check(`${label}：${accept ? "進入取代確認；取消後紀錄不變" : "確認前就拒絕，顯示「匯入失敗…目前的紀錄沒有被更動」，紀錄與備份都沒有變"}`, ok, review.slice(0, 140));
  }
  // An accepted first-edition file still migrates when confirmed, after the automatic backup.
  await page.locator("[data-import]").setInputFiles(join(outDir, "import-case-01.json"));
  await page.locator("[data-dialog]:not([hidden])").waitFor();
  await page.locator('[data-dialog] [data-answer="0"]').click();
  await page.waitForTimeout(250);
  const migrated = await page.evaluate(() => window.ACADEMY_DEBUG.state());
  s.check(
    "確認匯入有效 v1：筆記轉入新版，匯入前自動備份",
    migrated.fields["01-1:think"] === "第一版的筆記" && migrated.legacy?.from === "v1" && (await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("dtt-academy-workbook-backup:before-import")))),
  );
  s.check("沒有 JavaScript 錯誤", errors.length === 0, errors.join(" | "));
  writeFileSync(join(outDir, "import-formats.json"), JSON.stringify(results, null, 2));
  await context.close();
}

/* 5 · Zoom viewer on a phone, markers fixed to the image, keyboard dialog behaviour. */
{
  const s = scenario("手機看圖可放大、標號不漂移；燈箱鍵盤操作", "P1-03 / P2-02");
  const { context, page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await go(page, "01-4");
  await page.locator("#view-01-4 .w-mapref summary").click();
  const frame = page.locator("#view-01-4 .w-mapref .figure .frame").first();
  await frame.scrollIntoViewIfNeeded();
  const inline = (await frame.boundingBox()).width;
  await frame.click();
  await page.locator(".w-lightbox:not([hidden])").waitFor();
  const stage = page.locator("[data-lb-stage]");
  // Marker 7 sits inside the picture; marker 2 sits on its top edge, where a small view nudges it inward (at most
  // half a marker) so that it is never cut off.
  const markerAt = (label = "7") =>
    page.evaluate((text) => {
      const stageBox = document.querySelector("[data-lb-stage]").getBoundingClientRect();
      const marker = [...document.querySelectorAll("[data-lb-stage] .marker")].find((node) => node.textContent.trim() === text);
      const box = marker.getBoundingClientRect();
      return { x: (box.left + box.width / 2 - stageBox.left) / stageBox.width, y: (box.top + box.height / 2 - stageBox.top) / stageBox.height, inside: box.top >= stageBox.top - 0.5 && box.bottom <= stageBox.bottom + 0.5 && box.left >= stageBox.left - 0.5 && box.right <= stageBox.right + 0.5 };
    }, label);
  const fitWidth = (await stage.boundingBox()).width;
  const fitMark = await markerAt();
  const fitEdge = await markerAt("2");
  await page.locator('[data-lb="actual"]').click();
  const fullWidth = (await stage.boundingBox()).width;
  const fullMark = await markerAt();
  const cropWidth = Number(await page.locator("#view-01-4 .w-mapref .figure").first().getAttribute("data-crop-w"));
  s.check("390px：原尺寸 100% 的圖寬是適合螢幕的 3 倍以上", fullWidth / fitWidth >= 3, `fit ${fitWidth.toFixed(0)}px → 100% ${fullWidth.toFixed(0)}px（頁面內 ${inline.toFixed(0)}px）`);
  s.check("100% 等於原始畫面的 CSS 尺寸（1 擷取像素 = 1 CSS 像素）", Math.abs(fullWidth - cropWidth) <= 2, `${fullWidth.toFixed(0)} vs ${cropWidth}`);
  s.check("放大前後標號 7 在圖上的相對位置不變（誤差 < 0.5%）", Math.abs(fitMark.x - fullMark.x) < 0.005 && Math.abs(fitMark.y - fullMark.y) < 0.005, JSON.stringify({ fitMark, fullMark }));
  s.check("貼著圖上緣的標號 2：適合螢幕時整顆仍在圖內，沒有被裁掉", fitEdge.inside, JSON.stringify(fitEdge));
  const markRow = await page.evaluate(() => {
    const row = document.querySelector("[data-lb-marks]");
    const buttons = [...row.querySelectorAll(".w-lb-mark")];
    const hidden = buttons.filter((button) => { const box = button.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth || box.width === 0; }).map((button) => button.textContent);
    return { count: buttons.length, hidden, overflow: row.scrollWidth - row.clientWidth };
  });
  s.check("390px：「跳到標號」12 個按鈕（1–10、A、B）不用橫向捲動就全部看得到（F-11）", markRow.count === 12 && markRow.hidden.length === 0 && markRow.overflow <= 1, JSON.stringify(markRow));
  await page.screenshot({ path: join(outDir, "after-mobile-zoom-marks.png") });
  await page.locator("[data-lb-goto='1']").click();
  s.check("「跳到標號」把標號放大置中", (await page.evaluate(() => Number(document.querySelector(".w-lightbox").dataset.scale))) >= 1);
  await page.screenshot({ path: join(outDir, "after-mobile-zoom-100.png") });
  // Pinch with two touch points (CDP touch events, as a phone sends them).
  await page.locator('[data-lb="fit"]').click();
  const client = await context.newCDPSession(page);
  const view = await page.locator("[data-lb-viewport]").boundingBox();
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  const touch = (type, spread) => client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: cx - spread, y: cy, id: 1 }, { x: cx + spread, y: cy, id: 2 }] });
  const before = await page.evaluate(() => Number(document.querySelector(".w-lightbox").dataset.scale));
  await touch("touchStart", 30);
  for (const spread of [50, 80, 110, 140]) await touch("touchMove", spread);
  await touch("touchEnd", 0);
  const after = await page.evaluate(() => Number(document.querySelector(".w-lightbox").dataset.scale));
  s.check("兩指張開可以放大（模擬觸控）", after > before * 2, `${before.toFixed(2)} → ${after.toFixed(2)}`);
  await page.locator('[data-lb="reset"]').click();
  s.check("「還原」回到適合螢幕", Math.abs((await stage.boundingBox()).width - fitWidth) <= 2);
  await page.locator('[data-lb="close"]').click();
  await context.close();

  const desk = await open();
  await go(desk.page, "03-3");
  const trigger = desk.page.locator("#view-03-3 .figure .frame[role='button']").first();
  await trigger.focus();
  await desk.page.keyboard.press("Enter");
  await desk.page.locator(".w-lightbox:not([hidden])").waitFor();
  s.check("鍵盤 Enter 可以開啟放大檢視", true);
  s.check("開啟時背景設為 inert（不可操作）", await desk.page.evaluate(() => document.querySelector(".w-layout").inert === true && document.querySelector(".w-bar").inert === true));
  let inside = true;
  for (let i = 0; i < 18; i++) {
    await desk.page.keyboard.press("Tab");
    inside &&= await desk.page.evaluate(() => document.querySelector(".w-lightbox").contains(document.activeElement));
  }
  for (let i = 0; i < 18; i++) {
    await desk.page.keyboard.press("Shift+Tab");
    inside &&= await desk.page.evaluate(() => document.querySelector(".w-lightbox").contains(document.activeElement));
  }
  s.check("Tab／Shift+Tab 各 18 次都留在對話框內", inside);
  await desk.page.keyboard.press("Escape");
  s.check("Escape 關閉", await desk.page.locator(".w-lightbox").isHidden());
  s.check("關閉後焦點回到原本的圖片", await desk.page.evaluate(() => document.activeElement?.matches(".figure .frame[role='button']")));
  // Mouse drag pans the picture by the drag distance (it used to stop after the first move).
  await go(desk.page, "01-4");
  await desk.page.locator("#view-01-4 .w-mapref summary").click();
  await desk.page.locator("#view-01-4 .w-mapref .figure .frame").first().click();
  await desk.page.locator(".w-lightbox:not([hidden])").waitFor();
  await desk.page.locator('[data-lb="actual"]').click();
  await desk.page.locator('[data-lb="in"]').click();
  await desk.page.locator('[data-lb="in"]').click();
  const dragBox = await desk.page.locator("[data-lb-viewport]").boundingBox();
  const startScroll = await desk.page.evaluate(() => { const v = document.querySelector("[data-lb-viewport]"); return [v.scrollLeft, v.scrollTop]; });
  const dx = dragBox.x + dragBox.width / 2;
  const dy = dragBox.y + dragBox.height / 2;
  await desk.page.mouse.move(dx, dy);
  await desk.page.mouse.down();
  await desk.page.mouse.move(dx - 200, dy - 100, { steps: 12 });
  await desk.page.mouse.up();
  const endScroll = await desk.page.evaluate(() => { const v = document.querySelector("[data-lb-viewport]"); return [v.scrollLeft, v.scrollTop]; });
  const moved = [endScroll[0] - startScroll[0], endScroll[1] - startScroll[1]];
  s.check("滑鼠拖曳 (−200, −100)、分 12 步：畫面平移約 (200, 100)", Math.abs(moved[0] - 200) <= 4 && Math.abs(moved[1] - 100) <= 4, JSON.stringify(moved));
  await desk.page.keyboard.press("Escape");
  await desk.context.close();
}

/* 5b · Phone table of contents: a drawer below the top bar, closable by button, backdrop and Escape (F-02). */
{
  const s = scenario("手機目錄：不蓋住工具列；關閉鈕、點遮罩、Escape 都能關閉", "F-02");
  for (const width of [390, 360]) {
    const { context, page, errors } = await open({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    await go(page, "01-3");
    await page.evaluate(() => window.scrollTo(0, 600));
    const menu = page.locator(".w-menu");
    await menu.click();
    await page.waitForTimeout(300);
    const geo = await page.evaluate(() => {
      const nav = document.querySelector(".w-nav").getBoundingClientRect();
      const bar = document.querySelector(".w-bar").getBoundingClientRect();
      const button = document.querySelector(".w-menu").getBoundingClientRect();
      const hit = document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2);
      return { navTop: nav.top, navBottom: nav.bottom, barBottom: bar.bottom, menuOnTop: Boolean(hit?.closest(".w-menu")), focusInNav: document.querySelector(".w-nav").contains(document.activeElement), mainInert: document.querySelector("#w-main").inert, height: innerHeight };
    });
    s.check(`${width}px：目錄從工具列下方開始，不蓋住工具列`, geo.navTop >= geo.barBottom - 1, JSON.stringify(geo));
    s.check(`${width}px：目錄高度在視窗內（內容可捲動）`, geo.navBottom <= geo.height + 1);
    s.check(`${width}px：工具列上的「目錄」鈕沒有被蓋住`, geo.menuOnTop);
    s.check(`${width}px：打開時焦點移進目錄，後方頁面不可操作`, geo.focusInNav && geo.mainInert);
    await page.screenshot({ path: join(outDir, `after-mobile-toc-${width}.png`) });
    await page.locator("[data-nav-close]").click();
    await page.waitForTimeout(300);
    s.check(`${width}px：按「關閉目錄」關閉，焦點回到「目錄」鈕`, !(await page.locator(".w-nav.open").count()) && (await page.evaluate(() => document.activeElement?.classList.contains("w-menu"))));
    s.check(`${width}px：關閉後目錄連結不能被 Tab 到（不可見）`, (await page.evaluate(() => getComputedStyle(document.querySelector(".w-nav")).visibility)) === "hidden" && !(await page.evaluate(() => document.querySelector("#w-main").inert)));
    await menu.click();
    await page.waitForTimeout(300);
    await page.mouse.click(width - 12, 420);
    await page.waitForTimeout(300);
    s.check(`${width}px：點目錄外的遮罩就關閉`, !(await page.locator(".w-nav.open").count()) && (await page.locator("[data-nav-backdrop]").isHidden()));
    await menu.click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    s.check(`${width}px：Escape 關閉，焦點回到「目錄」鈕`, !(await page.locator(".w-nav.open").count()) && (await page.evaluate(() => document.activeElement?.classList.contains("w-menu"))));
    await menu.click();
    await page.waitForTimeout(300);
    await page.locator('.w-nav a[data-nav="02-1"]').click();
    await page.waitForTimeout(300);
    s.check(`${width}px：點目錄裡的任務會換頁並收起目錄`, (await page.locator("#view-02-1").isVisible()) && !(await page.locator(".w-nav.open").count()) && !(await page.evaluate(() => document.querySelector("#w-main").inert)));
    s.check(`${width}px：沒有 JavaScript 錯誤`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

/* 5c · Moving between pages is not an edit: no 「儲存中…」, last-saved time unchanged, position remembered (B-22). */
{
  const s = scenario("換頁不是作答：不顯示「儲存中…」，最後保存時間不變，仍記得讀到哪裡", "B-22");
  const { context, page, errors } = await open();
  await go(page, "01-1");
  await put(page, "01-1:think", "換頁測試前的筆記");
  await page.evaluate(() => window.ACADEMY_DEBUG.flush());
  const savedAt = (await stored(page))?.updatedAt;
  await page.evaluate(() => {
    window.__saveTexts = [];
    const target = document.querySelector("[data-save-status]");
    new MutationObserver(() => window.__saveTexts.push(target.textContent)).observe(target, { childList: true, characterData: true, subtree: true });
  });
  await page.locator("[data-next]").click();
  await page.waitForTimeout(150);
  await page.locator("[data-next]").click();
  await page.waitForTimeout(150);
  await go(page, "02-3");
  await page.waitForTimeout(800);
  const texts = await page.evaluate(() => window.__saveTexts);
  const after = await stored(page);
  s.check("連續換三頁，保存狀態從未出現「儲存中…」", !texts.some((text) => /儲存中/.test(text)), JSON.stringify(texts));
  s.check("最後保存時間仍是最後一次作答的時間", after?.updatedAt === savedAt, `${savedAt} → ${after?.updatedAt}`);
  s.check("讀到哪一頁仍有記下（繼續上次學習）", after?.lastView === "02-3", after?.lastView);
  s.check("作答內容不變", after?.fields["01-1:think"] === "換頁測試前的筆記");
  s.check("沒有 JavaScript 錯誤", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* 6 · Links: every in-page link and every glossary entry points to the right task. */
{
  const s = scenario("任務與術語連結存在且語意相符", "P2-01");
  const { context, page } = await open();
  const broken = await page.evaluate(() => {
    const ids = new Set(window.ACADEMY_VIEWS.map((view) => view.id));
    return [...document.querySelectorAll('a[href^="#"]')].map((link) => link.getAttribute("href").slice(1)).filter((id) => id && id !== "w-main" && !ids.has(id));
  });
  s.check("所有頁內連結都指向存在的頁面", broken.length === 0, broken.join(", "));
  const texts = await page.evaluate(() => Object.fromEntries(window.ACADEMY_VIEWS.map((view) => [view.id, document.getElementById(`view-${view.id}`).textContent])));
  const misses = [];
  for (const [name, id, , match] of course.glossary) {
    const words = match ?? name.replace(/（.*?）/g, "／").split("／").map((word) => word.trim()).filter(Boolean);
    if (!words.some((word) => texts[id]?.includes(word))) misses.push(`${name} → ${id}`);
  }
  s.check(`術語表 ${course.glossary.length} 條：目標任務確實講到該術語`, misses.length === 0, misses.join("、"));
  const fixed = course.glossary.filter(([name]) => ["當沖", "費稅門檻", "滑價", "風險預算", "N 字與突破", "頭頭高／底底高"].includes(name)).map(([name, id]) => `${name}→${id}`);
  s.check("審查指出的 6 條已改正", fixed.join(",") === "當沖→05-1,費稅門檻→05-1,滑價→05-2,風險預算→05-2,N 字與突破→05-4,頭頭高／底底高→05-4", fixed.join(","));
  s.check("不再有任何「紙本」作答依賴文字", !/請寫在紙本講義上|紙本作答頁|紙本講義的課前暖身/.test(Object.values(texts).join("")));
  await context.close();
}

/* 7 · Learner fields start empty; examples are labelled; the quick mission checks against real data. */
{
  const s = scenario("作答預設留白、範例有標示、課前小任務可核對", "建議 10 / 課前小任務");
  const { context, page } = await open();
  const nonEmpty = await page.evaluate(() => [...document.querySelectorAll("[data-field]")].filter((node) => (node.type === "radio" || node.type === "checkbox" ? node.checked : node.value !== "")).length);
  s.check("全新瀏覽器：所有作答欄位留白", nonEmpty === 0, `${nonEmpty} 個非空白`);
  s.check("所有自我檢查預設未勾", (await page.locator("input[data-check]:checked").count()) === 0);
  const unlabelled = await page.evaluate(() => [...document.querySelectorAll(".w-eg")].filter((node) => !/範例/.test(node.textContent)).length);
  s.check("範例區塊都標示「範例」", unlabelled === 0);
  await go(page, "Q");
  await put(page, "Q:card:0:0", "2330");
  await put(page, "Q:card:0:1", "2026-10-06");
  await put(page, "Q:card:0:2", "09:03");
  await put(page, "Q:card:0:3", "2580");
  s.check("讀錯價格：核對顯示和教材資料不同（不洩漏答案）", /和 2026-10-06 09:03 的教材資料不同/.test(await page.locator('[data-verify="Q:card"]').innerText()) && !/2585/.test(await page.locator('[data-verify="Q:card"]').innerText()));
  await put(page, "Q:card:0:3", "2585");
  s.check("讀對價格：核對一致", /與教材資料一致/.test(await page.locator('[data-verify="Q:card"]').innerText()));
  s.check("小任務完成卡出現三段：會做什麼／成果／下一個挑戰", /你現在會做什麼[\s\S]*你留下的成果[\s\S]*下一個小挑戰/.test(await page.locator('[data-done="Q"]').innerText()));
  await page.locator('[data-done="Q"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, "after-quick-mission-card.png") });
  await context.close();
}

/* 8 · Layout at 1440／768／390／360／320 in light and dark; fonts and every image loaded first. */
for (const width of [1440, 768, 390, 360, 320])
  for (const scheme of ["light", "dark"]) {
    const { context, page, errors } = await open({ viewport: { width, height: 900 }, colorScheme: scheme, isMobile: width < 700, hasTouch: width < 700 });
    const views = await page.evaluate(() => window.ACADEMY_VIEWS.map((view) => view.id));
    const overflow = [];
    let broken = 0;
    for (const id of views) {
      await go(page, id);
      const result = await page.evaluate(async () => {
        await document.fonts.ready;
        const view = document.querySelector(".w-view:not([hidden])");
        for (const details of view.querySelectorAll("details")) details.open = true;
        const images = [...view.querySelectorAll("img")];
        images.forEach((image) => (image.loading = "eager"));
        await Promise.all(images.map((image) => (image.complete ? image.decode().catch(() => {}) : new Promise((resolve) => ((image.onload = resolve), (image.onerror = resolve))))));
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, broken: images.filter((image) => !image.naturalWidth).length };
      });
      if (result.overflow > 1) overflow.push(`${id}(+${result.overflow}px)`);
      broken += result.broken;
    }
    const row = { width, scheme, views: views.length, overflow, brokenImages: broken, errors };
    report.layout.push(row);
    if (overflow.length) report.problems.push(`layout ${width} ${scheme}: overflow ${overflow.join(", ")}`);
    if (broken) report.problems.push(`layout ${width} ${scheme}: ${broken} broken images`);
    if (errors.length) report.problems.push(`layout ${width} ${scheme}: page errors ${errors.join(" | ")}`);
    console.log(`layout ${width} ${scheme}: ${views.length} views, overflow ${overflow.length}, broken ${broken}`);
    if (width === 390) {
      await go(page, "06-4");
      await page.screenshot({ path: join(outDir, `after-${scheme}-390-06-4.png`) });
    }
    await context.close();
  }

/* 9 · Contrast of small text (≤ 14px) in both themes, against its real background. */
for (const scheme of ["light", "dark"]) {
  const { context, page } = await open({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
  const views = await page.evaluate(() => window.ACADEMY_VIEWS.map((view) => view.id));
  const failures = new Map();
  let measured = 0;
  for (const id of views) {
    await go(page, id);
    const found = await page.evaluate(() => {
      const parse = (text) => (text.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const background = (node) => {
        for (let el = node; el; el = el.parentElement) {
          const [r, g, b, a = 1] = parse(getComputedStyle(el).backgroundColor);
          if (a > 0.5) return [r, g, b];
        }
        return parse(getComputedStyle(document.body).backgroundColor);
      };
      const view = document.querySelector(".w-view:not([hidden])");
      const out = [];
      let count = 0;
      for (const el of view.querySelectorAll("*")) {
        if (el.closest(".crop, .seal, svg")) continue;
        const own = [...el.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
        if (!own || !el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        if (parseFloat(style.fontSize) > 14 || style.visibility === "hidden") continue;
        count++;
        const fg = parse(style.color);
        const bg = background(el);
        const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        if (ratio < 4.5) out.push({ cls: el.className || el.tagName, text: el.textContent.trim().slice(0, 24), ratio: Math.round(ratio * 100) / 100 });
      }
      return { out, count };
    });
    measured += found.count;
    for (const item of found.out) failures.set(`${item.cls}|${item.ratio}`, { ...item, view: id });
  }
  const list = [...failures.values()];
  report.contrast.push({ scheme, measured, failures: list });
  if (list.length) report.problems.push(`contrast ${scheme}: ${list.length} kinds of small text below 4.5:1`);
  console.log(`contrast ${scheme}: ${measured} small-text elements, ${list.length} kinds below 4.5:1`);
  if (scheme === "dark") {
    await go(page, "06-1");
    await page.screenshot({ path: join(outDir, "after-dark-task-tag.png"), clip: { x: 300, y: 50, width: 900, height: 200 } });
  }
  await context.close();
}

await browser.close();
report.finishedAt = new Date().toISOString();
report.ok = report.problems.length === 0;
writeFileSync(join(outDir, "web-qa.json"), JSON.stringify(report, null, 2));
console.log(report.ok ? "All web checks passed." : `PROBLEMS (${report.problems.length}):\n${report.problems.join("\n")}`);
if (!report.ok) process.exitCode = 1;
