import type { ReviewBundle } from "./persist.ts";

export type LearningMilestoneId =
  "plan-recorded" | "fill-recorded" | "close-recorded" | "flat-at-end";
export type LearningMilestoneStatus = "achieved" | "not-observed" | "unknown";
export type LearningMilestone = {
  id: LearningMilestoneId;
  title: string;
  status: LearningMilestoneStatus;
  detail: string;
};
export type LearningProgress = {
  sessionId: string;
  scenarioId: string;
  noRecordedFills: boolean;
  achievedCount: number;
  knownCount: number;
  milestones: LearningMilestone[];
};
export const RECENT_LEARNING_REVIEW_LIMIT = 30;

/**
 * Presentation of a validated saved review, never a new grade or proof of skill.
 * Keep missing historical fields distinct from an explicitly recorded absence.
 */
export function deriveLearningProgress(bundle: ReviewBundle): LearningProgress {
  const snapshot = bundle.firstTradePlan;
  const hasFills = bundle.fills.length > 0;
  const positions = bundle.openPositionsAtEnd;
  const plan: LearningMilestone = {
    id: "plan-recorded",
    title: "寫下進場計畫",
    status: snapshot === undefined ? "unknown" : snapshot.plan ? "achieved" : "not-observed",
    detail:
      snapshot === undefined
        ? "這份舊紀錄未保存進場計畫欄位，無法判定。"
        : snapshot.plan
          ? "已留下進場條件、離場條件與討論用虧損額度；這不代表條件已出現或已照計畫執行。"
          : "這次未記錄進場計畫，下次可先寫下要等待的條件。",
  };
  if (snapshot?.plan && snapshot.order && snapshot.plan.simTime > snapshot.order.time) {
    plan.status = "unknown";
    plan.detail = "計畫時間晚於首筆委託，這份紀錄的先後順序需要核對。";
  }
  const fill: LearningMilestone = {
    id: "fill-recorded",
    title: "留下成交紀錄",
    status: hasFills ? "achieved" : "not-observed",
    detail: hasFills
      ? `這份復盤保存 ${bundle.fills.length} 筆模擬成交，可回看商品、方向、張數與費稅。`
      : "尚無成交紀錄；掛單不等於成交，等待條件出現也可以繼續練習。",
  };
  const close: LearningMilestone = {
    id: "close-recorded",
    title: "留下減碼／平倉紀錄",
    status: bundle.rec.trades > 0 ? (hasFills ? "achieved" : "unknown") : "not-observed",
    detail:
      bundle.rec.trades > 0
        ? hasFills
          ? `本盤記錄 ${bundle.rec.trades} 次平倉撮合，可能包含部分減碼或系統平倉，不表示已全部出場。`
          : "記錄有平倉次數，但未保存可核對的成交資料，暫不判定。"
        : "這次未記錄減碼或平倉成交；有部位時，可對照原先的離場條件。",
  };
  const flat: LearningMilestone = {
    id: "flat-at-end",
    title: "結束時零庫存",
    status:
      positions === undefined
        ? "unknown"
        : positions.length === 0 && hasFills
          ? "achieved"
          : "not-observed",
    detail:
      positions === undefined
        ? "這份舊紀錄未保存結束時庫存，無法判定。"
        : positions.length > 0
          ? `結束時仍有 ${positions.length} 檔未平部位，請回看出場條件與未成交原因。`
          : hasFills
            ? "有成交紀錄，且保存的結束時庫存為零；這項不表示自行平倉或已掌握出場能力。"
            : "結束時零庫存，但尚無成交紀錄，因此不計為平倉操作里程碑。",
  };
  const milestones = [plan, fill, close, flat];
  return {
    sessionId: bundle.rec.id,
    scenarioId: bundle.rec.scenarioId,
    noRecordedFills: !hasFills,
    achievedCount: milestones.filter((milestone) => milestone.status === "achieved").length,
    knownCount: milestones.filter((milestone) => milestone.status !== "unknown").length,
    milestones,
  };
}

export type LearningProgressSummary = {
  scope: "recent-local";
  limit: typeof RECENT_LEARNING_REVIEW_LIMIT;
  reviewCount: number;
  recent: LearningProgress[];
  milestones: Array<{
    id: LearningMilestoneId;
    title: string;
    achievedSessions: number;
    knownSessions: number;
    unknownSessions: number;
  }>;
};

/** Summarize already-loaded local reviews; this is not lifetime or cross-device progress. */
export function summarizeLearningProgress(
  reviews: readonly ReviewBundle[],
): LearningProgressSummary {
  const seen = new Set<string>();
  const recent = [...reviews]
    .sort((a, b) => b.rec.endedAt - a.rec.endedAt)
    .filter((review) => {
      if (seen.has(review.rec.id)) return false;
      seen.add(review.rec.id);
      return true;
    })
    .slice(0, RECENT_LEARNING_REVIEW_LIMIT)
    .map(deriveLearningProgress);
  const definitions: Array<{ id: LearningMilestoneId; title: string }> = [
    { id: "plan-recorded", title: "寫下進場計畫" },
    { id: "fill-recorded", title: "留下成交紀錄" },
    { id: "close-recorded", title: "留下減碼／平倉紀錄" },
    { id: "flat-at-end", title: "結束時零庫存" },
  ];
  return {
    scope: "recent-local",
    limit: RECENT_LEARNING_REVIEW_LIMIT,
    reviewCount: recent.length,
    recent,
    milestones: definitions.map((definition) => {
      const states = recent.map(
        (progress) =>
          progress.milestones.find((milestone) => milestone.id === definition.id)!.status,
      );
      return {
        ...definition,
        achievedSessions: states.filter((status) => status === "achieved").length,
        knownSessions: states.filter((status) => status !== "unknown").length,
        unknownSessions: states.filter((status) => status === "unknown").length,
      };
    }),
  };
}
