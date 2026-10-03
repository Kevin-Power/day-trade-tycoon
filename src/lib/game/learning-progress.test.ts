import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewBundle } from "./persist.ts";
import { deriveLearningProgress, summarizeLearningProgress } from "./learning-progress.ts";

const fill = {
  id: "F2",
  orderId: "O1",
  code: "2317",
  side: "buy" as const,
  lots: 1,
  price: 100,
  fee: 86,
  tax: 0,
  time: 60,
  vwapAt: 100,
};
const plan = {
  version: 1 as const,
  code: "2317",
  side: "buy" as const,
  lots: 1,
  simTime: 50,
  entryCondition: "等到條件出現",
  exitCondition: "條件失效時離場",
  maxLoss: 1000,
};
const order = {
  id: "O1",
  code: "2317",
  side: "buy" as const,
  type: "limit" as const,
  lots: 1,
  price: 100,
  time: 60,
};
function review(patch: Partial<ReviewBundle> = {}): ReviewBundle {
  return {
    rec: {
      id: "review-1",
      scenarioId: "wed-open",
      scenarioName: "第一課",
      endedAt: 1000,
      pnl: -500,
      pnlPct: -0.05,
      trades: 0,
      wins: 0,
      fees: 86,
      maxDrawdown: 0.001,
      grade: "D",
      title: "第一課",
      passed: false,
    },
    verdicts: [],
    fills: [],
    code: "2317",
    capital: 1000000,
    equity: 999500,
    sessionLabel: "本次模擬",
    firstTradePlan: { plan: null, order: null },
    openPositionsAtEnd: [],
    ...patch,
  };
}
const statuses = (bundle: ReviewBundle) =>
  Object.fromEntries(
    deriveLearningProgress(bundle).milestones.map((milestone) => [milestone.id, milestone.status]),
  );

test("a zero-fill session earns no trading milestone even if legacy pass rules say it passed", () => {
  const bundle = review();
  bundle.rec.passed = true;
  bundle.rec.grade = "S";
  const progress = deriveLearningProgress(bundle);
  assert.equal(progress.noRecordedFills, true);
  assert.equal(progress.achievedCount, 0);
  assert.equal(progress.knownCount, 4);
  assert.deepEqual(statuses(bundle), {
    "plan-recorded": "not-observed",
    "fill-recorded": "not-observed",
    "close-recorded": "not-observed",
    "flat-at-end": "not-observed",
  });
});

test("a saved plan is recognized without requiring an order, fill or profit", () => {
  const bundle = review({ firstTradePlan: { plan, order: null } });
  assert.equal(deriveLearningProgress(bundle).achievedCount, 1);
  assert.equal(statuses(bundle)["plan-recorded"], "achieved");
  assert.equal(statuses(bundle)["fill-recorded"], "not-observed");
});

test("an accepted but unfilled order is not a fill or a close", () => {
  const bundle = review({ firstTradePlan: { plan, order } });
  assert.equal(deriveLearningProgress(bundle).noRecordedFills, true);
  assert.equal(deriveLearningProgress(bundle).achievedCount, 1);
  assert.equal(statuses(bundle)["flat-at-end"], "not-observed");
});

test("historical absent fields stay unknown instead of becoming missing work or zero inventory", () => {
  const bundle = review({
    firstTradePlan: undefined,
    openPositionsAtEnd: undefined,
    fills: [fill],
  });
  const progress = deriveLearningProgress(bundle);
  assert.equal(statuses(bundle)["plan-recorded"], "unknown");
  assert.equal(statuses(bundle)["flat-at-end"], "unknown");
  assert.equal(progress.knownCount, 2);
  assert.equal(progress.achievedCount, 1);
});

test("partial position reductions earn only the recorded close milestone, with inventory retained", () => {
  const bundle = review({
    fills: [fill],
    openPositionsAtEnd: [{ code: "2317", lots: 1, last: 100 }],
  });
  bundle.rec.trades = 1;
  const progress = deriveLearningProgress(bundle);
  assert.equal(statuses(bundle)["close-recorded"], "achieved");
  assert.equal(statuses(bundle)["flat-at-end"], "not-observed");
  assert.match(progress.milestones[2]!.detail, /可能包含部分減碼或系統平倉/);
});

test("zero inventory after a fill is a factual end-state, including system liquidation", () => {
  const bundle = review({ fills: [fill], openPositionsAtEnd: [] });
  bundle.verdicts = [
    {
      rule: { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
      passed: false,
      detail: "結束時仍有部位，由系統強制平倉",
    },
  ];
  assert.equal(statuses(bundle)["flat-at-end"], "achieved");
  assert.match(deriveLearningProgress(bundle).milestones[3]!.detail, /不表示自行平倉/);
});

test("profit, letter grade, budget amount and saved pass verdicts do not control these milestones", () => {
  const bundle = review({ firstTradePlan: { plan, order }, fills: [fill] });
  bundle.rec.trades = 1;
  const before = deriveLearningProgress(bundle);
  const changed = structuredClone(bundle);
  changed.rec.pnl = 500000;
  changed.rec.pnlPct = 50;
  changed.rec.grade = "S";
  changed.rec.passed = true;
  changed.rec.maxDrawdown = 0.99;
  changed.firstTradePlan = { plan: { ...plan, maxLoss: 1 }, order };
  assert.deepEqual(deriveLearningProgress(changed), before);
});

test("contradictory chronology and unsupported close counts are unknown, not awarded", () => {
  const bundle = review({ firstTradePlan: { plan: { ...plan, simTime: 61 }, order } });
  bundle.rec.trades = 3;
  assert.equal(statuses(bundle)["plan-recorded"], "unknown");
  assert.equal(statuses(bundle)["close-recorded"], "unknown");
});

test("derived progress does not mutate saved grades, verdicts, snapshots or fill order", () => {
  const bundle = review({
    firstTradePlan: { plan, order },
    fills: [{ ...fill, id: "F4", time: 80 }, fill],
  });
  const before = JSON.stringify(bundle);
  deriveLearningProgress(bundle);
  summarizeLearningProgress([bundle, bundle]);
  assert.equal(JSON.stringify(bundle), before);
});

test("recent local summary deduplicates before selecting the latest 30 and never claims lifetime totals", () => {
  const reviews = Array.from({ length: 40 }, (_, index) => {
    const bundle = review();
    bundle.rec.id = `review-${index}`;
    bundle.rec.endedAt = index;
    return bundle;
  });
  const duplicate = structuredClone(reviews[0]!);
  duplicate.rec.endedAt = 100;
  const source = [...reviews, duplicate];
  const before = JSON.stringify(source);
  const summary = summarizeLearningProgress(source);
  assert.equal(summary.scope, "recent-local");
  assert.equal(summary.limit, 30);
  assert.equal(summary.reviewCount, 30);
  assert.equal(summary.recent[0]!.sessionId, "review-0");
  assert.equal(summary.recent[1]!.sessionId, "review-39");
  assert.equal(new Set(summary.recent.map((progress) => progress.sessionId)).size, 30);
  assert.equal(JSON.stringify(source), before);
});

test("summary counts unknown historical evidence separately and handles an empty local archive", () => {
  const old = review({ firstTradePlan: undefined, openPositionsAtEnd: undefined });
  const newer = review({ firstTradePlan: { plan, order }, fills: [fill] });
  newer.rec.id = "newer";
  const summary = summarizeLearningProgress([old, newer]);
  assert.deepEqual(
    summary.milestones.find((item) => item.id === "plan-recorded"),
    {
      id: "plan-recorded",
      title: "寫下進場計畫",
      achievedSessions: 1,
      knownSessions: 1,
      unknownSessions: 1,
    },
  );
  const empty = summarizeLearningProgress([]);
  assert.equal(empty.reviewCount, 0);
  assert.equal(empty.recent.length, 0);
  assert.ok(
    empty.milestones.every(
      (item) =>
        item.achievedSessions === 0 && item.knownSessions === 0 && item.unknownSessions === 0,
    ),
  );
});
