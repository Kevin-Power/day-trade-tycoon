import type { MorningPlan } from "./morning.ts";

export type PlanTemplateId = "breakout" | "pullback" | "observe";
export type PlanTemplate = {
  id: PlanTemplateId;
  title: string;
  summary: string;
  bias: MorningPlan["bias"];
  reason: string;
  entry: string;
  stop: string;
};

/** One-tap starting plans. Each still passes the same three-field plan check and stays editable. */
export const PLAN_TEMPLATES: readonly PlanTemplate[] = [
  {
    id: "breakout",
    title: "突破前高",
    summary: "等價格站上前高再買，跌回就走",
    bias: "bullish",
    reason: "開盤後走強，想等它站上前高",
    entry: "價格站上前高（圖上標「前高」的虛線）再買",
    stop: "跌回前高下方就賣出",
  },
  {
    id: "pullback",
    title: "回測平盤",
    summary: "回到昨收附近守住再買",
    bias: "bullish",
    reason: "回檔到昨收附近有撐",
    entry: "回到昨收附近、沒有跌破再買",
    stop: "跌破昨收就賣出",
  },
  {
    id: "observe",
    title: "先看不做",
    summary: "第一次先看開盤，不下單",
    bias: "observe",
    reason: "第一次練習，先看開盤怎麼走",
    entry: "今天只觀察，不下單",
    stop: "沒有部位，不適用",
  },
];
export const DEFAULT_PLAN_TEMPLATE: PlanTemplateId = "breakout";

export function applyPlanTemplate(template: PlanTemplate, plan: MorningPlan): MorningPlan {
  return { ...plan, bias: template.bias, reason: template.reason, entry: template.entry, stop: template.stop };
}

export function isBlankPlan(plan: Pick<MorningPlan, "reason" | "entry" | "stop">): boolean {
  return !plan.reason.trim() && !plan.entry.trim() && !plan.stop.trim();
}
