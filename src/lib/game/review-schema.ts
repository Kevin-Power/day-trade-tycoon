import { z } from "zod";
import { firstTradePlanSnapshotSchema } from "./trade-plan.ts";

const text = z.string().max(200);
const numeric = z.number().finite();
const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const SERVER_REVIEW_FILL_LIMIT = 5000;
const reviewBundleBaseSchema = z
  .object({
    rec: z.object({
      id,
      scenarioId: id,
      scenarioName: text,
      endedAt: numeric.nonnegative(),
      pnl: numeric,
      pnlPct: numeric,
      trades: numeric.int().min(0).max(10000),
      wins: numeric.int().min(0).max(10000),
      fees: numeric.nonnegative(),
      maxDrawdown: numeric.nonnegative(),
      grade: text,
      title: text,
      passed: z.boolean().optional(),
      pausedFills: numeric.int().nonnegative().optional(),
      violations: z.array(text).max(30).optional(),
    }),
    verdicts: z
      .array(
        z.object({
          rule: z.object({
            id: text,
            label: text,
            code: z.enum([
              "max_dd",
              "flatten_before_close",
              "no_average_down",
              "profit_gt_fees",
              "min_hold_minutes",
              "risk_down_after_low",
              "positive_pnl",
              "min_winning_trade",
            ]),
            params: z.record(z.string(), numeric).optional(),
          }),
          passed: z.boolean(),
          detail: text,
          at: numeric.nonnegative().optional(),
        }),
      )
      .max(30),
    fills: z
      .array(
        z.object({
          id,
          orderId: id,
          code: z.string().min(1).max(16),
          side: z.enum(["buy", "sell"]),
          lots: numeric.int().positive().max(100000),
          price: numeric.positive(),
          fee: numeric.nonnegative(),
          tax: numeric.nonnegative(),
          time: numeric.nonnegative(),
          vwapAt: numeric.nonnegative(),
          filledWhilePaused: z.boolean().optional(),
          slippageTicks: numeric.optional(),
          pnl: numeric.optional(),
        }),
      ),
    code: z.string().min(1).max(16),
    capital: numeric.positive(),
    equity: numeric,
    sessionLabel: text,
    firstTradePlan: firstTradePlanSnapshotSchema.optional(),
  });

function checkReviewIntegrity(bundle: z.infer<typeof reviewBundleBaseSchema>, ctx: z.RefinementCtx) {
  if (new Set(bundle.fills.map((fill) => fill.id)).size !== bundle.fills.length) {
    ctx.addIssue({ code: "custom", message: "成交編號重複", path: ["fills"] });
  }
  if (Math.abs(bundle.equity - bundle.capital - bundle.rec.pnl) > 0.02) {
    ctx.addIssue({ code: "custom", message: "權益與損益不一致", path: ["equity"] });
  }
}

// Browser storage keeps the complete session; only the server request is capped.
export const localReviewBundleSchema = reviewBundleBaseSchema.superRefine(checkReviewIntegrity);
export const reviewBundleSchema = reviewBundleBaseSchema.extend({
  fills: reviewBundleBaseSchema.shape.fills.max(SERVER_REVIEW_FILL_LIMIT),
}).superRefine(checkReviewIntegrity);
