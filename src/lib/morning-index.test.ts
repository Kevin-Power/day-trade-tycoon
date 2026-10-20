import test from "node:test";
import assert from "node:assert/strict";
import { formingIndexBar, INDEX_EMPTY_TEXT, indexAvailability, indexSummary } from "./morning-index.ts";
import type { MorningIndexBar } from "./morning.ts";

const p = [10, 12, 8, 11, 15, 9, 13, 14, 7, 12, 11, 10];
const BAR: MorningIndexBar = { t: 60, o: 10, h: 15, l: 7, c: 10, p };
// The real 10/06 09:00 minute (TWSE 5-second values after 09:00:00).
const FIRST_1006: MorningIndexBar = {
  t: 0,
  o: 49736.37,
  h: 49932.26,
  l: 49736.37,
  c: 49932.26,
  p: [49736.37, 49845.68, 49860, 49870, 49880, 49890, 49900, 49905, 49910, 49920, 49925, 49932.26],
};

test("at the start of the replay only the minute's first 5-second value is shown", () => {
  assert.deepEqual(formingIndexBar(BAR, 0), { t: 60, o: 10, h: 10, l: 10, c: 10, p: [10] });
});

test("half way the minute closes at its sixth value with the extremes so far", () => {
  const half = formingIndexBar(BAR, 0.5);
  assert.equal(half.c, p[5]);
  assert.equal(half.h, Math.max(...p.slice(0, 6)));
  assert.equal(half.l, Math.min(...p.slice(0, 6)));
  assert.equal(half.o, 10);
});

test("at the end the minute is the real bar, and before it never leaves the real range", () => {
  assert.deepEqual(formingIndexBar(BAR, 1), BAR);
  const almost = formingIndexBar(BAR, 0.999);
  assert.ok(almost.h <= BAR.h && almost.l >= BAR.l);
  assert.equal(almost.c, p[10]);
});

test("no bars: every number is empty, never NaN or 0.00%", () => {
  const summary = indexSummary([], 49712.04);
  assert.equal(summary.last, null);
  assert.equal(summary.change, null);
  assert.equal(summary.changeText, "");
  assert.equal(summary.percentText, "");
  assert.equal(summary.tone, "flat");
  assert.equal(summary.open, null);
  assert.equal(summary.high, null);
  assert.equal(summary.low, null);
});

test("the real 10/06 first minute reads 49,932.26, up 220.22 (+0.44%)", () => {
  const summary = indexSummary([FIRST_1006], 49712.04);
  assert.equal(summary.last, 49932.26);
  assert.equal(summary.change, 220.22);
  assert.equal(summary.changeText, "220.22");
  assert.equal(summary.percentText, "+0.44%");
  assert.equal(summary.tone, "up");
  assert.equal(summary.open, 49736.37);
  assert.equal(summary.high, 49932.26);
  assert.equal(summary.low, 49736.37);
});

// The 大盤 pane and the TAIEX row say why there is nothing to show, and never claim a lesson has no index when
// the run simply has not revealed 09:00 yet (final review, Important 1).
test("before a run the index waits for the run to start", () => {
  assert.equal(indexAvailability({ hasRun: false, series: undefined }), "no-run");
  assert.equal(INDEX_EMPTY_TEXT["no-run"], "開始練習後顯示大盤");
});

test("a run at cursor 0 with an index waits for the first minute instead of saying there is no index", () => {
  const series = { code: "TAIEX" as const, name: "加權指數", previousClose: 49712.04, source: "證交所", bars: [] };
  assert.equal(indexAvailability({ hasRun: true, series }), "waiting");
  assert.equal(INDEX_EMPTY_TEXT.waiting, "第一分鐘揭露後顯示大盤");
});

test("only a run without an index says the lesson has no index data", () => {
  assert.equal(indexAvailability({ hasRun: true, series: undefined }), "none");
  assert.equal(INDEX_EMPTY_TEXT.none, "本教材沒有大盤資料");
});

test("revealed index bars are ready to draw", () => {
  const series = { code: "TAIEX" as const, name: "加權指數", previousClose: 49712.04, source: "證交所", bars: [FIRST_1006] };
  assert.equal(indexAvailability({ hasRun: true, series }), "ready");
});
