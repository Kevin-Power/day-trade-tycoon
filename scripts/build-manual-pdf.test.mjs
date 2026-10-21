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
test("manual source describes today's trading desk, not the old one", () => {
  const text = JSON.stringify(source);
  for (const term of ["江波圖", "EMA11", "EMA24", "加權指數", "限價", "閃電即送", "大額委託", "委託回報", "模擬逐筆", "教學模擬"])
    assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /沒有掛限價|閃電下單也不在|自動播放 · 每 2 秒 1 分鐘|收價連線|暫停重播/);
});
test("manual PDF version matches the web manual's", () => {
  const page = readFileSync(join(root, "src", "components", "manual-page.tsx"), "utf8");
  assert.equal(source.version, page.match(/MANUAL_VERSION = "([^"]+)"/)?.[1]);
});
test("manual describes the plan templates, the cash re-check at the fill and average cost", () => {
  const text = JSON.stringify(source);
  for (const term of ["用這個計畫開始", "自己寫", "重新檢核資金", "平均成本未含費用"]) assert.ok(text.includes(term), term);
});
test("manual lists 回覆不明 in 委託回報 and says how to check it", () => {
  const blocks = source.pages.flatMap((page) => page.blocks ?? []);
  const reports = blocks.find((block) => block.title?.includes("委託回報"));
  assert.ok(reports?.text.includes("回覆不明"), "the 委託回報 callout lists 回覆不明");
  const unclear = blocks.find((block) => block.title?.includes("回覆不明"));
  for (const term of ["委託回報", "重試這次操作", "重新載入進度", "同一操作編號", "委託成功"])
    assert.ok(unclear?.text.includes(term), term);
});
test("web manual names today's plan and replay buttons", () => {
  const page = readFileSync(join(root, "src", "components", "manual-page.tsx"), "utf8");
  for (const term of ["用這個計畫開始", "+1 分", "播放"]) assert.ok(page.includes(term), term);
  assert.doesNotMatch(page, /按「前進 1 分鐘」/);
});
test("README names the current manual revision", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(readme.includes(`修訂 \`${source.version}\``), source.version);
});
