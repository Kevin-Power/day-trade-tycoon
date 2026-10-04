import assert from "node:assert/strict";
import { test } from "node:test";
import { checkpointsOf, debrief, LESSONS, passRulesOf, type DebriefInput } from "./curriculum.ts";

const lesson = LESSONS[0];
function example(overrides: Partial<DebriefInput> = {}): DebriefInput {
  return {
    trades: 1,
    pnl: 1000,
    fees: 100,
    maxDrawdown: 0.01,
    equity: 100000,
    exposure: 10000,
    fills: [
      { side: "buy", price: 100, vwapAt: 100 },
      { side: "sell", price: 101, vwapAt: 101 },
    ],
    ...overrides,
  };
}

test("zero closing matches does not turn an opening fill into a no-trade session", () => {
  const observed = debrief(lesson, example({ trades: 0, pnl: 0, fees: 0, fills: [] }));
  assert.ok(observed.tags.includes("尚無成交"));
  assert.ok(!observed.tags.includes("尚無平倉撮合"));
  assert.match(observed.headline, /沒有進場的理由/);
  assert.doesNotMatch(observed.headline, /下一盤.*出手/);

  const entered = debrief(
    lesson,
    example({
      trades: 0,
      pnl: -50,
      fees: 50,
      fills: [{ side: "buy", price: 100, vwapAt: 100 }],
    }),
  );
  assert.ok(entered.tags.includes("尚無平倉撮合"));
  assert.ok(!entered.tags.includes("尚無成交"));
  assert.match(entered.headline, /本盤有成交/);
});

test("positive pnl with a small drawdown does not certify risk control or entry skill", () => {
  const smallDrawdown = debrief(lesson, example());
  const largeDrawdown = debrief(lesson, example({ maxDrawdown: 0.05 }));
  for (const result of [smallDrawdown, largeDrawdown]) {
    assert.ok(result.tags.includes("模擬淨損益為正"));
    assert.ok(!result.tags.includes("風控有守"));
    assert.ok(!result.tags.includes("沒追價"));
    assert.match(result.headline, /單盤紀錄不是技能認證/);
  }
  assert.ok(!smallDrawdown.tags.includes("最大回撤超過 4%"));
  assert.ok(largeDrawdown.tags.includes("最大回撤超過 4%"));
});

test("the cost comparison treats positive and negative pnl equally without crediting direction", () => {
  for (const pnl of [-100, 0, 100]) {
    const result = debrief(lesson, example({ pnl }));
    assert.ok(result.tags.includes("淨損益絕對值小於費稅 1.2 倍"));
    assert.doesNotMatch(result.headline, /方向對了/);
    assert.ok(!result.tags.includes("費稅吃掉"));
  }
  const boundary = debrief(lesson, example({ pnl: 120 }));
  assert.ok(!boundary.tags.includes("淨損益絕對值小於費稅 1.2 倍"));
});

test("vwap comparisons describe the recorded price difference without inferring intent", () => {
  const nearby = debrief(
    lesson,
    example({
      fills: [
        { side: "buy", price: 100.39, vwapAt: 100 },
        { side: "sell", price: 99.61, vwapAt: 100 },
        { side: "buy", price: 200, vwapAt: 0 },
      ],
    }),
  );
  assert.ok(!nearby.tags.includes("成交價偏離均價比較值"));
  assert.ok(!nearby.tags.includes("沒追價"));
  for (const fill of [
    { side: "buy" as const, price: 100.41, vwapAt: 100 },
    { side: "sell" as const, price: 99.59, vwapAt: 100 },
  ]) {
    const result = debrief(lesson, example({ fills: [fill] }));
    assert.ok(result.tags.includes("成交價偏離均價比較值"));
    assert.ok(!result.tags.includes("追價"));
    assert.match(result.headline, /無法判定操作動機/);
  }
});

test("editing teaching copy preserves published lesson identifiers and checkpoint timing", () => {
  assert.deepEqual(
    LESSONS.map((item) => [item.id, item.beats.map((beat) => beat.atMinute)]),
    [
      ["wed-open", [0, 1, 10, 24]],
      ["mon", [0, 43, 60, 200]],
      ["tue-dump", [0, 8, 52, 70]],
      ["tue-v", [60, 120, 160, 250]],
      ["wed", [0, 1, 70, 200]],
      ["tycoon", [0, 1, 248]],
    ],
  );
  assert.deepEqual(
    checkpointsOf(LESSONS.find((item) => item.id === "tue-dump")!).map((beat) => beat.atMinute),
    [0.333, 120],
  );
});

test("teaching copy edits retain the original challenge definitions and numeric thresholds", () => {
  const contract = Object.fromEntries(
    LESSONS.map((item) => [
      item.id,
      passRulesOf(item.id).map(({ id, code, params }) => [id, code, params ?? null]),
    ]),
  );
  assert.deepEqual(contract, {
    "wed-open": [
      ["avg", "no_average_down", null],
      ["dd", "max_dd", { max: 0.02 }],
      ["flat", "flatten_before_close", null],
      ["win", "min_winning_trade", { min: 1 }],
    ],
    mon: [
      ["avg", "no_average_down", null],
      ["flat", "flatten_before_close", null],
      ["dd", "max_dd", { max: 0.04 }],
    ],
    "tue-dump": [
      ["avg", "no_average_down", null],
      ["risk", "risk_down_after_low", null],
      ["flat", "flatten_before_close", null],
    ],
    "tue-v": [
      ["hold", "min_hold_minutes", { min: 15 }],
      ["fees", "profit_gt_fees", { multiple: 3 }],
      ["flat", "flatten_before_close", null],
    ],
    wed: [
      ["pnl", "positive_pnl", null],
      ["dd", "max_dd", { max: 0.03 }],
      ["flat", "flatten_before_close", null],
    ],
    tycoon: [
      ["pnl", "positive_pnl", null],
      ["dd", "max_dd", { max: 0.05 }],
      ["flat", "flatten_before_close", null],
    ],
  });
});
