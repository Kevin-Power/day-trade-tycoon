// Shared helpers for the workbook capture: screenshots with target boxes, step checks, and desk actions.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DESKTOP = { width: 1280, height: 800, dpr: 2 };
export const PHONE = { width: 390, height: 844, dpr: 3 };
let debugDirectory = null;

/** Collects screenshots (with the boxes of the elements each figure points at), facts and checks. */
export class Recorder {
  constructor(out) {
    this.out = out;
    this.raw = join(out, "raw");
    mkdirSync(this.raw, { recursive: true });
    debugDirectory = join(out, "debug");
    mkdirSync(debugDirectory, { recursive: true });
    this.shots = {};
    this.facts = {};
    this.checks = [];
    this.scope = "setup";
  }

  section(scope) {
    this.scope = scope;
  }

  check(label, ok, detail = "") {
    this.checks.push({ scope: this.scope, label, ok: Boolean(ok), detail: String(detail ?? "") });
    console.log(`${ok ? "PASS" : "FAIL"} [${this.scope}] ${label}${detail ? ` — ${detail}` : ""}`);
    return Boolean(ok);
  }

  /** Waits for a locator and records a check; never throws, so one miss does not stop the walk. */
  async expectVisible(label, locator, timeout = 15000) {
    try {
      await locator.first().waitFor({ state: "visible", timeout });
      return this.check(label, true);
    } catch (error) {
      return this.check(label, false, error.message.split("\n")[0]);
    }
  }

  async expectText(label, locator, pattern, timeout = 15000) {
    const deadline = Date.now() + timeout;
    let text = "";
    while (Date.now() < deadline) {
      text = ((await locator.first().textContent({ timeout: 2000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) return this.check(label, true, text.slice(0, 120));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return this.check(label, false, `got "${text.slice(0, 160)}"`);
  }

  fact(key, value) {
    this.facts[key] = value;
  }

  /**
   * Screenshot of the viewport, or of one region when `region` is given. `targets` maps names to
   * locators; their boxes are stored relative to the image so figures can ring them exactly.
   */
  async shot(page, id, { region, targets = {}, meta = {}, pad = 0 } = {}) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const viewport = page.viewportSize();
    // A region that fits the viewport is clipped from the viewport; a taller one is taken in page
    // coordinates (full page + clip) so it is not cut. The desk itself always fits its viewport.
    let clip = null;
    let scroll = { x: 0, y: 0 };
    let fullPage = false;
    if (region) {
      await region.first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(150);
      const box = await region.first().boundingBox();
      if (!box) throw new Error(`${id}: region not visible`);
      fullPage = box.y - pad < 0 || box.y + box.height + pad > viewport.height;
      if (fullPage) scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      const limit = fullPage
        ? await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          }))
        : viewport;
      const x = Math.max(0, Math.floor(box.x + scroll.x - pad));
      const y = Math.max(0, Math.floor(box.y + scroll.y - pad));
      clip = {
        x,
        y,
        width: Math.min(limit.width - x, Math.ceil(box.width + pad * 2)),
        height: Math.min(limit.height - y, Math.ceil(box.height + pad * 2)),
      };
    }
    const origin = clip ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const boxes = {};
    for (const [name, locator] of Object.entries(targets)) {
      const box = await locator.first().boundingBox().catch(() => null);
      if (!box) {
        this.check(`${id}: target ${name} visible`, false);
        continue;
      }
      boxes[name] = {
        x: round(box.x + scroll.x - origin.x),
        y: round(box.y + scroll.y - origin.y),
        w: round(box.width),
        h: round(box.height),
      };
    }
    const file = `${id}.png`;
    await page.screenshot({
      path: join(this.raw, file),
      ...(clip ? { clip } : {}),
      ...(fullPage ? { fullPage: true } : {}),
      animations: "disabled",
      caret: "hide",
    });
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    this.shots[id] = {
      file,
      width: origin.width,
      height: origin.height,
      dpr,
      viewport,
      url: page.url().replace(/^https?:\/\/[^/]+/, ""),
      clock: (await page.locator(".td-clock strong").first().textContent({ timeout: 500 }).catch(() => null)) ?? null,
      boxes,
      meta,
      takenAt: new Date().toISOString(),
    };
    console.log(`SHOT ${id} ${origin.width}x${origin.height}@${dpr} targets=${Object.keys(boxes).join(",")}`);
    return this.shots[id];
  }

  save() {
    writeFileSync(join(this.out, "shots.json"), JSON.stringify(this.shots, null, 2));
    writeFileSync(join(this.out, "facts.json"), JSON.stringify(this.facts, null, 2));
    writeFileSync(join(this.out, "checks.json"), JSON.stringify(this.checks, null, 2));
    writeFileSync(join(this.out, "stalls.json"), JSON.stringify(stalls, null, 2));
  }
}

const round = (value) => Math.round(value * 10) / 10;

export async function settle(page, ms = 400) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(ms);
}

/** The run as the server sees it (read only). */
export async function morningState(page, lessonId) {
  return page.evaluate(async (lesson) => {
    const response = await fetch(lesson ? `/api/morning?lesson=${encodeURIComponent(lesson)}` : "/api/morning", {
      cache: "no-store",
      credentials: "same-origin",
    });
    return response.json();
  }, lessonId ?? null);
}

export async function clockText(page) {
  return ((await page.locator(".td-clock strong").first().textContent().catch(() => "")) ?? "").trim();
}

/** Every stall of the 「+1 分」 button is kept with what the page showed, for the acceptance record. */
export const stalls = [];

/** Presses 「+1 分」 until the desk clock shows `target` (HH:MM). */
export async function advanceTo(page, target, debugDir) {
  for (let guard = 0; guard < 160; guard++) {
    const now = await clockText(page);
    if (now === target) return;
    if (now > target) throw new Error(`clock ${now} already past ${target}`);
    const button = page.getByRole("button", { name: "前進 1 分鐘" });
    try {
      await button.click({ timeout: 10000 });
    } catch {
      // The 10:00 checkpoint disables the button by design; the clock may simply have re-rendered late.
      if ((await clockText(page)) === target) return;
      const banners = (await page.locator(".td-banner, .td-feedback, [role=alert]").allTextContents().catch(() => []))
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const disabled = await button.isDisabled().catch(() => null);
      const dir = debugDir ?? debugDirectory;
      const file = dir ? join(dir, `stall-${now.replace(":", "")}-${Date.now()}.png`) : null;
      if (file) await page.screenshot({ path: file }).catch(() => {});
      stalls.push({ at: now, target, disabled, banners, screenshot: file });
      console.log(`STALL at ${now} (disabled=${disabled}): ${banners.join(" | ")}`);
      const reload = page.getByRole("button", { name: "重新載入進度" });
      const synced = page.getByRole("button", { name: "已核對，載入目前進度" });
      if (await reload.isVisible().catch(() => false)) await reload.click();
      else if (await synced.isVisible().catch(() => false)) await synced.click();
      else await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      continue;
    }
    await page.waitForFunction(
      (previous) => document.querySelector(".td-clock strong")?.textContent?.trim() !== previous,
      now,
      { timeout: 15000 },
    );
  }
  throw new Error(`could not reach ${target}`);
}

export function deskLocators(page) {
  return {
    bar: page.locator("header.td-bar"),
    lessonSelect: page.locator('select[aria-label="教材交易日"]'),
    subject: page.locator(".td-subject"),
    clock: page.locator(".td-clock"),
    account: page.locator("dl.td-account"),
    replay: page.locator('[aria-label="歷史行情重播控制"]'),
    play: page.locator(".td-play"),
    speed: page.locator('[aria-label="重播速度"]'),
    plusOne: page.getByRole("button", { name: "前進 1 分鐘" }),
    reviewButton: page.locator('[aria-label="歷史行情重播控制"] button', { hasText: "復盤" }),
    resourcesButton: page.locator('button.td-tool[aria-controls="td-resources"]'),
    sizeControl: page.locator(".td-size"),
    hints: page.locator(".td-hints"),
    tip: page.locator(".td-tip"),
    feedback: page.locator(".td-feedback"),
    alert: page.locator(".td-alert"),
    watch: page.locator("aside.td-watch"),
    watchList: page.locator(".td-watchlist"),
    planNote: page.locator(".td-plan-note"),
    hero: page.locator("header.td-hero"),
    heroName: page.locator("#morning-practice-title"),
    heroStamp: page.locator(".td-hero-stamp"),
    heroPrice: page.locator(".td-hero-price"),
    heroChange: page.locator(".td-hero-change"),
    heroStats: page.locator(".td-hero-stats"),
    heroBook: page.locator(".td-hero-book"),
    chartBar: page.locator(".td-chartbar"),
    stepper: page.locator(".td-stepper"),
    stockSelect: page.locator('select[aria-label="選擇股票"]'),
    prevStock: page.getByRole("button", { name: "上一檔股票" }),
    nextStock: page.getByRole("button", { name: "下一檔股票" }),
    modeNav: page.locator('nav[aria-label="看盤分頁"]'),
    modeQuote: page.locator('[data-coach="mode-quote"]'),
    modeChart: page.locator('[data-coach="mode-chart"]'),
    source: page.locator(".td-chartbar-source"),
    chart: page.locator("section.td-chart"),
    canvas: page.locator('main canvas[role="img"]'),
    trade: page.locator("aside.td-trade"),
    quoteDetail: page.locator("section.terminal-quote-detail"),
    detailTabs: page.locator('nav[aria-label="下單行情分類"]'),
    detailSelect: page.locator('select[aria-label="下單商品"]'),
    book: page.locator(".td-book"),
    bookTag: page.locator(".td-book-head .td-chip"),
    asks: page.locator('.td-ladder[data-side="buy"]'),
    bids: page.locator('.td-ladder[data-side="sell"]'),
    mid: page.locator(".td-ladder-mid"),
    pressure: page.locator(".td-pressure"),
    flash: page.locator(".td-flash"),
    lots: page.locator(".td-lots"),
    ticket: page.locator("section.sim-ticket"),
    sideSwitch: page.locator('[aria-label="模擬買賣方向"]'),
    orderType: page.locator('[aria-label="委託價格類型"]'),
    limitField: page.locator(".morning-limit-field"),
    stepperQty: page.locator(".sim-stepper"),
    facts: page.locator("section.sim-ticket dl.sim-order-facts").first(),
    submit: page.locator("button.sim-submit"),
    pending: page.locator(".sim-pending"),
    confirm: page.locator(".sim-confirm"),
    help: page.locator(".sim-order-help"),
    ledger: page.locator(".td-ledger"),
    ledgerTabs: page.locator('nav[aria-label="交易紀錄分類"]'),
    ledgerToggle: page.locator(".sim-ledger-toggle"),
    ledgerContent: page.locator("#sim-ledger-content"),
    banner: page.locator(".td-banner"),
    review: page.locator('section[aria-labelledby="morning-review-title"]'),
    completion: page.locator("section", { hasText: "已保存 · 這是操作足跡，不是獲利能力評分" }).last(),
    resources: page.locator("#td-resources"),
    coach: page.locator(".td-coach-dialog"),
    dock: page.locator('nav[aria-label="主要分頁"]'),
  };
}

/** Opens one ledger tab (庫存／委託／成交); the desk keeps the ledger folded until asked. */
export async function ledgerTab(page, label) {
  const button = page.locator('nav[aria-label="交易紀錄分類"] button', { hasText: label }).first();
  await button.click();
  await page.waitForTimeout(250);
  const toggle = page.locator(".sim-ledger-toggle");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await page.waitForTimeout(250);
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}
