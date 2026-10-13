import test from "node:test";
import assert from "node:assert/strict";
import { deriveMorningAlerts } from "./morning-alerts.ts";
import type { MorningCatalog, MorningState } from "./morning.ts";

const catalog: MorningCatalog = {
  lessonId: "t",
  title: "t",
  date: "2026-10-06",
  start: "09:00",
  end: "10:30",
  maxCursor: 90,
  symbols: [{ code: "2330", name: "台積電", previousClose: 1000, previous5CloseMean: 1000 }],
  context: [],
  strategy: [],
  notices: [],
  videoUrl: null,
};

const bar = (minute: number, high: number, close: number) => ({
  t: minute * 60,
  o: close,
  h: high,
  l: Math.min(close, high) - 5,
  c: close,
  v: 0,
});

function state(
  cursor: number,
  bars: ReturnType<typeof bar>[],
  fills: MorningState["fills"] = [],
): MorningState {
  return {
    id: "s",
    lessonId: "t",
    cursor,
    revision: 1,
    plan: { bias: "observe", focusCode: "2330", reason: "", entry: "", stop: "" },
    bars: { "2330": bars },
    startingCash: 10_000_000,
    cash: 10_000_000,
    equity: 10_000_000,
    positions: [],
    orders: [],
    fills,
    completed: false,
    reflection: "",
    nextAdvanceAt: 0,
  };
}

test("closes crossing the previous close become alerts at the minute they complete", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1010, 1005), bar(2, 1005, 1000), bar(3, 995, 990)];
  assert.deepEqual(deriveMorningAlerts(catalog, state(4, bars)), [
    { t: 120, kind: "cross-up", code: "2330", text: "台積電 站上昨收 1000" },
    { t: 240, kind: "cross-down", code: "2330", text: "台積電 跌破昨收 1000" },
  ]);
});

test("a swing high appears only once it is confirmed, and never from unrevealed minutes", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1005, 995), bar(2, 1025, 995), bar(3, 1010, 995), bar(4, 1005, 995)];
  // At cursor 4 only minutes 0–3 are complete; minute 4 must be ignored even if present.
  assert.deepEqual(deriveMorningAlerts(catalog, state(4, bars)), []);
  assert.deepEqual(
    deriveMorningAlerts(catalog, state(4, bars)),
    deriveMorningAlerts(catalog, state(4, bars.slice(0, 4))),
  );
  assert.deepEqual(deriveMorningAlerts(catalog, state(5, bars)), [
    { t: 300, kind: "swing-high", code: "2330", text: "台積電 前高確認 1025" },
  ]);
});

test("the learner's fills are alerts and sort last within the same minute", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1010, 1005)];
  const fill = { id: "f", code: "2330", side: "buy" as const, shares: 1000, price: 1005, fee: 20, tax: 0, t: 120 };
  const alerts = deriveMorningAlerts(catalog, state(2, bars, [fill]));
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.at(-1), {
    t: 120,
    kind: "fill",
    code: "2330",
    text: "你的委託成交：台積電 買進 1 張 @ 1005",
  });
});

test("an empty or not-yet-started session has no alerts", () => {
  assert.deepEqual(deriveMorningAlerts(catalog, state(0, [])), []);
});

test("a fill revealed by the latest advance is the latest alert, even when that minute also crosses", () => {
  // Engine timing: advancing from cursor 2 fills at minute 2's open (t=120) and reveals
  // minute 2, whose close crosses the previous close at its end (t=180).
  const bars = [bar(0, 1000, 995), bar(1, 1000, 995), bar(2, 1010, 1005)];
  const fill = { id: "f", code: "2330", side: "buy" as const, shares: 1000, price: 995, fee: 20, tax: 0, t: 120 };
  const alerts = deriveMorningAlerts(catalog, state(3, bars, [fill]));
  assert.equal(alerts.at(-1)?.kind, "fill");
  assert.equal(alerts.at(-1)?.t, 120);
});
