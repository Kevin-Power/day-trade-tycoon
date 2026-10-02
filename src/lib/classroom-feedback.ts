import { z } from "zod";

export const SESSION_FEEDBACK_PAGE_SIZE = 10;
export const FEEDBACK_OBSERVATION_LIMIT = 600;
export const FEEDBACK_NEXT_STEP_LIMIT = 300;

const sessionIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const sessionFeedbackCursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();

export const loadSessionFeedbackSchema = z
  .object({
    sessionId: sessionIdSchema,
    before: sessionFeedbackCursorSchema.optional(),
  })
  .strict();

export const addSessionFeedbackSchema = z
  .object({
    sessionId: sessionIdSchema,
    requestId: z.string().uuid(),
    observation: z.string().trim().min(1).max(FEEDBACK_OBSERVATION_LIMIT),
    nextStep: z.string().trim().min(1).max(FEEDBACK_NEXT_STEP_LIMIT),
  })
  .strict();

export type SessionFeedbackCursor = z.infer<typeof sessionFeedbackCursorSchema>;
export type LoadSessionFeedbackInput = z.infer<typeof loadSessionFeedbackSchema>;
export type AddSessionFeedbackInput = z.infer<typeof addSessionFeedbackSchema>;

export type SessionFeedback = {
  id: string;
  sessionId: string;
  authorName: string;
  observation: string;
  nextStep: string;
  /** UTC ISO timestamp, preserving database microseconds for stable pagination. */
  createdAt: string;
};

export type SessionFeedbackPage = {
  items: SessionFeedback[];
  nextCursor: SessionFeedbackCursor | null;
};
