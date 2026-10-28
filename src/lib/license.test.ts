import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICENSE_DATA,
  LICENSE_DATA_CONFIRMED,
  LICENSE_EXCLUDED,
  LICENSE_INCLUDED,
  LICENSE_PAYMENT_NOTE,
  LICENSE_PRICING_NOTE,
  LICENSE_QUOTE,
  LICENSE_SKUS,
  LICENSE_VERSION,
  SEAT_ROADMAP,
  SEAT_TODAY,
  licensePlainText,
} from "./license.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(join(root, "src/components/license-page.tsx"), "utf8");
const lobby = readFileSync(join(root, "src/components/lobby.tsx"), "utf8");
const manual = readFileSync(join(root, "src/components/manual-page.tsx"), "utf8");
const gate = readFileSync(join(root, "src/components/gate-screen.tsx"), "utf8");
const gaps = readFileSync(join(root, "docs/feature-gaps.md"), "utf8");
const text = licensePlainText();

const FAKE_PRICE = /NT\$|NTD|\bTWD\b|新台幣\s*\d|\$\s*\d{2,}|一班\s*\d/;

describe("classroom license copy", () => {
  it("lists the four things a classroom package includes", () => {
    const titles = LICENSE_INCLUDED.map((x) => x.title);
    assert.deepEqual(titles, ["模擬教室", "課綱", "地端包", "說明書"]);
  });

  it("says what is not included: live orders, advisory, guaranteed profit", () => {
    const titles = LICENSE_EXCLUDED.map((x) => x.title);
    assert.ok(titles.some((t) => t.includes("實盤下單")));
    assert.ok(titles.some((t) => t.includes("投顧")));
    assert.ok(titles.some((t) => t.includes("保證獲利")));
  });

  it("keeps every SKU quote as 洽教室／講師報價", () => {
    assert.equal(LICENSE_QUOTE, "洽教室／講師報價");
    assert.ok(LICENSE_SKUS.length >= 2);
    for (const sku of LICENSE_SKUS) {
      assert.equal(sku.quote, LICENSE_QUOTE);
    }
    assert.match(LICENSE_PRICING_NOTE, /洽教室／講師報價/);
    assert.match(LICENSE_PAYMENT_NOTE, /不接金流/);
  });

  it("does not invent NT$ or class-fee numbers", () => {
    assert.equal(FAKE_PRICE.test(text), false);
    assert.equal(FAKE_PRICE.test(page), false);
  });

  it("distinguishes classroom access, individual identity and payment", () => {
    assert.match(SEAT_TODAY, /同一組入場密碼/);
    assert.match(SEAT_ROADMAP, /每人一個帳號/);
    assert.match(SEAT_TODAY, /不代表完成繳費/);
    assert.match(SEAT_ROADMAP, /尚未提供/);
  });

  it("renders from the copy SSOT and is linked from lobby and gate", () => {
    assert.match(page, /LICENSE_INCLUDED/);
    assert.match(page, /LICENSE_EXCLUDED/);
    assert.match(page, /LICENSE_QUOTE/);
    assert.match(lobby, /to="\/license"/);
    assert.match(lobby, /課程說明/);
    assert.match(gate, /to="\/license"/);
    assert.match(gate, /無須入場碼即可查看/);
  });

  it("says where the daily lessons' data comes from, when it was confirmed, and that the list is shown after the close", () => {
    assert.equal(LICENSE_VERSION, "2026-10-28");
    assert.equal(LICENSE_DATA_CONFIRMED, "2026-10-22");
    const market = LICENSE_DATA.find((item) => item.id === "market")?.body ?? "";
    for (const phrase of ["富邦", "逐筆", "證交所", "2026-10-22", "不是即時行情"]) assert.ok(market.includes(phrase), phrase);
    const list = LICENSE_DATA.find((item) => item.id === "list")?.body ?? "";
    for (const phrase of ["收盤後", "代號與名稱", "體驗訪客看不到名單"]) assert.ok(list.includes(phrase), phrase);
    assert.match(text, /2026-10-22/);
    assert.match(page, /LICENSE_DATA/);
    // The list is shown without its score or level, and is never called a recommendation, a win rate or a radar.
    for (const word of ["推薦", "勝率", "漲停雷達"]) assert.equal(text.includes(word), false, word);
    // Decision D: no score and no level, and not even the words for them.
    assert.ok(list.includes("只顯示代號與名稱"));
    for (const word of ["分數", "等級"]) {
      assert.equal(JSON.stringify(LICENSE_DATA).includes(word), false, `LICENSE_DATA says ${word}`);
      assert.equal(manual.includes(word), false, `the manual page says ${word}`);
    }
  });

  it("records P0-7/8/9 done and P1-7 progress in the roadmap", () => {
    assert.match(gaps, /P0-7[\s\S]*?#6 已修/);
    assert.match(gaps, /P0-8[\s\S]*?#6 已修/);
    assert.match(gaps, /P0-9[\s\S]*?#6 已修/);
    assert.match(gaps, /P1-7[\s\S]*?本 PR 進度/);
    assert.match(gaps, /\/license/);
  });
});
