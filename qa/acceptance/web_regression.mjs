#!/usr/bin/env node
// Independent regression of the workbook's interactive edition (read only, written apart from the workbook's own
// tests). Each case acts the way a student does — clicks, typing, reloads, files — and keeps screenshots.
//
//   node qa/acceptance/web_regression.mjs <web dir with index.html> <out dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, resolve, normalize } from "node:path";

const [webDir, outDir] = process.argv.slice(2);
const root = resolve(webDir);
mkdirSync(outDir, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const server = createServer((request, response) => {
  const path = normalize(join(root, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  const file = path.endsWith("\\") || path.endsWith("/") ? join(path, "index.html") : path;
  if (!file.startsWith(root) || !existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const cases = [];
async function run(name, size, body, options = {}) {
  const context = await browser.newContext({ viewport: size, acceptDownloads: true, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = { name, ok: false, details: [], shots: [] };
  const shot = async (label) => {
    const file = `${cases.length + 1}-${label}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage: false });
    result.shots.push(file);
  };
  try {
    result.ok = Boolean(await body({ page, context, shot, note: (text) => result.details.push(text) }));
  } catch (error) {
    result.details.push(`error: ${error.message.split("\n")[0]}`);
    await shot("error").catch(() => {});
  }
  if (errors.length) result.details.push(`page errors: ${errors.join(" | ")}`);
  cases.push(result);
  console.log(`${result.ok ? "PASS" : "FAIL"} ${name} — ${result.details.join(" · ").slice(0, 300)}`);
  await context.close();
}
const go = async (page, id) => {
  await page.evaluate((target) => (location.hash = target), id);
  await page.waitForTimeout(250);
};
const visibleView = (page) => page.locator(".w-view:not([hidden])");
const text = async (locator) => ((await locator.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

/** Fills what a student would fill in one task view: every self-check, one choice per radio group, 否 with a reason
 *  for 是／否／不適用 questions, every text field, and table rows up to `rows`. Habit radios get exactly one pick. */
async function completeView(page, id, { rows = 3, answer = "否" } = {}) {
  await go(page, id);
  const view = visibleView(page);
  for (const box of await view.locator('input[type="checkbox"][data-check]').all()) if (!(await box.isChecked())) await box.check();
  const groups = new Set(await view.locator('input[type="radio"]').evaluateAll((inputs) => inputs.map((input) => input.name)));
  for (const name of groups) {
    const options = view.locator(`input[type="radio"][name="${name}"]`);
    const labels = await options.evaluateAll((inputs) => inputs.map((input) => input.closest("label")?.textContent?.trim() ?? ""));
    const index = labels.includes(answer) ? labels.indexOf(answer) : 0;
    await options.nth(index).check();
  }
  for (const add of await view.locator("[data-add-row]").all()) {
    const prefix = await add.getAttribute("data-add-row");
    const table = view.locator(`[data-table="${prefix}"]`);
    for (let guard = 0; guard < 6 && (await table.locator("tbody tr").count()) < rows; guard++) await add.click();
  }
  for (const field of await view.locator("input[type=text][data-field], input:not([type])[data-field], input[type=number][data-field], input[type=time][data-field], textarea[data-field], [data-table] input, [data-table] textarea").all()) {
    if (!(await field.isVisible()) || (await field.inputValue()) !== "") continue;
    const type = (await field.getAttribute("type")) ?? "text";
    await field.fill(type === "number" ? "1" : type === "time" ? "09:20" : "驗收測試輸入");
  }
  for (const select of await view.locator("select[data-field], [data-table] select").all()) {
    const options = await select.locator("option").evaluateAll((items) => items.map((item) => item.value).filter(Boolean));
    if (options.length && !(await select.inputValue())) await select.selectOption(options[0]);
  }
  await page.waitForTimeout(150);
}
const levelText = (page, level) => text(page.locator(`[data-level-progress="${level}"]`));
const levelDone = (page, level) => page.locator(`[data-level-seal="${level}"]`).first().evaluate((element) => element.classList.contains("done"));

try {
  await run("P0 Level 06：只選一個習慣，其餘必要任務完成後即可通關（06-4 答否／不適用）", { width: 1440, height: 900 }, async ({ page, shot, note }) => {
    await page.goto(base);
    await go(page, "06-1");
    const habits = visibleView(page).locator('input[type="radio"][name="06-1:habit"]');
    note(`habit options ${await habits.count()} (radio)`);
    const before = await levelText(page, "L06");
    for (const id of ["06-1", "06-2", "06-3", "06-4", "06-5", "06-6"]) await completeView(page, id);
    // 06-4: the last question answered 不適用 with a reason, the rest 否 — honest answers, not 是.
    await go(page, "06-4");
    const tri = visibleView(page).locator('input[type="radio"][name="06-4:adh:4"]');
    if (await tri.count()) {
      const labels = await tri.evaluateAll((inputs) => inputs.map((input) => input.closest("label")?.textContent?.trim()));
      await tri.nth(labels.indexOf("不適用")).check();
    }
    await shot("06-4-answers");
    const picked = await page.evaluate(() => [...document.querySelectorAll('input[name="06-1:habit"]')].filter((input) => input.checked).length);
    const answers = await page.evaluate(() => [0, 1, 2, 3, 4].map((i) => document.querySelector(`input[name="06-4:adh:${i}"]:checked`)?.closest("label")?.textContent?.trim()));
    await go(page, "L06");
    await shot("L06-level");
    const after = await levelText(page, "L06");
    const done = await levelDone(page, "L06");
    await go(page, "06-6");
    const feedback = await text(page.locator('[data-done="06-6"]'));
    await shot("06-6-done");
    note(`before "${before}" · habits checked ${picked} · 06-4 answers ${answers.join("/")} · after "${after}" · seal done ${done}`);
    note(`06-6 feedback: ${feedback.slice(0, 140)}`);
    return picked === 1 && answers.every((answer) => answer && answer !== "是") && done && ["你現在會做什麼", "你留下的成果", "下一個小挑戰"].every((part) => feedback.includes(part));
  });

  await run("P0 期末三份作品：不用紙本，數位填寫、重新整理仍在、匯出 JSON、清空後匯入還原（先確認）", { width: 1440, height: 900 }, async ({ page, context, shot, note }) => {
    await page.goto(base);
    for (const id of ["F-3", "F-4", "F-5"]) await completeView(page, id);
    await go(page, "F-3");
    const stock = page.locator('[data-field="F-3:plan:stock"]');
    const stockValue = await stock.locator("option").evaluateAll((options) => options.find((option) => option.textContent.includes("2330"))?.value ?? "");
    await stock.selectOption(stockValue);
    await go(page, "F-5");
    await page.locator('[data-field="F-5:reflect:proud"]').fill("09:20 等條件成立才送單");
    const states = {};
    for (const id of ["F-3", "F-4", "F-5"]) states[id] = await text(page.locator(`[data-task-state="${id}"]`));
    await shot("finals-filled");
    await page.reload();
    await go(page, "F-3");
    const kept = await page.locator('[data-field="F-3:plan:stock"]').inputValue();
    note(`F-3 stock option "${stockValue}"`);
    await go(page, "F-4");
    const logRows = await visibleView(page).locator('[data-table="F-4:log"] tbody tr').count();
    await go(page, "progress");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "匯出備份檔（JSON）" }).click()]);
    const file = join(outDir, "export.json");
    await download.saveAs(file);
    const exported = JSON.parse(readFileSync(file, "utf8"));
    const data = exported.data ?? exported;
    const hasFinals = JSON.stringify(data).includes(stockValue) && JSON.stringify(data).includes("09:20 等條件成立才送單");
    note(`states ${JSON.stringify(states)} · after reload F-3 stock "${kept}" · F-4 rows ${logRows} · export schema ${exported.schema} v${exported.version} · finals in export ${hasFinals}`);
    // A different, empty browser: import the file; it must ask before replacing.
    const fresh = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
    const other = await fresh.newPage();
    await other.goto(base);
    await other.evaluate(() => (location.hash = "F-3"));
    await other.locator('[data-field="F-3:plan:plan:reason"], [data-field="F-3:plan:reason"]').first().fill("另一台裝置原本的內容");
    await other.waitForTimeout(600);
    await other.evaluate(() => (location.hash = "progress"));
    await other.getByLabel("匯入備份檔").setInputFiles(file);
    const dialog = other.getByRole("dialog");
    const asked = await dialog.waitFor({ timeout: 5000 }).then(() => true, () => false);
    await other.screenshot({ path: join(outDir, "import-confirm.png") });
    const dialogText = asked ? await text(dialog) : "";
    if (asked) await dialog.getByRole("button", { name: /取代|匯入|確定/ }).first().click();
    await other.waitForTimeout(600);
    await other.evaluate(() => (location.hash = "F-3"));
    const restored = await other.locator('[data-field="F-3:plan:stock"]').inputValue();
    await other.evaluate(() => (location.hash = "progress"));
    const backups = await text(other.locator(".w-view:not([hidden])"));
    await other.screenshot({ path: join(outDir, "after-import.png") });
    await fresh.close();
    note(`import asked ${asked} (${dialogText.slice(0, 80)}) · restored "${restored}" · backup listed ${/備份/.test(backups)}`);
    return Object.values(states).every((state) => /完成|✓/.test(state)) && kept === stockValue && logRows >= 3 && hasFinals && asked && restored === stockValue;
  });

  await run("P1 最新輸入：打字後立刻重新整理、立刻切頁，內容都在", { width: 390, height: 844 }, async ({ page, note }) => {
    await page.goto(base);
    await go(page, "F-5");
    await page.locator('[data-field="F-5:reflect:change"]').fill("立刻重整也要在");
    await page.reload();
    await go(page, "F-5");
    const afterReload = await page.locator('[data-field="F-5:reflect:change"]').inputValue();
    await page.locator('[data-field="F-5:reflect:mistake"]').fill("立刻切頁也要在");
    await go(page, "glossary");
    await page.reload();
    await go(page, "F-5");
    const afterNav = await page.locator('[data-field="F-5:reflect:mistake"]').inputValue();
    note(`reload "${afterReload}" · navigate+reload "${afterNav}"`);
    return afterReload === "立刻重整也要在" && afterNav === "立刻切頁也要在";
  });

  await run("P1 保存失敗：瀏覽器拒絕寫入時，畫面說保存失敗，且仍能匯出剛寫的內容", { width: 1440, height: 900 }, async ({ page, context, shot, note }) => {
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith("dtt-academy-workbook")) throw new DOMException("quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    await page.goto(base);
    await go(page, "F-5");
    await page.locator('[data-field="F-5:reflect:proud"]').fill("寫不進去也不能消失");
    await page.locator('[data-field="F-5:reflect:proud"]').blur();
    await page.waitForTimeout(1500);
    const status = await text(page.locator("body"));
    await shot("save-failed");
    await go(page, "progress");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "匯出備份檔（JSON）" }).click()]);
    const file = join(outDir, "export-after-failure.json");
    await download.saveAs(file);
    const kept = readFileSync(file, "utf8").includes("寫不進去也不能消失");
    note(`保存失敗 shown ${status.includes("保存失敗")} · export keeps the text ${kept}`);
    return status.includes("保存失敗") && kept;
  });

  await run("P1 壞掉的紀錄：不當機、不靜默刪除，原始內容另存備份", { width: 1440, height: 900 }, async ({ page, context, shot, note }) => {
    await context.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("dtt-academy-workbook-v2", "{這不是 JSON");
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto(base);
    await page.waitForTimeout(800);
    await shot("corrupt-banner");
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const kept = await page.evaluate(() => Object.keys(localStorage).some((key) => localStorage.getItem(key) === "{這不是 JSON"));
    const usable = await page.locator(".w-view:not([hidden])").isVisible();
    note(`keys ${keys.join(", ")} · raw text kept ${kept} · page usable ${usable}`);
    return kept && usable;
  });

  await run("P1 繼續上次學習：重新開啟入口頁會帶回上次的任務", { width: 1440, height: 900 }, async ({ page, shot, note }) => {
    await page.goto(base);
    await go(page, "05-2");
    await page.waitForTimeout(500);
    await page.goto(base.replace(/#.*/, ""));
    await page.waitForTimeout(500);
    const body = await text(page.locator(".w-view:not([hidden])"));
    const link = page.locator('a[href="#05-2"]').filter({ hasText: /繼續/ });
    await shot("resume");
    note(`resume link ${await link.count()} · ${body.match(/繼續[^。]{0,40}/)?.[0] ?? "no 繼續 text"}`);
    return (await link.count()) > 0 || /繼續.{0,20}05-2/.test(body);
  });

  await run("P1 手機看圖：390px 放大到原尺寸、可平移、標號不漂移，鍵盤開關與焦點", { width: 390, height: 844 }, async ({ page, shot, note }) => {
    await page.goto(base);
    await go(page, "01-4");
    // The workbench overview: the largest figure of 01-4 (r2 puts key-area close-ups first).
    const figures = visibleView(page).locator("figure[data-crop-w]");
    const areas = await figures.evaluateAll((items) => items.map((item) => Number(item.dataset.cropW) * Number(item.dataset.cropH)));
    const frame = figures.nth(areas.indexOf(Math.max(...areas))).locator('.frame[role="button"]');
    // r2 keeps the full ten-area overview in a folded reference section: open it the way a student does.
    const folded = await frame.evaluate((element) => {
      const details = element.closest("details");
      return details && !details.open ? true : false;
    });
    if (folded) {
      await frame.evaluate((element) => element.closest("details").querySelector("summary").scrollIntoView());
      await frame.evaluate((element) => element.closest("details").querySelector("summary").click());
      note("opened the folded overview section first");
    }
    await frame.scrollIntoViewIfNeeded();
    const inline = await frame.boundingBox();
    await frame.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator(".w-lightbox");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    const measure = () =>
      page.evaluate(() => {
        const box = (document.querySelector(".w-lightbox .crop") ?? document.querySelector(".w-lightbox img"))?.getBoundingClientRect();
        const markers = [...document.querySelectorAll(".w-lightbox .marker")].map((marker) => {
          const rect = marker.getBoundingClientRect();
          return [(rect.left + rect.width / 2 - box.left) / box.width, (rect.top + rect.height / 2 - box.top) / box.height];
        });
        return { width: box.width, left: box.left, top: box.top, markers };
      });
    const fit = await measure();
    await shot("viewer-fit");
    await dialog.getByRole("button", { name: "原尺寸 100%" }).click();
    await page.waitForTimeout(400);
    const actual = await measure();
    await shot("viewer-actual");
    const drift = Math.max(0, ...actual.markers.map(([x, y], i) => Math.max(Math.abs(x - fit.markers[i][0]), Math.abs(y - fit.markers[i][1]))));
    const centre = await page.evaluate(() => {
      const box = (document.querySelector(".w-lightbox .crop") ?? document.querySelector(".w-lightbox img")).getBoundingClientRect();
      return [Math.min(innerWidth - 20, Math.max(20, box.left + box.width / 2)), Math.min(innerHeight - 60, Math.max(160, box.top + box.height / 2))];
    });
    // A finger drag, as on a phone (touch events, ten moves).
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    await touch("touchStart", centre[0], centre[1]);
    for (let i = 1; i <= 10; i++) await touch("touchMove", centre[0] - i * 12, centre[1] - i * 6);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(300);
    const panned = await measure();
    await dialog.getByRole("button", { name: "還原" }).click();
    await page.waitForTimeout(300);
    const reset = await measure();
    // Focus stays in the dialog for 12 Tabs and 12 Shift+Tabs.
    let escaped = 0;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (!(await page.evaluate(() => Boolean(document.activeElement?.closest(".w-lightbox"))))) escaped++;
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      if (!(await page.evaluate(() => Boolean(document.activeElement?.closest(".w-lightbox"))))) escaped++;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const closed = await dialog.isHidden();
    const focusBack = await page.evaluate(() => document.activeElement?.classList.contains("frame"));
    const scale = actual.width / inline.width;
    note(`inline ${Math.round(inline.width)}px → fit ${Math.round(fit.width)}px → 100% ${Math.round(actual.width)}px (×${scale.toFixed(2)} of the page image) · marker drift ${(drift * 100).toFixed(2)}% · pan moved ${Math.round(panned.left - actual.left)},${Math.round(panned.top - actual.top)}px · reset ${Math.round(reset.width)}px · focus escaped ${escaped}/24 · Esc closed ${closed} · focus back ${focusBack}`);
    return scale >= 2 && drift < 0.005 && Math.abs(panned.left - actual.left) > 100 && Math.abs(reset.width - fit.width) < 2 && escaped === 0 && closed && focusBack;
  }, { hasTouch: true, isMobile: true });

  // Fable F-02 (r2.1): on a phone the 目錄 panel covered the 目錄 button, could not be closed, and a tap at the
  // button's place opened 開始之前. Checked with real touch taps at 390 and 360.
  for (const width of [390, 360]) {
    await run(`P2 手機目錄（${width}）：打開後看得到關閉方式，關閉鈕、點遮罩、Esc 都能關，不會誤觸跳頁`, { width, height: width === 390 ? 844 : 740 }, async ({ page, shot, note }) => {
      await page.goto(base);
      await go(page, "03-4");
      const menu = page.locator("button.w-menu");
      const nav = page.locator("#w-nav");
      const isOpen = () => nav.evaluate((element) => element.classList.contains("open") && getComputedStyle(element).visibility !== "hidden");
      const tapAt = async (x, y) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(350);
      };
      const button = await menu.boundingBox();
      await tapAt(button.x + button.width / 2, button.y + button.height / 2);
      const opened = await isOpen();
      const top = await nav.evaluate((element) => Math.round(element.getBoundingClientRect().top));
      const covered = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button.w-menu") !== null, [button.x + button.width / 2, button.y + button.height / 2]);
      await shot(`menu-open-${width}`);
      // 1) a tap at the 目錄 button again must not jump to 開始之前
      await tapAt(button.x + button.width / 2, button.y + button.height / 2);
      const hashAfterTap = await page.evaluate(() => location.hash);
      if (!(await isOpen())) await menu.click();
      // 2) the close button
      await page.getByRole("button", { name: "關閉目錄" }).click();
      await page.waitForTimeout(300);
      const closedByButton = !(await isOpen());
      // 3) the shade beside the panel
      await menu.click();
      await page.waitForTimeout(300);
      const panel = await nav.boundingBox();
      await tapAt(Math.min(width - 8, panel.x + panel.width + 20), Math.min(700, panel.y + 200));
      const closedByShade = !(await isOpen());
      // 4) Escape, focus back on 目錄
      await menu.click();
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const closedByEscape = !(await isOpen());
      const focusBack = await page.evaluate(() => document.activeElement?.classList.contains("w-menu") ?? false);
      const stayed = await page.evaluate(() => location.hash);
      note(`open ${opened} · panel top ${top}px · 目錄 button still reachable ${covered} · hash after tapping there ${hashAfterTap} · closed by button ${closedByButton}, shade ${closedByShade}, Esc ${closedByEscape} · focus back ${focusBack} · page ${stayed}`);
      return opened && covered && hashAfterTap === "#03-4" && closedByButton && closedByShade && closedByEscape && focusBack && stayed === "#03-4";
    }, { hasTouch: true, isMobile: true });
  }

  await run("P2 桌機看圖：滑鼠拖曳可以平移放大的圖", { width: 1440, height: 900 }, async ({ page, shot, note }) => {
    await page.goto(base);
    await go(page, "01-4");
    const frame = visibleView(page).locator('figure[data-crop-w="1326"] .frame').first();
    await frame.evaluate((element) => {
      const details = element.closest("details");
      if (details) details.open = true;
    });
    await frame.scrollIntoViewIfNeeded();
    await frame.click();
    await page.locator(".w-lightbox").waitFor({ state: "visible" });
    await page.locator('.w-lightbox [data-lb="in"]').click();
    await page.locator('.w-lightbox [data-lb="in"]').click();
    await page.waitForTimeout(300);
    const box = () => page.evaluate(() => {
      const rect = document.querySelector(".w-lightbox .crop").getBoundingClientRect();
      return [rect.left, rect.top];
    });
    const before = await box();
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(520, 350, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await box();
    await shot("desktop-pan");
    const moved = [Math.round(after[0] - before[0]), Math.round(after[1] - before[1])];
    note(`mouse drag −200,−100 in 10 moves → image moved ${moved.join(",")}`);
    return moved[0] <= -160 && moved[1] <= -80;
  });

  await run("P2 術語連結：每個連結的目標任務存在，而且內容提到這個術語", { width: 1440, height: 900 }, async ({ page, note }) => {
    await page.goto(base);
    await go(page, "glossary");
    const links = await page.locator(".w-view:not([hidden]) a[href^='#']").evaluateAll((anchors) =>
      anchors.map((anchor) => ({ term: anchor.closest("div")?.querySelector("dt")?.childNodes[0]?.textContent?.trim() ?? "", target: anchor.getAttribute("href").slice(1) })),
    );
    const bad = [];
    for (const { term, target } of links) {
      const content = await page.evaluate((id) => document.querySelector(`[data-view="${id}"]`)?.textContent ?? null, target);
      if (content === null) {
        bad.push(`${term}→${target} missing`);
        continue;
      }
      const squeeze = (value) => value.replace(/\s+/g, "");
      const parts = squeeze(term).split(/[／（）()]+/).filter(Boolean).flatMap((part) => [part, part.replace(/圖$/, "")]).filter(Boolean);
      if (!parts.some((part) => squeeze(content).includes(part))) bad.push(`${term}→${target} does not mention it`);
    }
    note(`${links.length} links · problems ${bad.length}: ${bad.slice(0, 6).join("; ")}`);
    return links.length > 0 && bad.length === 0;
  });

  await run("P2 預設留白：全新開啟時所有作答欄位都是空的，範例有標示", { width: 1440, height: 900 }, async ({ page, note }) => {
    await page.goto(base);
    const filled = await page.evaluate(() =>
      [...document.querySelectorAll("[data-field]")].filter((field) => (field.type === "radio" || field.type === "checkbox" ? field.checked : (field.value ?? "").trim() !== "")).map((field) => field.dataset.field),
    );
    const examples = await page.evaluate(() => [...document.querySelectorAll(".w-example-row, [data-example]")].length);
    const labelled = await page.evaluate(() => document.body.textContent.includes("範例"));
    note(`pre-filled fields ${filled.length}${filled.length ? ` (${filled.slice(0, 5).join(", ")})` : ""} · example rows ${examples} · 「範例」 label present ${labelled}`);
    return filled.length === 0 && labelled;
  });

  await run("P1 成就感：課前小任務、每關能力卡與學習成果冊", { width: 390, height: 844 }, async ({ page, shot, note }) => {
    await page.goto(base);
    await go(page, "Q");
    const quick = await text(visibleView(page));
    await shot("quick-mission");
    await completeView(page, "01-1");
    const feedback = await text(page.locator('[data-done="01-1"]'));
    await shot("01-1-done");
    await go(page, "portfolio");
    const portfolio = await text(visibleView(page));
    await shot("portfolio");
    note(`quick mission ${quick.length} chars (${quick.slice(0, 60)}) · 01-1 feedback: ${feedback.slice(0, 120)} · portfolio ${portfolio.slice(0, 120)}`);
    return quick.length > 200 && ["你現在會做什麼", "你留下的成果", "下一個小挑戰"].every((part) => feedback.includes(part)) && /講師確認/.test(portfolio + (await text(page.locator("body"))));
  });
} finally {
  await browser.close();
  server.close();
}
const summary = { checkedAt: new Date().toISOString(), web: root, cases: cases.length, passed: cases.filter((item) => item.ok).length };
writeFileSync(join(outDir, "web-regression.json"), JSON.stringify({ summary, cases }, null, 2));
console.log(JSON.stringify(summary));
