/**
 * After the guest account is created, the session is read again on this schedule (ms) before the
 * page offers 再試一次. One refused read (a busy school connection) must not leave the page waiting.
 */
export const GUEST_CONFIRM_DELAYS_MS = [1000, 2000, 4000] as const;

/** idle → signing-in → confirming (until the session shows the guest) → idle, or failed. */
export type GuestPhase = "idle" | "signing-in" | "confirming" | "failed";

/** What a page that needs an identity shows while the guest identity is set up. */
export function guestBootstrapStatus(input: {
  isPending: boolean;
  needsGuest: boolean;
  phase: GuestPhase;
}): "ready" | "pending" | "failed" {
  if (!input.needsGuest) return input.isPending ? "pending" : "ready";
  return input.phase === "failed" ? "failed" : "pending";
}

/** The wait before session read number `attempt` (from 0), or null when the page stops waiting. */
export function nextConfirmDelay(attempt: number): number | null {
  return GUEST_CONFIRM_DELAYS_MS[attempt] ?? null;
}
