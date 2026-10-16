import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedTradingDay, marketDataSummary } from "./market-data-status.ts";

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
