import { GateRateLimiter } from "./gate/rate-limit.server.ts";

/**
 * /api/morning's limits (③ decision Q): practice requests count per practiser (member or guest); the source IP only
 * has a total wide enough for a classroom of 30 behind one address at 2× (about 60 requests a minute each).
 */
export const MORNING_LIMITS = { perSourcePerMinute: 2_400, perPractiserPerMinute: 180, concurrent: 40 } as const;
const MINUTE_MS = 60_000;
/** Distinct keys a limiter keeps at most; a new key past it is refused until old ones expire. */
const SOURCES_KEPT = 2_000;
const PRACTISERS_KEPT = 2_000;

export class MorningTraffic {
  readonly #sources = new GateRateLimiter(MORNING_LIMITS.perSourcePerMinute, MINUTE_MS, SOURCES_KEPT);
  readonly #practisers = new GateRateLimiter(MORNING_LIMITS.perPractiserPerMinute, MINUTE_MS, PRACTISERS_KEPT);
  #active = 0;

  /** Before the session is read: room among the requests in progress, then the source's budget. Pair with leave(). */
  enter(sourceKey: string, now = Date.now()): boolean {
    if (this.#active >= MORNING_LIMITS.concurrent || !this.#sources.take(sourceKey, now)) return false;
    this.#active += 1;
    return true;
  }

  leave(): void {
    this.#active = Math.max(0, this.#active - 1);
  }

  /** Once the practiser is known: their own budget. */
  practiser(userId: string, now = Date.now()): boolean {
    return this.#practisers.take(userId, now);
  }

  get active(): number {
    return this.#active;
  }
}
