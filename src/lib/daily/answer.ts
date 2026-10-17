import { z } from "zod";
import { limitDown, roundToTick } from "../market/ticks.ts";
import type { DailyChoice, DailyQuestionPayload } from "./types.ts";

export const DAILY_REASONS = [
  { id: "volume", label: "量能放大" },
  { id: "resistance", label: "前高有賣壓" },
  { id: "strong", label: "大盤偏強" },
  { id: "unclear", label: "看不清楚先等" },
] as const;

export const dailyAnswerSchema = z
  .object({
    questionId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    choice: z.enum(["enter", "watch", "skip"]),
    stopPrice: z.number().finite().positive().max(1_000_000).optional(),
    reason: z.enum(["volume", "resistance", "strong", "unclear"]).optional(),
    guestTerms: z.literal(true).optional(),
  })
  .strict();

/** A stop is a legal tick below the question minute's close (never the next open, which would hint). */
export function validateStop(
  question: Pick<DailyQuestionPayload, "bars" | "questionT" | "referencePrice">,
  choice: DailyChoice,
  stopPrice: number | undefined,
): string | null {
  if (choice !== "enter") return stopPrice === undefined ? null : "觀望或不追不需要停損";
  if (stopPrice === undefined) return "選進場要先設停損";
  const close = question.bars.find((bar) => bar.t === question.questionT)?.c;
  const legal =
    close !== undefined &&
    Math.round(roundToTick(stopPrice) * 100) === Math.round(stopPrice * 100) &&
    stopPrice < close &&
    stopPrice >= limitDown(question.referencePrice);
  return legal ? null : "停損要是合法價位，並且低於目前價格";
}
