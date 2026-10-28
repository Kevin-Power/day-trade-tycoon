// The desk's words after the lessons moved to real Fubon trades (spec 2026-10-22 §5, §6, §10): market data is never
// called simulated or Yahoo's, the matching rules say what the engine does, and the paper-trading labels stay.
// These read the components' source, so a sentence put back by accident fails here.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const DESK = [
  "trade-tape",
  "quote-hero",
  "stock-detail",
  "morning-trading",
  "morning-order-book",
  "morning-practice",
  "morning-plan-form",
  "watch-table",
  "morning-desk-bar",
  "lesson-picker",
  "run-records",
].map((name) => `src/components/${name}.tsx`);

// Market data is real now. 「模擬成交」 and 「模擬逐筆」 described the old in-minute replay made from open/high/low/close;
// 「教學模擬五檔」 the made-up ladder; Yahoo was the old minute source.
const BANNED = ["模擬逐筆", "模擬成交", "教學模擬五檔", "Yahoo"];

test("no desk component calls market data simulated or names Yahoo", () => {
  for (const path of DESK) {
    const text = source(path);
    for (const word of BANNED) assert.ok(!text.includes(word), `${path} still says ${word}`);
  }
});

test("the replay notice about the simulated replay is gone, and nothing asks for it", () => {
  assert.equal(existsSync(join(root, "src/components/replay-notice.tsx")), false);
  const practice = source("src/components/morning-practice.tsx");
  assert.ok(!/ReplayNotice|replay-notice|replayNotice/.test(practice));
});

test("the paper-trading labels stay", () => {
  const trading = source("src/components/morning-trading.tsx");
  for (const label of ["模擬帳戶", "模擬下單", "確認模擬委託", "教學模擬・不連接券商、不送出真實委託"])
    assert.ok(trading.includes(label), label);
  assert.ok(source("src/components/morning-desk-bar.tsx").includes("模擬帳戶"));
  assert.ok(source("src/components/lightning-order.tsx").includes("僅教室模擬"));
});

test("the trade list is Fubon's real trades, and the quote says it is a replay of history", () => {
  const tape = source("src/components/trade-tape.tsx");
  assert.ok(tape.includes("富邦逐筆"));
  assert.ok(!/依真實一分鐘開高低收|開高低收模擬/.test(tape));
  const hero = source("src/components/quote-hero.tsx");
  assert.ok(hero.includes("歷史重播"));
  assert.ok(!hero.includes("真實歷史 分鐘收價") && !hero.includes("真實歷史 1 分 K"), "the source label names Fubon, not the chart");
});

test("the matching text is the real rule: the first real trade after the order, a limit on touch, no queue", () => {
  const trading = source("src/components/morning-trading.tsx");
  for (const phrase of ["委託後第一筆", "碰到", "不考慮排隊", "對學員稍微有利"])
    assert.ok(trading.includes(phrase), phrase);
  // The old rule, a fill at the next minute's open, is not told anywhere on the desk.
  for (const path of DESK) {
    const text = source(path);
    assert.ok(!text.includes("下一分鐘開盤價"), `${path} still matches at the next minute's open`);
    assert.ok(!text.includes("開盤價達"), `${path} still waits for an open price`);
  }
  assert.ok(!source("src/lib/morning-orders.ts").includes("下一分鐘開盤"));
});

test("a fill's time is shown to the second from the real trade", () => {
  const trading = source("src/components/morning-trading.tsx");
  assert.ok(trading.includes("fillClock(fill)"));
  assert.ok(!/formatTime\(fill\.t\)/.test(trading));
});

test("the manual, licence and lobby say what the lessons are now", () => {
  const manual = source("src/components/manual-page.tsx");
  assert.match(manual, /MANUAL_VERSION = "2026-10-28-lessons1"/);
  for (const phrase of ["富邦逐筆", "證交所", "熱門當沖", "1 到 80 檔", "真實五檔", "買一賣一", "不考慮排隊"])
    assert.ok(manual.includes(phrase), `manual: ${phrase}`);
  for (const path of [
    "src/components/manual-page.tsx",
    "src/components/license-page.tsx",
    "src/lib/license.ts",
    "src/components/live-tape.tsx",
    "src/components/real-candles-entry.tsx",
  ]) {
    const text = source(path);
    for (const word of [...BANNED, "10/05", "10/06", "下一分鐘開盤價", "2026/10/05", "2026/10/06"])
      assert.ok(!text.includes(word), `${path} still says ${word}`);
  }
  // The list is never called a recommendation, a win rate or the radar (decision D of the list design).
  for (const path of ["src/components/manual-page.tsx", "src/components/license-page.tsx", "src/lib/license.ts"]) {
    const text = source(path);
    for (const word of ["推薦", "勝率", "漲停雷達"]) assert.ok(!text.includes(word), `${path} says ${word}`);
  }
});
