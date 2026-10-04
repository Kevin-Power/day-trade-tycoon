import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the real headline generator. Replace only data imports, avoiding the
// browser store and preserving a clear boundary between copy and market values.
const source = readFileSync(new URL("../src/lib/market/week.ts", import.meta.url), "utf8");
const exports = {};
const imports = {
  "@/lib/market/rng": { gauss: () => 0 },
  "@/lib/market/real-paths": { stockField: () => ({}) },
  "@/lib/market/tape": { getTapeDay: () => undefined },
};
runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports,
    require: (id) => {
      assert.ok(id in imports, `Unexpected headline dependency: ${id}`);
      return imports[id];
    },
  },
);
const { WEEK_SESSIONS, sessionFromTape } = exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const day = {
  id: "headline-test-day",
  date: "2026-01-01",
  label: "測試教材",
  weekday: "四",
  prevClose: 10000,
  open: 10001,
  high: 12345.67,
  low: 8765.43,
  close: 11223.45,
  highIndex: 2976,
  lowIndex: 4,
  highMinute: 248,
  lowMinute: 0.333,
  turnoverYi: 9876,
  index5s: [10001, 10002],
  complete: true,
  stocks: { 2330: { prev: 100, open: 101, high: 105, low: 99, close: 103 } },
};

test("the first live teaching headline does not reveal the historical day outcome", () => {
  const first = WEEK_SESSIONS.wed.headlines.find((item) => item.atMinute === 0);
  assert.ok(first);
  assert.doesNotMatch(first.text, /09:00:20|44,926|全日低|手癢/);
  for (const session of Object.values(WEEK_SESSIONS)) {
    for (const headline of session.headlines) {
      assert.doesNotMatch(headline.text, /全日[高低]|盤中最[高低]|終場|收在最|隨後翻黑|外資轉賣/);
    }
  }
});

test("tape teaching text does not depend on future high, low, close, or final turnover", () => {
  for (const timing of [
    { lowMinute: 0.333, highMinute: 248 },
    { lowMinute: 120, highMinute: 270 },
    { lowMinute: 110, highMinute: 115 },
  ]) {
    const baseline = sessionFromTape({ ...day, ...timing });
    const changedOutcome = sessionFromTape({
      ...day,
      ...timing,
      high: 23456.78,
      low: 7654.32,
      close: 22334.56,
      turnoverYi: 123456,
      stocks: { 2330: { ...day.stocks["2330"], high: 1000, low: 1, close: 900 } },
    });
    assert.deepEqual(plain(changedOutcome.headlines), plain(baseline.headlines));
    assert.doesNotMatch(
      baseline.headlines.map((item) => item.text).join(" "),
      /盤中最[高低]|開盤附近見低|收在最/,
    );
  }
});

test("removing headline spoilers leaves the original trigger times and market data intact", () => {
  assert.deepEqual(
    plain(
      Object.fromEntries(
        Object.entries(WEEK_SESSIONS).map(([id, session]) => [
          id,
          session.headlines.map((headline) => headline.atMinute),
        ]),
      ),
    ),
    { mon: [12, 43, 60, 200], tue: [1, 8, 120, 160, 250], wed: [0, 70, 200, 248] },
  );

  for (const [timing, expectedTimes] of [
    [{ lowMinute: 0.333, highMinute: 248 }, [0, 248, 250]],
    [{ lowMinute: 120, highMinute: 270 }, [0, 120, 270, 250]],
    [{ lowMinute: 110, highMinute: 115 }, [0, 110, 250]],
  ]) {
    const input = { ...day, ...timing };
    const generated = sessionFromTape(input);
    assert.deepEqual(plain(generated.headlines.map((item) => item.atMinute)), expectedTimes);
    for (const key of [
      "id",
      "date",
      "label",
      "weekday",
      "prevClose",
      "open",
      "high",
      "low",
      "close",
      "highMinute",
      "lowMinute",
      "turnoverYi",
    ]) {
      assert.equal(generated[key], input[key], `${key} changed while editing copy`);
    }
    assert.deepEqual(plain(generated.keys), [
      { m: 0, px: input.open },
      { m: input.lowMinute, px: input.low },
      { m: input.highMinute, px: input.high },
      { m: 270, px: input.close },
    ]);
    assert.deepEqual(plain(generated.stockPrev), { 2330: 100 });
    assert.deepEqual(plain(generated.stockClose), { 2330: 103 });
  }
});
