import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePdfArgs, pythonCandidates } from "./build-manual-pdf.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdf = join(root, "public", "daytrade-tycoon-manual.pdf");
const source = JSON.parse(readFileSync(join(root, "docs", "pdf-source.json"), "utf8"));

test("local PDF builder accepts Python/output paths containing spaces", () => {
  const parsed = parsePdfArgs(
    ["--python", "C:\\local runtime\\python.exe", "--output", "output/manual file.pdf"],
    {},
  );
  assert.equal(parsed.python, "C:\\local runtime\\python.exe");
  assert.equal(parsed.output, "output/manual file.pdf");
  assert.deepEqual(pythonCandidates("C:\\local runtime\\python.exe"), [
    "C:\\local runtime\\python.exe",
  ]);
});
test("obsolete network/browser arguments cannot trigger a web request", () => {
  assert.ok(parsePdfArgs(["--url", "https://example.com"], {}).error);
  assert.ok(parsePdfArgs(["--start"], {}).error);
  assert.ok(parsePdfArgs(["--output"], {}).error);
  assert.equal(parsePdfArgs([], {}).python, "");
});
test("manual source explains the real-minute replay and its current limits", () => {
  assert.equal(source.pages.length, 8);
  const text = JSON.stringify(source);
  for (const term of [
    "09:00",
    "10:30",
    "下一分鐘開盤價",
    "1,000 萬元",
    "保存復盤",
    "註冊帳號不等於完成繳費",
    "沒有線上刷卡",
  ])
    assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /Grok|45 分鐘|註冊時班級代碼填 TEACHER|個股分時.*套用大盤節奏/);
});
test("static PDF exists for the learner manual download", () => {
  assert.equal(existsSync(pdf), true);
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
  assert.ok(statSync(pdf).size > 20000);
});
