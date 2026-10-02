import type { RuleVerdict } from "./pass-rules.ts";

const OUTCOME_RULES = new Set(["profit_gt_fees", "positive_pnl", "min_winning_trade"]);

/** Presentation only: preserve each saved verdict and the original pass decision. */
export function groupReviewVerdicts(verdicts: readonly RuleVerdict[]) {
  return [
    {
      id: "practice",
      title: "操作與風險條件",
      description: "對照本盤紀錄，檢查如何操作與控制風險。",
      verdicts: verdicts.filter((verdict) => !OUTCOME_RULES.has(verdict.rule.code)),
    },
    {
      id: "outcome",
      title: "模擬盈虧目標",
      description: "這些是本課的結果門檻；未達成不等於操作違規。",
      verdicts: verdicts.filter((verdict) => OUTCOME_RULES.has(verdict.rule.code)),
    },
  ].filter((group) => group.verdicts.length > 0);
}
