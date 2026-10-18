// Walks a brand-new student through every workbook level on a disposable classroom and records the
// real screens the workbook uses. Every step also asserts what the learner should see, so one run is
// both the screenshot source and the Playwright acceptance record. Nothing here talks to production.
import { chromium } from "playwright";
import { randomBytes } from "node:crypto";
import {
  Recorder,
  DESKTOP,
  PHONE,
  settle,
  morningState,
  advanceTo,
  clockText,
  deskLocators,
  ledgerTab,
} from "./lib.mjs";

const STUDENT = { name: "示範學員", email: "student.demo@example.invalid" };

export async function capture({ appBase, gateCode, out }) {
  const rec = new Recorder(out);
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  rec.fact("browser", browser.version());
  try {
    await warmup(browser, rec, appBase);
    await quickstart(browser, rec, appBase, gateCode);
    const desk = await level01(browser, rec, appBase, gateCode);
    await level02(desk.page, rec);
    await level03(desk.page, rec);
    await level04(desk.page, rec, browser, desk.context);
    await level05(desk.page, rec, appBase);
    await level06(desk.page, rec, appBase);
    await finalMission(desk.page, rec, appBase);
  } catch (error) {
    rec.check("walk finished without an unexpected stop", false, error.stack?.split("\n").slice(0, 3).join(" | "));
  } finally {
    rec.save();
    await browser.close();
  }
  return rec;
}

async function newDesktop(browser, extra = {}) {
  const context = await browser.newContext({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
    deviceScaleFactor: DESKTOP.dpr,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    ...extra,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
  return { context, page };
}

/* ─────────────── 課前小任務：訪客進教室，讀出第一個報價（不建立帳號） ─────────────── */
async function quickstart(browser, rec, appBase, gateCode) {
  rec.section("quick");
  const { context, page } = await newDesktop(browser);
  const d = deskLocators(page);
  await page.setViewportSize({ width: DESKTOP.width, height: 1000 });
  await page.goto(appBase + "/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("教室入場碼", { exact: true }).fill(gateCode);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "進入教室" }).click();
  const today = page.locator("section.today-card");
  await rec.expectVisible("訪客進入大廳，看到「今天三件事」", page.getByRole("heading", { name: "今天三件事" }), 20000);
  const startToday = page.getByRole("link", { name: "開始今天的練習" });
  await rec.expectVisible("訪客也有「開始今天的練習」", startToday);
  await settle(page, 800);
  await rec.shot(page, "q-today", { region: today, pad: 8, targets: { card: today, start: startToday } });
  await startToday.click();
  const observe = page.getByRole("radio", { name: /先看不做/ });
  await rec.expectVisible("訪客打開作戰計畫（不用帳號）", observe, 20000);
  await rec.expectText("訪客的交易日預設 2026-10-06", d.lessonSelect.locator("option:checked"), "2026-10-06");
  await rec.expectText("訪客的課程是第 1 課", d.subject, "第一筆有計畫的委託");
  await observe.click();
  await settle(page, 300);
  const begin = page.getByRole("button", { name: "用這個計畫開始" });
  await rec.shot(page, "q-plan", {
    region: page.getByRole("radiogroup", { name: "選一個計畫範本" }).locator(".."),
    pad: 8,
    targets: { observe, start: begin, templates: page.getByRole("radiogroup", { name: "選一個計畫範本" }) },
  });
  await begin.click();
  await rec.expectText("訪客開始後時鐘是 09:01", d.clock, "09:01", 20000);
  const coach = page.getByRole("dialog");
  if (await coach.isVisible().catch(() => false)) {
    const skip = coach.getByRole("button", { name: "跳過" });
    await rec.expectVisible("新手教學可以按「跳過」", skip);
    await skip.click();
    await settle(page, 400);
  }
  rec.check("新手教學關閉後可以操作工作台", (await page.locator(".td-coach").count()) === 0);
  await advanceTo(page, "09:03");
  await settle(page, 600);
  await rec.expectText("訪客：報價區是台積電", d.heroName, "台積電");
  await rec.shot(page, "q-desk", {
    meta: { lesson: "2026-10-06", exercise: "first-order", guest: true },
    targets: { clock: d.clock, plusOne: d.plusOne, replay: d.replay, hero: d.hero, heroName: d.heroName, stamp: d.heroStamp, price: d.heroPrice.locator("strong"), change: d.heroChange },
  });
  await rec.shot(page, "q-quote", {
    region: d.hero,
    pad: 6,
    targets: { name: d.heroName, stamp: d.heroStamp, price: d.heroPrice.locator("strong"), change: d.heroChange },
  });
  const state = await morningState(page);
  const bars = state.state.bars["2330"];
  rec.fact("quick", {
    lessonDate: state.catalog?.date ?? null,
    clock: await clockText(page),
    stamp: ((await d.heroStamp.textContent()) ?? "").trim(),
    last: bars.at(-1).c,
    previousClose: state.catalog.symbols.find((symbol) => symbol.code === "2330")?.previousClose,
  });
  rec.check("訪客 09:03 的台積電收價與教材資料一致（2585）", bars.at(-1).c === 2585, String(bars.at(-1).c));
  await context.close();
}

/* ───────────────────────── 課前暖身：/try ───────────────────────── */
async function warmup(browser, rec, appBase) {
  rec.section("warmup");
  const { context, page } = await newDesktop(browser);
  await page.goto(appBase + "/try", { waitUntil: "domcontentloaded" });
  await rec.expectVisible("免費體驗頁可直接開啟", page.getByText("免費體驗 · 不用帳號"));
  const card = page.locator("section[aria-labelledby='try-step-title']");
  // The whole practice column (progress, order card, question, button) is taller than the viewport,
  // so it is taken as a region in page coordinates.
  await rec.shot(page, "try-review", {
    region: page.locator("main"),
    targets: {
      steps: page.getByRole("list", { name: "體驗進度" }),
      order: card.locator("div.my-5").first(),
      question: card.locator("fieldset"),
      action: page.getByRole("button", { name: "確認並送出範例委託" }),
    },
  });
  await page.getByLabel("1 張，也就是 1,000 股").check();
  await page.getByRole("button", { name: "確認並送出範例委託" }).click();
  await rec.expectText("第 2 步：已送出還不代表已買到", page.locator("#try-step-title"), "已送出，還不代表已買到");
  await page.getByLabel("查看這筆委託的成交狀態").check();
  await page.getByRole("button", { name: "查看這筆範例成交" }).click();
  await rec.expectText("看到成交後再確認手上張數", page.locator("#try-step-title"), "看到成交");
  await page.getByRole("button", { name: /範例平倉/ }).click();
  await page.getByLabel("−100 元，少了交易成本").check();
  await page.getByRole("button", { name: "確認結果，完成體驗" }).click();
  await rec.expectText("體驗完成", page.locator("#try-step-title"), "完成了");
  await page.locator("#try-step-title").scrollIntoViewIfNeeded();
  await rec.shot(page, "try-complete", { region: card, pad: 8, targets: { done: card } });
  await context.close();
}

/* ───────────────────────── LEVEL 01 ───────────────────────── */
async function level01(browser, rec, appBase, gateCode) {
  rec.section("L01");
  const { context, page } = await newDesktop(browser);
  const d = deskLocators(page);

  // 01-1 教室入場 (a taller window, so 「進入教室」 and 「儲存資料」 are on screen)
  await page.setViewportSize({ width: DESKTOP.width, height: 1000 });
  await page.goto(appBase + "/", { waitUntil: "domcontentloaded" });
  const gateInput = page.getByLabel("教室入場碼", { exact: true });
  await rec.expectVisible("入場頁顯示教室入場碼欄位", gateInput);
  const enter = page.getByRole("button", { name: "進入教室" });
  rec.check("未勾選聲明前「進入教室」不能按", await enter.isDisabled());
  await rec.shot(page, "gate", {
    targets: {
      trial: page.getByRole("link", { name: /先體驗模擬操作/ }),
      code: page.locator("#classroom-gate").locator(".."),
      notice: page.locator("#classroom-disclaimer").locator(".."),
      agree: page.getByRole("checkbox"),
      enter,
    },
  });
  await gateInput.fill(gateCode);
  await page.getByRole("checkbox").check();
  rec.check("勾選聲明後「進入教室」可以按", await enter.isEnabled());
  await rec.shot(page, "gate-ready", {
    region: page.locator("form").first(),
    pad: 12,
    targets: { code: page.locator("#classroom-gate"), agree: page.getByRole("checkbox"), enter },
  });
  await enter.click();
  await rec.expectVisible("進入大廳：看到「今天三件事」", page.getByRole("heading", { name: "今天三件事" }), 20000);
  await settle(page, 1200);
  await rec.shot(page, "lobby-guest", {
    targets: {
      daily: page.locator("section.daily-card"),
      today: page.locator("section.today-card"),
      start: page.getByRole("link", { name: "開始今天的練習" }),
      coachLink: page.getByRole("link", { name: "第一次使用？看新手教學" }),
      size: page.getByRole("radiogroup", { name: "文字大小" }).first(),
    },
  });
  const account = page.locator("#my-learning");
  await rec.shot(page, "lobby-account", {
    region: account,
    pad: 10,
    targets: { signin: account.getByRole("link", { name: /登入／建立帳號/ }) },
  });

  // 01-1 建立學員帳號
  await account.getByRole("link", { name: /登入／建立帳號/ }).click();
  await page.getByRole("button", { name: "首次註冊" }).click();
  await rec.expectVisible("登入頁切到「首次註冊」", page.getByRole("heading", { name: "建立學員帳號" }));
  await page.locator("#learner-name").fill(STUDENT.name);
  await page.locator("#learner-email").fill(STUDENT.email);
  await page.locator("#learner-password").fill(randomBytes(18).toString("base64url"));
  await rec.shot(page, "signup", {
    targets: {
      tab: page.getByRole("button", { name: "首次註冊" }),
      name: page.locator("#learner-name"),
      email: page.locator("#learner-email"),
      password: page.locator("#learner-password"),
      submit: page.getByRole("button", { name: "建立帳號，繼續下一步" }),
      note: page.getByText("帳號註冊不代表完成繳費"),
    },
  });
  await page.getByRole("button", { name: "建立帳號，繼續下一步" }).click();
  const save = page.getByRole("button", { name: "儲存資料，進入教室" });
  await rec.expectVisible("帳號建立後進入「2 / 2 完成班級資料」", save, 20000);
  await rec.shot(page, "profile", {
    targets: {
      name: page.locator("#profile-name"),
      klass: page.locator("#learner-class"),
      agree: page.getByRole("checkbox"),
      save,
    },
  });
  rec.check("未勾選教學聲明前不能儲存", await save.isDisabled());
  await page.getByRole("checkbox").check();
  await save.click();
  await rec.expectVisible("儲存班級資料後回到大廳", page.getByRole("link", { name: "開始今天的練習" }), 20000);
  await rec.expectVisible("大廳出現「我的學習」（已登入）", page.getByRole("link", { name: "我的學習" }));
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await settle(page, 1500);
  await rec.shot(page, "lobby-member", {
    targets: {
      daily: page.locator("section.daily-card"),
      today: page.locator("section.today-card"),
      start: page.getByRole("link", { name: "開始今天的練習" }),
      mine: page.getByRole("link", { name: "我的學習" }),
      manual: page.getByRole("navigation", { name: "教室導覽" }).getByRole("link", { name: /教材/ }),
      leave: page.getByRole("button", { name: "離開教室" }),
    },
  });
  const courses = page.locator("#courses");
  await courses.scrollIntoViewIfNeeded();
  const card1 = page.locator('article[data-course="1"]');
  await rec.shot(page, "courses", {
    region: courses.locator("div.grid").first(),
    pad: 6,
    targets: {
      card1,
      steps: card1.locator("details summary"),
      start1: card1.getByRole("link", { name: /開始第 1 課/ }),
      card2: page.locator('article[data-course="2"]'),
    },
  });
  await card1.locator("summary", { hasText: "查看練習步驟" }).click();
  await rec.shot(page, "course-steps", {
    region: card1,
    pad: 4,
    targets: { steps: card1.locator("details"), start1: card1.getByRole("link", { name: /開始第 1 課/ }) },
  });
  await card1.locator("summary", { hasText: "查看練習步驟" }).click();
  rec.check("六個練習主題卡片", (await page.locator("article[data-course]").count()) === 6);

  // 01-2 開始第一輪
  await card1.getByRole("link", { name: /開始第 1 課/ }).click();
  const breakout = page.getByRole("radio", { name: /突破前高/ });
  await rec.expectVisible("第 1 課的作戰計畫表單打開", breakout, 20000);
  rec.check("預設範本是「突破前高」", (await breakout.getAttribute("aria-checked")) === "true");
  await rec.expectText("狀態列顯示第 1 課", d.subject, "第一筆有計畫的委託");
  await rec.expectText("交易日預設 2026-10-06", d.lessonSelect.locator("option:checked"), "2026-10-06");
  await page.getByRole("radio", { name: /先看不做/ }).click();
  await settle(page, 300);
  await rec.shot(page, "plan-observe", {
    targets: {
      lesson: d.lessonSelect,
      subject: d.subject,
      clock: d.clock,
      templates: page.getByRole("radiogroup", { name: "選一個計畫範本" }),
      observe: page.getByRole("radio", { name: /先看不做/ }),
      start: page.getByRole("button", { name: "用這個計畫開始" }),
      details: page.locator(".td-plan-details summary"),
      money: page.getByText("本課紙上資金為新臺幣 1,000 萬元"),
    },
  });
  await page.locator(".td-plan-details summary").click();
  await page.setViewportSize({ width: DESKTOP.width, height: 1500 });
  await settle(page, 500);
  await rec.shot(page, "plan-observe-details", {
    region: page.locator("section[aria-labelledby='morning-plan-title']"),
    pad: 4,
    targets: {
      focus: page.getByLabel("先關注哪一檔"),
      bias: page.getByRole("group", { name: "目前的觀察方向" }).or(page.locator("fieldset fieldset")).first(),
      reason: page.getByLabel(/我觀察的理由/),
      entry: page.getByLabel(/什麼條件出現，我才考慮操作/),
      stop: page.getByLabel(/什麼情況代表計畫失效/),
    },
  });
  await page.locator(".td-plan-details summary").click();
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await settle(page, 300);
  await page.getByRole("button", { name: "用這個計畫開始" }).click();
  await rec.expectVisible("開始後自動揭露 09:00 第一根 K", d.canvas, 20000);
  await rec.expectText("時鐘前進到 09:01", d.clock, "09:01");
  const coach = page.getByRole("dialog");
  await rec.expectVisible("第一次開始時出現新手教學", coach, 15000);
  for (let step = 1; step <= 3; step++) {
    await settle(page, 500);
    await rec.shot(page, `coach-${step}`, { targets: { dialog: page.locator(".td-coach-dialog"), ring: page.locator(".td-coach-ring").first() } });
    await coach.getByRole("button", { name: step === 3 ? "完成" : "下一步" }).click();
  }
  rec.check("新手教學三步後關閉", (await page.locator(".td-coach").count()) === 0);

  // 01-3 認識交易工作台
  await advanceTo(page, "09:03");
  await settle(page, 600);
  await rec.shot(page, "desk-tour", {
    meta: { lesson: "2026-10-06", exercise: "first-order" },
    targets: {
      bar: d.bar,
      lesson: d.lessonSelect,
      clock: d.clock,
      account: d.account,
      replay: d.replay,
      resources: d.resourcesButton,
      tip: d.tip,
      watch: d.watchList,
      hero: d.hero,
      chartBar: d.chartBar,
      chart: d.chart,
      quoteDetail: d.quoteDetail,
      ticket: d.ticket,
      ledger: d.ledger,
      planNote: d.planNote,
    },
  });
  // The same moment on a phone (read only): bottom tabs, and the 大字 mode.
  await phoneShots(browser, rec, context, "phone01", { senior: true });
  const r1 = await morningState(page);
  rec.fact("lessons", r1.lessons.map((lesson) => ({ id: lesson.lessonId, date: lesson.date, title: lesson.title })));
  rec.fact("symbols1006", r1.catalog.symbols.map(({ code, name, previousClose }) => ({ code, name, previousClose })));
  rec.fact("r1.plan", r1.state.plan);

  // 01-4 自選報價切換股票
  const hon = page.locator(".td-watch-item", { hasText: "鴻海" });
  await hon.click();
  await rec.expectText("點自選報價的鴻海，報價區換成鴻海", d.heroName, "鴻海");
  await rec.shot(page, "switch-watch", {
    targets: { hon, heroName: d.heroName, stepper: d.stepper, select: d.stockSelect, tsmc: page.locator(".td-watch-item", { hasText: "台積電" }) },
  });
  await d.nextStock.click();
  await rec.expectText("按「下一檔股票」換到聯發科", d.heroName, "聯發科");
  await rec.shot(page, "switch-stepper", {
    region: page.locator(".td-center"),
    targets: { prev: d.prevStock, next: d.nextStock, select: d.stockSelect, heroName: d.heroName },
  });
  await d.stockSelect.selectOption("2330");
  await rec.expectText("下拉選單選回台積電", d.heroName, "台積電");

  // 01-5 讀出最新報價
  await rec.shot(page, "quote-hero", {
    region: d.hero,
    pad: 6,
    targets: {
      name: d.heroName,
      stamp: d.heroStamp,
      price: d.heroPrice.locator("strong"),
      change: d.heroChange,
      book: d.heroBook,
    },
  });
  const r1b = await morningState(page);
  const tsmcBars = r1b.state.bars["2330"];
  rec.fact("quote0903", {
    clock: await clockText(page),
    lastBarStart: tsmcBars.at(-1).t,
    last: tsmcBars.at(-1).c,
    previousClose: r1b.catalog.symbols[0].previousClose,
    open: tsmcBars[0].o,
    high: Math.max(...tsmcBars.map((bar) => bar.h)),
    low: Math.min(...tsmcBars.map((bar) => bar.l)),
  });
  rec.fact("watch0903", Object.fromEntries(r1b.catalog.symbols.map((symbol) => [symbol.code, r1b.state.bars[symbol.code].at(-1).c])));
  return { context, page };
}

/* ───────────────────────── LEVEL 02 ───────────────────────── */
async function level02(page, rec) {
  rec.section("L02");
  const d = deskLocators(page);
  await advanceTo(page, "09:05");
  await settle(page, 500);
  const up = page.locator(".td-watch-item", { hasText: "鴻海" });
  const down = page.locator(".td-watch-item", { hasText: "聯發科" });
  rec.check("鴻海在昨收之上（紅色 ▲）", (await up.getAttribute("data-tone")) === "up");
  rec.check("聯發科在昨收之下（綠色 ▼）", (await down.getAttribute("data-tone")) === "down");
  await rec.shot(page, "updown", {
    targets: { up, down, heroChange: d.heroChange, chart: d.chart, watchFoot: page.locator(".td-watch-foot") },
  });
  // Open / high / low and the 行情 tab.
  await d.detailTabs.getByRole("button", { name: "行情" }).click();
  await settle(page, 300);
  await rec.shot(page, "ohl", {
    targets: {
      quoteTab: d.detailTabs.getByRole("button", { name: "行情" }),
      detail: page.locator(".terminal-detail-stats"),
      range: page.locator(".terminal-price-range"),
      stamp: page.locator(".terminal-detail-stamp"),
    },
  });
  // 分時 / K 線 and the confirmed swing high (09:07 on 10/06 for 台積電; the bar keeps only the latest alert).
  await advanceTo(page, "09:07");
  await rec.expectText("快訊：台積電 前高確認 2590", d.alert, "台積電 前高確認 2590");
  await d.modeChart.click();
  await settle(page, 600);
  await rec.shot(page, "kline", {
    targets: { modeNav: d.modeNav, modeChart: d.modeChart, chart: d.chart, alert: d.alert, source: d.source },
  });
  const canvas = d.canvas.first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.5);
  await settle(page, 500);
  await rec.shot(page, "kline-hover", { region: d.chart, targets: { chart: d.chart } });
  await page.mouse.move(box.x + box.width + 40, box.y - 40);
  await d.modeQuote.click();
  await settle(page, 600);
  rec.check("切到分時", (await d.modeQuote.getAttribute("aria-pressed")) === "true");
  await rec.shot(page, "fenshi", { targets: { modeQuote: d.modeQuote, chart: d.chart, source: d.source } });
  await d.modeChart.click();
  // 五檔
  await d.detailTabs.getByRole("button", { name: "五檔" }).click();
  await settle(page, 300);
  const ask1 = d.asks.locator(".td-level").last();
  const bid1 = d.bids.locator(".td-level").first();
  const ask1Price = Number((await ask1.locator(".td-level-price").textContent()).trim());
  const bid1Price = Number((await bid1.locator(".td-level-price").textContent()).trim());
  const midPrice = Number((await d.mid.locator("strong").textContent()).trim());
  rec.check("買1 等於最新分鐘收價", bid1Price === midPrice, `${bid1Price} vs ${midPrice}`);
  rec.check("賣1 比買1 高一檔", ask1Price > bid1Price, `${ask1Price} > ${bid1Price}`);
  rec.check("報價區的買價／賣價與五檔一致", (await d.heroBook.textContent()).includes(String(bid1Price)) && (await d.heroBook.textContent()).includes(String(ask1Price)));
  rec.fact("book0908", { ask1: ask1Price, bid1: bid1Price, mid: midPrice, clock: await clockText(page) });
  await rec.shot(page, "book", {
    region: d.trade,
    targets: { tag: d.bookTag, asks: d.asks, ask1, mid: d.mid, bid1, bids: d.bids, pressure: d.pressure, flash: d.flash, lots: d.lots, heroBook: d.heroBook },
  });
  await rec.shot(page, "book-hero", { targets: { heroBook: d.heroBook, ask1, bid1, tag: d.bookTag } });
  // 分鐘明細
  await d.detailTabs.getByRole("button", { name: "分鐘明細" }).click();
  await settle(page, 300);
  await rec.shot(page, "minutes", { region: d.quoteDetail, targets: { tab: d.detailTabs.getByRole("button", { name: "分鐘明細" }), table: page.locator(".terminal-minute-tape table") } });
  await d.detailTabs.getByRole("button", { name: "五檔" }).click();
  // 教材抽屜
  await d.resourcesButton.click();
  await rec.expectVisible("「教材」打開教材與資料", page.locator("#td-resources-title"));
  await page.locator("#td-resources summary", { hasText: "資料來源與本課使用說明" }).click();
  await settle(page, 300);
  await rec.shot(page, "resources", {
    region: d.resources,
    targets: { title: page.locator("#td-resources-title"), sources: page.locator("#td-resources summary", { hasText: "資料來源與本課使用說明" }) },
  });
  await page.locator("#td-resources summary", { hasText: "資料來源與本課使用說明" }).click();
  await page.locator("#td-resources").getByRole("button", { name: "關閉" }).click();
  // 保存第一輪復盤（第 1 輪：只看不做）
  await advanceTo(page, "09:10");
  await d.reviewButton.click();
  await rec.expectVisible("「復盤」打開復盤表單", d.review);
  await rec.shot(page, "review-r1", {
    region: d.review,
    targets: { summary: d.review.locator("p.rounded-xl").first(), questions: d.review.locator("div.rounded-xl.border").first(), text: d.review.locator("textarea"), save: page.getByRole("button", { name: "保存復盤，完成這一輪" }) },
  });
  await d.review.locator("textarea").fill("第一輪只看不做：台積電開在昨收 2575 附近，09:07 出現前高 2590。我會讀最新價、漲跌、五檔了，下一輪練習送出第一筆委託。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("保存後出現完成卡", d.completion, 20000);
  await rec.expectText("完成卡列出「寫下自己的計畫」與「完成這一輪復盤」", d.completion, /寫下自己的計畫.*完成這一輪復盤/);
  await rec.expectText("完成卡顯示練習分（當天第一輪）", d.completion, /這次拿到 \+\d+ 分/);
  await settle(page, 400);
  await completionShot(page, rec, "complete-r1", d, { restart: page.getByRole("button", { name: "寫新計畫，再練一輪" }) });
}

/** The completion card now carries the practice-points card and is taller than the window: shoot it in a tall viewport. */
async function completionShot(page, rec, id, d, targets) {
  await page.setViewportSize({ width: DESKTOP.width, height: 1700 });
  await settle(page, 500);
  await d.completion.scrollIntoViewIfNeeded().catch(() => {});
  await rec.shot(page, id, {
    region: d.completion,
    targets: { badges: d.completion.locator("ul").first(), points: d.completion.getByText(/這次拿到|今天的練習分已經算過了/).first(), ...targets },
  });
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await settle(page, 300);
}

/* ───────────────────────── LEVEL 03 ───────────────────────── */
async function level03(page, rec) {
  rec.section("L03");
  const d = deskLocators(page);
  await page.getByRole("button", { name: "寫新計畫，再練一輪" }).click();
  const pullback = page.getByRole("radio", { name: /回測平盤/ });
  await rec.expectVisible("再練一輪：作戰計畫重新打開", pullback, 15000);
  await pullback.click();
  await page.locator(".td-plan-details summary").click();
  await page.setViewportSize({ width: DESKTOP.width, height: 1500 });
  await settle(page, 500);
  rec.check("回測平盤 已選取", (await pullback.getAttribute("aria-checked")) === "true");
  rec.check("關注股票預設為 2330 台積電", (await page.getByLabel("先關注哪一檔").inputValue()) === "2330");
  await rec.shot(page, "plan-pullback", {
    region: page.locator("section[aria-labelledby='morning-plan-title']"),
    pad: 4,
    targets: {
      pullback,
      focus: page.getByLabel("先關注哪一檔"),
      bias: page.getByLabel("觀察偏多條件"),
      reason: page.getByLabel(/我觀察的理由/),
      entry: page.getByLabel(/什麼條件出現，我才考慮操作/),
      stop: page.getByLabel(/什麼情況代表計畫失效/),
      start: page.getByRole("button", { name: "用這個計畫開始" }),
    },
  });
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await settle(page, 300);
  await page.getByRole("button", { name: "用這個計畫開始" }).click();
  await rec.expectText("第二輪開始，時鐘回到 09:01", d.clock, "09:01", 20000);
  rec.check("新手教學不會再出現", (await page.locator(".td-coach").count()) === 0);
  await advanceTo(page, "09:16");
  await settle(page, 500);
  await rec.shot(page, "wait-0916", {
    targets: { heroPrice: d.heroPrice, chart: d.chart, planNote: d.planNote, tip: d.tip },
  });
  await advanceTo(page, "09:20");
  await rec.expectText("09:20 快訊：台積電 站上昨收 2575", d.alert, "站上昨收");
  await settle(page, 500);
  await rec.shot(page, "signal-0920", { targets: { alert: d.alert, chart: d.chart, heroPrice: d.heroPrice, planNote: d.planNote } });
  // 03-3 下單票
  const buy = d.sideSwitch.getByRole("button", { name: "買進" });
  rec.check("下單方向預設「買進」", (await buy.getAttribute("aria-pressed")) === "true");
  rec.check("價格類型預設「市價」", (await d.orderType.getByRole("button", { name: "市價" }).getAttribute("aria-pressed")) === "true");
  const factsText = (await d.facts.textContent()).replace(/\s+/g, "");
  rec.check("參考金額 = 最新收價 × 1,000 股", factsText.includes("2,575,000") || factsText.includes("2,580,000"), factsText.slice(0, 80));
  await rec.shot(page, "ticket-market", {
    region: d.ticket,
    targets: {
      side: d.sideSwitch,
      type: d.orderType,
      typeHint: page.locator(".sim-execution strong"),
      qty: d.stepperQty,
      amount: d.facts.locator("div").nth(0),
      cost: d.facts.locator("div").nth(1),
      cash: d.facts.locator("div").nth(2),
      submit: d.submit,
      help: d.help.locator("summary"),
    },
  });
  await d.orderType.getByRole("button", { name: "限價" }).click();
  await settle(page, 300);
  await rec.shot(page, "ticket-limit", {
    region: d.ticket,
    targets: {
      type: d.orderType,
      field: d.limitField,
      down: page.getByRole("button", { name: "降低一檔價格" }),
      up: page.getByRole("button", { name: "提高一檔價格" }),
      typeHint: page.locator(".sim-execution strong"),
    },
  });
  await d.orderType.getByRole("button", { name: "市價" }).click();
  await d.help.locator("summary").click();
  await settle(page, 300);
  await rec.shot(page, "ticket-help", { region: d.help, pad: 4, targets: { help: d.help } });
  await d.help.locator("summary").click();
  // 03-4 核對並送出
  await d.submit.click();
  await rec.expectVisible("按「核對模擬買進」出現確認卡", page.locator("#sim-confirm-title"));
  await rec.expectText("確認卡寫明 1,000 股", d.confirm, "1,000 股");
  await rec.expectText("確認卡寫明市價模擬", d.confirm, "市價模擬");
  await rec.shot(page, "confirm-buy", {
    region: d.ticket,
    targets: {
      title: page.locator("#sim-confirm-title"),
      symbol: page.locator(".sim-confirm-symbol"),
      main: page.locator(".sim-confirm-main"),
      facts: d.confirm.locator("dl.sim-order-facts"),
      help: d.confirm.locator(".sim-help"),
      send: page.getByRole("button", { name: "確認送出模擬買進" }),
      back: page.getByRole("button", { name: "返回修改" }),
    },
  });
  const before = await morningState(page);
  rec.fact("r2.orderCursor", before.state.cursor);
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await rec.expectVisible("送出後顯示「委託已送出 · 等待撮合」", page.getByText("委託已送出 · 等待撮合"));
  await rec.expectText("提示列：尚未代表成交", d.feedback, "尚未代表成交");
  await rec.shot(page, "pending-buy", {
    targets: {
      pending: d.pending,
      advance: page.getByRole("button", { name: "前進一分鐘撮合" }),
      cancel: d.pending.getByRole("button", { name: "撤回委託" }),
      feedback: d.feedback,
      ledgerTabs: d.ledgerTabs,
    },
  });
  await ledgerTab(page, "委託");
  await rec.expectText("委託分頁狀態「待撮合」", d.ledgerContent, "待撮合");
  await rec.shot(page, "orders-pending", {
    targets: { tabs: d.ledgerTabs, content: d.ledgerContent, status: d.ledgerContent.locator(".sim-status").first(), pending: d.pending },
  });
  const pending = await morningState(page);
  rec.check("伺服器紀錄：一筆待撮合的市價買進", pending.state.orders.at(-1)?.status === "pending" && pending.state.fills.length === 0);
}

/* ───────────────────────── LEVEL 04 ───────────────────────── */
async function level04(page, rec, browser, context) {
  rec.section("L04");
  const d = deskLocators(page);
  // 04-1 前進一分鐘撮合
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await rec.expectText("前進後委託狀態變成「已成交」", d.ledgerContent, "已成交");
  await rec.expectText("快訊：你的委託成交", d.alert, "你的委託成交");
  const filled = await morningState(page);
  const buyFill = filled.state.fills.at(-1);
  rec.fact("r2.buyFill", buyFill);
  rec.fact("r2.afterBuy", { cursor: filled.state.cursor, cash: filled.state.cash, equity: filled.state.equity, positions: filled.state.positions, last: filled.state.bars["2330"].at(-1).c });
  await settle(page, 400);
  await rec.shot(page, "filled-buy", {
    targets: { alert: d.alert, feedback: d.feedback, status: d.ledgerContent.locator(".sim-status").first(), content: d.ledgerContent, account: d.account, chart: d.chart },
  });
  // 04-2 成交與庫存
  await ledgerTab(page, "成交");
  await rec.expectText("成交分頁列出手續費", d.ledgerContent, String(buyFill.fee.toLocaleString("en-US")));
  await rec.shot(page, "fills-buy", { region: d.ledger, targets: { tabs: d.ledgerTabs, content: d.ledgerContent } });
  await ledgerTab(page, "庫存");
  await rec.expectText("庫存分頁：持有 1 張", d.ledgerContent, "1 張");
  await rec.shot(page, "positions-1", {
    targets: { tabs: d.ledgerTabs, content: d.ledgerContent, account: d.account, meta: page.locator(".td-ledger-meta") },
  });
  // Phone views of the same account (read only): a held position.
  await phoneShots(browser, rec, context, "phone");
  // 04-3 限價留單與撤回. First what the workbook now explains about the lot buttons when selling:
  // set 2 lots while buying, switch to 賣出 → the ticket drops to the 1 lot held and 「增加一張」 greys out.
  const more = page.getByRole("button", { name: "增加一張" });
  const lotsValue = page.locator("#sim-lots-value");
  await more.click();
  rec.check("04-3：買進時可以設成 2 張", ((await lotsValue.textContent()) ?? "").trim().startsWith("2"), (await lotsValue.textContent()) ?? "");
  await d.sideSwitch.getByRole("button", { name: "賣出" }).click();
  await settle(page, 200);
  rec.check("04-3：切到「賣出」後，張數自動變成可賣出庫存 1 張", ((await lotsValue.textContent()) ?? "").trim().startsWith("1"), (await lotsValue.textContent()) ?? "");
  rec.check("04-3：賣出時「增加一張」是灰色（不能超過庫存）", await more.isDisabled());
  rec.check("04-3：張數等於庫存時沒有「賣出張數超過庫存」訊息", (await page.getByText("賣出張數超過庫存，請減少張數。").count()) === 0);
  await d.orderType.getByRole("button", { name: "限價" }).click();
  const limitInput = page.locator("#morning-limit-price");
  await limitInput.fill("2595");
  await settle(page, 300);
  rec.check("限價欄位填入 2595", (await limitInput.inputValue()) === "2595");
  await rec.shot(page, "sell-limit-form", {
    region: d.ticket,
    targets: { side: d.sideSwitch, type: d.orderType, field: d.limitField, qty: d.stepperQty, holding: d.facts.locator("div").nth(2), submit: d.submit },
  });
  await d.submit.click();
  await rec.expectText("確認卡：限價 2595", d.confirm, "限價 2595");
  await rec.shot(page, "confirm-sell-limit", { region: d.ticket, targets: { main: page.locator(".sim-confirm-main"), facts: d.confirm.locator("dl.sim-order-facts"), help: d.confirm.locator(".sim-help"), send: page.getByRole("button", { name: "確認送出模擬賣出" }) } });
  await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
  await rec.expectText("限價賣出留單等待", d.pending, "限價 2595");
  await rec.shot(page, "pending-sell-limit", { region: d.ticket, targets: { pending: d.pending, cancel: d.pending.getByRole("button", { name: "撤回委託" }), help: d.pending.locator("small") } });
  await d.pending.getByRole("button", { name: "撤回委託" }).click();
  await rec.expectText("提示列：已更新撤單結果", d.feedback, "撤單");
  await ledgerTab(page, "委託");
  await rec.expectText("委託分頁顯示「已撤回」", d.ledgerContent, "已撤回");
  await rec.expectText("撤回原因：由學員取消", d.ledgerContent, "由學員取消");
  await rec.shot(page, "cancelled", { region: d.ledger, targets: { content: d.ledgerContent, cancelled: d.ledgerContent.locator(".sim-status", { hasText: "已撤回" }), reason: d.ledgerContent.locator(".sim-record-reason").first() } });
  // 04-4 依計畫賣出（失效條件：跌破昨收）
  await advanceTo(page, "09:37");
  await rec.expectText("09:37 快訊：台積電 跌破昨收 2575", d.alert, "跌破昨收");
  await settle(page, 400);
  await rec.shot(page, "stop-0937", { targets: { alert: d.alert, chart: d.chart, heroPrice: d.heroPrice, positions: d.ledgerTabs } });
  await d.sideSwitch.getByRole("button", { name: "賣出" }).click();
  await d.orderType.getByRole("button", { name: "市價" }).click();
  await d.submit.click();
  await rec.expectText("確認卡：賣出 1 張、市價模擬", d.confirm, "市價模擬");
  await rec.shot(page, "confirm-sell", { region: d.ticket, targets: { main: page.locator(".sim-confirm-main"), facts: d.confirm.locator("dl.sim-order-facts"), send: page.getByRole("button", { name: "確認送出模擬賣出" }) } });
  await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await rec.expectText("賣出成交快訊", d.alert, "賣出");
  await ledgerTab(page, "成交");
  const sold = await morningState(page);
  rec.fact("r2.sellFill", sold.state.fills.at(-1));
  rec.fact("r2.afterSell", { cursor: sold.state.cursor, cash: sold.state.cash, equity: sold.state.equity, pnl: Math.round((sold.state.equity - sold.state.startingCash) * 100) / 100, positions: sold.state.positions });
  rec.check("賣出後庫存為 0", sold.state.positions.length === 0);
  await settle(page, 400);
  await rec.shot(page, "sold", { targets: { content: d.ledgerContent, account: d.account, alert: d.alert, tabs: d.ledgerTabs } });
  await ledgerTab(page, "庫存");
  await rec.expectText("庫存分頁：目前沒有庫存", d.ledgerContent, "目前沒有庫存");
  // 04-6 10:00 回看計畫並保存
  await advanceTo(page, "10:00");
  await rec.expectVisible("10:00 停下來回看計畫", page.getByRole("heading", { name: "10:00，回看自己的計畫" }));
  await rec.shot(page, "checkpoint-1000", { targets: { banner: page.locator(".td-banner", { hasText: "10:00，回看自己的計畫" }), write: page.getByRole("button", { name: "現在寫復盤" }), extend: page.getByRole("button", { name: "延伸觀察至 10:30" }) } });
  const atTen = await morningState(page);
  rec.fact("r2.at1000", { equity: atTen.state.equity, pnl: Math.round((atTen.state.equity - atTen.state.startingCash) * 100) / 100, orders: atTen.state.orders.map((o) => ({ side: o.side, status: o.status, limit: o.limitPrice ?? null, price: o.price ?? null, reason: o.reason ?? null, at: o.submittedCursor })) });
  await page.getByRole("button", { name: "現在寫復盤" }).click();
  await rec.expectText("復盤表單顯示第 1 課的復盤問題", d.review, "送單前，哪些已完成的 K 線支持這次決定");
  await d.review.locator("textarea").fill("09:20 看到「站上昨收」才送出市價買進 1 張，以 09:20 這一分鐘的開盤價 2575 成交；09:37 跌破昨收，依計畫賣出，以 2570 成交。價差 −5,000 元，加上手續費與交易稅，本輪 −13,254 元。下次先算好費稅門檻再進場。");
  await rec.shot(page, "review-r2", { region: d.review, targets: { summary: d.review.locator("p.rounded-xl").first(), questions: d.review.locator("div.rounded-xl.border").first(), text: d.review.locator("textarea"), save: page.getByRole("button", { name: "保存復盤，完成這一輪" }) } });
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("第二輪保存完成", d.completion, 20000);
  await settle(page, 400);
  await completionShot(page, rec, "complete-r2", d, { restart: page.getByRole("button", { name: "寫新計畫，再練一輪" }) });
}

async function phoneShots(browser, rec, desktopContext, prefix, { senior: withSenior = false } = {}) {
  const state = await desktopContext.storageState();
  const context = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height },
    deviceScaleFactor: PHONE.dpr,
    isMobile: true,
    hasTouch: true,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    storageState: state,
  });
  const page = await context.newPage();
  await page.goto(new URL("/morning?panel=trade", desktopContext.pages()[0].url()).href, { waitUntil: "domcontentloaded" });
  const dock = page.locator('nav[aria-label="主要分頁"]');
  await rec.expectVisible(`${prefix}：手機版底部有四個分頁`, dock, 20000);
  for (const [label, id] of [["行情", "market"], ["自選", "watch"], ["下單", "trade"], ["庫存", "positions"]]) {
    await dock.getByRole("button", { name: new RegExp(label) }).click();
    await page.waitForTimeout(700);
    await rec.shot(page, `${prefix}-${id}`, { targets: { dock, tab: dock.getByRole("button", { name: new RegExp(label) }) } });
  }
  // The order ticket sits under the order book on a phone: scroll to it.
  await dock.getByRole("button", { name: /下單/ }).click();
  await page.waitForTimeout(500);
  await page.locator("section.sim-ticket").evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await rec.shot(page, `${prefix}-ticket`, {
    targets: { dock, ticket: page.locator("section.sim-ticket"), submit: page.locator("button.sim-submit").or(page.locator(".sim-pending")).first() },
  });
  await context.close();
  if (!withSenior) return;
  // Large text on a phone (the classroom's 大字 mode).
  const senior = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height },
    deviceScaleFactor: PHONE.dpr,
    isMobile: true,
    hasTouch: true,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    storageState: state,
  });
  await senior.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const big = await senior.newPage();
  await big.goto(new URL("/morning?panel=trade", desktopContext.pages()[0].url()).href, { waitUntil: "domcontentloaded" });
  await big.locator('nav[aria-label="主要分頁"]').waitFor({ timeout: 20000 });
  await big.locator('nav[aria-label="主要分頁"]').getByRole("button", { name: /行情/ }).click();
  await big.waitForTimeout(800);
  await rec.shot(big, `${prefix}-senior`, { targets: { size: big.getByRole("radiogroup", { name: "文字大小" }).first() } });
  await senior.close();
}

/* ───────────────────────── LEVEL 05 ───────────────────────── */
async function startThemeRound(page, rec, appBase, exerciseId, label) {
  // From the lobby card of the theme: the finished round shows first, then a new plan.
  await page.goto(`${appBase}/morning?exercise=${exerciseId}&panel=trade`, { waitUntil: "domcontentloaded" });
  const restart = page.getByRole("button", { name: "寫新計畫，再練一輪" });
  await rec.expectVisible(`${label}：先看到上一輪的完成卡`, restart, 20000);
  await restart.click();
  await rec.expectVisible(`${label}：新的作戰計畫表單`, page.getByRole("radio", { name: /自己寫/ }), 15000);
}

async function fillCustomPlan(page, { focus, bias, reason, entry, stop }) {
  await page.getByRole("radio", { name: /自己寫/ }).click();
  await page.waitForTimeout(200);
  if (focus) await page.getByLabel("先關注哪一檔").selectOption(focus);
  if (bias) await page.getByLabel(bias).check();
  await page.getByLabel(/我觀察的理由/).fill(reason);
  await page.getByLabel(/什麼條件出現，我才考慮操作/).fill(entry);
  await page.getByLabel(/什麼情況代表計畫失效/).fill(stop);
}

async function level05(page, rec, appBase) {
  const d = deskLocators(page);
  // 05-1 第 2 課：先算風險，再決定張數（範例：鴻海，10/06）
  rec.section("L05-1");
  await startThemeRound(page, rec, appBase, "position", "第 2 課");
  await rec.expectText("狀態列顯示第 2 課", d.subject, "核對部位與風險");
  await fillCustomPlan(page, {
    focus: "2317",
    bias: "觀察偏多條件",
    reason: "鴻海開高後回落。練習先算可承受的模擬損失，再決定張數。",
    entry: "收價重新站上 262 才買進；本輪可承受模擬損失 5,000 元，最多 2 張。",
    stop: "收價跌破 260.5 就全部賣出；10:00 前一定處理完部位。",
  });
  await page.setViewportSize({ width: DESKTOP.width, height: 1500 });
  await settle(page, 500);
  await rec.shot(page, "plan-risk", {
    region: page.locator("section[aria-labelledby='morning-plan-title']"),
    pad: 4,
    targets: {
      custom: page.getByRole("radio", { name: /自己寫/ }),
      focus: page.getByLabel("先關注哪一檔"),
      entry: page.getByLabel(/什麼條件出現，我才考慮操作/),
      stop: page.getByLabel(/什麼情況代表計畫失效/),
      start: page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }),
    },
  });
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await settle(page, 300);
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await rec.expectText("第 2 課開始", d.clock, "09:01", 20000);
  await rec.expectText("教學提示換成第 2 課原則", d.tip, "核對現有部位");
  await advanceTo(page, "09:04");
  await rec.expectText("報價區已切到計畫關注的鴻海", d.heroName, "鴻海");
  await d.stepperQty.getByRole("button", { name: "增加一張" }).click();
  await settle(page, 300);
  await rec.shot(page, "ticket-2lots", {
    region: d.ticket,
    targets: { qty: d.stepperQty, amount: d.facts.locator("div").nth(0), cost: d.facts.locator("div").nth(1), cash: d.facts.locator("div").nth(2), submit: d.submit },
  });
  const ticketFacts = (await d.facts.textContent()).replace(/\s+/g, " ").trim();
  rec.fact("r3.ticket2lots", ticketFacts);
  await d.submit.click();
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await ledgerTab(page, "庫存");
  await rec.expectText("庫存：鴻海 2 張", d.ledgerContent, "2 張");
  await rec.shot(page, "positions-2", { region: d.ledger, targets: { content: d.ledgerContent, tabs: d.ledgerTabs } });
  const r3buy = await morningState(page);
  rec.fact("r3.buyFill", r3buy.state.fills.at(-1));
  // Stop: first close below 260.5.
  let guard = 0;
  for (;;) {
    const s = await morningState(page);
    const last = s.state.bars["2317"].at(-1).c;
    if (last < 260.5 || guard++ > 40) break;
    await advanceTo(page, nextMinute(await clockText(page)));
  }
  rec.fact("r3.stopClock", await clockText(page));
  await d.sideSwitch.getByRole("button", { name: "賣出" }).click();
  await settle(page, 200);
  const lotsNow = Number((await page.locator("#sim-lots-value").textContent()).replace(/\D/g, ""));
  if (lotsNow < 2) await d.stepperQty.getByRole("button", { name: "增加一張" }).click();
  await d.submit.click();
  await rec.shot(page, "confirm-sell-2", { region: d.ticket, targets: { main: page.locator(".sim-confirm-main"), facts: d.confirm.locator("dl.sim-order-facts"), send: page.getByRole("button", { name: "確認送出模擬賣出" }) } });
  await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await ledgerTab(page, "成交");
  const r3sell = await morningState(page);
  rec.fact("r3.sellFill", r3sell.state.fills.at(-1));
  rec.fact("r3.pnl", Math.round((r3sell.state.equity - r3sell.state.startingCash) * 100) / 100);
  rec.check("第 2 課範例：停損後庫存為 0", r3sell.state.positions.length === 0);
  await rec.shot(page, "fills-r3", { region: d.ledger, targets: { content: d.ledgerContent } });
  await d.reviewButton.click();
  await rec.expectText("第 2 課復盤問題", d.review, "實際張數是否符合原先計畫");
  await d.review.locator("textarea").fill("計畫最多 2 張，實際 2 張；跌破 260.5 依計畫全部賣出，沒有未確認的委託。下次先核對每張的費稅再決定張數。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("第 2 課保存完成", d.completion, 20000);

  // 05-2 第 3 課：按條件處理出場（範例：台達電 10/06，條件沒有成立就不進場）
  rec.section("L05-2");
  await startThemeRound(page, rec, appBase, "exit", "第 3 課");
  await fillCustomPlan(page, {
    focus: "2308",
    bias: "觀察偏多條件",
    reason: "台達電開高。練習在進場前就寫好出場條件。",
    entry: "09:01 之後，收價重新站上 2100 才買進 1 張。",
    stop: "持有時收價跌破 2060 就賣出；10:00 前沒有進場就不交易。",
  });
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await rec.expectText("第 3 課開始", d.clock, "09:01", 20000);
  await rec.expectText("教學提示換成第 3 課原則", d.tip, "出場條件成立");
  await advanceTo(page, "09:12");
  await d.resourcesButton.click();
  await page.locator("#td-resources summary", { hasText: "本輪作戰計畫" }).click();
  await settle(page, 300);
  await rec.shot(page, "saved-plan", { region: d.resources, targets: { saved: page.locator("#td-resources section", { hasText: "回到開始前寫的計畫" }) } });
  await page.locator("#td-resources").getByRole("button", { name: "關閉" }).click();
  await rec.shot(page, "exit-watch", { targets: { heroPrice: d.heroPrice, chart: d.chart, tip: d.tip, planNote: d.planNote } });
  await advanceTo(page, "10:00");
  await page.getByRole("button", { name: "現在寫復盤" }).click();
  await rec.expectText("第 3 課復盤問題", d.review, "出場決定是否依據事先寫下的條件");
  await d.review.locator("textarea").fill("09:01 後台達電收價都沒有站回 2100，進場條件沒有成立，所以沒有部位、也不需要出場。結束時沒有部位與未成交委託。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("第 3 課保存完成", d.completion, 20000);
  const r4 = await morningState(page);
  rec.fact("r4.summary", { orders: r4.state.orders.length, fills: r4.state.fills.length, cursor: r4.state.cursor });

  // 05-3 第 4 課：觀察 N 字與突破（範例：廣達 10/06，前高與回檔）
  rec.section("L05-3");
  await startThemeRound(page, rec, appBase, "n-breakout", "第 4 課");
  await fillCustomPlan(page, {
    focus: "2382",
    bias: "先觀察／不確定",
    reason: "練習只用已完成的 K 線找前高、回檔與再突破。",
    entry: "出現前高、回檔後，收價再站上前高才考慮買進 1 張。",
    stop: "形態沒完成就只觀察；持有時跌破回檔低點就賣出。",
  });
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await rec.expectText("第 4 課開始", d.clock, "09:01", 20000);
  await rec.expectText("教學提示換成第 4 課原則", d.tip, "前高");
  await advanceTo(page, "09:14");
  await rec.expectText("09:14 快訊：廣達 前高確認", d.alert, "廣達 前高確認");
  await d.modeChart.click();
  await settle(page, 600);
  await rec.shot(page, "n-swing", { targets: { alert: d.alert, chart: d.chart, heroName: d.heroName, modeChart: d.modeChart } });
  await advanceTo(page, "09:30");
  await settle(page, 400);
  await rec.shot(page, "n-pullback", { targets: { chart: d.chart, heroPrice: d.heroPrice } });
  await advanceTo(page, "10:00");
  await page.getByRole("button", { name: "現在寫復盤" }).click();
  await d.review.locator("textarea").fill("09:14 廣達確認前高 336，之後回檔到 333 附近，10:00 前收價沒有再站上前高，N 字沒有完成，所以只觀察不進場。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("第 4 課保存完成", d.completion, 20000);

  // 05-4 第 5 課：練習等待與不交易（範例：先看不做，延伸到 10:30）
  rec.section("L05-4");
  await startThemeRound(page, rec, appBase, "patience", "第 5 課");
  await fillCustomPlan(page, {
    focus: "2330",
    bias: "先觀察／不確定",
    reason: "練習等待：條件沒出現就記錄等待的理由。",
    entry: "收價站上 2590（前高）才考慮買進 1 張；沒站上就等待。",
    stop: "沒有部位時，等待到 10:30 結束；持有時跌破 2575 就賣出。",
  });
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await rec.expectText("第 5 課開始", d.clock, "09:01", 20000);
  await rec.expectText("教學提示換成第 5 課原則", d.tip, "等待");
  await advanceTo(page, "10:00");
  await page.getByRole("button", { name: "延伸觀察至 10:30" }).click();
  await advanceTo(page, "10:30");
  await rec.expectText("10:30 已到教材結尾", d.banner.last(), "本課沒有下一分鐘");
  await rec.shot(page, "end-1030", { targets: { banner: d.banner.last(), clock: d.clock, review: d.reviewButton } });
  await d.reviewButton.click();
  await rec.expectText("第 5 課復盤問題", d.review, "哪些時刻選擇等待");
  await d.review.locator("textarea").fill("09:07 前高 2590 確認後，收價都在 2565–2585 之間，沒有站上 2590，所以整段等待、沒有交易。09:20 看到站上昨收的快訊時有點想買，但不是我的條件。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("第 5 課保存完成", d.completion, 20000);
  await rec.expectText("完成卡：整輪等待也列出「照計畫的股票操作」「收盤前不留倉」", d.completion, /照計畫的股票操作.*收盤前不留倉/);
  await rec.expectText("同一天再練：練習分只算最好的一輪", d.completion, "同一天的練習分只算最好的一輪");
  await settle(page, 400);
  await completionShot(page, rec, "complete-wait", d, {});
}

function nextMinute(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + 1;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* ───────────────────────── LEVEL 06 ───────────────────────── */
async function level06(page, rec, appBase) {
  rec.section("L06");
  const d = deskLocators(page);
  await startThemeRound(page, rec, appBase, "review", "第 6 課");
  await fillCustomPlan(page, {
    focus: "2330",
    bias: "觀察偏多條件",
    reason: "這輪要檢查的習慣：送單前先寫下時間與理由。",
    entry: "收價回到 2575 不跌破，再出現站上昨收時買進 1 張。",
    stop: "收價跌破 2575 就賣出；10:00 前處理完部位。",
  });
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await rec.expectText("第 6 課開始", d.clock, "09:01", 20000);
  await rec.expectText("教學提示換成第 6 課原則", d.tip, "對照自己的選擇");
  await advanceTo(page, "09:20");
  await d.submit.click();
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await advanceTo(page, "09:37");
  await d.sideSwitch.getByRole("button", { name: "賣出" }).click();
  await d.orderType.getByRole("button", { name: "市價" }).click();
  await d.submit.click();
  await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  await advanceTo(page, "10:00");
  // 對照四份紀錄
  await d.resourcesButton.click();
  await page.locator("#td-resources summary", { hasText: "本輪作戰計畫" }).click();
  await settle(page, 300);
  await rec.shot(page, "review-plan", { region: d.resources, targets: { saved: page.locator("#td-resources section", { hasText: "回到開始前寫的計畫" }) } });
  await page.locator("#td-resources").getByRole("button", { name: "關閉" }).click();
  for (const [label, id] of [["委託", "review-orders"], ["成交", "review-fills"], ["庫存", "review-positions"]]) {
    await ledgerTab(page, label);
    await rec.shot(page, id, { region: d.ledger, targets: { content: d.ledgerContent, tabs: d.ledgerTabs, meta: page.locator(".td-ledger-meta") } });
  }
  const r7 = await morningState(page);
  rec.fact("r7", { fills: r7.state.fills, pnl: Math.round((r7.state.equity - r7.state.startingCash) * 100) / 100, orders: r7.state.orders.map((o) => ({ side: o.side, status: o.status, at: o.submittedCursor, price: o.price ?? null })) });
  await page.getByRole("button", { name: "現在寫復盤" }).click();
  await rec.expectText("第 6 課復盤問題", d.review, "哪個決定符合原計畫");
  await d.review.locator("textarea").fill("計畫：回到昨收不破、站上昨收再買。09:20 依條件買進 1 張（2575），09:37 跌破昨收依計畫賣出（2570）。價差 −5,000、費稅 8,254，共 −13,254。失誤：進場前沒算費稅門檻。下次只改一件事：送單前先寫下『至少要漲幾檔才打平』。");
  await rec.shot(page, "review-r7", { region: d.review, targets: { summary: d.review.locator("p.rounded-xl").first(), questions: d.review.locator("div.rounded-xl.border").first(), text: d.review.locator("textarea"), save: page.getByRole("button", { name: "保存復盤，完成這一輪" }) } });
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("第 6 課保存完成", d.completion, 20000);
  await settle(page, 400);
  await completionShot(page, rec, "complete-r7", d, { reflection: d.completion.locator("p.whitespace-pre-wrap") });
}

/* ───────────────────────── FINAL MISSION（驗證用，不放入學員版答案） ───────────────────────── */
async function finalMission(page, rec, appBase) {
  rec.section("FINAL");
  const d = deskLocators(page);
  // A student who follows the workbook literally has already practised 10/05 (task 05-2 uses it; the
  // example rounds above run on 10/06). Recreate that: the first visit to 10/05 opens a plan directly,
  // and that finished round is what the final mission's day switch shows first.
  await page.goto(`${appBase}/morning?exercise=position&panel=trade`, { waitUntil: "domcontentloaded" });
  await d.lessonSelect.waitFor({ timeout: 20000 });
  const options = await d.lessonSelect.locator("option").allTextContents();
  rec.check("交易日可選 2026-10-05 與 2026-10-06", options.some((o) => o.includes("2026-10-05")) && options.some((o) => o.includes("2026-10-06")), options.join(" / "));
  const value = await d.lessonSelect.locator("option", { hasText: "2026-10-05" }).getAttribute("value");
  await d.lessonSelect.selectOption(value);
  await rec.expectVisible("05-2：第一次換到 10/05，作戰計畫直接打開", page.getByRole("radio", { name: /自己寫/ }), 20000);
  await rec.expectText("05-2：狀態列顯示第 2 課", d.subject, "核對部位與風險");
  await page.getByRole("radio", { name: /先看不做/ }).click();
  await page.getByRole("button", { name: "用這個計畫開始" }).click();
  await rec.expectText("10/05 的第 2 課一輪開始", d.clock, "09:01", 20000);
  const coachDialog = page.getByRole("dialog");
  if (await coachDialog.isVisible().catch(() => false)) await coachDialog.getByRole("button", { name: "跳過" }).click().catch(() => {});
  await d.reviewButton.click();
  await d.review.locator("textarea").fill("先看不做：只確認 10/05 的開盤，沒有送單。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("10/05 的第 2 課一輪保存完成", d.completion, 20000);

  // The final mission from the 第 6 課 card, switching 交易日 to 2026-10-05 as the workbook says.
  await page.goto(`${appBase}/morning?exercise=review&panel=trade`, { waitUntil: "domcontentloaded" });
  await d.lessonSelect.waitFor({ timeout: 20000 });
  await d.lessonSelect.selectOption(value);
  const restart = page.getByRole("button", { name: "寫新計畫，再練一輪" });
  await rec.expectVisible("F-1：換到已練過的 10/05，先出現那一天上一輪的完成卡", restart, 20000);
  await rec.expectText("F-1：這時狀態列是別的課（第 2 課）", d.subject, "核對部位與風險");
  rec.check("F-1：這時還沒有作戰計畫表單", (await page.getByRole("radio", { name: /自己寫/ }).count()) === 0);
  await restart.scrollIntoViewIfNeeded();
  await restart.click();
  await rec.expectVisible("F-1：按「寫新計畫，再練一輪」後出現作戰計畫", page.getByRole("radio", { name: /自己寫/ }), 15000);
  await rec.expectText("F-1：狀態列回到第 6 課", d.subject, "用紀錄完成復盤");
  await rec.expectText("交易日已換成 2026-10-05", d.lessonSelect.locator("option:checked"), "2026-10-05");
  await rec.shot(page, "final-day", { targets: { lesson: d.lessonSelect, subject: d.subject } });
  await fillCustomPlan(page, {
    focus: "2317",
    bias: "觀察偏多條件",
    reason: "期末挑戰：鴻海開在昨收之上，練習完整執行自己的規則。",
    entry: "收價站穩 255（連續兩分鐘不低於 255）才買進 1 張；可承受模擬損失 3,000 元。",
    stop: "收價跌破 254 就賣出；10:00 前一定處理完部位。",
  });
  await page.getByRole("button", { name: "保存計畫，進入 09:00 練習" }).click();
  await rec.expectText("期末挑戰開始", d.clock, "09:01", 20000);
  await advanceTo(page, "09:03");
  await d.submit.click();
  await page.getByRole("button", { name: "確認送出模擬買進" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  let guard = 0;
  for (;;) {
    const s = await morningState(page, value);
    const last = s.state.bars["2317"].at(-1).c;
    if (last < 254 || (await clockText(page)) >= "09:59" || guard++ > 60) break;
    await advanceTo(page, nextMinute(await clockText(page)));
  }
  rec.fact("final.exitClock", await clockText(page));
  await d.sideSwitch.getByRole("button", { name: "賣出" }).click();
  await d.orderType.getByRole("button", { name: "市價" }).click();
  await d.submit.click();
  await page.getByRole("button", { name: "確認送出模擬賣出" }).click();
  await page.getByRole("button", { name: "前進一分鐘撮合" }).click();
  const fin = await morningState(page, value);
  rec.fact("final", { fills: fin.state.fills, pnl: Math.round((fin.state.equity - fin.state.startingCash) * 100) / 100, positions: fin.state.positions });
  rec.check("期末範例：結束前庫存為 0", fin.state.positions.length === 0);
  await advanceTo(page, "10:00");
  await page.getByRole("button", { name: "現在寫復盤" }).click();
  await d.review.locator("textarea").fill("期末挑戰範例：依計畫進場與出場，結束時沒有部位，費稅已核對。");
  await page.getByRole("button", { name: "保存復盤，完成這一輪" }).click();
  await rec.expectVisible("期末挑戰保存完成", d.completion, 20000);
  await settle(page, 400);
  await completionShot(page, rec, "complete-final", d, {});
  // Lobby after a finished day: 今天三件事 all done.
  await page.goto(appBase + "/", { waitUntil: "domcontentloaded" });
  await rec.expectVisible("大廳：今天完成了", page.getByText("今天完成了，明天再來"), 20000);
  await settle(page, 800);
  await rec.shot(page, "lobby-done", { targets: { today: page.locator("section.today-card"), again: page.getByRole("link", { name: "再練一輪" }) } });
}
