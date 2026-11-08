import test from "node:test";
import assert from "node:assert/strict";
import { breakoutsOf, deriveMorningAlerts, freshBreakout } from "./morning-alerts.ts";
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

// A 前高 of 1025 at 09:02, confirmed when 09:04 closes (t=300); everything closes under the previous close until then.
const peak = [bar(0, 1000, 995), bar(1, 1005, 995), bar(2, 1025, 995), bar(3, 1010, 995), bar(4, 1005, 995)];

test("a close above a confirmed 前高 is 過前高 at the minute it completes, once (N 字攻擊)", () => {
  const bars = [...peak, bar(5, 1022, 1020), bar(6, 1032, 1030), bar(7, 1040, 1035), bar(8, 1030, 1010), bar(9, 1040, 1035)];
  assert.deepEqual(deriveMorningAlerts(catalog, state(10, bars)), [
    { t: 300, kind: "swing-high", code: "2330", text: "台積電 前高確認 1025" },
    { t: 360, kind: "cross-up", code: "2330", text: "台積電 站上昨收 1000" },
    { t: 420, kind: "break-high", code: "2330", text: "台積電 過前高 1025" },
  ]);
});

test("過前高 never comes from a minute that is not revealed, nor from a close at the 前高", () => {
  const bars = [...peak, bar(5, 1022, 1020), bar(6, 1032, 1030)];
  // At cursor 6, minute 6 (09:06) is not complete.
  assert.equal(deriveMorningAlerts(catalog, state(6, bars)).some((alert) => alert.kind === "break-high"), false);
  assert.deepEqual(deriveMorningAlerts(catalog, state(6, bars)), deriveMorningAlerts(catalog, state(6, bars.slice(0, 6))));
  const equal = [...peak, bar(5, 1025, 1025)];
  assert.equal(deriveMorningAlerts(catalog, state(6, equal)).some((alert) => alert.kind === "break-high"), false);
});

test("breakoutsOf: the chart's 過前高 marks are the alerts' minutes, with their closes", () => {
  const bars = [...peak, bar(5, 1022, 1020), bar(6, 1032, 1030), bar(7, 1040, 1035), bar(8, 1030, 1010), bar(9, 1040, 1035)];
  const highs = [{ t: 120, p: 1025, confirmedAt: 300 }];
  assert.deepEqual(breakoutsOf(bars, highs), [{ t: 360, p: 1030, high: 1025 }]);
  // Before its confirmation no close counts, and a high nothing has closed above has no mark.
  assert.deepEqual(breakoutsOf(bars, [{ p: 1025, confirmedAt: 600 }]), []);
  assert.deepEqual(breakoutsOf(bars, [{ p: 1050, confirmedAt: 300 }]), []);
});

test("breakoutsOf: one minute that goes above several 前高 (or two at one price) is one 過前高, the highest", () => {
  const bars = [...peak, bar(5, 1022, 1020), bar(6, 1032, 1030)];
  const highs = [
    { p: 1015, confirmedAt: 240 },
    { p: 1025, confirmedAt: 300 },
    { p: 1025, confirmedAt: 300 },
  ];
  assert.deepEqual(breakoutsOf(bars, highs), [
    { t: 300, p: 1020, high: 1015 },
    { t: 360, p: 1030, high: 1025 },
  ]);
  const both = [{ p: 1015, confirmedAt: 330 }, { p: 1025, confirmedAt: 300 }];
  assert.deepEqual(breakoutsOf(bars, both), [{ t: 360, p: 1030, high: 1025 }]);
});

test("in one minute 過前高 sorts after 站上昨收 and before the learner's fill", () => {
  const bars = [...peak, bar(5, 1032, 1030)];
  const fill = { id: "f", code: "2330", side: "buy" as const, shares: 1000, price: 1010, fee: 20, tax: 0, t: 300 };
  assert.deepEqual(
    deriveMorningAlerts(catalog, state(6, bars, [fill])).map((alert) => alert.kind),
    ["swing-high", "cross-up", "break-high", "fill"],
  );
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

test("a fill made of several trades shows its average as 成交紀錄 does: two decimals off the tick grid", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1010, 1005)];
  const fill = (price: number) => ({ id: "f", code: "2330", side: "buy" as const, shares: 400_000, price, fee: 20, tax: 0, t: 90 });
  const text = (price: number) => deriveMorningAlerts(catalog, state(2, bars, [fill(price)])).at(-1)?.text;
  // 1462.5 is not on a 1,000+ stock's 5-point grid: not rounded to 1463.
  assert.equal(text(1462.5), "你的委託成交：台積電 買進 400 張 @ 1462.50");
  assert.equal(text(20.577125000000006), "你的委託成交：台積電 買進 400 張 @ 20.58");
  // One trade's price is written as the grid writes it.
  assert.equal(text(1005), "你的委託成交：台積電 買進 400 張 @ 1005");
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

test("a 自動出場 sell is announced as the classroom's 停利／停損, not as the learner's order", () => {
  const bars = [bar(0, 1000, 995), bar(1, 1010, 1005)];
  const fill = { id: "x", code: "2330", side: "sell" as const, shares: 1000, price: 1015, fee: 20, tax: 3, t: 100 };
  const run = state(2, bars, [fill]);
  run.orders = [{ id: "x", code: "2330", side: "sell", shares: 1000, status: "filled", submittedCursor: 1, price: 1015, auto: "takeProfit", triggerPrice: 1015 }];
  assert.equal(deriveMorningAlerts(catalog, run).at(-1)?.text, "自動停利成交：台積電 賣出 1 張 @ 1015");
});

test("a breakout is fresh for five minutes after its minute completes, so the 行情 can flag 過前高 where the thumb is", () => {
  const breakouts = [
    { t: 600, p: 1010, high: 1005 },
    { t: 1200, p: 1030, high: 1020 },
  ];
  // 09:20 completed at 1260; at 09:25 (1500) it is 240 s old: fresh, and the latest wins.
  assert.deepEqual(freshBreakout(breakouts, 1500), { t: 1200, p: 1030, high: 1020 });
  assert.deepEqual(freshBreakout(breakouts, 1260), { t: 1200, p: 1030, high: 1020 });
  // Five minutes exactly still counts; a second more does not.
  assert.deepEqual(freshBreakout(breakouts, 1560), { t: 1200, p: 1030, high: 1020 });
  assert.equal(freshBreakout(breakouts, 1561), null);
  // Before the minute completes nothing is known of it.
  assert.equal(freshBreakout(breakouts, 1259), null);
  assert.equal(freshBreakout([], 1500), null);
});
