import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePass } from "./pass-rules.ts";
import { groupReviewVerdicts } from "./review-presentation.ts";
import type { Fill } from "./types.ts";

test("a losing first-lesson round trip keeps its original result while separating the unmet profit goal", () => {
  const fills: Fill[] = [
    {
      id: "buy-1",
      orderId: "ob",
      code: "DEMO",
      side: "buy",
      lots: 1,
      price: 100,
      fee: 20,
      tax: 0,
      time: 60,
      vwapAt: 100,
    },
    {
      id: "sell-1",
      orderId: "os",
      code: "DEMO",
      side: "sell",
      lots: 1,
      price: 99.9,
      fee: 20,
      tax: 150,
      time: 120,
      vwapAt: 100,
    },
  ];
  const result = evaluatePass({
    lessonId: "wed-open",
    pnl: -290,
    fees: 190,
    maxDrawdown: 0.00029,
    endT: 1800,
    positionsOpen: 0,
    fills,
    forcedClose: false,
  });
  const saved = JSON.stringify(result);
  const groups = groupReviewVerdicts(result.verdicts);
  assert.equal(result.passed, false);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["practice", "outcome"],
  );
  assert.equal(groups[0].verdicts.length, 3);
  assert.ok(groups[0].verdicts.every((verdict) => verdict.passed));
  assert.deepEqual(
    groups[1].verdicts.map((verdict) => verdict.rule.code),
    ["min_winning_trade"],
  );
  assert.equal(groups[1].verdicts[0].passed, false);
  assert.equal(groups[1].verdicts[0], result.verdicts[3]);
  assert.equal(JSON.stringify(result), saved);
});

test("grouping preserves saved timestamps, thresholds, and details without reevaluating historical rules", () => {
  const verdicts = [
    {
      rule: {
        id: "historical",
        label: "當時的盈虧門檻",
        code: "profit_gt_fees" as const,
        params: { multiple: 7 },
      },
      passed: false,
      detail: "原始判定文字",
      at: 120,
    },
  ];
  Object.freeze(verdicts[0]);
  Object.freeze(verdicts);
  const groups = groupReviewVerdicts(verdicts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "outcome");
  assert.equal(groups[0].verdicts[0], verdicts[0]);
  assert.deepEqual(groupReviewVerdicts([]), []);
});
