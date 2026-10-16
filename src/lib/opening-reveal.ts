import { MORNING_ADVANCE_INTERVAL } from "./morning-engine.ts";

/**
 * After a start, the page reveals 09:00 by itself. The server set nextAdvanceAt to its own time plus
 * one interval before replying, so waiting a full interval (plus margin) from receiving that reply is
 * always late enough, however fast or slow the phone's clock is.
 */
export const OPENING_REVEAL_MS = MORNING_ADVANCE_INTERVAL + 50;

export function openingRevealDelay(receivedAt: number, now: number): number {
  return Math.max(0, receivedAt + OPENING_REVEAL_MS - now);
}
