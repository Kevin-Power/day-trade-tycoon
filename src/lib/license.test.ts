import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICENSE_EXCLUDED,
  LICENSE_INCLUDED,
  LICENSE_PAYMENT_NOTE,
  LICENSE_PRICING_NOTE,
  LICENSE_QUOTE,
  LICENSE_SKUS,
  SEAT_ROADMAP,
  SEAT_TODAY,
  licensePlainText,
} from "./license.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(join(root, "src/components/license-page.tsx"), "utf8");
const lobby = readFileSync(join(root, "src/components/lobby.tsx"), "utf8");
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

  it("describes shared password today and per-seat accounts as roadmap", () => {
    assert.match(SEAT_TODAY, /同一組入場密碼/);
    assert.match(SEAT_ROADMAP, /每人一個帳號/);
    assert.match(SEAT_ROADMAP, /還沒做/);
  });

  it("renders from the copy SSOT and is linked from lobby and gate", () => {
    assert.match(page, /LICENSE_INCLUDED/);
    assert.match(page, /LICENSE_EXCLUDED/);
    assert.match(page, /LICENSE_QUOTE/);
    assert.match(lobby, /to="\/license"/);
    assert.match(lobby, /教室授權/);
    assert.match(gate, /to="\/license"/);
    assert.match(gate, /不必入場密碼/);
  });

  it("records P0-7/8/9 done and P1-7 progress in the roadmap", () => {
    assert.match(gaps, /P0-7[\s\S]*?#6 已修/);
    assert.match(gaps, /P0-8[\s\S]*?#6 已修/);
    assert.match(gaps, /P0-9[\s\S]*?#6 已修/);
    assert.match(gaps, /P1-7[\s\S]*?本 PR 進度/);
    assert.match(gaps, /\/license/);
  });
});
