import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedTradingDay, extraLines, marketDataSummary } from "./market-data-status.ts";

const at = (iso: string) => new Date(iso);
const run = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-10-16",
  mode: "daily",
  startedAt: "2026-10-16T16:45:00+08:00",
  finishedAt: "2026-10-16T17:05:00+08:00",
  outcome: "ok",
  reason: null,
  symbols: { total: 1049, fetched: 1049, failed: 0, excluded: 0 },
  ...overrides,
});
const status = (lastRun: unknown, history: unknown[] = [], latestDay: string | null = "2026-10-16") => ({
  schema: 1,
  latestDay,
  lastRun,
  history,
});
const day = (date: string, coverage = "full-market", symbols = 1049) => ({
  date,
  coverage,
  symbols,
  manifestSha256: "a".repeat(64),
  publishedAt: `${date}T17:05:00+08:00`,
});
const index = (...days: unknown[]) => ({ schema: 1, days });
const EVENING = at("2026-10-16T20:00:00+08:00");

test("expectedTradingDay is the latest weekday whose 19:30 has passed in Taipei", () => {
  assert.equal(expectedTradingDay(at("2026-10-16T20:00:00+08:00")), "2026-10-16");
  assert.equal(expectedTradingDay(at("2026-10-16T18:00:00+08:00")), "2026-10-15");
  assert.equal(expectedTradingDay(at("2026-10-17T12:00:00+08:00")), "2026-10-16");
  assert.equal(expectedTradingDay(at("2026-10-19T10:00:00+08:00")), "2026-10-16");
  assert.equal(expectedTradingDay(at("2026-10-19T19:31:00+08:00")), "2026-10-19");
});

test("an unconfigured or never-run fetcher says so", () => {
  assert.equal(marketDataSummary({ configured: false, status: null, index: null }, EVENING).state, "unconfigured");
  const never = marketDataSummary({ configured: true, status: null, index: null }, EVENING);
  assert.equal(never.state, "never");
  assert.equal(never.missingExpectedDay, null);
});

test("a successful run reports the latest day, counts and duration", () => {
  const summary = marketDataSummary(
    { configured: true, status: status(run()), index: index(day("2026-10-05", "selected", 5), day("2026-10-16")) },
    EVENING,
  );
  assert.equal(summary.state, "ok");
  assert.equal(summary.latestDay, "2026-10-16");
  assert.equal(summary.latestSymbols, 1049);
  assert.equal(summary.fullMarketDays, 1);
  assert.equal(summary.lastRun?.durationMinutes, 20);
  assert.equal(summary.missingExpectedDay, null);
});

test("already-done shows as ok and a failure keeps its reason", () => {
  const done = marketDataSummary(
    { configured: true, status: status(run({ outcome: "already-done" })), index: index(day("2026-10-16")) },
    EVENING,
  );
  assert.equal(done.state, "ok");
  const failed = marketDataSummary(
    {
      configured: true,
      status: status(run({ outcome: "failed", reason: "登入失敗：＊＊＊" })),
      index: index(day("2026-10-15")),
    },
    EVENING,
  );
  assert.equal(failed.state, "failed");
  assert.equal(failed.reason, "登入失敗：＊＊＊");
  assert.equal(failed.missingExpectedDay, "2026-10-16");
});

test("a recorded holiday covers the expected day", () => {
  const closed = marketDataSummary(
    {
      configured: true,
      status: status(run({ outcome: "closed" }), [
        { date: "2026-10-16", outcome: "closed", finishedAt: "2026-10-16T16:46:00+08:00" },
      ]),
      index: index(day("2026-10-15")),
    },
    EVENING,
  );
  assert.equal(closed.state, "closed");
  assert.equal(closed.missingExpectedDay, null);
});

test("a run still marked running after two hours is stalled", () => {
  const stalled = marketDataSummary(
    {
      configured: true,
      status: status(run({ outcome: "running", finishedAt: null, startedAt: "2026-10-16T16:45:00+08:00" })),
      index: index(day("2026-10-15")),
    },
    EVENING,
  );
  assert.equal(stalled.state, "stalled");
  assert.match(stalled.reason ?? "", /中斷/);
});

test("malformed files are invalid, not thrown", () => {
  for (const bad of [{ schema: 2 }, { invalid: true }, "text", 42]) {
    assert.equal(marketDataSummary({ configured: true, status: bad, index: null }, EVENING).state, "invalid");
    assert.equal(marketDataSummary({ configured: true, status: null, index: bad }, EVENING).state, "invalid");
  }
});

// ── What the fetcher writes after the candles: ticks, TAIEX and the 當沖 list (status.json keys) ──
const ticks = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-10-16",
  outcome: "ok",
  reason: null,
  symbols: { total: 1056, fetched: 1056, failed: 0 },
  trades: 1_043_210,
  finishedAt: "2026-10-16T17:30:00+08:00",
  ...overrides,
});
const taiex = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-10-16",
  outcome: "ok",
  reason: null,
  points: 3240,
  failed: [],
  finishedAt: "2026-10-16T17:35:00+08:00",
  ...overrides,
});
const radar = (overrides: Record<string, unknown> = {}) => ({
  outcome: "ok",
  reason: null,
  latest: "2026-10-16",
  symbols: 23,
  stored: ["2026-10-16"],
  finishedAt: "2026-10-16T17:36:00+08:00",
  ...overrides,
});
const withExtras = (extras: Record<string, unknown>) => ({ ...status(run()), ...extras });
const summaryOf = (extras: Record<string, unknown>) =>
  marketDataSummary({ configured: true, status: withExtras(extras), index: index(day("2026-10-16")) }, EVENING);

test("ticks: the newest day's stocks, trades and whether it is complete", () => {
  const whole = summaryOf({ ticks: ticks() }).ticks;
  assert.deepEqual(whole, {
    state: "ok",
    date: "2026-10-16",
    symbols: { total: 1056, fetched: 1056, failed: 0 },
    trades: 1_043_210,
    complete: true,
    reason: null,
  });
  const partial = summaryOf({
    ticks: ticks({ outcome: "partial", reason: "；2 檔沒抓齊", symbols: { total: 1056, fetched: 1054, failed: 2 }, trades: 1_000_000 }),
  }).ticks;
  assert.equal(partial.state, "partial");
  assert.equal(partial.state === "partial" && partial.complete, false);
  assert.equal(partial.state === "partial" && partial.symbols.fetched, 1054);
  const failed = summaryOf({
    ticks: ticks({ outcome: "failed", reason: "登入失敗", symbols: { total: 0, fetched: 0, failed: 0 }, trades: 0 }),
  }).ticks;
  assert.equal(failed.state, "failed");
  assert.equal(failed.state === "failed" && failed.reason, "登入失敗");
  assert.equal(failed.state === "failed" && failed.complete, false);
});

test("taiex: the newest handled day is stored or the run says why not, even when that day itself was stored", () => {
  const stored = summaryOf({ taiex: taiex() }).taiex;
  assert.deepEqual(stored, { state: "ok", date: "2026-10-16", points: 3240, reason: null, failedDays: [] });
  // An older day failed in the same run: the outcome is failed with the reason prefixed by that day, whatever `date` says.
  const mixed = summaryOf({
    taiex: taiex({ outcome: "failed", reason: "2026-10-15：證交所沒有這天的資料", failed: ["2026-10-15"] }),
  }).taiex;
  assert.equal(mixed.state, "failed");
  assert.equal(mixed.state === "failed" && mixed.reason, "2026-10-15：證交所沒有這天的資料");
  assert.deepEqual(mixed.state === "failed" && mixed.failedDays, ["2026-10-15"]);
  // The error path writes no date and no points.
  const unexpected = summaryOf({
    taiex: { date: null, outcome: "failed", reason: "大盤處理時發生未預期的錯誤", points: null, failed: [], finishedAt: "2026-10-16T17:35:00+08:00" },
  }).taiex;
  assert.equal(unexpected.state, "failed");
  assert.equal(unexpected.state === "failed" && unexpected.date, null);
});

test("radar: the newest stored list's date and count, a failure's reason, and 尚未設定 without a config", () => {
  assert.deepEqual(summaryOf({ radar: radar() }).radar, {
    state: "ok",
    latest: "2026-10-16",
    count: 23,
    reason: null,
  });
  const failed = summaryOf({ radar: radar({ outcome: "failed", reason: "名單存檔失敗" }) }).radar;
  assert.equal(failed.state, "failed");
  assert.equal(failed.state === "failed" && failed.reason, "名單存檔失敗");
  assert.equal(failed.state === "failed" && failed.latest, "2026-10-16", "the list stored earlier is still the newest");
  const unconfigured = summaryOf({
    radar: radar({ outcome: "not-configured", latest: null, symbols: null, stored: [] }),
  }).radar;
  assert.deepEqual(unconfigured, { state: "not-configured" });
  const none = summaryOf({ radar: radar({ latest: null, symbols: null, stored: [] }) }).radar;
  assert.deepEqual(none, { state: "ok", latest: null, count: null, reason: null });
});

test("a status file written before these keys, or with them damaged, still reads: neutral lines, nothing thrown", () => {
  const old = summaryOf({});
  assert.deepEqual([old.ticks, old.taiex, old.radar], [{ state: "none" }, { state: "none" }, { state: "none" }]);
  assert.equal(old.state, "ok", "the candles' own state is untouched");
  const damaged = summaryOf({
    ticks: "yes",
    taiex: { outcome: "weird", date: "2026-10-16" },
    radar: { outcome: "ok", latest: "last week", symbols: -3 },
  });
  assert.deepEqual(
    [damaged.ticks, damaged.taiex, damaged.radar],
    [{ state: "unreadable" }, { state: "unreadable" }, { state: "unreadable" }],
  );
  assert.equal(damaged.state, "ok");
  // One damaged key does not hide the others.
  const mixed = summaryOf({ ticks: [1, 2], taiex: taiex(), radar: radar() });
  assert.equal(mixed.ticks.state, "unreadable");
  assert.equal(mixed.taiex.state, "ok");
  assert.equal(mixed.radar.state, "ok");
  // Negative or fractional counts are not counts.
  assert.equal(summaryOf({ ticks: ticks({ trades: -1 }) }).ticks.state, "unreadable");
  assert.equal(summaryOf({ ticks: ticks({ symbols: { total: 1.5, fetched: 1, failed: 0 } }) }).ticks.state, "unreadable");
  // Not configured, never run, or a damaged file as a whole: no lines to show either.
  for (const input of [
    { configured: false, status: null, index: null },
    { configured: true, status: null, index: null },
    { configured: true, status: { schema: 2 }, index: null },
  ]) {
    const summary = marketDataSummary(input, EVENING);
    assert.deepEqual([summary.ticks, summary.taiex, summary.radar], [{ state: "none" }, { state: "none" }, { state: "none" }]);
  }
});

test("the list is never spelled out: no stock codes or names, only a date and a count", () => {
  const summary = summaryOf({
    radar: { ...radar(), codes: ["2330", "2317"], list: [["2330", "台積電"]], stored: ["2026-10-16"] },
  });
  const text = JSON.stringify(summary.radar);
  assert.ok(!/2330|2317|台積電/.test(text), text);
  assert.ok(!/2330|台積電/.test(JSON.stringify(extraLines(summary))), "the lines do not name a stock either");
  // A list that arrives as an array where the count belongs is a damaged file, not a list to print.
  assert.equal(summaryOf({ radar: radar({ symbols: [["2330", "台積電"]] }) }).radar.state, "unreadable");
});

test("the card's three lines: 逐筆, 大盤 and 熱門當沖名單", () => {
  const lines = extraLines(summaryOf({ ticks: ticks(), taiex: taiex(), radar: radar() }));
  assert.deepEqual(
    lines.map((line) => line.label),
    ["逐筆", "大盤", "熱門當沖名單"],
  );
  assert.equal(lines[0].text, "2026-10-16・1,056／1,056 檔・1,043,210 筆・完整");
  assert.equal(lines[1].text, "2026-10-16 已存（3,240 點）");
  assert.equal(lines[2].text, "最新 2026-10-16・23 檔");
  assert.deepEqual(lines.map((line) => line.tone), ["ok", "ok", "ok"]);

  const trouble = extraLines(
    summaryOf({
      ticks: ticks({ outcome: "partial", reason: "；2 檔沒抓齊", symbols: { total: 1056, fetched: 1054, failed: 2 }, trades: 1_000_000 }),
      taiex: taiex({ outcome: "failed", reason: "2026-10-15：證交所沒有這天的資料", failed: ["2026-10-15"] }),
      radar: radar({ outcome: "failed", reason: "名單存檔失敗" }),
    }),
  );
  assert.equal(trouble[0].text, "2026-10-16・1,054／1,056 檔・1,000,000 筆・未完整");
  assert.equal(trouble[1].text, "失敗：2026-10-15：證交所沒有這天的資料");
  assert.equal(trouble[2].text, "失敗：名單存檔失敗（最新已存 2026-10-16・23 檔）");
  assert.deepEqual(trouble.map((line) => line.tone), ["warn", "warn", "warn"]);

  const failedTicks = extraLines(
    summaryOf({ ticks: ticks({ outcome: "failed", reason: "登入失敗", symbols: { total: 0, fetched: 0, failed: 0 }, trades: 0 }) }),
  );
  assert.equal(failedTicks[0].text, "2026-10-16・失敗：登入失敗");

  const neutral = extraLines(summaryOf({}));
  assert.deepEqual(neutral.map((line) => line.text), ["尚無紀錄", "尚無紀錄", "尚無紀錄"]);
  assert.deepEqual(neutral.map((line) => line.tone), ["muted", "muted", "muted"]);
  const unreadable = extraLines(summaryOf({ ticks: 1, taiex: 1, radar: 1 }));
  assert.deepEqual(unreadable.map((line) => line.text), ["紀錄格式無法讀取", "紀錄格式無法讀取", "紀錄格式無法讀取"]);
  assert.deepEqual(unreadable.map((line) => line.tone), ["muted", "muted", "muted"]);

  assert.equal(
    extraLines(summaryOf({ radar: radar({ outcome: "not-configured", latest: null, symbols: null, stored: [] }) }))[2].text,
    "尚未設定",
  );
  assert.equal(extraLines(summaryOf({ radar: radar({ latest: null, symbols: null, stored: [] }) }))[2].text, "還沒有已存的名單");
  // A failure without a recorded reason still says it failed.
  assert.equal(extraLines(summaryOf({ taiex: taiex({ outcome: "failed", reason: null }) }))[1].text, "失敗：原因未記錄");
});
