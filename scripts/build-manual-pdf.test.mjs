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
test("manual source explains the daily real lessons and their current limits", () => {
  assert.equal(source.pages.length, 8);
  const text = JSON.stringify(source);
  for (const term of [
    "09:00",
    "10:30",
    "富邦逐筆",
    "熱門當沖",
    "1 到 80 檔",
    "1,000 萬元",
    "保存復盤",
    "課前最後核對",
  ])
    assert.ok(text.includes(term), term);
  assert.doesNotMatch(text, /Grok|45 分鐘|註冊時班級代碼填 TEACHER|個股分時.*套用大盤節奏/);
  // The first lessons (Yahoo minutes of 10/05 and 10/06), the old fill at the next open and the made-up ticks are gone.
  assert.doesNotMatch(text, /Yahoo|10\/05|10\/06|下一分鐘開盤價|模擬逐筆/);
  // The list is never called a recommendation, a win rate or the radar.
  assert.doesNotMatch(text, /推薦|勝率|漲停雷達/);
});
test("manual source tells the matching rule, the real books and the default 自選", () => {
  const text = JSON.stringify(source);
  for (const term of [
    "1–400 張",
    "快選",
    "量夠才成交",
    "累計到委託張數",
    "平均價",
    "不做部分成交",
    "不考慮排隊",
    "對學員稍微有利",
    "真實五檔",
    "買一賣一",
    "前一交易日的熱門當沖名單",
    "成交值前 20 名",
    "從 2026/10/21 起",
  ])
    assert.ok(text.includes(term), term);
  // The rule before 2026-10-30: one touching trade filled the whole order, 1–3 lots.
  assert.doesNotMatch(text, /1-3 張|1–3 張|委託後第一筆|第一筆真實成交|碰到就成交|那筆成交的張數|排隊與張數/);
});
test("static PDF exists for the learner manual download", () => {
  assert.equal(existsSync(pdf), true);
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
  assert.ok(statSync(pdf).size > 20000);
});
test("manual source describes today's trading desk, not the old one", () => {
  const text = JSON.stringify(source);
  for (const term of ["江波圖", "加權指數", "限價", "閃電即送", "大額委託", "委託回報", "教學模擬"])
    assert.ok(text.includes(term), term);
  // 2026-11-08, 石大哥: 「EMA11和24要拉掉，常態班的學生沒學過」 — the desk no longer draws them.
  assert.doesNotMatch(text, /EMA/);
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
test("both manuals describe the 自選江波圖's 放大 and ±10% scales and its solid 昨收 line", () => {
  const pdfRow = JSON.stringify(source).match(/\["自選江波圖","([^"]+)"\]/)?.[1] ?? "";
  const webPage = readFileSync(join(root, "src", "components", "manual-page.tsx"), "utf8");
  const webRow = webPage.match(/k="自選江波圖"\s*v="([^"]+)"/)?.[1] ?? "";
  for (const [name, row] of [["PDF", pdfRow], ["web", webRow]]) {
    for (const term of ["放大", "±10%", "昨收"]) assert.ok(row.includes(term), `${name}: ${term}`);
    assert.doesNotMatch(row, /虛線/, `${name}: the 昨收 line is solid since 2026-10-26`);
  }
});
test("both manuals give the engine's three reasons for an order cancelled at 10:30", () => {
  // lessons/matching.ts endReason: 「之後沒有成交」 when no trade came after the order, 「教材結束，委託未成交」 when
  // trades came but none touched it, 「成交量不足」 when some touched it without the lots.
  const pdfRow = JSON.stringify(source).match(/\["待成交委託","([^"]+)"\]/)?.[1] ?? "";
  const webPage = readFileSync(join(root, "src", "components", "manual-page.tsx"), "utf8");
  const webRow = webPage.match(/k="委託"\s*v="([^"]+)"/)?.[1] ?? "";
  for (const [name, row] of [["PDF", pdfRow], ["web", webRow]])
    for (const reason of ["之後沒有成交", "教材結束，委託未成交", "成交量不足"])
      assert.ok(row.includes(`「${reason}」`), `${name}: ${reason}`);
});
test("every 手冊版本 the manual names is its own version", () => {
  const named = [...JSON.stringify(source).matchAll(/手冊版本：([0-9A-Za-z-]+)/g)].map((match) => match[1]);
  assert.ok(named.length >= 1, "the manual names its version");
  for (const version of named) assert.equal(version, source.version);
});
test("web manual names today's plan and replay buttons", () => {
  const page = readFileSync(join(root, "src", "components", "manual-page.tsx"), "utf8");
  for (const term of ["用這個計畫開始", "+1 分", "播放"]) assert.ok(page.includes(term), term);
  assert.doesNotMatch(page, /按「前進 1 分鐘」/);
});
test("both manuals tell the 觸價單 a buy fill sends and the phone's 五檔 beside the 江波圖", () => {
  // 2026-11-06 石大哥: 「下單後，直接會設觸價單來停損、停利嗎?」 (morning-exit.ts triggerOrders, live 20261106T152333301Z)
  // and 走勢＋五檔並排 on phones (side-book.tsx, live 20261106T160057714Z). The user: 「說明書也一起更新觸價單和五檔」.
  const pdfText = JSON.stringify(source);
  const webPage = readFileSync(join(root, "src", "components", "manual-page.tsx"), "utf8");
  for (const [name, text] of [["PDF", pdfText], ["web", webPage]]) {
    for (const term of [
      "觸價單",
      "最低獲利檔",
      "手續費和當沖證交稅",
      "停損 10 檔",
      "多加幾檔",
      "約幾 %",
      "市價賣出這檔全部庫存",
      "另一張自動取消",
      "停利觸價",
      "停損觸價",
      "江波圖右邊並排五檔",
      "最近 40 筆成交",
      "外盤",
      "內盤",
      "放大",
    ])
      assert.ok(text.includes(term), `${name}: ${term}`);
    // Before the 11/04 trade bar, 行情's 買進／賣出 jumped to 下單; before 11/02 the plan's 停止條件 was only words.
    assert.doesNotMatch(text, /直接到下單|不是自動停損/, name);
    // Until 2026-11-08 the default 停利 was +1.5%; 石大哥 asked for 「最低的tick(可cover手續費和證交稅)」.
    assert.doesNotMatch(text, /預設開啟（停利 \+1\.5%|預設 \+1\.5%/, name);
    // Until 2026-11-09 停損 was −2% and both could be percentages; the owner: 停利 標準tick + 幾個tick, 停損 in ticks.
    assert.doesNotMatch(text, /停損 -2%|-2%）|改成百分比|選百分比|停利百分比|停損百分比|\+0\.5% 到 \+3%/, name);
  }
});
test("README names the current manual revision", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(readme.includes(`修訂 \`${source.version}\``), source.version);
});
