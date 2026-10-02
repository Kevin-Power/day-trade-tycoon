import { z } from "zod";

export const TRADE_PLAN_TEXT_LIMIT = 200;

const numeric = z.number().finite();
const code = z.string().min(1).max(16);
const side = z.enum(["buy", "sell"]);
const lots = numeric.int().min(1).max(200);
const condition = z.string().trim().min(1).max(TRADE_PLAN_TEXT_LIMIT);

/** A learner's own notes, not an order, stop-loss instruction or grading rule. */
export const tradePlanInputSchema = z.object({
  entryCondition: condition,
  exitCondition: condition,
  maxLoss: numeric.positive(),
});

export const tradePlanSchema = tradePlanInputSchema.extend({
  version: z.literal(1),
  code,
  side,
  lots,
  simTime: numeric.nonnegative(),
}).readonly();

/** Capture accepted intent once; later matching/cancellation must not rewrite it. */
export const firstPlannedOrderSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/),
  code,
  side,
  type: z.enum(["limit", "market"]),
  tif: z.enum(["ROD", "IOC", "FOK"]).optional(),
  lots,
  price: numeric.positive(),
  time: numeric.nonnegative(),
}).readonly();

export const firstTradePlanSnapshotSchema = z.object({
  plan: tradePlanSchema.nullable(),
  order: firstPlannedOrderSchema.nullable(),
}).readonly();

export type TradePlanInput = z.infer<typeof tradePlanInputSchema>;
export type TradePlan = z.infer<typeof tradePlanSchema>;
export type FirstPlannedOrder = z.infer<typeof firstPlannedOrderSchema>;
export type FirstTradePlanSnapshot = z.infer<typeof firstTradePlanSnapshotSchema>;

export function snapshotFirstTradePlan(
  plan: TradePlan | null,
  order: FirstPlannedOrder | null,
): FirstTradePlanSnapshot {
  return firstTradePlanSnapshotSchema.parse({ plan, order });
}
