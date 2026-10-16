import test from "node:test";
import assert from "node:assert/strict";
import { applyPlanTemplate, DEFAULT_PLAN_TEMPLATE, isBlankPlan, PLAN_TEMPLATES } from "./plan-templates.ts";
import { planSchema } from "./morning-engine.ts";

test("every template passes the server plan check", () => {
  const base = { exerciseId: "first-order", bias: "observe", focusCode: "2330", reason: "", entry: "", stop: "" } as const;
  for (const template of PLAN_TEMPLATES)
    assert.equal(planSchema.safeParse(applyPlanTemplate(template, base)).success, true, template.id);
});

test("applying a template keeps the chosen stock and exercise", () => {
  const plan = applyPlanTemplate(PLAN_TEMPLATES[1], {
    exerciseId: "patience", bias: "bearish", focusCode: "2317", reason: "x", entry: "y", stop: "z" });
  assert.equal(plan.focusCode, "2317");
  assert.equal(plan.exerciseId, "patience");
  assert.equal(plan.bias, "bullish");
  assert.equal(plan.stop, "跌破昨收就賣出");
});

test("breakout is the default and uses the approved copy", () => {
  assert.equal(DEFAULT_PLAN_TEMPLATE, "breakout");
  assert.deepEqual(PLAN_TEMPLATES.map((template) => template.title), ["突破前高", "回測平盤", "先看不做"]);
  assert.equal(PLAN_TEMPLATES[0].entry, "價格站上前高（圖上標「前高」的虛線）再買");
  assert.deepEqual(
    PLAN_TEMPLATES.map(({ id, bias, reason, entry, stop }) => ({ id, bias, reason, entry, stop })),
    [
      { id: "breakout", bias: "bullish", reason: "開盤後走強，想等它站上前高", entry: "價格站上前高（圖上標「前高」的虛線）再買", stop: "跌回前高下方就賣出" },
      { id: "pullback", bias: "bullish", reason: "回檔到昨收附近有撐", entry: "回到昨收附近、沒有跌破再買", stop: "跌破昨收就賣出" },
      { id: "observe", bias: "observe", reason: "第一次練習，先看開盤怎麼走", entry: "今天只觀察，不下單", stop: "沒有部位，不適用" },
    ],
  );
});

test("a plan is blank only when all three texts are empty after trimming", () => {
  assert.equal(isBlankPlan({ reason: " ", entry: "", stop: "\n" }), true);
  assert.equal(isBlankPlan({ reason: "a", entry: "", stop: "" }), false);
});
