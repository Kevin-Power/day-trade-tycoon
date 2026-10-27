/** One registry per broker connection. Keys include provider/exchange/segment/
 * symbol/channel; workers translate them to provider-specific subscription IDs.
 */
export class SubscriptionRegistry {
  private owners = new Map<string, Set<string>>();
  private active = new Set<string>();
  private pending = new Map<string, "subscribe" | "unsubscribe">();
  private epoch: string;
  private readonly capacity: number;

  constructor(epoch: string, capacity: number) {
    if (!epoch || !Number.isSafeInteger(capacity) || capacity <= 0)
      throw new Error("INVALID_SUBSCRIPTION_CONFIG");
    this.epoch = epoch;
    this.capacity = capacity;
  }

  private desired(): Set<string> {
    return new Set([...this.owners.values()].flatMap((keys) => [...keys]));
  }

  replace(owner: string, keys: readonly string[]): void {
    if (!owner || keys.some((key) => !key || key.length > 256))
      throw new Error("INVALID_SUBSCRIPTION_KEY");
    const previous = this.owners.get(owner);
    this.owners.set(owner, new Set(keys));
    if (this.desired().size > this.capacity) {
      if (previous) this.owners.set(owner, previous);
      else this.owners.delete(owner);
      throw new Error("SUBSCRIPTION_CAPACITY_EXCEEDED");
    }
  }

  remove(owner: string): void {
    this.owners.delete(owner);
  }

  reset(epoch: string): void {
    if (!epoch || epoch === this.epoch) throw new Error("NEW_EPOCH_REQUIRED");
    this.epoch = epoch;
    this.active.clear();
    this.pending.clear();
  }

  plan() {
    const desired = this.desired();
    // Release old subscriptions before requesting replacements at capacity.
    const unsubscribe = [...this.active]
      .filter((key) => !desired.has(key) && !this.pending.has(key))
      .sort();
    const pendingAdds = [...this.pending.values()].filter((op) => op === "subscribe").length;
    const free = Math.max(0, this.capacity - this.active.size - pendingAdds);
    const subscribe = [...desired]
      .filter((key) => !this.active.has(key) && !this.pending.has(key))
      .sort()
      .slice(0, free);
    return {
      epoch: this.epoch,
      subscribe,
      unsubscribe,
      ready: [...desired].every((key) => this.active.has(key) && !this.pending.has(key)),
    };
  }

  markRequested(epoch: string, operation: "subscribe" | "unsubscribe", key: string): void {
    if (epoch !== this.epoch) throw new Error("OLD_EPOCH");
    if (!this.plan()[operation].includes(key)) throw new Error("UNPLANNED_SUBSCRIPTION");
    this.pending.set(key, operation);
  }

  acknowledge(epoch: string, operation: "subscribe" | "unsubscribe", key: string): boolean {
    if (epoch !== this.epoch || this.pending.get(key) !== operation) return false;
    this.pending.delete(key);
    if (operation === "subscribe") this.active.add(key);
    else this.active.delete(key);
    return true;
  }

  isReady(key: string): boolean {
    return this.desired().has(key) && this.active.has(key) && !this.pending.has(key);
  }
  // Timeout/error is not an ACK. A worker must reset/reconcile the broker's actual
  // subscription list; blindly retrying pending requests can exceed the limit.
}

/** Bounded full-jitter reconnect delay. Never apply this policy to trade sends. */
export function reconnectDelayMs(attempt: number, random: number, maxAttempts = 8): number | null {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !Number.isFinite(random) ||
    random < 0 ||
    random > 1
  )
    throw new Error("INVALID_BACKOFF_ARGUMENT");
  if (attempt >= maxAttempts) return null;
  return Math.floor(random * Math.min(30_000, 1000 * 2 ** Math.min(attempt, 20)));
}
