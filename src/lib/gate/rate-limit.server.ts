import { isIP } from "node:net";

/** Bounded failure window; only a configured, loopback-only proxy may supply the client IP. */
export class GateRateLimiter {
  private entries = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  private capacity: number;
  constructor(max = 12, windowMs = 600_000, capacity = 10_000) {
    this.max = max; this.windowMs = windowMs; this.capacity = capacity;
  }
  take(key: string, now = Date.now()): boolean {
    for (const [id, times] of this.entries) {
      if (!times.length || times[times.length - 1] <= now - this.windowMs) this.entries.delete(id);
    }
    const times = (this.entries.get(key) || []).filter(t => t > now - this.windowMs);
    if (times.length >= this.max || (!this.entries.has(key) && this.entries.size >= this.capacity)) return false;
    times.push(now);
    this.entries.set(key, times);
    return true;
  }
  clear(key: string): void { this.entries.delete(key); }
  get size(): number { return this.entries.size; }
}
export function gateRateKey(headers: Headers): string {
  if (process.env.CLASSROOM_TRUST_PROXY === "true") {
    const address = headers.get("cf-connecting-ip")?.trim() || "";
    if (isIP(address)) return address;
  }
  return "direct-origin";
}
