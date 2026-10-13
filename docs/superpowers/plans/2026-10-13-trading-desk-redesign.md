# 交易畫面改版（子專案 1：版面與質感）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/morning?panel=trade` 交易畫面改成參考盤等級的專業看盤介面：滿版三欄、大走勢圖、直式五檔、緊湊下單區、頂部狀態列與提示列，並只使用真實或可推導的資料。

**Architecture:** 新增單一樣式檔 `src/trading-desk.css`，以根節點 `.trading-desk` 限定範圍並集中定義顏色變數；刪除五個只服務交易畫面的舊樣式檔，並裁掉 `classroom-refresh.css` 中屬於交易畫面的區段。版面骨架由 `morning-practice.tsx` 重新組合；新的頂部狀態列與提示列放在 `morning-desk-bar.tsx`；可測試的邏輯一律寫成 `src/lib/` 下的純函式並先寫測試。撮合規則、伺服器 API 與資料完全不動。

**Tech Stack:** React 19、TanStack Start/Router、Tailwind CSS v4（`@theme` 變數）、純 CSS、Canvas 2D（`TapeChart`）、Node `node:test`（`--experimental-strip-types`）、Playwright（視覺驗收）。

**Spec:** `docs/superpowers/specs/2026-10-13-trading-terminal-redesign-design.md`

## Global Constraints

- **資料原則**：只用真實與可推導的資料。不生成逐筆、不畫江波逐筆線、不顯示成交量或均價（分鐘量單位未核對）。
- **下單規則不變**：點賣價買進、點買價賣出；每筆 1–3 張；同時一筆待撮合；下一分鐘開盤價撮合；閃電即送；核對後送出；撤回委託。所有既有按鈕文字與 `aria-label` 維持原樣，驗收腳本依賴它們。
- **顏色變數（逐字）**：底色 `#05080d`、面板 `#0b111b`、標題列 `#14305a`（底線 `#2a5594`）、分隔線 `#1c2636`、主文字 `#e6edf7`、次要文字 `#8a9bb6`、上漲 `#ff3b3b`、下跌 `#19d36b`、昨收線 `#e8c547`、選取與強調 `#3b8cff`、快訊底色 `#3a0d12`、快訊文字 `#ff8a8a`。
- **字體**：數字 IBM Plex Mono（已自架）並使用 `tabular-nums`；中文 Noto Sans TC。可見文字最小 11px；主價格 28px、自選價格 24px、五檔 14px、表格 13px。
- **斷點**：沿用 `useTerminalLayout`：桌機 ≥1200px、平板 768–1199px、手機 <768px、長輩模式另計（`layout === "senior"`）。
- **點擊範圍**：手機至少 44px；長輩模式主要按鈕至少 56px。
- **播放速度**：1x 每 2000ms 前進 1 分鐘，2x 每 1000ms（等於伺服器下限 `MORNING_ADVANCE_INTERVAL = 1000`）。不做 4x。
- **DOM 必須保留**：`plan.reason` 與 `session.reflection` 的文字必須留在 DOM（`scripts/onprem/integration.test.mjs` 以 `waitFor({ state: 'attached' })` 檢查），所以教材面板關閉時用 `hidden` 屬性隱藏，不可卸載。
- **lib 模組匯入**：`src/lib/` 下會被 `node --test` 載入的模組，只能用相對路徑並帶 `.ts` 副檔名（例如 `./market/ticks.ts`），不可用 `@/`。
- **圖表銳利度標準調整**：規格寫「軟像素維持 0%」，那是在圖內沒有文字標記時量的。本計畫在圖內新增「高／低」與「前高」文字標籤，文字必然有抗鋸齒，因此改以「每個縮放比例 ≤3%，且低於改版前」為標準。交付時需告知使用者這項調整。
- **共用工作區**：另一個工作階段可能同時修改這個工作區。每個任務開始前執行 `git status --short`；只用明確路徑 `git add`，不要 `git add -A`。不要部署。
- **提交身分**：`git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`。

## Review Focus

1. **練習開始前**（沒有 session、cursor 0、沒有任何 K 棒）：狀態列、提示列、圖表等待畫面與五檔都要正常顯示，不能出現 `-Infinity`、`NaN` 或空白頁。→ Task 2、3、4、5 的測試涵蓋空陣列與 cursor 0；Task 13 在播種前另外跑一次版面檢查。
2. **漲停或跌停**時某一側五檔為空：階梯要顯示「漲停範圍內無價位」，買賣比例條不得除以零。→ Task 4 的 `bookPressure` 測試。
3. **10:00 後延伸觀察**（cursor 61–90）：K 線視窗要跟著往後移，分時軸到 10:30。→ Task 3 的 `candleWindow(90)` 測試。
4. **長輩模式在 320px 寬**：全站規則會讓所有按鈕至少 56px 高，狀態列容易溢出。→ Task 13 的 `--strict` 版面檢查涵蓋「320×700 長輩模式」。
5. **未揭露資料外洩**：伺服器回傳的 bars 理論上只到 cursor，但若有超出 cursor 的資料，快訊不得引用。→ Task 5 的測試直接餵入超出 cursor 的 K 棒。

---

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `scripts/qa/desk-server.mjs` | 新增 | 隔離驗收伺服器（臨時 PGlite、本機埠） |
| `scripts/qa/desk-stop.mjs` | 新增 | 讓驗收伺服器正常關閉資料庫 |
| `scripts/qa/desk-seed.mjs` | 新增 | 播種：開始練習、買兩張、推進到 09:27 |
| `scripts/qa/desk-layout.mjs` | 新增 | 各尺寸版面檢查與截圖 |
| `scripts/qa/desk-sharpness.mjs` | 新增 | 真實裝置縮放下的圖表銳利度 |
| `scripts/qa/desk-orders.mjs` | 新增 | 下單流程實測與 API 回讀 |
| `src/lib/market/ticks.ts` | 修改 | 新增 `estimateRoundTripCost` |
| `src/lib/market/chart-data.ts` | 修改 | 新增 `candleWindow`、`formatPercentChange`、`sessionExtremes` |
| `src/lib/morning-book.ts` | 修改 | 新增 `bookPressure` |
| `src/lib/morning-alerts.ts` | 新增 | 推導快訊 `deriveMorningAlerts` |
| `src/components/charts.tsx` | 修改 | terminal 呈現：雙座標、分時填色、高低標籤、前高 |
| `src/components/morning-desk-bar.tsx` | 新增 | `DeskBar`、`StatusBar`、`HintBar`、`REPLAY_DELAY` |
| `src/components/morning-practice.tsx` | 修改 | 頁框、版面骨架、報價標題列、圖表面板、教材面板、自選 |
| `src/components/morning-order-book.tsx` | 改寫 | 直式五檔階梯與比例條 |
| `src/components/morning-trading.tsx` | 修改 | 下單區標題、預估來回費稅、庫存區標題 |
| `src/components/morning-quotes.tsx` | 修改 | 小走勢樣式類別、明細標題列類別 |
| `src/trading-desk.css` | 新增 | 交易畫面唯一的樣式檔 |
| `src/styles.css` | 修改 | 移除舊匯入、加入新匯入 |
| `src/classroom-refresh.css` | 修改 | 刪除交易畫面區段 |
| `src/terminal-premium.css`、`src/terminal-polish.css`、`src/morning-flash.css`、`src/sim-order.css`、`src/quote-workspace.css` | 刪除 | 只服務交易畫面的舊樣式 |
| `docs/trading-desk-2026-10-13.md` | 新增 | 改版紀錄、驗收結果、正式站登入檢查清單 |

---

### Task 1: 驗收工具與改版前基準

**Files:**
- Create: `scripts/qa/desk-server.mjs`、`scripts/qa/desk-stop.mjs`、`scripts/qa/desk-seed.mjs`、`scripts/qa/desk-layout.mjs`、`scripts/qa/desk-sharpness.mjs`、`scripts/qa/desk-orders.mjs`
- Output（被 git 忽略）：`artifacts/trading-desk-qa/<label>/`

**Interfaces:**
- Produces：
  - `node scripts/qa/desk-server.mjs`：環境變數 `PORT_APP`（預設 18810）、`PORT_PROXY`（預設 18811）、`APP_ENTRY`（預設 `.output/server/index.mjs`）。代理位址 `http://127.0.0.1:<PORT_PROXY>` 已自動登入。
  - `node scripts/qa/desk-stop.mjs [PORT_PROXY]`
  - `node scripts/qa/desk-seed.mjs [baseUrl]`
  - `node scripts/qa/desk-layout.mjs <baseUrl> <label> [--strict]`
  - `node scripts/qa/desk-sharpness.mjs <baseUrl> <label>`
  - `node scripts/qa/desk-orders.mjs <baseUrl> <label>`
  - `node scripts/qa/desk-pages.mjs <baseUrl> <label>`

- [ ] **Step 1: 建立 `scripts/qa/desk-server.mjs`**

```js
// Disposable QA server for trading-desk checks: temporary PGlite data, loopback ports only.
// Never touches the production service or its data. Stop it with scripts/qa/desk-stop.mjs.
import { fork } from "node:child_process";
import { createServer, request as forward } from "node:http";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const project = fileURLToPath(new URL("../..", import.meta.url));
const { initialize, applicationEnvironment } = await import(
  pathToFileURL(join(project, "scripts/onprem/launcher.mjs")).href
);
const appPort = Number(process.env.PORT_APP ?? 18810);
const proxyPort = Number(process.env.PORT_PROXY ?? 18811);
const appEntry = process.env.APP_ENTRY ?? join(project, ".output/server/index.mjs");
const downloads = process.env.DOWNLOADS ?? join(project, ".output/downloads");

const root = await mkdtemp(join(tmpdir(), "daytrade-desk-qa-"));
await cp(join(project, "scripts/onprem/protect-data.ps1"), join(root, "protect-data.ps1"));
const config = await initialize(root, {
  ownerEmail: "ui-fixture@example.invalid",
  classCode: "UIQA",
  port: appPort,
});
const base = `http://127.0.0.1:${appPort}`;
const app = fork(join(project, "scripts/hosting/app-runner.mjs"), [appEntry], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  env: { ...applicationEnvironment(root, config), CLASSROOM_DOWNLOADS_DIR: downloads },
});
let logs = "";
app.stdout.on("data", (chunk) => (logs += chunk));
app.stderr.on("data", (chunk) => (logs += chunk));
let ready = false;
for (let i = 0; i < 160 && !ready; i++) {
  try {
    ready = (await fetch(base + "/api/health")).ok;
  } catch {
    // The server is still starting.
  }
  if (app.exitCode !== null) throw new Error("QA server exited:\n" + logs);
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("QA server not ready:\n" + logs);

const jar = new Map();
const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
async function post(path, data) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify(data),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
}
const password = randomBytes(22).toString("base64url");
await post("/api/gate", { password: config.gateCode });
await post("/api/admin/setup", {
  name: "畫面驗收測試",
  email: config.ownerEmail,
  password,
  token: config.setupToken,
  acceptTos: true,
});
await post("/api/auth/sign-in/email", { email: config.ownerEmail, password });

const proxy = createServer((req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${appPort}`, origin: base, cookie: cookie() };
  const outgoing = forward(base + req.url, { method: req.method, headers }, (response) => {
    const safe = { ...response.headers };
    delete safe["set-cookie"];
    res.writeHead(response.statusCode, safe);
    response.pipe(res);
  });
  outgoing.on("error", () => {
    res.writeHead(502);
    res.end("QA upstream unavailable");
  });
  req.pipe(outgoing);
});
await new Promise((done, fail) => {
  proxy.once("error", fail);
  proxy.listen(proxyPort, "127.0.0.1", done);
});
const stateDir = join(project, "artifacts/trading-desk-qa");
await mkdir(stateDir, { recursive: true });
await writeFile(join(stateDir, `server-${proxyPort}.json`), JSON.stringify({ runtime: root }));
console.log(`QA ready: http://127.0.0.1:${proxyPort} (runtime ${root})`);

let stopping = false;
const stopFile = join(root, "stop-request");
const poll = setInterval(() => {
  if (!stopping && existsSync(stopFile)) void stop();
}, 500);
async function stop() {
  stopping = true;
  clearInterval(poll);
  proxy.closeAllConnections();
  proxy.close();
  const acknowledged = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Shutdown acknowledgement missing")), 25000);
    app.on("message", (message) => {
      if (message?.type === "shutdown-complete") {
        clearTimeout(timer);
        done();
      }
    });
  });
  app.send({ type: "shutdown" });
  await acknowledged;
  app.kill();
  console.log("QA database closed cleanly");
  process.exit(0);
}
process.on("SIGINT", () => void stop());
```

- [ ] **Step 2: 建立 `scripts/qa/desk-stop.mjs`**

```js
// Asks a running desk-server to close its database cleanly.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = process.argv[2] ?? "18811";
const project = fileURLToPath(new URL("../..", import.meta.url));
const { runtime } = JSON.parse(
  readFileSync(join(project, `artifacts/trading-desk-qa/server-${port}.json`), "utf8"),
);
writeFileSync(join(runtime, "stop-request"), "");
console.log(`Stop requested for ${runtime}`);
```

- [ ] **Step 3: 建立 `scripts/qa/desk-seed.mjs`**

```js
// Disposable QA fixture only: start a plan, buy two lots, replay to 09:27.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:18811";
async function call(action) {
  const response = await fetch(
    base + "/api/morning",
    action
      ? {
          method: "POST",
          headers: { origin: base, "content-type": "application/json" },
          body: JSON.stringify({ ...action, requestId: randomUUID() }),
        }
      : {},
  );
  assert.equal(response.status, 200);
  return response.json();
}
let data = await call();
const code = data.catalog.symbols[0].code;
data = await call({
  action: "start",
  plan: {
    exerciseId: "first-order",
    focusCode: code,
    bias: "observe",
    reason: "驗收模擬下單與庫存平均成本顯示。",
    entry: "觀察開盤價格區間，核對條件後建立部位；每次一張，逐筆檢查成交。",
    stop: "完成隔離測試後停止。",
  },
});
async function advance() {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, data.state.nextAdvanceAt - Date.now()) + 30),
  );
  data = await call({ action: "advance", id: data.state.id, expectedRevision: data.state.revision });
}
await advance();
for (let i = 0; i < 2; i++) {
  data = await call({
    action: "order",
    id: data.state.id,
    expectedRevision: data.state.revision,
    code,
    side: "buy",
    lots: 1,
  });
  await advance();
}
assert.equal(data.state.positions[0].shares, 2000);
while (data.state.cursor < 27) await advance();
console.log(JSON.stringify({ cursor: data.state.cursor, fills: data.state.fills.length }));
```

- [ ] **Step 4: 建立 `scripts/qa/desk-layout.mjs`**

```js
// Layout checks and screenshots for the trading desk at every target size.
// Usage: node scripts/qa/desk-layout.mjs <baseUrl> <label> [--strict]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run", ...flags] = process.argv.slice(2);
const strict = flags.includes("--strict");
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const cases = [
  [1920, 1080, false],
  [1366, 900, false],
  [820, 900, false],
  [375, 812, false],
  [320, 700, false],
  [1366, 900, true],
  [320, 700, true],
];

const scan = () => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.opacity !== "0";
  };
  const id = (el) =>
    `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}` +
    `[${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 14)}]`;
  const small = [];
  const clipped = [];
  const offscreen = [];
  let minFont = Infinity;
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(".sr-only, [hidden]") || ["SCRIPT", "STYLE", "CANVAS"].includes(el.tagName)) continue;
    if (!visible(el)) continue;
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    minFont = Math.min(minFont, size);
    if (size < 11) small.push(`${size}px ${id(el)}`);
    if (
      (style.overflowX === "hidden" || style.overflowX === "clip") &&
      style.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1
    )
      clipped.push(id(el));
    const rect = el.getBoundingClientRect();
    if (rect.right > innerWidth + 1 || rect.left < -1) offscreen.push(id(el));
  }
  const main = document.querySelector("main");
  const canvas = document.querySelector('main canvas[role="img"]');
  return {
    minFont: minFont === Infinity ? null : minFont,
    small,
    clipped,
    offscreen,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollHeight - innerHeight,
    mainScroll: main ? main.scrollHeight - main.clientHeight : null,
    chartRatio: canvas ? Number((canvas.getBoundingClientRect().height / innerHeight).toFixed(3)) : null,
  };
};

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const rows = [];
for (const [width, height, senior] of cases) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (senior)
    await context.addInitScript(() => localStorage.setItem("day-tycoon-display-v1", "senior"));
  const page = await context.newPage();
  await page.goto(`${base}/morning?panel=trade`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 20000 });
  await page.waitForSelector('main canvas[role="img"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const report = await page.evaluate(scan);
  const name = `${width}x${height}${senior ? "-senior" : ""}`;
  await page.screenshot({ path: `${out}${name}.png`, fullPage: true });
  rows.push({ name, width, height, senior, ...report });
  await context.close();
}
await browser.close();
writeFileSync(`${out}layout.json`, JSON.stringify(rows, null, 2));
console.table(
  rows.map((row) => ({
    case: row.name,
    minFont: row.minFont,
    "<11px": row.small.length,
    clipped: row.clipped.length,
    offscreen: row.offscreen.length,
    overflowX: row.pageOverflowX,
    docScroll: row.documentScroll,
    mainScroll: row.mainScroll,
    chart: row.chartRatio,
  })),
);
const failures = [];
for (const row of rows) {
  if (row.small.length) failures.push(`${row.name}: ${row.small.length} text elements below 11px`);
  if (row.clipped.length || row.offscreen.length || row.pageOverflowX > 0)
    failures.push(`${row.name}: horizontal overflow or clipped text`);
  if (!row.senior && row.width >= 1200 && row.height >= 800) {
    if (row.documentScroll > 1 || (row.mainScroll ?? 0) > 1) failures.push(`${row.name}: page scrolls`);
    if (!(row.chartRatio >= 0.5)) failures.push(`${row.name}: chart height ratio ${row.chartRatio}`);
  }
}
if (failures.length) {
  console.log("FAILURES:\n" + failures.join("\n"));
  if (strict) process.exitCode = 1;
} else console.log("All layout checks passed.");
```

- [ ] **Step 5: 建立 `scripts/qa/desk-sharpness.mjs`**

```js
// Chart sharpness at genuine device scale factors (Chrome flag, not CDP emulation).
// Counts anti-aliased blend pixels inside the plot of the real trading-desk chart.
// Usage: node scripts/qa/desk-sharpness.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const launch = (args) =>
  chromium.launch({ args }).catch(() => chromium.launch({ channel: "chrome", args }));

const rows = [];
for (const ratio of [1, 1.25, 1.5, 2]) {
  const browser = await launch([`--force-device-scale-factor=${ratio}`, "--window-size=1400,1000"]);
  const page = await (await browser.newContext({ viewport: null })).newPage();
  await page.goto(`${base}/morning?panel=trade`, { waitUntil: "domcontentloaded" });
  const canvas = page.locator('main canvas[role="img"]');
  await canvas.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const palette = await canvas.evaluate((el) => {
    const style = getComputedStyle(el);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return [
      read("--color-bg", "#080d14"),
      read("--color-border", "#243040"),
      read("--color-up", "#ff3b3b"),
      read("--color-down", "#17c964"),
      read("--color-tape", "#e8c547"),
      read("--color-muted", "#8b9bb0"),
      read("--color-warn", "#e7b549"),
    ];
  });
  const png = await canvas.screenshot();
  writeFileSync(`${out}sharp-dpr${ratio}.png`, png);
  const stats = await page.evaluate(
    async ({ b64, ratio, palette }) => {
      const image = new Image();
      image.src = "data:image/png;base64," + b64;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const cssW = image.width / ratio;
      const cssH = image.height / ratio;
      // Plot interior: skip both axes and the time axis.
      const x0 = Math.round(80 * ratio);
      const x1 = Math.round((cssW - 90) * ratio);
      const y0 = Math.round(14 * ratio);
      const y1 = Math.round((cssH - 30) * ratio);
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const colours = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
      let drawn = 0;
      let soft = 0;
      for (let i = 0; i < data.length; i += 4) {
        const distance = (c) =>
          Math.max(Math.abs(c[0] - data[i]), Math.abs(c[1] - data[i + 1]), Math.abs(c[2] - data[i + 2]));
        if (distance(colours[0]) > 4) drawn++;
        if (Math.min(...colours.map(distance)) > 6) soft++;
      }
      return { drawn, soft };
    },
    { b64: png.toString("base64"), ratio, palette },
  );
  rows.push({ dpr: ratio, ...stats, softPct: Number(((100 * stats.soft) / Math.max(1, stats.drawn)).toFixed(1)) });
  await browser.close();
}
writeFileSync(`${out}sharpness.json`, JSON.stringify(rows, null, 2));
console.table(rows);
```

- [ ] **Step 6: 建立 `scripts/qa/desk-orders.mjs`**

```js
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
```

- [ ] **Step 6b: 建立 `scripts/qa/desk-pages.mjs`（共用樣式頁面的回歸截圖）**

```js
// Screenshots of the other pages that share classroom-refresh.css, for before/after comparison.
// Usage: node scripts/qa/desk-pages.mjs <baseUrl> <label>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [base = "http://127.0.0.1:18811", label = "run"] = process.argv.slice(2);
const out = fileURLToPath(new URL(`../../artifacts/trading-desk-qa/${label}/`, import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
for (const [width, height] of [
  [1366, 900],
  [375, 812],
]) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  for (const [name, path] of [
    ["lobby", "/"],
    ["try", "/try"],
    ["manual", "/manual"],
  ]) {
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}page-${name}-${width}.png`, fullPage: true });
  }
  await context.close();
}
await browser.close();
console.log(`Saved page screenshots to ${out}`);
```

- [ ] **Step 7: 建置目前版本並啟動驗收伺服器**

```bash
npm run build
```
預期：結尾印出 `"offlineVerified": true`，結束碼 0。

在背景啟動伺服器（Bash 工具用 `run_in_background: true`）：
```bash
node scripts/qa/desk-server.mjs
```
等候 `http://127.0.0.1:18811/api/health` 回 200：
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18811/api/health
```
預期：`200`。

- [ ] **Step 8: 播種並擷取改版前基準**

```bash
node scripts/qa/desk-seed.mjs http://127.0.0.1:18811
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 before
node scripts/qa/desk-sharpness.mjs http://127.0.0.1:18811 before
node scripts/qa/desk-orders.mjs http://127.0.0.1:18811 before
node scripts/qa/desk-pages.mjs http://127.0.0.1:18811 before
```
預期：
- 播種印出 `{"cursor":27,"fills":2}`。
- 版面表格會列出「page scrolls」「chart height ratio」等失敗項目。這是改版前的狀態，不加 `--strict` 時結束碼為 0。
- `orders.json` 內容為 `marketBuy.newFills = 1`、`lightning.status = "cancelled"`、`sellWithoutHolding.submitDisabled = true`。

- [ ] **Step 9: 關閉伺服器**

```bash
node scripts/qa/desk-stop.mjs 18811
```
預期：背景伺服器印出 `QA database closed cleanly`。

- [ ] **Step 10: 確認腳本通過 lint 並提交**

```bash
npx eslint scripts/qa
git add scripts/qa/desk-server.mjs scripts/qa/desk-stop.mjs scripts/qa/desk-seed.mjs scripts/qa/desk-layout.mjs scripts/qa/desk-sharpness.mjs scripts/qa/desk-orders.mjs scripts/qa/desk-pages.mjs
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "test: add trading desk QA scripts and capture the pre-redesign baseline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
預期：eslint 無輸出；提交成功。

---

### Task 2: 預估來回費稅

**Files:**
- Modify: `src/lib/market/ticks.ts`（在 `sellTax` 之後）
- Test: `src/lib/market/ticks.test.ts`

**Interfaces:**
- Consumes: `commission(notional: number): number`、`sellTax(notional: number): number`（`src/lib/market/ticks.ts`）
- Produces: `estimateRoundTripCost(notional: number): number`（Task 11 使用）

- [ ] **Step 1: 寫失敗的測試**

把 `src/lib/market/ticks.test.ts` 第 3 行的匯入改為：
```ts
import {
  clampLimit,
  commission,
  estimateRoundTripCost,
  limitDown,
  limitUp,
  roundToTick,
  sellTax,
  stepTick,
  tickSize,
} from "./ticks.ts";
```
在檔案最後加上：
```ts
describe("estimateRoundTripCost", () => {
  it("adds both commissions and the day-trade tax at one reference notional", () => {
    // 2580 × 1,000 shares: fee 2,206 on each side, tax 3,870.
    assert.equal(estimateRoundTripCost(2_580_000), 2206 * 2 + 3870);
  });
  it("applies the NT$20 minimum fee on each side", () => {
    assert.equal(estimateRoundTripCost(10_000), 20 + 20 + 15);
  });
  it("returns 0 for missing or non-positive notionals", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      assert.equal(estimateRoundTripCost(value), 0);
  });
  it("uses exactly the engine's commission and sell tax", () => {
    for (const notional of [9_990, 100_000, 518_000, 4_955_000])
      assert.equal(estimateRoundTripCost(notional), commission(notional) * 2 + sellTax(notional));
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
node --experimental-strip-types --test src/lib/market/ticks.test.ts
```
預期：FAIL，`does not provide an export named 'estimateRoundTripCost'`。

- [ ] **Step 3: 實作**

在 `src/lib/market/ticks.ts` 的 `sellTax` 函式之後加入：
```ts
/** Buy fee, sell fee and day-trade tax if the position is closed at the same notional. */
export function estimateRoundTripCost(notional: number): number {
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  return commission(notional) * 2 + sellTax(notional);
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
node --experimental-strip-types --test src/lib/market/ticks.test.ts
```
預期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/market/ticks.ts src/lib/market/ticks.test.ts
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: estimate round-trip fees with the engine's own rates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 圖表輔助函式

**Files:**
- Modify: `src/lib/market/chart-data.ts`（檔案最後）
- Test: `src/lib/market/chart-data.test.ts`

**Interfaces:**
- Produces（Task 6、8、9 使用）：
  - `candleWindow(cursor: number, minutes?: number): { startT: number; endT: number }`（秒）
  - `formatPercentChange(price: number, previous: number): string`（例如 `"+0.19%"`；無效輸入回傳 `""`）
  - `sessionExtremes(bars: readonly Bar[]): { high: TickPt; low: TickPt } | null`

- [ ] **Step 1: 寫失敗的測試**

在 `src/lib/market/chart-data.test.ts` 的匯入清單加入 `candleWindow`、`formatPercentChange`、`sessionExtremes`（依字母順序放在 `canvasResolution` 之後、`sessionExtremes` 放在 `nearestTimePoint` 之後），並在檔案最後加上：
```ts
test("candle view keeps a fixed 60-minute span that follows the cursor", () => {
  assert.deepEqual(candleWindow(0), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(5), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(60), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(90), { startT: 1800, endT: 5400 });
  assert.deepEqual(candleWindow(Number.NaN), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(-3), { startT: 0, endT: 3600 });
  assert.deepEqual(candleWindow(10, 5), { startT: 300, endT: 600 });
});

test("percent change is signed, two decimals and never negative zero", () => {
  assert.equal(formatPercentChange(2580, 2575), "+0.19%");
  assert.equal(formatPercentChange(2570, 2575), "-0.19%");
  assert.equal(formatPercentChange(2575, 2575), "0.00%");
  assert.equal(formatPercentChange(2575.0001, 2575), "0.00%");
  assert.equal(formatPercentChange(2574.9999, 2575), "0.00%");
  assert.equal(formatPercentChange(2580, 0), "");
  assert.equal(formatPercentChange(Number.NaN, 2575), "");
});

test("session extremes report the first highest high and lowest low", () => {
  const bars = [
    { t: 0, o: 10, h: 11, l: 9, c: 10, v: 0 },
    { t: 60, o: 10, h: 12, l: 9, c: 11, v: 0 },
    { t: 120, o: 11, h: 12, l: 8, c: 9, v: 0 },
  ];
  assert.deepEqual(sessionExtremes(bars), { high: { t: 60, p: 12 }, low: { t: 120, p: 8 } });
  assert.equal(sessionExtremes([]), null);
  assert.equal(sessionExtremes([{ t: 0, o: 1, h: Number.NaN, l: 1, c: 1, v: 0 }]), null);
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
node --experimental-strip-types --test src/lib/market/chart-data.test.ts
```
預期：FAIL，缺少匯出 `candleWindow`。

- [ ] **Step 3: 實作**

在 `src/lib/market/chart-data.ts` 最後加入：
```ts
/** Fixed-width candle view: the latest `minutes` minutes, with empty space ahead early on. */
export function candleWindow(cursor: number, minutes = 60): { startT: number; endT: number } {
  const span = Math.max(1, Math.round(minutes)) * 60;
  const now = Number.isFinite(cursor) ? Math.max(0, cursor) * 60 : 0;
  const startT = Math.max(0, now - span);
  return { startT, endT: startT + span };
}

/** Signed change against the previous close, e.g. "+0.19%"; never shows "-0.00%". */
export function formatPercentChange(price: number, previous: number): string {
  if (!Number.isFinite(price) || !Number.isFinite(previous) || previous <= 0) return "";
  const rounded = Math.round((price / previous - 1) * 10000) / 100;
  if (rounded === 0) return "0.00%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

/** Highest high and lowest low among the given bars; the first occurrence wins. */
export function sessionExtremes(bars: readonly Bar[]): { high: TickPt; low: TickPt } | null {
  let high: TickPt | null = null;
  let low: TickPt | null = null;
  for (const bar of bars) {
    if (![bar.t, bar.h, bar.l].every(Number.isFinite)) continue;
    if (!high || bar.h > high.p) high = { t: bar.t, p: bar.h };
    if (!low || bar.l < low.p) low = { t: bar.t, p: bar.l };
  }
  return high && low ? { high, low } : null;
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
node --experimental-strip-types --test src/lib/market/chart-data.test.ts
```
預期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/market/chart-data.ts src/lib/market/chart-data.test.ts
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: add candle window, percent change and session extreme helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 五檔買賣比例

**Files:**
- Modify: `src/lib/morning-book.ts`（檔案最後）
- Test: `src/lib/morning-book.test.ts`

**Interfaces:**
- Consumes: `createMorningBook`、`MorningBookLevel`
- Produces: `bookPressure(book: { bids: readonly MorningBookLevel[]; asks: readonly MorningBookLevel[] }): { bidLots: number; askLots: number; bidShare: number }`（Task 10 使用）

- [ ] **Step 1: 寫失敗的測試**

把 `src/lib/morning-book.test.ts` 的匯入改為 `import { bookPressure, createMorningBook, validMorningLimit } from "./morning-book.ts";`，並在最後加上：
```ts
test("book pressure sums illustrative lots and never divides by zero", () => {
  const book = createMorningBook("2330", 12, 2580, 2575);
  const pressure = bookPressure(book);
  assert.equal(pressure.bidLots, book.bids.reduce((sum, level) => sum + level.lots, 0));
  assert.equal(pressure.askLots, book.asks.reduce((sum, level) => sum + level.lots, 0));
  assert.ok(
    Math.abs(pressure.bidShare - pressure.bidLots / (pressure.bidLots + pressure.askLots)) < 1e-12,
  );
  assert.deepEqual(bookPressure({ bids: [], asks: [] }), { bidLots: 0, askLots: 0, bidShare: 0.5 });
  // At limit-up the ask side is empty, so every shown lot is a bid.
  assert.equal(bookPressure(createMorningBook("2330", 1, limitUp(100), 100)).bidShare, 1);
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
node --experimental-strip-types --test src/lib/morning-book.test.ts
```
預期：FAIL，缺少匯出 `bookPressure`。

- [ ] **Step 3: 實作**

在 `src/lib/morning-book.ts` 最後加入：
```ts
/** Share of illustrative bid lots among all shown lots; 0.5 when nothing is shown. Teaching data only. */
export function bookPressure(book: {
  bids: readonly MorningBookLevel[];
  asks: readonly MorningBookLevel[];
}): { bidLots: number; askLots: number; bidShare: number } {
  const bidLots = book.bids.reduce((sum, level) => sum + level.lots, 0);
  const askLots = book.asks.reduce((sum, level) => sum + level.lots, 0);
  const total = bidLots + askLots;
  return { bidLots, askLots, bidShare: total > 0 ? bidLots / total : 0.5 };
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
node --experimental-strip-types --test src/lib/morning-book.test.ts
```
預期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/morning-book.ts src/lib/morning-book.test.ts
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: compute bid/ask pressure from the teaching order book" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 推導快訊

**Files:**
- Create: `src/lib/morning-alerts.ts`
- Test: `src/lib/morning-alerts.test.ts`

**Interfaces:**
- Consumes: `deriveSwingHighs(bars, now, startT, endT)`（`./market/swing-highs.ts`）、`formatPrice`（`./market/ticks.ts`）、`MorningCatalog`、`MorningState`（`./morning.ts`）
- Produces（Task 7 使用）：
  - `type MorningAlertKind = "fill" | "swing-high" | "cross-up" | "cross-down"`
  - `type MorningAlert = { t: number; kind: MorningAlertKind; code: string; text: string }`（`t` 為距 09:00 的秒數）
  - `deriveMorningAlerts(catalog: MorningCatalog, state: MorningState): MorningAlert[]`（依時間遞增；同時間時成交排最後，`.at(-1)` 即最新一則）

撤回委託在 `MorningState` 中沒有時間戳記，所以不列為快訊；撤回時既有的回饋訊息（`feedback`）會顯示在提示列。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/lib/morning-alerts.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { deriveMorningAlerts } from "./morning-alerts.ts";
import type { MorningCatalog, MorningState } from "./morning.ts";

const catalog: MorningCatalog = {
  lessonId: "t",
  title: "t",
  date: "2026-10-06",
  start: "09:00",
  end: "10:30",
  maxCursor: 90,
  symbols: [{ code: "2330", name: "台積電", previousClose: 1000, previous5CloseMean: 1000 }],
  context: [],
  strategy: [],
  notices: [],
  videoUrl: null,
};

const bar = (minute: number, high: number, close: number) => ({
  t: minute * 60,
  o: close,
  h: high,
  l: Math.min(close, high) - 5,
  c: close,
  v: 0,
});

function state(
  cursor: number,
  bars: ReturnType<typeof bar>[],
  fills: MorningState["fills"] = [],
): MorningState {
  return {
    id: "s",
    lessonId: "t",
    cursor,
    revision: 1,
    plan: { bias: "observe", focusCode: "2330", reason: "", entry: "", stop: "" },
    bars: { "2330": bars },
    startingCash: 10_000_000,
    cash: 10_000_000,
    equity: 10_000_000,
    positions: [],
    orders: [],
    fills,
    completed: false,
    reflection: "",
    nextAdvanceAt: 0,
  };
}

test("closes crossing the previous close become alerts at the minute they complete", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1010, 1005), bar(2, 1005, 1000), bar(3, 995, 990)];
  assert.deepEqual(deriveMorningAlerts(catalog, state(4, bars)), [
    { t: 120, kind: "cross-up", code: "2330", text: "台積電 站上昨收 1000" },
    { t: 240, kind: "cross-down", code: "2330", text: "台積電 跌破昨收 1000" },
  ]);
});

test("a swing high appears only once it is confirmed, and never from unrevealed minutes", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1005, 995), bar(2, 1025, 995), bar(3, 1010, 995), bar(4, 1005, 995)];
  // At cursor 4 only minutes 0–3 are complete; minute 4 must be ignored even if present.
  assert.deepEqual(deriveMorningAlerts(catalog, state(4, bars)), []);
  assert.deepEqual(
    deriveMorningAlerts(catalog, state(4, bars)),
    deriveMorningAlerts(catalog, state(4, bars.slice(0, 4))),
  );
  assert.deepEqual(deriveMorningAlerts(catalog, state(5, bars)), [
    { t: 300, kind: "swing-high", code: "2330", text: "台積電 前高確認 1025" },
  ]);
});

test("the learner's fills are alerts and sort last within the same minute", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1010, 1005)];
  const fill = { id: "f", code: "2330", side: "buy" as const, shares: 1000, price: 1005, fee: 20, tax: 0, t: 120 };
  const alerts = deriveMorningAlerts(catalog, state(2, bars, [fill]));
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.at(-1), {
    t: 120,
    kind: "fill",
    code: "2330",
    text: "你的委託成交：台積電 買進 1 張 @ 1005",
  });
});

test("an empty or not-yet-started session has no alerts", () => {
  assert.deepEqual(deriveMorningAlerts(catalog, state(0, [])), []);
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
node --experimental-strip-types --test src/lib/morning-alerts.test.ts
```
預期：FAIL，找不到模組 `./morning-alerts.ts`。

- [ ] **Step 3: 實作**

建立 `src/lib/morning-alerts.ts`：
```ts
import { deriveSwingHighs } from "./market/swing-highs.ts";
import { formatPrice } from "./market/ticks.ts";
import type { MorningCatalog, MorningState } from "./morning.ts";

export type MorningAlertKind = "fill" | "swing-high" | "cross-up" | "cross-down";
export type MorningAlert = { t: number; kind: MorningAlertKind; code: string; text: string };

// Within one minute the learner's own fill is the most important, so it sorts last.
const PRIORITY: Record<MorningAlertKind, number> = {
  "cross-up": 0,
  "cross-down": 0,
  "swing-high": 1,
  fill: 2,
};

/**
 * Events derived only from what the server has already revealed: completed minutes up to the
 * cursor and the learner's own fills. Nothing after `state.cursor` can influence the result.
 */
export function deriveMorningAlerts(catalog: MorningCatalog, state: MorningState): MorningAlert[] {
  const cutoff = Math.max(0, state.cursor) * 60;
  const alerts: MorningAlert[] = [];
  for (const symbol of catalog.symbols) {
    const bars = (state.bars[symbol.code] ?? [])
      .filter((bar) => Number.isFinite(bar.t) && bar.t + 60 <= cutoff)
      .slice()
      .sort((a, b) => a.t - b.t);
    for (const high of deriveSwingHighs(bars, cutoff, 0, catalog.maxCursor * 60).confirmed) {
      if (high.confirmedAt > cutoff) continue;
      alerts.push({
        t: high.confirmedAt,
        kind: "swing-high",
        code: symbol.code,
        text: `${symbol.name} 前高確認 ${formatPrice(high.p)}`,
      });
    }
    for (let index = 1; index < bars.length; index++) {
      const before = bars[index - 1]!.c - symbol.previousClose;
      const after = bars[index]!.c - symbol.previousClose;
      const t = bars[index]!.t + 60;
      const reference = formatPrice(symbol.previousClose);
      if (before <= 0 && after > 0)
        alerts.push({ t, kind: "cross-up", code: symbol.code, text: `${symbol.name} 站上昨收 ${reference}` });
      else if (before >= 0 && after < 0)
        alerts.push({ t, kind: "cross-down", code: symbol.code, text: `${symbol.name} 跌破昨收 ${reference}` });
    }
  }
  for (const fill of state.fills) {
    if (!Number.isFinite(fill.t) || fill.t > cutoff) continue;
    const name = catalog.symbols.find((item) => item.code === fill.code)?.name ?? fill.code;
    alerts.push({
      t: fill.t,
      kind: "fill",
      code: fill.code,
      text: `你的委託成交：${name} ${fill.side === "buy" ? "買進" : "賣出"} ${fill.shares / 1000} 張 @ ${formatPrice(fill.price)}`,
    });
  }
  return alerts.sort((a, b) => a.t - b.t || PRIORITY[a.kind] - PRIORITY[b.kind]);
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
node --experimental-strip-types --test src/lib/morning-alerts.test.ts
```
預期：4 項全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/morning-alerts.ts src/lib/morning-alerts.test.ts
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: derive desk alerts from revealed minutes and own fills" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 圖表呈現（雙座標、分時填色、高低與前高標記）

**Files:**
- Modify: `src/components/charts.tsx`（`paint()` 內 terminal 呈現的部分）
- Modify: `src/components/morning-practice.tsx`（`MorningChart` 傳入的 `TapeChart` 屬性）

**Interfaces:**
- Consumes: `formatPercentChange`、`sessionExtremes`、`candleWindow`（Task 3）、`deriveSwingHighs`（`@/lib/market/swing-highs`）
- Produces: `TapeChart` 的 `presentation="terminal"` 呈現：左價格軸、右漲跌幅軸、分時填色、「高／低」標籤、「前高」虛線。其他 `presentation` 值的呈現不變。

- [ ] **Step 1: 更新 `charts.tsx` 的匯入**

在 `@/lib/market/chart-data` 的匯入清單加入 `formatPercentChange` 與 `sessionExtremes`（依字母順序）。

- [ ] **Step 2: 左價格軸、右漲跌幅軸**

把
```ts
  const padL = terminal ? 16 : Math.ceil(axisWidth + 12);
  const padR = Math.ceil(axisWidth + 14);
```
改為：
```ts
  // The trading desk shows prices on the left and change from the previous close on the right.
  const percentWidth = terminal ? ctx.measureText("+10.00%").width : 0;
  const padL = Math.ceil(axisWidth + 12);
  const padR = Math.ceil(Math.max(axisWidth, percentWidth) + 14);
```
把格線迴圈前的 `ctx.textAlign = terminal ? "left" : "right";` 改為 `ctx.textAlign = "right";`，並把迴圈內的
```ts
    ctx.fillText(
      label(price),
      snapEdge(terminal ? w - padR + 8 : padL - 7, sx),
      snapEdge(y, sy),
    );
```
改為：
```ts
    ctx.fillText(label(price), snapEdge(padL - 7, sx), snapEdge(y, sy));
    if (terminal) {
      ctx.textAlign = "left";
      ctx.fillText(formatPercentChange(price, opt.prev), snapEdge(w - padR + 8, sx), snapEdge(y, sy));
      ctx.textAlign = "right";
    }
```

- [ ] **Step 3: 分時填色**

在折線分支（`} else {` 之後、`const runs = …` 之後）把
```ts
    ctx.lineWidth = 2;
```
改為：
```ts
    if (terminal && !isIndex) {
      // Shade between each run and the previous close; the colour follows the run's side.
      const base = yOf(opt.prev);
      ctx.save();
      ctx.globalAlpha = 0.16;
      for (const run of runs) {
        if (run.points.length < 2) continue;
        ctx.fillStyle = run.above ? c.up : c.down;
        ctx.beginPath();
        ctx.moveTo(xOf(run.points[0]!.t), base);
        for (const point of run.points) ctx.lineTo(xOf(point.t), yOf(point.p));
        ctx.lineTo(xOf(run.points.at(-1)!.t), base);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.lineWidth = terminal ? 1.5 : 2;
```

- [ ] **Step 4: 「高／低」標籤與「前高」虛線**

在成交三角形迴圈（`for (const fill of inChartWindow(opt.fills ?? [], window).slice(0, 48)) {…}`）之後、前高迴圈之前，加入：
```ts
  if (terminal && !isIndex) {
    const extremes = sessionExtremes(bars);
    if (extremes && extremes.high.p > extremes.low.p) {
      ctx.save();
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tag = (point: TickPt, text: string, color: string, above: boolean) => {
        const x = xOf(point.t + (interval ? interval / 2 : 0));
        const raw = yOf(point.p) + (above ? -1 : 1) * (c.fontSize * 0.9);
        const y = Math.min(plotBottom - c.fontSize / 2 - 2, Math.max(padT + c.fontSize / 2 + 2, raw));
        const width = ctx.measureText(text).width + 8;
        const left = Math.min(w - padR - width, Math.max(padL, x - width / 2));
        ctx.fillStyle = c.bg;
        ctx.fillRect(
          snapEdge(left, sx),
          snapEdge(y - c.fontSize / 2 - 2, sy),
          snapEdge(width, sx),
          snapEdge(c.fontSize + 4, sy),
        );
        ctx.fillStyle = color;
        ctx.fillText(text, snapEdge(left + width / 2, sx), snapEdge(y, sy));
      };
      tag(extremes.high, `高 ${label(extremes.high.p)}`, c.up, true);
      tag(extremes.low, `低 ${label(extremes.low.p)}`, c.down, false);
      ctx.restore();
    }
  }
```
在前高迴圈內，緊接在 `continue;` 判斷之後、`const x = xOf(highPoint.t);` 之前，加入：
```ts
    if (terminal) {
      // Desk style: a dashed level from the confirmed high to the right edge, labelled "前高".
      const y = hRule(yOf(highPoint.p));
      ctx.save();
      ctx.strokeStyle = c.warn;
      ctx.lineWidth = cssPixels(hairline);
      ctx.setLineDash(dashes([5, 4], sx));
      ctx.beginPath();
      ctx.moveTo(vRule(xOf(highPoint.t + (interval ? interval / 2 : 0))), y);
      ctx.lineTo(gridRight, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.warn;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`前高 ${label(highPoint.p)}`, snapEdge(w - padR - 4, sx), snapEdge(y - 2, sy));
      ctx.restore();
      continue;
    }
```

- [ ] **Step 5: `MorningChart` 傳入新屬性**

在 `src/components/morning-practice.tsx`：
- `@/lib/market/chart-data` 尚未匯入，新增 `import { candleWindow } from "@/lib/market/chart-data";`。
- 新增 `import { deriveSwingHighs } from "@/lib/market/swing-highs";`。
- 在 `MorningChart` 中 `const last = bars.at(-1);` 之後加入：
```tsx
  const now = (session?.cursor ?? 0) * 60;
  const view = candles
    ? candleWindow(session?.cursor ?? 0)
    : { startT: 0, endT: catalog.maxCursor * 60 };
  const swingHighs = deriveSwingHighs(bars, now, 0, catalog.maxCursor * 60).confirmed;
  const fills = (session?.fills ?? [])
    .filter((fill) => fill.code === symbol.code)
    .map((fill) => ({ t: fill.t, p: fill.price, side: fill.side }));
```
- 把 `TapeChart` 的
```tsx
            startT={0}
            endT={catalog.maxCursor * 60}
            now={session.cursor * 60}
            range={{ start: 0, end: session.cursor * 60 }}
```
改為：
```tsx
            startT={view.startT}
            endT={view.endT}
            now={now}
            swingHighs={swingHighs}
            fills={fills}
```

- [ ] **Step 6: 型別、lint、單元測試**

```bash
npx tsc --noEmit
npx eslint src/components/charts.tsx src/components/morning-practice.tsx --quiet
node --experimental-strip-types --test src/lib/market/chart-data.test.ts
```
預期：皆無錯誤。

- [ ] **Step 7: 實際畫面檢查**

```bash
npm run build
```
依 Task 1 的 Step 7–9 啟動伺服器、播種，然後執行：
```bash
node scripts/qa/desk-sharpness.mjs http://127.0.0.1:18811 task6
node scripts/qa/desk-stop.mjs 18811
```
預期：
- 每個縮放比例的 `softPct` ≤ 3。
- 開啟 `artifacts/trading-desk-qa/task6/sharp-dpr1.png`，應看到左側價格、右側漲跌幅、「高／低」標籤；若已有確認的前高，會看到「前高」虛線。

- [ ] **Step 8: 提交**

```bash
git add src/components/charts.tsx src/components/morning-practice.tsx
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: desk chart axes, intraday shading and high/low markers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 新樣式檔、頁框、狀態列、提示列與教材面板

這個任務刪除舊樣式檔。之後到 Task 12 之間，尚未改寫的區塊會暫時只有基本樣式；這是預期的過渡狀態。

**Files:**
- Create: `src/trading-desk.css`、`src/components/morning-desk-bar.tsx`
- Modify: `src/styles.css`、`src/classroom-refresh.css`、`src/components/morning-practice.tsx`
- Delete: `src/terminal-premium.css`、`src/terminal-polish.css`、`src/morning-flash.css`、`src/sim-order.css`、`src/quote-workspace.css`

**Interfaces:**
- Consumes: `deriveMorningAlerts`、`MorningAlert`（Task 5）
- Produces:
  - `src/components/morning-desk-bar.tsx`：`type ReplaySpeed = 1 | 2`；`REPLAY_DELAY: Record<ReplaySpeed, number>`；`DeskBar({ children })`；`StatusBar(props)`；`HintBar({ tip, alert, feedback, children })`
  - 根節點 `<div data-market-theme="dark" data-layout={layout} className="trading-desk">`
  - 版面類別：`td-main`、`td-workbench`、`td-watch`、`td-plan-note`、`td-center`、`td-pane`、`td-trade`、`td-ledger`、`td-plan`、`td-plan-close`、`td-mobile-ticket`、`td-empty`、`td-banner`、`td-loading`、`td-titlebar`、`td-button`、`td-resources`、`td-section`

- [ ] **Step 1: 刪除舊樣式並更新匯入**

```bash
git rm src/terminal-premium.css src/terminal-polish.css src/morning-flash.css src/sim-order.css src/quote-workspace.css
```
在 `src/styles.css` 頂端，把
```css
@import "./quote-workspace.css";
@import "./classroom-refresh.css";
@import "./sim-order.css";
@import "./terminal-premium.css";
@import "./morning-flash.css";
@import "./terminal-polish.css";
```
改為：
```css
@import "./classroom-refresh.css";
@import "./trading-desk.css";
```

- [ ] **Step 2: 裁掉 `classroom-refresh.css` 的交易畫面區段**

刪除以下四段（行號以 2026-10-13 版本為準；刪除前先用選擇器確認範圍）：
1. 約 371–624 行：從 `.terminal-shell.morning-workspace[data-market-theme="dark"] {` 開始，到 `.quote-app-footer` 規則結束。
2. 約 641–643 行：`@media (max-width: 1100px)` 內的 `.quote-session-steps` 規則（只刪這條，保留同一媒體查詢中的其他規則）。
3. 約 712–790 行：`@media (max-width: 767px)` 內所有以 `.quote-` 開頭的規則（保留 `.access-`、`.lobby-` 等規則）。
4. 約 817–839 行：`html[data-reading-mode="senior"]` 開頭、作用於 `.quote-session-*`、`.quote-date-picker`、`.quote-bid-ask`、`.quote-price-row` 的規則。

確認沒有殘留：
```bash
grep -nE "\.quote-|morning-workspace" src/classroom-refresh.css
```
預期：無輸出。

- [ ] **Step 3: 建立 `src/trading-desk.css`（變數、根節點、狀態列、提示列、教材面板、版面格線）**

```css
/* Trading desk: the /morning trading screen. One token set; no other stylesheet styles it. */
.trading-desk {
  --td-bg: #05080d;
  --td-panel: #0b111b;
  --td-raised: #111a29;
  --td-title: #14305a;
  --td-title-line: #2a5594;
  --td-line: #1c2636;
  --td-line-strong: #2b3a52;
  --td-fg: #e6edf7;
  --td-muted: #8a9bb6;
  --td-up: #ff3b3b;
  --td-down: #19d36b;
  --td-prev: #e8c547;
  --td-accent: #3b8cff;
  --td-alert-bg: #3a0d12;
  --td-alert-fg: #ff8a8a;
  --td-up-wash: rgb(255 59 59 / 0.16);
  --td-down-wash: rgb(25 211 107 / 0.16);
  --td-accent-wash: rgb(59 140 255 / 0.16);
  --td-hairline: 1px;

  /* Tokens read by TapeChart and by Tailwind utilities inside the desk. */
  --color-bg: var(--td-panel);
  --color-surface: var(--td-panel);
  --color-elevated: var(--td-raised);
  --color-fg: var(--td-fg);
  --color-muted: var(--td-muted);
  --color-subtle: var(--td-muted);
  --color-border: var(--td-line);
  --color-border-strong: var(--td-line-strong);
  --color-brand: var(--td-accent);
  --color-brand-fg: #ffffff;
  --color-up: var(--td-up);
  --color-down: var(--td-down);
  --color-tape: var(--td-prev);
  --color-warn: #e7b549;
  --color-vwap: #9eb6d4;
  --color-vol: #8a9bb6;

  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--td-bg);
  color: var(--td-fg);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
}
@media (min-resolution: 2dppx) {
  .trading-desk {
    --td-hairline: 0.5px;
  }
}
.trading-desk[data-layout="desktop"] {
  height: 100dvh;
}
.trading-desk .td-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.trading-desk[data-layout="desktop"] .td-main {
  overflow: auto;
}
.trading-desk .td-num,
.trading-desk time,
.trading-desk output {
  font-family: var(--font-mono);
}
.trading-desk :is(button, select, input, textarea, summary, a, [tabindex]):focus-visible {
  outline: 2px solid var(--td-accent);
  outline-offset: 1px;
}
.trading-desk [data-tone="up"] {
  --td-tone: var(--td-up);
}
.trading-desk [data-tone="down"] {
  --td-tone: var(--td-down);
}
.trading-desk [data-tone="flat"] {
  --td-tone: var(--td-fg);
}
.trading-desk button:disabled {
  cursor: not-allowed;
}

/* Shared pieces */
.trading-desk .td-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding: 0 10px;
  background: var(--td-title);
  border-bottom: 1px solid var(--td-title-line);
  font-size: 13px;
  font-weight: 600;
}
.trading-desk .td-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 14px;
  color: var(--td-fg);
  background: var(--td-raised);
  border: 1px solid var(--td-line-strong);
  border-radius: 4px;
  font-weight: 600;
}
.trading-desk .td-button[data-variant="primary"] {
  color: #ffffff;
  background: var(--td-accent);
  border-color: var(--td-accent);
}
.trading-desk .td-chip {
  display: inline-block;
  padding: 1px 6px;
  color: var(--td-fg);
  border: 1px solid var(--td-line-strong);
  border-radius: 2px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

/* Status bar */
.trading-desk .td-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  padding: 0 12px;
  background: var(--td-title);
  border-bottom: 1px solid var(--td-title-line);
  white-space: nowrap;
}
.trading-desk .td-bar :is(button, select, a) {
  min-height: 28px;
}
.trading-desk :is(.td-home, .td-tool) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--td-fg);
  background: transparent;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.trading-desk :is(.td-home, .td-tool) svg {
  width: 15px;
  height: 15px;
}
.trading-desk :is(.td-home, .td-tool):hover {
  background: rgb(255 255 255 / 0.08);
}
.trading-desk .td-tool:is([aria-expanded="true"], [aria-pressed="true"]) {
  color: #ffffff;
  background: var(--td-accent);
  border-color: var(--td-accent);
}
.trading-desk .td-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.trading-desk .td-brand svg {
  width: 18px;
  height: 18px;
  color: var(--td-prev);
}
.trading-desk .td-lesson select {
  height: 28px;
  padding: 0 24px 0 8px;
  color: var(--td-fg);
  background: rgb(0 0 0 / 0.25);
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 4px;
  font: 500 12px/1 var(--font-mono);
}
.trading-desk .td-subject {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.trading-desk .td-subject span {
  color: var(--td-prev);
}
.trading-desk .td-clock {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.trading-desk .td-clock i {
  align-self: center;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--td-muted);
}
.trading-desk .td-clock[data-state="running"] i {
  background: var(--td-up);
}
.trading-desk .td-clock strong {
  font: 600 16px/1 var(--font-mono);
}
.trading-desk .td-clock small {
  color: rgb(230 237 247 / 0.72);
  font-size: 11px;
}
.trading-desk .td-account {
  display: flex;
  gap: 14px;
  margin: 0;
}
.trading-desk .td-account div {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.trading-desk .td-account dt {
  color: rgb(230 237 247 / 0.72);
  font-size: 11px;
}
.trading-desk .td-account dd {
  margin: 0;
  font: 600 14px/1 var(--font-mono);
}
.trading-desk .td-account dd[data-tone] {
  color: var(--td-tone);
}
.trading-desk .td-replay {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.trading-desk .td-replay button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 10px;
  color: var(--td-fg);
  background: rgb(0 0 0 / 0.25);
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.trading-desk .td-replay svg {
  width: 14px;
  height: 14px;
}
.trading-desk .td-replay button:disabled {
  opacity: 0.45;
}
.trading-desk :is(.td-play[data-running="true"], .td-start) {
  color: #ffffff;
  background: var(--td-up);
  border-color: var(--td-up);
}
.trading-desk .td-speed {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 4px;
}
.trading-desk .td-replay .td-speed button {
  border: 0;
  border-radius: 0;
  background: transparent;
  font-family: var(--font-mono);
}
.trading-desk .td-replay .td-speed button[aria-pressed="true"] {
  background: var(--td-accent);
}

/* Hint row */
.trading-desk .td-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  min-height: 28px;
  padding: 3px 12px;
  background: var(--td-panel);
  border-bottom: 1px solid var(--td-line);
  font-size: 12px;
}
.trading-desk .td-hints > p {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  margin: 0;
}
.trading-desk :is(.td-tip, .td-alert) > span:first-child {
  flex: none;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 700;
}
.trading-desk .td-tip {
  color: var(--td-muted);
}
.trading-desk .td-tip > span:first-child {
  color: #0b111b;
  background: var(--td-prev);
  border-radius: 2px;
}
.trading-desk .td-alert {
  margin-left: auto;
  padding-right: 8px;
  color: var(--td-alert-fg);
  background: var(--td-alert-bg);
}
.trading-desk .td-alert > span:first-child {
  color: #ffffff;
  background: var(--td-up);
}
.trading-desk .td-feedback {
  margin-left: auto;
  color: #9ce6ce;
}
.trading-desk .td-banner {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin: 0;
  padding: 8px 10px;
  background: var(--td-raised);
  border-left: 3px solid var(--td-prev);
}
.trading-desk .td-banner h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
.trading-desk .td-banner p {
  margin: 0;
  color: var(--td-muted);
}
.trading-desk .td-banner-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.trading-desk .td-main > :is(.td-banner, .td-loading, section:not(.td-workbench)) {
  margin: 12px;
}
.trading-desk .td-loading {
  color: var(--td-muted);
}

/* Lesson resources drawer: stays in the DOM while hidden. */
.trading-desk .td-resources {
  position: fixed;
  inset: 40px 0 0 auto;
  z-index: 30;
  width: min(440px, 100vw);
  overflow: auto;
  padding-bottom: 24px;
  background: var(--td-panel);
  border-left: 1px solid var(--td-line-strong);
  box-shadow: -12px 0 32px rgb(0 0 0 / 0.5);
}
.trading-desk .td-resources[hidden] {
  display: none;
}
.trading-desk .td-resources-head {
  position: sticky;
  top: 0;
  z-index: 1;
}
.trading-desk .td-resources-head h2 {
  margin: 0;
  font-size: 14px;
  outline: none;
}
.trading-desk .td-section {
  border-bottom: var(--td-hairline) solid var(--td-line);
}
.trading-desk .td-section > summary {
  padding: 10px 12px;
  font-weight: 600;
  cursor: pointer;
}
.trading-desk .td-section > :not(summary) {
  margin: 0 12px 12px;
}

/* Workbench grid */
.trading-desk .td-workbench {
  position: relative;
  min-width: 0;
}
.trading-desk[data-layout="desktop"] .td-workbench {
  display: grid;
  height: 100%;
  grid-template-columns: minmax(240px, 21fr) minmax(0, 55fr) minmax(300px, 24fr);
  grid-template-rows: minmax(0, 1fr) 190px;
  grid-template-areas:
    "watch center trade"
    "watch ledger trade";
}
.trading-desk[data-layout="tablet"] .td-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 38%);
  grid-template-rows: auto minmax(460px, 1fr) auto;
  grid-template-areas:
    "watch watch"
    "center trade"
    "ledger trade";
}
.trading-desk .td-watch {
  grid-area: watch;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--td-panel);
  border-right: 1px solid var(--td-line);
}
.trading-desk[data-layout="tablet"] .td-watch {
  border-right: 0;
  border-bottom: 1px solid var(--td-line);
}
.trading-desk .td-center {
  grid-area: center;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--td-panel);
}
.trading-desk .td-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.trading-desk .td-trade {
  grid-area: trade;
  min-height: 0;
  overflow: auto;
  background: var(--td-panel);
  border-left: 1px solid var(--td-line);
}
.trading-desk .td-ledger {
  grid-area: ledger;
  min-height: 0;
  overflow: auto;
  background: var(--td-panel);
  border-top: 1px solid var(--td-line);
}
.trading-desk .td-workbench:not(:has(.td-ledger)) .td-center {
  grid-row: 1 / 3;
}
.trading-desk[data-layout="tablet"] .td-workbench:not(:has(.td-ledger)) .td-center {
  grid-row: 2 / 4;
}
.trading-desk .td-plan {
  z-index: 5;
  overflow: auto;
  padding: 16px;
  background: rgb(5 8 13 / 0.97);
}
.trading-desk[data-layout="desktop"] .td-plan {
  grid-area: 1 / 2 / 3 / 4;
}
.trading-desk[data-layout="tablet"] .td-plan {
  grid-area: 2 / 1 / 4 / 3;
}
.trading-desk .td-plan-close {
  margin-bottom: 12px;
}
.trading-desk .td-empty {
  margin: 0;
  padding: 24px 16px;
  color: var(--td-muted);
  text-align: center;
}
```

- [ ] **Step 4: 建立 `src/components/morning-desk-bar.tsx`**

```tsx
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, CandlestickChart, CirclePause, Play } from "lucide-react";
import { DisplayControls } from "@/components/display-controls";
import type { MorningAlert } from "@/lib/morning-alerts";
import type { MorningLessonSummary, MorningState } from "@/lib/morning";
import type { MorningExercise } from "@/lib/morning-exercises";
import { formatMoney, formatTime } from "@/lib/utils";

export type ReplaySpeed = 1 | 2;

/** Milliseconds between automatic one-minute advances; 2x equals the server's one-second floor. */
export const REPLAY_DELAY: Record<ReplaySpeed, number> = { 1: 2000, 2: 1000 };

export function DeskBar({ children }: { children?: ReactNode }) {
  return (
    <header className="td-bar" aria-label="交易工作台">
      <Link to="/" aria-label="返回教室大廳" className="td-home">
        <ArrowLeft aria-hidden />
        <span>大廳</span>
      </Link>
      <span className="td-brand">
        <CandlestickChart aria-hidden />
        <span>當沖大富翁</span>
      </span>
      {children}
      <DisplayControls compact className="td-tool" />
    </header>
  );
}

export function StatusBar({
  lessons,
  lessonId,
  exercise,
  session,
  showPlan,
  cursor,
  completed,
  auto,
  speed,
  busy,
  playDisabled,
  canAdvance,
  reviewDisabled,
  resourcesOpen,
  onLessonChange,
  onStartPlan,
  onTogglePlay,
  onSpeed,
  onAdvance,
  onReview,
  onResources,
}: {
  lessons: MorningLessonSummary[];
  lessonId: string;
  exercise?: MorningExercise;
  session: MorningState | null;
  showPlan: boolean;
  cursor: number;
  completed: boolean;
  auto: boolean;
  speed: ReplaySpeed;
  busy: boolean;
  playDisabled: boolean;
  canAdvance: boolean;
  reviewDisabled: boolean;
  resourcesOpen: boolean;
  onLessonChange: (lessonId: string) => void;
  onStartPlan: () => void;
  onTogglePlay: () => void;
  onSpeed: (speed: ReplaySpeed) => void;
  onAdvance: () => void;
  onReview: () => void;
  onResources: () => void;
}) {
  const profit = session ? session.equity - session.startingCash : 0;
  const state = showPlan ? "idle" : completed ? "done" : auto ? "running" : "paused";
  return (
    <DeskBar>
      <label className="td-lesson">
        <span className="sr-only">教材交易日</span>
        <select
          aria-label="教材交易日"
          value={lessonId}
          disabled={busy}
          onChange={(event) => onLessonChange(event.target.value)}
        >
          {lessons.map((lesson) => (
            <option key={lesson.lessonId} value={lesson.lessonId}>
              {lesson.date} · {lesson.symbols.length} 檔
            </option>
          ))}
        </select>
      </label>
      <span className="td-subject">
        <span>{exercise?.no ?? "自由練習"}</span>
        <strong>{exercise?.title ?? "真實歷史行情練習"}</strong>
      </span>
      <span className="td-clock" data-state={state}>
        <i aria-hidden />
        <strong>{showPlan ? "09:00" : formatTime(cursor * 60).slice(0, 5)}</strong>
        <small>
          {showPlan ? "待開始" : completed ? "已完成" : auto ? "重播中" : "已暫停"}
        </small>
      </span>
      {session && !showPlan && (
        <dl className="td-account" aria-label="模擬帳戶">
          <div>
            <dt>本輪損益</dt>
            <dd data-tone={profit > 0 ? "up" : profit < 0 ? "down" : "flat"}>
              {profit > 0 ? "+" : ""}
              {formatMoney(profit, 0)}
            </dd>
          </div>
          <div>
            <dt>可用資金</dt>
            <dd>{formatMoney(session.cash, 0)}</dd>
          </div>
        </dl>
      )}
      <div className="td-replay" role="group" aria-label="歷史行情重播控制">
        {showPlan ? (
          <button type="button" className="td-start" onClick={onStartPlan}>
            <Play aria-hidden />
            開始練習
          </button>
        ) : (
          <>
            <button
              type="button"
              className="td-play"
              data-running={auto}
              title={`每 ${REPLAY_DELAY[speed] / 1000} 秒前進 1 分鐘`}
              disabled={playDisabled}
              onClick={onTogglePlay}
              aria-label={auto ? "暫停重播" : "自動重播"}
            >
              {auto ? <CirclePause aria-hidden /> : <Play aria-hidden />}
              <span>{auto ? "暫停" : "播放"}</span>
            </button>
            <span className="td-speed" role="group" aria-label="重播速度">
              {([1, 2] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={speed === value}
                  onClick={() => onSpeed(value)}
                >
                  {value}x
                </button>
              ))}
            </span>
            <button
              type="button"
              aria-label="前進 1 分鐘"
              disabled={!canAdvance}
              onClick={onAdvance}
            >
              +1 分
            </button>
            <button type="button" disabled={reviewDisabled} onClick={onReview}>
              <BookOpen aria-hidden />
              <span>復盤</span>
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        className="td-tool"
        aria-expanded={resourcesOpen}
        aria-controls="td-resources"
        onClick={onResources}
      >
        <BookOpen aria-hidden />
        教材
      </button>
    </DeskBar>
  );
}

export function HintBar({
  tip,
  alert,
  feedback,
  children,
}: {
  tip?: string;
  alert?: MorningAlert;
  feedback?: string;
  children?: ReactNode;
}) {
  return (
    <section className="td-hints" aria-label="教學提示與快訊">
      {tip && (
        <p className="td-tip">
          <span>教學</span>
          {tip}
        </p>
      )}
      {feedback ? (
        <p role="status" className="td-feedback">
          {feedback}
        </p>
      ) : alert ? (
        <p
          className="td-alert"
          data-kind={alert.kind}
          aria-live={alert.kind === "fill" ? "polite" : "off"}
        >
          <span>快訊</span>
          <time>{formatTime(alert.t).slice(0, 5)}</time>
          {alert.text}
        </p>
      ) : null}
      {children}
    </section>
  );
}
```

- [ ] **Step 5: 改寫 `PageFrame`**

在 `src/components/morning-practice.tsx`：
- 匯入改為 `import { useTerminalLayout, type TerminalLayout } from "@/lib/use-terminal-layout";`。
- 新增 `import { DeskBar, HintBar, REPLAY_DELAY, StatusBar, type ReplaySpeed } from "@/components/morning-desk-bar";`。
- 新增 `import { deriveMorningAlerts } from "@/lib/morning-alerts";`。
- 刪除 `DARK_CHART` 常數；`react` 匯入中的 `type CSSProperties` 也一併刪除（它只被 `DARK_CHART` 使用）。在 `MorningChart` 的 `<section>` 上移除 `style={DARK_CHART}`。
- 把整個 `function PageFrame(…) {…}` 替換為：
```tsx
function PageFrame({
  children,
  layout,
  bar,
  hints,
}: {
  children: ReactNode;
  layout?: TerminalLayout;
  bar?: ReactNode;
  hints?: ReactNode;
}) {
  return (
    <div data-market-theme="dark" data-layout={layout} className="trading-desk">
      {bar ?? <DeskBar />}
      {hints}
      <main className="td-main">{children}</main>
    </div>
  );
}
```
`PageFrame` 不再使用的匯入（例如 `ArrowLeft`、`CandlestickChart`）若在檔內其他地方也沒用到就刪除；`npx tsc --noEmit` 與 eslint 會列出。

- [ ] **Step 6: 播放速度與教材面板狀態**

在 `MorningLesson` 的 state 宣告區（`const [feedback, setFeedback] = useState("");` 附近）加入：
```tsx
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourcesHeading = useRef<HTMLHeadingElement>(null);
```
在自動播放的 `useEffect` 中，把 `Math.max(2000, nextAdvanceAt - Date.now() + 30)` 改為 `Math.max(REPLAY_DELAY[speed], nextAdvanceAt - Date.now() + 30)`，並在相依陣列加入 `speed`。
新增：
```tsx
  useEffect(() => {
    if (resourcesOpen) resourcesHeading.current?.focus({ preventScroll: true });
  }, [resourcesOpen]);
```
在 `const orderTicket = …` 之後加入：
```tsx
  const latestAlert =
    catalog && marketSession ? deriveMorningAlerts(catalog, marketSession).at(-1) : undefined;
```

- [ ] **Step 7: 頁面組合**

在 `MorningLesson` 的 `return (` 中，把開頭的 `<PageFrame>` 改為：
```tsx
    <PageFrame
      layout={layout}
      bar={
        data && catalog ? (
          <StatusBar
            lessons={data.lessons ?? [catalog]}
            lessonId={catalog.lessonId}
            exercise={exercise}
            session={marketSession ?? null}
            showPlan={showPlan}
            cursor={cursor}
            completed={completed}
            auto={auto}
            speed={speed}
            busy={Boolean(busy)}
            playDisabled={
              Boolean(busy) || atCheckpoint || atEnd || completed || Boolean(error || notice)
            }
            canAdvance={canAdvance && !error && !notice}
            reviewDisabled={Boolean(busy) || completed}
            resourcesOpen={resourcesOpen}
            onLessonChange={(next) => {
              setAuto(false);
              onLessonChange(next);
            }}
            onStartPlan={() => setPlanOpen(true)}
            onTogglePlay={() => {
              setFeedback("");
              setAuto((value) => !value);
            }}
            onSpeed={setSpeed}
            onAdvance={() => void advance()}
            onReview={openReview}
            onResources={() => setResourcesOpen((value) => !value)}
          />
        ) : undefined
      }
      hints={
        data && catalog ? (
          <HintBar
            tip={exercise?.principle}
            alert={latestAlert}
            feedback={showPlan ? "" : feedback}
          >
            {atCheckpoint && !showPlan && (
              <div role="status" className="td-banner">
                <h2>10:00，回看自己的計畫</h2>
                <p>主要練習時段已結束。可以寫復盤，或選擇延伸至 10:30；系統不會自動平倉。</p>
                <div className="td-banner-actions">
                  <button
                    type="button"
                    className="td-button"
                    data-variant="primary"
                    onClick={openReview}
                  >
                    現在寫復盤
                  </button>
                  <button type="button" className="td-button" onClick={() => setExtended(true)}>
                    延伸觀察至 10:30
                  </button>
                </div>
              </div>
            )}
            {atEnd && !completed && !showPlan && (
              <p role="status" className="td-banner">
                已到 {catalog.end}，本課沒有下一分鐘。請核對委託與剩餘庫存，再保存復盤；系統不會自動平倉。
              </p>
            )}
          </HintBar>
        ) : undefined
      }
    >
```
接著在同一個 return 內：
1. 刪除整段 `<section className="quote-session-toolbar" …>…</section>`（教材交易日、課程名稱與步驟條已移到狀態列）。
2. 刪除 `{marketSession && !singlePane && <AccountSummary session={marketSession} />}`。
3. 刪除整段 `<section className="quote-replay-bar" …>…</section>`。
4. 刪除 `{feedback && !showPlan && (<p role="status" className="quote-feedback">…</p>)}`、`{atCheckpoint && !showPlan && (…)}`、`{atEnd && !completed && !showPlan && (…)}` 三段（已移到提示列）。
5. 類別改名：`quote-workbench` → `td-workbench`；`quote-watch-panel` → `td-watch`；`terminal-plan-note` → `td-plan-note`；`quote-market-panel` → `td-center`；`quote-active-pane` → `td-pane`；`quote-mobile-ticket` → `td-mobile-ticket`（兩處）；`quote-empty-pane` → `td-empty`；`quote-trade-panel` → `td-trade`；`quote-plan-panel` → `td-plan`；`quote-plan-close` → `td-plan-close`，並在該按鈕加上 `td-button`（`className="td-plan-close td-button"`）；`quote-ledger-panel` → `td-ledger`；`quote-loading` → `td-loading`；檔內**所有** `quote-alert`（錯誤、通知、教材區的「已恢復這個交易日尚未完成的練習」提示）→ `td-banner`。改完後 `grep -n "quote-" src/components/morning-practice.tsx` 只應剩下 Task 8 會處理的 `quote-tabs`、`quote-overview` 等報價與圖表類別。
6. 把 `<div className="terminal-resources" aria-label="教材與練習資料">` 這個區塊的外層換成教材面板，內部三個 `<details className="quote-settings">` 的類別改為 `td-section`（`summary` 的 `id="morning-lesson-picker"` 保留）：
```tsx
              <aside
                id="td-resources"
                className="td-resources"
                hidden={!resourcesOpen}
                aria-labelledby="td-resources-title"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setResourcesOpen(false);
                }}
              >
                <header className="td-titlebar td-resources-head">
                  <h2 id="td-resources-title" ref={resourcesHeading} tabIndex={-1}>
                    教材與資料
                  </h2>
                  <button
                    type="button"
                    className="td-tool"
                    onClick={() => setResourcesOpen(false)}
                  >
                    關閉
                  </button>
                </header>
                {/* 原本的三個 <details>，className 改為 "td-section"，內容不變 */}
              </aside>
```
這個 `aside` 放在原本 `terminal-resources` 的位置。關閉時只用 `hidden` 屬性隱藏，計畫原因與復盤文字仍留在 DOM。

- [ ] **Step 8: 型別、lint、測試、建置**

```bash
npx tsc --noEmit
npx eslint src --quiet
npm test
npm run build
```
預期：tsc 與 eslint 無輸出；`npm test` 為 0 失敗（項目數比 554 多出 Task 2–5 新增的測試）；建置結尾 `"offlineVerified": true`。

- [ ] **Step 9: 畫面檢查**

啟動驗收伺服器、播種後執行：
```bash
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 task7
node scripts/qa/desk-orders.mjs http://127.0.0.1:18811 task7
node scripts/qa/desk-stop.mjs 18811
```
預期：
- `orders.json` 與 `artifacts/trading-desk-qa/before/orders.json` 的內容相同。
- `task7/1366x900.png` 的頂部是一條藍色狀態列（大廳、品牌、教材交易日、課程、時間、損益、資金、播放、1x/2x、+1 分、復盤、教材、長輩），下方是提示列；三欄格線已就位，欄內區塊尚未完成樣式。

- [ ] **Step 10: 提交**

```bash
git add src/trading-desk.css src/components/morning-desk-bar.tsx src/components/morning-practice.tsx src/styles.css src/classroom-refresh.css
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: trading desk shell with status bar, hint row and lesson drawer" -m "Replaces the stacked trading-screen stylesheets with src/trading-desk.css." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
（`git rm` 已在 Step 1 暫存刪除。）

---

### Task 8: 中欄：報價標題列、走勢圖面板、庫存區

**Files:**
- Modify: `src/components/morning-practice.tsx`（`MorningQuote`、`MorningTerminalNav`、`MorningChart`、新增 `MorningDataDetails`、`MorningLesson` 中的使用處）
- Modify: `src/components/morning-trading.tsx`（`Ledger` 標題列）
- Modify: `src/trading-desk.css`（檔案最後追加）

**Interfaces:**
- Consumes: `formatPercentChange`（Task 3）、`td-center`、`td-pane`、`td-titlebar`（Task 7）
- Produces: `MorningQuote` 新增屬性 `nav?: ReactNode`；`MorningDataDetails({ catalog, session, code })`（放在教材面板）

- [ ] **Step 1: 改寫 `MorningQuote`**

把整個 `function MorningQuote(…) {…}` 替換為（另在檔案頂端加入 `import { candleWindow, formatPercentChange } from "@/lib/market/chart-data";`，取代 Task 6 的單一匯入）：
```tsx
function MorningQuote({
  catalog,
  session,
  code,
  onSelect,
  titleRef,
  nav,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  onSelect: (code: string) => void;
  titleRef: RefObject<HTMLHeadingElement | null>;
  nav?: ReactNode;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const index = catalog.symbols.findIndex((item) => item.code === symbol.code);
  const revealed = session?.bars[symbol.code] ?? [];
  const last = revealed.at(-1);
  const change = last ? last.c - symbol.previousClose : null;
  const tone = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";
  const move = (step: number) =>
    onSelect(
      catalog.symbols[(index + step + catalog.symbols.length) % catalog.symbols.length].code,
    );
  return (
    <>
      <header className="td-quote" data-tone={tone}>
        <div className="td-quote-id">
          <h1 ref={titleRef} tabIndex={-1} id="morning-practice-title">
            {symbol.name}
            <small>{symbol.code}</small>
          </h1>
          <select
            aria-label="選擇股票"
            value={symbol.code}
            onChange={(event) => onSelect(event.target.value)}
          >
            {catalog.symbols.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
          <div className="td-quote-arrows">
            <button type="button" onClick={() => move(-1)} aria-label="上一檔股票">
              <ChevronLeft aria-hidden />
            </button>
            <button type="button" onClick={() => move(1)} aria-label="下一檔股票">
              <ChevronRight aria-hidden />
            </button>
          </div>
        </div>
        {nav}
        <p className="td-quote-price" title="最新完整分鐘收價">
          <strong>{last ? formatPrice(last.c) : "—"}</strong>
          {change !== null && last ? (
            <>
              <span>
                {change > 0 ? "▲" : change < 0 ? "▼" : ""}
                {Math.abs(change).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}
              </span>
              <span>{formatPercentChange(last.c, symbol.previousClose)}</span>
            </>
          ) : (
            <span>待揭露第一分鐘</span>
          )}
        </p>
      </header>
      <dl className="td-quote-stats" aria-label="已揭露行情摘要">
        {[
          ["昨收", symbol.previousClose],
          ["開盤", revealed[0]?.o],
          ["最高", revealed.length ? Math.max(...revealed.map((bar) => bar.h)) : undefined],
          ["最低", revealed.length ? Math.min(...revealed.map((bar) => bar.l)) : undefined],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{typeof value === "number" ? formatPrice(value) : "—"}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
```

- [ ] **Step 2: 分頁列改名並放進標題列**

在 `MorningTerminalNav` 中把兩處 `["quote", "行情"]` 改為 `["quote", "分時"]`，並把 `<nav aria-label="看盤分頁" className="quote-tabs">` 改為 `<nav aria-label="看盤分頁" className="td-tabs" data-variant={singlePane ? "panes" : "chart"}>`。

在 `MorningLesson` 中，把
```tsx
                  {!(singlePane && (activePane === "trade" || activePane === "positions")) && (
                    <MorningQuote
                      catalog={catalog}
                      session={marketSession ?? null}
                      code={code}
                      onSelect={setSelected}
                      titleRef={practiceHeading}
                    />
                  )}
                  <MorningTerminalNav
                    active={singlePane || activePane === "quote" ? activePane : "chart"}
                    onSelect={setActivePane}
                    singlePane={singlePane}
                  />
```
改為：
```tsx
                  {!(singlePane && (activePane === "trade" || activePane === "positions")) && (
                    <MorningQuote
                      catalog={catalog}
                      session={marketSession ?? null}
                      code={code}
                      onSelect={setSelected}
                      titleRef={practiceHeading}
                      nav={singlePane ? undefined : paneNav}
                    />
                  )}
                  {singlePane && paneNav}
```
並在 `return (` 之前定義：
```tsx
  const paneNav = (
    <MorningTerminalNav
      active={singlePane || activePane === "quote" ? activePane : "chart"}
      onSelect={setActivePane}
      singlePane={singlePane}
    />
  );
```

- [ ] **Step 3: 圖表面板與 `MorningDataDetails`**

把整個 `function MorningChart(…) {…}` 替換為以下兩個函式：
```tsx
function MorningChart({
  catalog,
  session,
  code,
  candles,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  candles: boolean;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const bars = session?.bars[code] ?? [];
  const last = bars.at(-1);
  const now = (session?.cursor ?? 0) * 60;
  const view = candles
    ? candleWindow(session?.cursor ?? 0)
    : { startT: 0, endT: catalog.maxCursor * 60 };
  const swingHighs = deriveSwingHighs(bars, now, 0, catalog.maxCursor * 60).confirmed;
  const fills = (session?.fills ?? [])
    .filter((fill) => fill.code === symbol.code)
    .map((fill) => ({ t: fill.t, p: fill.price, side: fill.side }));
  return (
    <section className="td-chart" aria-label={symbol.name + "歷史分鐘行情"}>
      <div className="td-chart-legend">
        <span className="td-chip">{candles ? "真實 1 分 K" : "分時・分鐘收價"}</span>
        {last && (
          <span aria-label="圖表最新完整分鐘">
            <time>{formatTime(last.t).slice(0, 5)}</time>
            {(
              [
                ["開", last.o],
                ["高", last.h],
                ["低", last.l],
                ["收", last.c],
              ] as const
            ).map(([label, price]) => (
              <span key={label}>
                {label}
                <strong>{formatPrice(price)}</strong>
              </span>
            ))}
          </span>
        )}
        <span className="td-chart-date">{catalog.date} 台北時間</span>
      </div>
      <div className="td-chart-canvas">
        {last && session ? (
          <TapeChart
            bars={bars}
            ticks={[]}
            prev={symbol.previousClose}
            high={Math.max(...bars.map((bar) => bar.h))}
            low={Math.min(...bars.map((bar) => bar.l))}
            last={last.c}
            open={bars[0]?.o}
            startT={view.startT}
            endT={view.endT}
            now={now}
            swingHighs={swingHighs}
            fills={fills}
            variant={candles ? "candles" : "stock"}
            presentation="terminal"
            showVolume={false}
            showAverage={false}
            showVolumeReadout={false}
            appendCurrentQuote={false}
            completedBarSeconds={60}
            interactive
            ariaLabel={
              catalog.date +
              " " +
              code +
              " " +
              symbol.name +
              "歷史" +
              (candles ? "一分鐘K線" : "分鐘收價連線") +
              "，只包含目前已完成分鐘，不顯示成交量或均價。"
            }
          />
        ) : (
          <div className="td-chart-waiting">
            <strong>09:00</strong>
            <span>等待第一根完整 K 棒</span>
            <small>
              {session ? "前進一分鐘後揭露真實行情" : "先保存作戰計畫，開始當日歷史回放"}
            </small>
          </div>
        )}
      </div>
    </section>
  );
}

function MorningDataDetails({
  catalog,
  session,
  code,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const bars = session?.bars[symbol.code] ?? [];
  const last = bars.at(-1);
  return (
    <details className="td-section">
      <summary>報價彙總與 K 棒明細{last ? " · " + bars.length + " 根" : ""}</summary>
      <div className="td-data-details">
        <dl className="grid grid-cols-2 gap-3">
          <Metric label="前一交易日收盤" value={formatPrice(symbol.previousClose)} />
          <Metric
            label="前 5 個完整交易日收盤均值"
            value={symbol.previous5CloseMean.toLocaleString("zh-TW", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          />
        </dl>
        <p>以上均值不含本日，僅供歷史參考；當日 SMA5 的計算定義尚未確認。</p>
        {last && (
          <div
            className="td-candle-table"
            tabIndex={0}
            role="region"
            aria-label="已完成分鐘 K 線明細，可捲動查看"
          >
            <table>
              <caption>
                {catalog.date} · {symbol.name} {symbol.code} · Yahoo Finance 原始
                OHLC。時間為分鐘起點，整根於下一分鐘揭露。
              </caption>
              <thead>
                <tr>
                  {["分鐘", "開盤", "最高", "最低", "收盤"].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bars.map((bar) => (
                  <tr key={bar.t}>
                    <th scope="row">{formatTime(bar.t).slice(0, 5)}</th>
                    {[bar.o, bar.h, bar.l, bar.c].map((price, index) => (
                      <td key={index}>{formatPrice(price)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          K 線直接使用來源開高低收，該分鐘完成後才揭露整根。分時只連接各分鐘收價，點位標在分鐘結束時間，不代表分鐘內逐筆路徑；缺漏區間保留斷線。點按圖表或用左右方向鍵查看資料。
        </p>
        <p>來源：Yahoo Finance 歷史 1 分鐘 OHLC。這是真實歷史分鐘 K，尚非富邦即時或逐筆江波行情。</p>
        <p>分鐘量尚未核對，不顯示量柱、均價或量能訊號；沒有真實五檔。資料缺漏不會以生成價格補齊。</p>
      </div>
    </details>
  );
}
```
在教材面板（`td-resources`）中，於「資料來源與本課使用說明」那個 `<details>` 之前加入：
```tsx
                <MorningDataDetails catalog={catalog} session={marketSession ?? null} code={code} />
```

- [ ] **Step 4: 庫存區標題列**

在 `src/components/morning-trading.tsx` 的 `Ledger` 中：
- 把 `<div className="sim-ledger-header">` 改為 `<div className="sim-ledger-header td-titlebar">`。
- 把
```tsx
        <span>
          本輪紀錄 <b>·</b> {formatTime(session.cursor * 60).slice(0, 5)}
        </span>
```
改為：
```tsx
        <span className="td-ledger-meta">
          帳戶估值 <b>{formatMoney(session.equity, 0)}</b> · 期初{" "}
          <b>{formatMoney(session.startingCash, 0)}</b> ·{" "}
          <time>{formatTime(session.cursor * 60).slice(0, 5)}</time>
        </span>
```

- [ ] **Step 5: 中欄樣式**

在 `src/trading-desk.css` 最後追加：
```css
/* Center column: quote title, stats, chart */
.trading-desk .td-quote {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  padding: 0 12px;
  background: var(--td-title);
  border-bottom: 1px solid var(--td-title-line);
}
.trading-desk .td-quote-id {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.trading-desk .td-quote h1 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
  outline: none;
}
.trading-desk .td-quote h1 small {
  color: rgb(230 237 247 / 0.72);
  font: 500 13px/1 var(--font-mono);
}
.trading-desk .td-quote select {
  max-width: 150px;
  height: 26px;
  padding: 0 22px 0 6px;
  color: var(--td-fg);
  background: rgb(0 0 0 / 0.25);
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 4px;
  font-size: 12px;
}
.trading-desk .td-quote-arrows {
  display: inline-flex;
  gap: 2px;
}
.trading-desk .td-quote-arrows button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--td-fg);
  background: rgb(0 0 0 / 0.25);
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 4px;
}
.trading-desk .td-quote-arrows svg {
  width: 14px;
  height: 14px;
}
.trading-desk .td-tabs {
  display: flex;
  align-self: stretch;
}
.trading-desk .td-tabs button {
  padding: 0 14px;
  color: rgb(230 237 247 / 0.72);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 600;
}
.trading-desk .td-tabs button[aria-pressed="true"] {
  color: #ffffff;
  background: rgb(0 0 0 / 0.2);
  border-bottom-color: var(--td-accent);
}
.trading-desk .td-quote-price {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 0 auto;
  color: var(--td-tone);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.trading-desk .td-quote-price strong {
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
}
.trading-desk .td-quote-price span {
  font-size: 13px;
}
.trading-desk .td-quote-stats {
  display: flex;
  gap: 18px;
  margin: 0;
  padding: 5px 12px;
  border-bottom: var(--td-hairline) solid var(--td-line);
  font-size: 12px;
}
.trading-desk .td-quote-stats div {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.trading-desk .td-quote-stats dt {
  color: var(--td-muted);
}
.trading-desk .td-quote-stats dd {
  margin: 0;
  font-family: var(--font-mono);
}
.trading-desk .td-chart {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.trading-desk .td-chart-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 5px 12px;
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .td-chart-legend > span[aria-label] {
  display: inline-flex;
  gap: 10px;
}
.trading-desk .td-chart-legend :is(time, strong) {
  margin-left: 3px;
  color: var(--td-fg);
  font-family: var(--font-mono);
  font-weight: 500;
}
.trading-desk .td-chart-date {
  margin-left: auto;
}
.trading-desk .td-chart-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
}
.trading-desk .td-chart-waiting {
  display: grid;
  place-content: center;
  gap: 4px;
  height: 100%;
  min-height: 220px;
  color: var(--td-muted);
  text-align: center;
  background: repeating-linear-gradient(0deg, transparent 0 47px, var(--td-line) 47px 48px);
}
.trading-desk .td-chart-waiting strong {
  color: var(--td-fg);
  font: 600 24px/1 var(--font-mono);
}

/* Ledger */
.trading-desk .sim-ledger {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.trading-desk .sim-ledger-header {
  position: sticky;
  top: 0;
  z-index: 1;
}
.trading-desk .sim-ledger-header nav {
  display: flex;
  align-self: stretch;
}
.trading-desk .sim-ledger-header nav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  color: rgb(230 237 247 / 0.72);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-weight: 600;
}
.trading-desk .sim-ledger-header nav button[aria-pressed="true"] {
  color: #ffffff;
  border-bottom-color: var(--td-accent);
}
.trading-desk .sim-ledger-header nav span {
  min-width: 18px;
  padding: 0 5px;
  text-align: center;
  background: rgb(0 0 0 / 0.3);
  border-radius: 2px;
  font: 500 11px/16px var(--font-mono);
}
.trading-desk .td-ledger-meta {
  color: rgb(230 237 247 / 0.78);
  font-size: 11px;
  font-weight: 500;
}
.trading-desk .td-ledger-meta b {
  color: var(--td-fg);
  font-family: var(--font-mono);
  font-weight: 600;
}
.trading-desk .sim-ledger-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.trading-desk .sim-ledger-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  padding: 16px;
  color: var(--td-muted);
  text-align: center;
}
.trading-desk .sim-ledger-empty strong {
  color: var(--td-fg);
}
.trading-desk .sim-ledger-empty p {
  margin: 0;
}
.trading-desk .terminal-record-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.trading-desk .terminal-record-table :is(th, td) {
  padding: 6px 12px;
  text-align: right;
  white-space: nowrap;
  border-bottom: var(--td-hairline) solid var(--td-line);
  font-family: var(--font-mono);
}
.trading-desk .terminal-record-table thead th {
  position: sticky;
  top: 0;
  color: var(--td-muted);
  background: var(--td-panel);
  font: 500 11px/1.4 var(--font-sans);
}
.trading-desk .terminal-record-table :is(thead th, tbody th):first-child {
  text-align: left;
}
.trading-desk .terminal-record-table tbody th strong {
  display: block;
  font: 600 13px/1.3 var(--font-sans);
}
.trading-desk .terminal-record-table tbody th small {
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .terminal-record-table tbody tr:hover {
  background: var(--td-raised);
}
.trading-desk .sim-buy {
  color: var(--td-up);
}
.trading-desk .sim-sell {
  color: var(--td-down);
}
.trading-desk .sim-status {
  display: inline-block;
  padding: 1px 6px;
  background: var(--td-raised);
  border-radius: 2px;
  font: 500 11px/1.4 var(--font-sans);
}
.trading-desk .sim-status[data-status="pending"] {
  color: var(--td-prev);
}
.trading-desk .sim-status[data-status="rejected"] {
  color: var(--td-alert-fg);
}
.trading-desk .sim-cancel {
  margin-left: 8px;
  padding: 2px 8px;
  color: var(--td-fg);
  background: transparent;
  border: 1px solid var(--td-line-strong);
  border-radius: 3px;
  font-size: 11px;
}
.trading-desk .sim-record-reason {
  display: block;
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .td-candle-table {
  max-height: 320px;
  overflow: auto;
}
.trading-desk .td-candle-table table {
  width: 100%;
  border-collapse: collapse;
  font: 12px/1.4 var(--font-mono);
}
.trading-desk .td-candle-table caption {
  padding-bottom: 6px;
  color: var(--td-muted);
  font: 11px/1.5 var(--font-sans);
  text-align: left;
}
.trading-desk .td-candle-table :is(th, td) {
  padding: 3px 8px;
  text-align: right;
  border-bottom: var(--td-hairline) solid var(--td-line);
}
.trading-desk .td-data-details {
  display: grid;
  gap: 8px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .td-data-details p {
  margin: 0;
}
```

- [ ] **Step 6: 型別、lint、建置與畫面檢查**

```bash
npx tsc --noEmit
npx eslint src --quiet
npm run build
```
啟動伺服器、播種後：
```bash
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 task8
node scripts/qa/desk-sharpness.mjs http://127.0.0.1:18811 task8
node scripts/qa/desk-stop.mjs 18811
```
預期：
- `task8/1366x900.png` 中欄依序是藍色標題列（台積電 2330、選單、左右鍵、分時/K線分頁、右側大字紅色價格）、開高低昨一行、圖例列、佔滿高度的 K 線圖、底部的庫存/委託/成交分頁。
- 1366×900 與 1920×1080 的 `chart` 比例 ≥ 0.5。
- 每個縮放比例的 `softPct` ≤ 3。

- [ ] **Step 7: 提交**

```bash
git add src/components/morning-practice.tsx src/components/morning-trading.tsx src/trading-desk.css
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: desk quote title bar, chart panel and ledger" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 自選報價與平板報價列

**Files:**
- Modify: `src/components/morning-practice.tsx`（`MorningWatchlist`）
- Modify: `src/components/morning-quotes.tsx`（`MorningSparkline` 類別）
- Modify: `src/trading-desk.css`

**Interfaces:**
- Consumes: `formatPercentChange`（Task 3）
- Produces: 類別 `td-watchlist[data-compact]`、`td-watch-head`、`td-watch-list`、`td-watch-item[data-tone]`、`td-watch-name`、`td-watch-price`、`td-watch-change`、`td-spark`、`td-watch-foot`

- [ ] **Step 1: 改寫 `MorningWatchlist`**

把整個 `function MorningWatchlist(…) {…}` 替換為：
```tsx
function MorningWatchlist({
  catalog,
  session,
  code,
  onSelect,
  compact = false,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  onSelect: (code: string) => void;
  compact?: boolean;
}) {
  return (
    <section className="td-watchlist" data-compact={compact} aria-label="自選行情">
      <div className="td-titlebar td-watch-head">
        <span>
          <CandlestickChart size={15} aria-hidden /> 自選報價
        </span>
        <span className="td-num">{catalog.symbols.length}</span>
      </div>
      <div className="td-watch-list" role="group" aria-label="選擇重播商品">
        {catalog.symbols.map((symbol) => {
          const last = session?.bars[symbol.code]?.at(-1);
          const change = last ? last.c - symbol.previousClose : null;
          const tone = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";
          return (
            <button
              type="button"
              key={symbol.code}
              className="td-watch-item"
              data-tone={tone}
              aria-pressed={code === symbol.code}
              onClick={() => onSelect(symbol.code)}
            >
              <span className="td-watch-name">
                <span>{symbol.name}</span>
                <small>{symbol.code}</small>
              </span>
              <strong className="td-watch-price">{last ? formatPrice(last.c) : "—"}</strong>
              <span className="td-watch-change">
                {change === null || !last
                  ? "尚未揭露"
                  : `${change > 0 ? "▲" : change < 0 ? "▼" : "—"} ${Math.abs(change).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}  ${formatPercentChange(last.c, symbol.previousClose)}`}
              </span>
              {!compact && (
                <MorningSparkline
                  bars={session?.bars[symbol.code] ?? []}
                  previous={symbol.previousClose}
                />
              )}
            </button>
          );
        })}
      </div>
      {!compact && <p className="td-watch-foot">已揭露分鐘收價 · 虛線為昨收</p>}
    </section>
  );
}
```

- [ ] **Step 2: 小走勢樣式類別**

在 `src/components/morning-quotes.tsx` 的 `MorningSparkline`：
- `className="terminal-spark-empty"` 改為 `className="td-spark td-spark-empty"`。
- `className="terminal-spark"` 改為 `className="td-spark"`。
- 昨收虛線的 `<path>` 移除 `stroke="#607189"` 與 `opacity="0.55"`，改加 `className="td-spark-prev"`（保留 `d`、`strokeDasharray`、`vectorEffect`）。

- [ ] **Step 3: 自選樣式**

在 `src/trading-desk.css` 最後追加：
```css
/* Watchlist */
.trading-desk .td-watchlist {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.trading-desk .td-watch-head span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.trading-desk .td-watch-head .td-num {
  padding: 0 6px;
  background: rgb(0 0 0 / 0.3);
  border-radius: 2px;
  font-size: 11px;
}
.trading-desk .td-watch-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.trading-desk .td-watch-item {
  display: grid;
  grid-template-areas:
    "name spark"
    "price spark"
    "change spark";
  grid-template-columns: minmax(0, 1fr) 92px;
  align-items: center;
  column-gap: 8px;
  width: 100%;
  padding: 8px 10px 8px 9px;
  color: var(--td-fg);
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: var(--td-hairline) solid var(--td-line);
  border-left: 3px solid transparent;
}
.trading-desk .td-watch-item:hover {
  background: var(--td-raised);
}
.trading-desk .td-watch-item[aria-pressed="true"] {
  background: var(--td-accent-wash);
  border-left-color: var(--td-accent);
}
.trading-desk .td-watch-name {
  grid-area: name;
  display: flex;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
.trading-desk .td-watch-name small {
  color: var(--td-muted);
  font: 500 11px/1.6 var(--font-mono);
}
.trading-desk .td-watch-price {
  grid-area: price;
  color: var(--td-tone);
  font: 600 24px/1.1 var(--font-mono);
}
.trading-desk .td-watch-change {
  grid-area: change;
  color: var(--td-tone);
  font: 500 12px/1.3 var(--font-mono);
  white-space: pre;
}
.trading-desk .td-spark {
  grid-area: spark;
  width: 92px;
  height: 52px;
  color: var(--td-tone);
}
.trading-desk .td-spark-empty {
  display: grid;
  place-items: center;
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .td-spark-prev {
  stroke: var(--td-prev);
  opacity: 0.6;
}
.trading-desk .td-watch-foot {
  margin: 0;
  padding: 8px 12px;
  color: var(--td-muted);
  font-size: 11px;
  border-top: var(--td-hairline) solid var(--td-line);
}
.trading-desk .td-plan-note {
  padding: 10px 12px;
  color: var(--td-muted);
  font-size: 12px;
  border-top: 1px solid var(--td-line);
}
.trading-desk .td-plan-note .terminal-eyebrow {
  display: block;
  color: var(--td-prev);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.trading-desk .td-plan-note h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  color: var(--td-fg);
  font-size: 13px;
}
.trading-desk .td-plan-note .terminal-plan-code {
  color: var(--td-accent);
  font-family: var(--font-mono);
}
.trading-desk .td-plan-note p {
  display: -webkit-box;
  margin: 4px 0 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

/* Tablet: watchlist becomes a horizontal quote strip */
.trading-desk .td-watchlist[data-compact="true"] .td-watch-list {
  display: flex;
  overflow-x: auto;
}
.trading-desk .td-watchlist[data-compact="true"] .td-watch-item {
  flex: 0 0 132px;
  grid-template-areas:
    "name"
    "price"
    "change";
  grid-template-columns: minmax(0, 1fr);
  border-bottom: 0;
  border-left: 0;
  border-right: var(--td-hairline) solid var(--td-line);
  border-top: 2px solid transparent;
}
.trading-desk .td-watchlist[data-compact="true"] .td-watch-item[aria-pressed="true"] {
  border-top-color: var(--td-accent);
}
.trading-desk .td-watchlist[data-compact="true"] .td-watch-price {
  font-size: 20px;
}
```

- [ ] **Step 4: 型別、lint、建置與畫面檢查**

```bash
npx tsc --noEmit
npx eslint src --quiet
npm run build
```
啟動伺服器、播種後：
```bash
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 task9
node scripts/qa/desk-stop.mjs 18811
```
預期：
- `task9/1366x900.png` 左欄每檔顯示名稱、代號、大字價格（紅漲綠跌）、漲跌與漲跌幅、小走勢；選取列有藍色左線。
- `task9/820x900.png` 頂部是一排可橫向捲動的報價列。

- [ ] **Step 5: 提交**

```bash
git add src/components/morning-practice.tsx src/components/morning-quotes.tsx src/trading-desk.css
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: desk watchlist rows and tablet quote strip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 直式五檔與買賣比例條

**Files:**
- Modify（整檔改寫）: `src/components/morning-order-book.tsx`
- Modify: `src/trading-desk.css`

**Interfaces:**
- Consumes: `bookPressure`（Task 4）、`createMorningBook`、`MorningBookLevel`
- Produces: `MorningOrderBook` 的屬性與行為不變（`code`、`cursor`、`last`、`previousClose`、`lots`、`holdingLots`、`flash`、`disabled`、`onLots`、`onFlash`、`onPick`）。按鈕的 `aria-label`、開關 `aria-label="閃電即送"`、群組 `aria-label="五檔下單張數"` 不變。

- [ ] **Step 1: 改寫 `src/components/morning-order-book.tsx`**

```tsx
import { Zap } from "lucide-react";
import { bookPressure, createMorningBook, type MorningBookLevel } from "@/lib/morning-book";
import { formatPrice } from "@/lib/market/ticks";

type Tone = "up" | "down" | "flat";

export function MorningOrderBook({
  code,
  cursor,
  last,
  previousClose,
  lots,
  holdingLots,
  flash,
  disabled,
  onLots,
  onFlash,
  onPick,
}: {
  code: string;
  cursor: number;
  last?: number;
  previousClose: number;
  lots: number;
  holdingLots: number;
  flash: boolean;
  disabled: boolean;
  onLots: (lots: number) => void;
  onFlash: (enabled: boolean) => void;
  onPick: (price: number, side: "buy" | "sell") => void;
}) {
  const book = createMorningBook(code, cursor, last ?? 0, previousClose);
  const maxLots = Math.max(
    1,
    ...book.asks.map((level) => level.lots),
    ...book.bids.map((level) => level.lots),
  );
  const pressure = bookPressure(book);
  const tone = (price: number): Tone =>
    price > previousClose ? "up" : price < previousClose ? "down" : "flat";
  return (
    <div className="td-book" data-flash={flash}>
      <div className="td-book-head">
        <span className="td-chip">教學模擬五檔</span>
        <span>
          可賣 <b className="td-num">{holdingLots}</b> 張
        </span>
      </div>
      <div className="td-ladder-labels" aria-hidden="true">
        <span>檔位</span>
        <span>價格</span>
        <span>模擬量</span>
      </div>
      <BookLevels
        levels={[...book.asks].reverse()}
        side="buy"
        lots={lots}
        maxLots={maxLots}
        tone={tone}
        disabled={disabled}
        onPick={onPick}
        empty={last ? "漲停範圍內無價位" : "等待第一分鐘"}
      />
      <div className="td-ladder-mid" data-tone={last ? tone(last) : "flat"}>
        <span>最新分鐘收價</span>
        <strong>{last ? formatPrice(last) : "—"}</strong>
      </div>
      <BookLevels
        levels={book.bids}
        side="sell"
        lots={lots}
        maxLots={maxLots}
        tone={tone}
        disabled={disabled || holdingLots < lots}
        onPick={onPick}
        empty={last ? "跌停範圍內無價位" : "等待第一分鐘"}
      />
      <div
        className="td-pressure"
        role="img"
        aria-label={`教學模擬委買 ${pressure.bidLots} 張、委賣 ${pressure.askLots} 張`}
      >
        <span style={{ width: `${pressure.bidShare * 100}%` }} />
        <small>委買 {pressure.bidLots}</small>
        <small>委賣 {pressure.askLots}</small>
      </div>
      <div className="td-flash">
        <span>
          <Zap aria-hidden />
          閃電下單
        </span>
        <button
          type="button"
          role="switch"
          className="td-switch"
          aria-label="閃電即送"
          aria-checked={flash}
          disabled={!flash && disabled}
          onClick={() => onFlash(!flash)}
        >
          <i aria-hidden />
          {flash ? "已開啟" : "開啟即送"}
        </button>
      </div>
      <div className="td-lots" role="group" aria-label="五檔下單張數">
        <span>每筆張數</span>
        {[1, 2, 3].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={lots === value}
            disabled={disabled}
            onClick={() => onLots(value)}
          >
            {value} 張
          </button>
        ))}
      </div>
      <p className="td-book-hint" role="status">
        {flash ? `點價即送 ${lots} 張限價模擬委託` : "點價格核對委託；開啟閃電可直接送單"}
      </p>
      <p className="td-book-source">五檔價量為教學生成，非真實委託簿。</p>
    </div>
  );
}

function BookLevels({
  levels,
  side,
  lots,
  maxLots,
  tone,
  disabled,
  onPick,
  empty,
}: {
  levels: MorningBookLevel[];
  side: "buy" | "sell";
  lots: number;
  maxLots: number;
  tone: (price: number) => Tone;
  disabled: boolean;
  onPick: (price: number, side: "buy" | "sell") => void;
  empty: string;
}) {
  const ask = side === "buy";
  return (
    <div
      className="td-ladder"
      data-side={side}
      role="group"
      aria-label={ask ? "賣方五檔，點價模擬買進" : "買方五檔，點價模擬賣出"}
    >
      {levels.map((level) => (
        <button
          type="button"
          key={level.level}
          className="td-level"
          data-side={side}
          data-tone={tone(level.price)}
          disabled={disabled}
          aria-label={`${ask ? "賣" : "買"}${level.level} 價格 ${formatPrice(level.price)}，模擬${ask ? "買進" : "賣出"} ${lots} 張`}
          onKeyDown={(event) => {
            if (event.repeat && (event.key === "Enter" || event.key === " "))
              event.preventDefault();
          }}
          onClick={(event) => {
            if (event.detail < 2) onPick(level.price, side);
          }}
        >
          <i
            className="td-level-fill"
            style={{ width: `${(level.lots / maxLots) * 100}%` }}
            aria-hidden
          />
          <span className="td-level-rank">
            {ask ? "賣" : "買"}
            {level.level}
          </span>
          <strong className="td-level-price">{formatPrice(level.price)}</strong>
          <span className="td-level-lots">{level.lots}</span>
        </button>
      ))}
      {!levels.length && <p className="td-ladder-empty">{empty}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 五檔樣式**

在 `src/trading-desk.css` 最後追加：
```css
/* Order book ladder */
.trading-desk .td-book {
  display: flex;
  flex-direction: column;
}
.trading-desk .td-book-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .td-book-head b {
  color: var(--td-fg);
}
.trading-desk .td-ladder-labels,
.trading-desk .td-level {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 72px;
  align-items: center;
}
.trading-desk .td-ladder-labels {
  padding: 2px 10px;
  color: var(--td-muted);
  font-size: 11px;
  border-bottom: var(--td-hairline) solid var(--td-line);
}
.trading-desk .td-ladder-labels span:not(:first-child) {
  text-align: right;
}
.trading-desk .td-ladder {
  display: flex;
  flex-direction: column;
}
.trading-desk .td-level {
  position: relative;
  min-height: 28px;
  padding: 0 10px;
  color: var(--td-fg);
  text-align: right;
  background: transparent;
  border: 0;
  border-bottom: var(--td-hairline) solid rgb(28 38 54 / 0.7);
  font-family: var(--font-mono);
  font-size: 14px;
  cursor: pointer;
}
.trading-desk .td-level:hover:not(:disabled) {
  background: var(--td-raised);
  outline: 1px solid var(--td-accent);
  outline-offset: -1px;
}
.trading-desk .td-level:disabled {
  opacity: 0.55;
}
.trading-desk .td-level-fill {
  position: absolute;
  inset: 3px 0 3px auto;
  pointer-events: none;
}
.trading-desk .td-level[data-side="buy"] .td-level-fill {
  background: var(--td-down-wash);
}
.trading-desk .td-level[data-side="sell"] .td-level-fill {
  background: var(--td-up-wash);
}
.trading-desk .td-level-rank {
  position: relative;
  text-align: left;
  font: 500 11px/1 var(--font-sans);
}
.trading-desk .td-level[data-side="buy"] .td-level-rank {
  color: var(--td-down);
}
.trading-desk .td-level[data-side="sell"] .td-level-rank {
  color: var(--td-up);
}
.trading-desk .td-level-price {
  position: relative;
  color: var(--td-tone);
  font-weight: 600;
}
.trading-desk .td-level-lots {
  position: relative;
}
.trading-desk .td-ladder-mid {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--td-raised);
  border-block: 1px solid var(--td-line-strong);
}
.trading-desk .td-ladder-mid span {
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .td-ladder-mid strong {
  color: var(--td-tone);
  font: 600 20px/1 var(--font-mono);
}
.trading-desk .td-ladder-empty {
  margin: 0;
  padding: 10px;
  color: var(--td-muted);
  font-size: 12px;
  text-align: center;
}
.trading-desk .td-pressure {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 20px;
  margin: 6px 10px 0;
  padding: 0 6px;
  overflow: hidden;
  background: var(--td-down-wash);
  border-radius: 2px;
}
.trading-desk .td-pressure > span {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgb(255 59 59 / 0.35);
}
.trading-desk .td-pressure small {
  position: relative;
  font: 500 11px/1 var(--font-mono);
}
.trading-desk .td-flash {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 8px 10px;
  font-weight: 600;
  border-top: var(--td-hairline) solid var(--td-line);
}
.trading-desk .td-flash > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.trading-desk .td-flash svg {
  width: 16px;
  height: 16px;
  color: var(--td-prev);
}
.trading-desk .td-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px 0 4px;
  color: var(--td-fg);
  background: var(--td-raised);
  border: 1px solid var(--td-line-strong);
  border-radius: 14px;
  font-size: 12px;
}
.trading-desk .td-switch i {
  position: relative;
  width: 28px;
  height: 16px;
  background: var(--td-line-strong);
  border-radius: 8px;
}
.trading-desk .td-switch i::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  content: "";
  background: #ffffff;
  border-radius: 50%;
  transition: transform 120ms;
}
.trading-desk .td-switch[aria-checked="true"] {
  color: var(--td-prev);
  border-color: var(--td-prev);
}
.trading-desk .td-switch[aria-checked="true"] i {
  background: var(--td-prev);
}
.trading-desk .td-switch[aria-checked="true"] i::after {
  transform: translateX(12px);
}
.trading-desk .td-lots {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 6px;
  padding: 0 10px 8px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .td-lots button {
  min-height: 30px;
  color: var(--td-fg);
  background: var(--td-raised);
  border: 1px solid var(--td-line-strong);
  border-radius: 3px;
  font-family: var(--font-mono);
}
.trading-desk .td-lots button[aria-pressed="true"] {
  color: #ffffff;
  background: var(--td-accent-wash);
  border-color: var(--td-accent);
}
.trading-desk .td-book-hint {
  margin: 0;
  padding: 0 10px 6px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .td-book[data-flash="true"] .td-book-hint {
  color: var(--td-prev);
}
.trading-desk .td-book-source {
  margin: 0;
  padding: 6px 10px;
  color: var(--td-muted);
  font-size: 11px;
  border-top: var(--td-hairline) solid var(--td-line);
}
```

- [ ] **Step 3: 型別、lint、建置、下單流程**

```bash
npx tsc --noEmit
npx eslint src --quiet
npm run build
```
啟動伺服器、播種後：
```bash
node scripts/qa/desk-orders.mjs http://127.0.0.1:18811 task10
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 task10
node scripts/qa/desk-stop.mjs 18811
```
預期：
- `orders.json` 與 `before/orders.json` 相同。
- `task10/1366x900.png` 右欄為直式五檔：賣 5 到賣 1（綠色底條）、中間大字收價、買 1 到買 5（紅色底條），下方是委買/委賣比例條、閃電開關與 1/2/3 張。

- [ ] **Step 4: 提交**

```bash
git add src/components/morning-order-book.tsx src/trading-desk.css
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: vertical order book ladder with teaching pressure bar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 下單區、行情明細分頁、預估來回費稅

**Files:**
- Modify: `src/components/morning-trading.tsx`
- Modify: `src/components/morning-quotes.tsx`（`MorningQuoteDetail` 標題列類別）
- Modify: `src/trading-desk.css`

**Interfaces:**
- Consumes: `estimateRoundTripCost`（Task 2）
- Produces: 下單區多一列「預估來回費稅（假設同價出場）」，在一般表單與核對畫面都顯示。

- [ ] **Step 1: 預估來回費稅與標題列**

在 `src/components/morning-trading.tsx`：
- 把 `import { formatPrice, stepTick } from "@/lib/market/ticks";` 改為 `import { estimateRoundTripCost, formatPrice, stepTick } from "@/lib/market/ticks";`。
- 把
```tsx
        <header className="sim-ticket-header">
          <div>
            <span className="terminal-eyebrow">ORDER ENTRY</span>
            <h2 id="morning-order-title">模擬下單</h2>
          </div>
          <span className="sim-paper-tag">紙上交易</span>
        </header>
```
改為：
```tsx
        <header className="sim-ticket-header td-titlebar">
          <h2 id="morning-order-title">模擬下單</h2>
          <span className="sim-paper-tag">紙上交易</span>
        </header>
```
- 在核對畫面的 `<dl className="sim-order-facts">` 中，「參考金額（未含費）」那個 `<div>` 之後加入：
```tsx
                <div>
                  <dt>預估來回費稅（假設同價出場）</dt>
                  <dd>
                    {referenceAmount === null
                      ? "—"
                      : formatMoney(estimateRoundTripCost(referenceAmount), 0)}
                  </dd>
                </div>
```
- 在一般表單的 `<dl className="sim-order-facts">` 中，「參考金額」那個 `<div>` 之後加入：
```tsx
                  <div>
                    <dt>
                      預估來回費稅<small>（假設同價出場）</small>
                    </dt>
                    <dd>
                      {referenceAmount === null
                        ? "—"
                        : formatMoney(estimateRoundTripCost(referenceAmount), 0)}
                    </dd>
                  </div>
```

在 `src/components/morning-quotes.tsx` 把 `<header className="terminal-pane-bar">` 改為 `<header className="terminal-pane-bar td-titlebar">`。

- [ ] **Step 2: 下單區與明細樣式**

在 `src/trading-desk.css` 最後追加：
```css
/* Right column: quote detail tabs */
.trading-desk .morning-order-station {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.trading-desk .terminal-quote-detail {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--td-line);
}
.trading-desk .terminal-pane-bar nav {
  display: flex;
  align-self: stretch;
}
.trading-desk .terminal-pane-bar nav button {
  padding: 0 12px;
  color: rgb(230 237 247 / 0.72);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 600;
}
.trading-desk .terminal-pane-bar nav button[aria-pressed="true"] {
  color: #ffffff;
  border-bottom-color: var(--td-accent);
}
.trading-desk .terminal-pane-bar select {
  max-width: 140px;
  height: 26px;
  color: var(--td-fg);
  background: rgb(0 0 0 / 0.25);
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 4px;
  font-size: 12px;
}
.trading-desk .terminal-pane-bar > span {
  font-size: 12px;
}
.trading-desk .terminal-detail-price {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 12px 4px;
  color: var(--td-tone);
  font-family: var(--font-mono);
}
.trading-desk .terminal-detail-price strong {
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
}
.trading-desk .terminal-detail-price span {
  font-size: 13px;
}
.trading-desk .terminal-detail-stamp {
  display: flex;
  justify-content: space-between;
  padding: 0 12px 6px;
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .terminal-detail-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
  margin: 0;
  padding: 6px 12px;
}
.trading-desk .terminal-detail-stats div {
  display: flex;
  justify-content: space-between;
}
.trading-desk .terminal-detail-stats dt {
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .terminal-detail-stats dd {
  margin: 0;
  font-family: var(--font-mono);
}
.trading-desk .terminal-price-range {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 6px 12px 10px;
  color: var(--td-muted);
  font: 500 11px/1.2 var(--font-mono);
}
.trading-desk .terminal-price-range span:nth-of-type(2) {
  text-align: right;
}
.trading-desk .terminal-price-range div {
  position: relative;
  grid-column: 1 / -1;
  height: 4px;
  background: var(--td-line-strong);
  border-radius: 2px;
}
.trading-desk .terminal-price-range i {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 10px;
  background: var(--td-fg);
  transform: translateX(-1px);
}
.trading-desk .terminal-minute-tape {
  max-height: 300px;
  overflow: auto;
}
.trading-desk .terminal-minute-tape table {
  width: 100%;
  border-collapse: collapse;
  font: 12px/1.4 var(--font-mono);
}
.trading-desk .terminal-minute-tape :is(th, td) {
  padding: 4px 12px;
  text-align: right;
  border-bottom: var(--td-hairline) solid var(--td-line);
}
.trading-desk .terminal-minute-tape :is(th, td):first-child {
  text-align: left;
}
.trading-desk .terminal-minute-tape thead th {
  color: var(--td-muted);
  font: 500 11px/1.4 var(--font-sans);
}
.trading-desk .terminal-tape-empty {
  margin: 0;
  padding: 12px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .terminal-data-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 5px 12px;
  color: var(--td-muted);
  font-size: 11px;
  border-top: var(--td-hairline) solid var(--td-line);
}
.trading-desk .terminal-data-status i {
  width: 6px;
  height: 6px;
  background: var(--td-down);
  border-radius: 50%;
}
.trading-desk .terminal-data-status span {
  margin-left: auto;
}

/* Order ticket */
.trading-desk .sim-ticket {
  display: flex;
  flex-direction: column;
}
.trading-desk .sim-ticket-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.trading-desk .sim-paper-tag {
  padding: 1px 6px;
  border: 1px solid rgb(255 255 255 / 0.3);
  border-radius: 2px;
  font-size: 11px;
  font-weight: 500;
}
.trading-desk .sim-ticket-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.trading-desk .sim-order-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.trading-desk .sim-side-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.trading-desk .sim-side-switch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  color: var(--td-muted);
  background: var(--td-raised);
  border: 1px solid var(--td-line-strong);
  border-radius: 4px;
  font-size: 15px;
  font-weight: 700;
}
.trading-desk .sim-side-switch svg {
  width: 16px;
  height: 16px;
}
.trading-desk .sim-side-switch button[data-side="buy"][aria-pressed="true"] {
  color: #ffffff;
  background: var(--td-up);
  border-color: var(--td-up);
}
.trading-desk .sim-side-switch button[data-side="sell"][aria-pressed="true"] {
  color: #04120a;
  background: var(--td-down);
  border-color: var(--td-down);
}
.trading-desk .sim-execution {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-execution strong {
  font-weight: 500;
}
.trading-desk .morning-order-type {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--td-line-strong);
  border-radius: 4px;
}
.trading-desk .morning-order-type button {
  min-height: 30px;
  padding: 0 14px;
  color: var(--td-muted);
  background: transparent;
  border: 0;
  font-weight: 600;
}
.trading-desk .morning-order-type button[aria-pressed="true"] {
  color: #ffffff;
  background: var(--td-accent);
}
.trading-desk .morning-limit-field {
  display: grid;
  gap: 4px;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk :is(.morning-limit-field > div, .sim-stepper) {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 38px;
  min-height: 38px;
  overflow: hidden;
  background: var(--td-bg);
  border: 1px solid var(--td-line-strong);
  border-radius: 4px;
}
.trading-desk :is(.morning-limit-field button, .sim-stepper button) {
  display: grid;
  place-items: center;
  color: var(--td-fg);
  background: var(--td-raised);
  border: 0;
  font-size: 16px;
}
.trading-desk :is(.morning-limit-field button, .sim-stepper button):disabled {
  color: var(--td-muted);
  opacity: 0.5;
}
.trading-desk .sim-stepper svg {
  width: 16px;
  height: 16px;
}
.trading-desk .morning-limit-field input {
  min-width: 0;
  color: var(--td-fg);
  text-align: center;
  background: transparent;
  border: 0;
  font: 600 16px/1 var(--font-mono);
}
.trading-desk .morning-limit-field input[aria-invalid="true"] {
  color: var(--td-alert-fg);
}
.trading-desk .morning-limit-field [role="alert"] {
  margin: 0;
  color: var(--td-alert-fg);
}
.trading-desk .sim-quantity-heading {
  display: flex;
  justify-content: space-between;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-stepper output {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  font: 600 18px/38px var(--font-mono);
}
.trading-desk .sim-stepper output span {
  color: var(--td-muted);
  font: 400 12px/1 var(--font-sans);
}
.trading-desk .sim-order-facts {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-top: 8px;
  border-top: var(--td-hairline) solid var(--td-line);
}
.trading-desk .sim-order-facts div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.trading-desk .sim-order-facts dt {
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-order-facts dt small {
  font-size: 11px;
}
.trading-desk .sim-order-facts dd {
  margin: 0;
  font: 600 13px/1.4 var(--font-mono);
}
.trading-desk .sim-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  color: #ffffff;
  background: var(--td-up);
  border: 0;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 700;
}
.trading-desk .sim-ticket[data-side="sell"] .sim-submit {
  color: #04120a;
  background: var(--td-down);
}
.trading-desk .sim-submit span {
  padding-left: 10px;
  border-left: 1px solid rgb(255 255 255 / 0.35);
  font: 600 13px/1 var(--font-mono);
}
.trading-desk .sim-submit svg {
  width: 18px;
  height: 18px;
}
.trading-desk .sim-submit:disabled {
  opacity: 0.45;
}
.trading-desk :is(.sim-back, .sim-prepare, .sim-pending-actions button, .morning-flash-ready button) {
  min-height: 36px;
  padding: 0 12px;
  color: var(--td-fg);
  background: var(--td-raised);
  border: 1px solid var(--td-line-strong);
  border-radius: 4px;
  font-weight: 600;
}
.trading-desk .sim-prepare {
  width: 100%;
  color: #ffffff;
  background: var(--td-accent);
  border-color: var(--td-accent);
}
.trading-desk .sim-ticket-message {
  margin: 0;
  color: var(--td-alert-fg);
  font-size: 12px;
}
.trading-desk :is(.sim-pending, .morning-flash-ready) {
  display: grid;
  gap: 6px;
  padding: 10px;
  background: rgb(232 197 71 / 0.08);
  border: 1px solid rgb(232 197 71 / 0.45);
  border-radius: 4px;
}
.trading-desk .sim-pending > div:first-child {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--td-prev);
}
.trading-desk .sim-pending p {
  margin: 0;
  font-family: var(--font-mono);
}
.trading-desk .sim-pending small {
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-pending-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.trading-desk .morning-flash-ready {
  color: var(--td-prev);
}
.trading-desk .morning-flash-ready p {
  margin: 0;
  color: var(--td-fg);
  font-size: 12px;
}
.trading-desk .sim-confirm {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: var(--td-raised);
  border: 1px solid var(--td-accent);
  border-radius: 4px;
}
.trading-desk .sim-confirm h3 {
  margin: 0;
  font-size: 14px;
  outline: none;
}
.trading-desk .sim-confirm-symbol {
  margin: 0;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-confirm-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 20px;
  font-weight: 700;
}
.trading-desk .sim-confirm-main span {
  font-family: var(--font-mono);
}
.trading-desk .sim-help {
  margin: 0;
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-order-help {
  color: var(--td-muted);
  font-size: 12px;
}
.trading-desk .sim-order-help summary {
  padding: 4px 0;
  cursor: pointer;
}
.trading-desk .sim-order-help p {
  margin: 4px 0;
}
.trading-desk .sim-ticket-footnote {
  margin: 0;
  color: var(--td-muted);
  font-size: 11px;
  text-align: center;
}
```

- [ ] **Step 3: 型別、lint、建置、下單流程**

```bash
npx tsc --noEmit
npx eslint src --quiet
npm run build
```
啟動伺服器、播種後：
```bash
node scripts/qa/desk-orders.mjs http://127.0.0.1:18811 task11
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 task11
node scripts/qa/desk-stop.mjs 18811
```
預期：
- `orders.json` 與 `before/orders.json` 相同。
- `task11/orders-final.png` 的下單區顯示「預估來回費稅（假設同價出場）」。在 2317 選擇賣出時顯示無庫存訊息，核對按鈕停用。

- [ ] **Step 4: 提交**

```bash
git add src/components/morning-trading.tsx src/components/morning-quotes.tsx src/trading-desk.css
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: compact desk order ticket with estimated round-trip fees" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 手機、長輩模式、計畫與帳戶卡片

**Files:**
- Modify: `src/trading-desk.css`

**Interfaces:**
- Consumes: Task 7–11 的所有類別
- Produces: 手機與長輩模式的版面規則

- [ ] **Step 1: 追加樣式**

在 `src/trading-desk.css` 最後追加：
```css
/* Phone and senior: single column */
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-workbench {
  display: flex;
  flex-direction: column;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-bar {
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 10px;
  white-space: normal;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) :is(.td-subject, .td-brand > span) {
  display: none;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-account {
  flex-wrap: wrap;
  gap: 4px 12px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-replay {
  display: grid;
  order: 10;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  width: 100%;
  margin-left: 0;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-replay > :only-child {
  grid-column: 1 / -1;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-replay :is(button, .td-speed) {
  min-height: 44px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-replay .td-speed button {
  flex: 1;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-hints {
  padding: 6px 10px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-alert {
  margin-left: 0;
}
.trading-desk .td-tabs[data-variant="panes"] {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  background: var(--td-title);
  border-bottom: 1px solid var(--td-title-line);
}
.trading-desk .td-tabs[data-variant="panes"] button {
  min-height: 44px;
  padding: 0 4px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-quote {
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 8px 10px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-quote-price {
  width: 100%;
  margin-left: 0;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-quote-stats {
  flex-wrap: wrap;
  gap: 4px 14px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-quote-arrows button {
  width: 44px;
  height: 44px;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-chart-canvas {
  flex: none;
  height: clamp(260px, 52vh, 420px);
}
.trading-desk .td-mobile-ticket {
  display: flex;
  flex-direction: column;
}
.trading-desk:is([data-layout="phone"], [data-layout="senior"]) .td-resources {
  inset: 0;
  width: 100vw;
}
.trading-desk[data-layout="phone"] :is(.td-level, .td-lots button, .morning-order-type button, .sim-side-switch button) {
  min-height: 44px;
}
.trading-desk[data-layout="phone"] :is(.sim-stepper, .morning-limit-field > div) {
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  min-height: 44px;
}
.trading-desk[data-layout="phone"] .td-watch-item {
  min-height: 64px;
}

/* Senior mode: larger type; global rules already give buttons 56px */
.trading-desk[data-layout="senior"] {
  font-size: 16px;
}
.trading-desk[data-layout="senior"] .td-level {
  grid-template-columns: 56px minmax(0, 1fr) 80px;
  min-height: 56px;
  font-size: 18px;
}
.trading-desk[data-layout="senior"] .td-ladder-labels {
  grid-template-columns: 56px minmax(0, 1fr) 80px;
  font-size: 14px;
}
.trading-desk[data-layout="senior"] :is(.sim-submit, .sim-side-switch button, .td-lots button, .morning-order-type button) {
  min-height: 56px;
  font-size: 18px;
}
.trading-desk[data-layout="senior"] :is(.sim-stepper, .morning-limit-field > div) {
  grid-template-columns: 56px minmax(0, 1fr) 56px;
  min-height: 56px;
}
.trading-desk[data-layout="senior"] .td-quote-price strong {
  font-size: 36px;
}
.trading-desk[data-layout="senior"] .td-watch-price {
  font-size: 28px;
}
.trading-desk[data-layout="senior"] :is(.td-hints, .td-quote-stats, .sim-order-facts dt, .td-book-hint, .td-book-source, .terminal-data-status, .td-chart-legend, .td-level-rank) {
  font-size: 15px;
}
.trading-desk[data-layout="senior"] .td-account dd {
  font-size: 18px;
}

/* Account card (phone and senior positions pane) */
.trading-desk .sim-account {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--td-line);
}
.trading-desk .sim-account-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.trading-desk .sim-account-label small {
  display: block;
  color: var(--td-muted);
  font-size: 11px;
  font-weight: 400;
}
.trading-desk .sim-account dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 0;
}
.trading-desk .sim-account dt {
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .sim-account dd {
  margin: 0;
  font: 600 18px/1.2 var(--font-mono);
}
.trading-desk .sim-account dd small {
  color: var(--td-muted);
  font-size: 11px;
}
.trading-desk .sim-account-note {
  color: var(--td-muted);
  font-size: 11px;
}
```

- [ ] **Step 2: 建置與嚴格版面檢查**

```bash
npm run build
```
啟動伺服器、播種後：
```bash
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 task12 --strict
node scripts/qa/desk-stop.mjs 18811
```
預期：印出 `All layout checks passed.`，結束碼 0。若有失敗，依失敗項目調整本任務的樣式後重跑，直到通過。

- [ ] **Step 3: 提交**

```bash
git add src/trading-desk.css
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "feat: phone, senior and account card styles for the trading desk" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 全面驗收、其他頁面回歸與改版紀錄

**Files:**
- Create: `docs/trading-desk-2026-10-13.md`
- Output（被 git 忽略）：`artifacts/trading-desk-qa/final/`、`artifacts/trading-desk-qa/final-noplan/`

- [ ] **Step 1: 全部自動檢查**

```bash
npx tsc --noEmit
npx eslint src scripts/qa --quiet
npm test
npm run build
```
預期：tsc 與 eslint 無輸出；`npm test` 0 失敗；建置結尾 `"offlineVerified": true`。

- [ ] **Step 2: 練習開始前的畫面**

啟動驗收伺服器，**不播種**，直接執行：
```bash
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 final-noplan
```
預期：沒有 `<11px`、`clipped`、`offscreen` 或水平溢出。這個狀態沒有圖表，所以「chart height ratio」失敗是正常的。截圖中狀態列顯示「開始練習」，提示列顯示教學原則。

- [ ] **Step 3: 播種後完整驗收**

```bash
node scripts/qa/desk-seed.mjs http://127.0.0.1:18811
node scripts/qa/desk-layout.mjs http://127.0.0.1:18811 final --strict
node scripts/qa/desk-sharpness.mjs http://127.0.0.1:18811 final
node scripts/qa/desk-orders.mjs http://127.0.0.1:18811 final
node scripts/qa/desk-stop.mjs 18811
```
預期：
- 版面檢查 `All layout checks passed.`。
- 每個縮放比例的 `softPct` ≤ 3，且都低於 `before/sharpness.json` 的對應值。
- `final/orders.json` 與 `before/orders.json` 完全相同。

- [ ] **Step 4: 其他頁面回歸**

這次裁掉了 `classroom-refresh.css` 的部分區段。在 Step 3 停止伺服器之前（或重新啟動並播種後）執行：
```bash
node scripts/qa/desk-pages.mjs http://127.0.0.1:18811 final
```
把 `final/page-*.png` 與 `before/page-*.png` 逐張並排比對（大廳、試閱、手冊，各兩種寬度）。預期：版面、顏色、間距沒有差異。若有差異，代表裁切誤刪了共用規則，需從 git 歷史還原該規則。

- [ ] **Step 4b: 與參考盤並排**

把使用者在對話中提供的參考盤截圖複製到驗收目錄（本次工作階段的附件路徑為 `C:\Users\kevin\AppData\Local\Temp\claude\C--Users-kevin-Documents-ChatGPT------\dab0bb2e-d3fb-4926-a1d6-01515327f80b\images\1.png` 與 `2.png`）：
```bash
cp "C:/Users/kevin/AppData/Local/Temp/claude/C--Users-kevin-Documents-ChatGPT------/dab0bb2e-d3fb-4926-a1d6-01515327f80b/images/1.png" artifacts/trading-desk-qa/final/reference-desktop.png
cp "C:/Users/kevin/AppData/Local/Temp/claude/C--Users-kevin-Documents-ChatGPT------/dab0bb2e-d3fb-4926-a1d6-01515327f80b/images/2.png" artifacts/trading-desk-qa/final/reference-phone.png
```
在改版紀錄中並列 `final/1920x1080.png` 與 `final/reference-desktop.png`，寫下仍有差距的地方（例如參考盤有加權指數小圖與成交量柱，屬於子專案 2、3）。

- [ ] **Step 5: 撰寫改版紀錄**

建立 `docs/trading-desk-2026-10-13.md`，內容包含：
- **改版內容**：依規格六節逐項列出實際完成的功能。
- **驗收結果**：各尺寸版面表（從 `final/layout.json` 摘錄）、改版前後的圖表銳利度表（`before` 與 `final` 的 `sharpness.json`）、下單流程結果（`orders.json`），以及截圖路徑。
- **規格偏差**：圖表銳利度標準由 0% 改為 ≤3%；撤回委託不列為快訊，改由回饋訊息顯示。並說明原因。
- **已刪除與裁切的樣式檔**。
- **正式站登入檢查清單**（發布後由使用者操作）：
  1. 以自己的帳號登入 `https://rich.yilutek.com/morning?panel=trade`。
  2. 桌機畫面整頁不捲動；頂部藍色狀態列顯示時間、損益、可用資金、播放與 1x/2x。
  3. 切換分時與 K 線：分時有昨收黃色虛線與紅綠填色，K 線最多顯示 60 分鐘。
  4. 右欄五檔由上到下是賣 5…賣 1、收價、買 1…買 5。點賣 1 會出現核對畫面，按「返回修改」不送單。
  5. 下單區顯示「預估來回費稅（假設同價出場）」。
  6. 按「教材」開啟側邊面板，計畫內容與資料說明都在；按 Esc 可關閉。
  7. 開啟長輩模式：單欄、大字、主要按鈕夠大。
  8. 在自己常用的螢幕縮放（例如 125% 或 150%）下，K 線邊緣銳利。

- [ ] **Step 6: 提交**

```bash
git add docs/trading-desk-2026-10-13.md
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "docs: record trading desk redesign verification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

不要推送或部署；把結果與檢查清單回報給使用者，由使用者決定是否發布。
