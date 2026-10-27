import { z } from "zod";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const price = integer.positive();
const decimalSequence = z.string().regex(/^\d{1,20}$/);
const envelope = {
  provider: z.enum(["fubon", "ibfs"]),
  source: z.enum(["broker-live", "broker-sandbox", "historical", "synthetic"]),
  exchange: z.enum(["TWSE", "TPEX"]),
  symbol: z.string().regex(/^\d{4}$/),
  segment: z.literal("regular"),
  tradingDate: z.iso.date(),
  epoch: z.string().min(1).max(128),
  kind: z.enum(["snapshot", "update"]),
  phase: z.enum(["continuous", "auction", "halted", "closed"]),
  marketTimeUs: z.string().regex(/^\d{1,16}$/),
  sequence: decimalSequence.nullable(),
};
const level = z.object({ price4: price, shares: integer }).strict();
export const frameSchema = z.discriminatedUnion("channel", [
  z.object({ ...envelope, channel: z.literal("trades"), price4: price, shares: integer }).strict(),
  // Workers must normalize full snapshots. Incremental-book patches are not supported.
  z
    .object({
      ...envelope,
      channel: z.literal("books"),
      bids: z.array(level).max(5),
      asks: z.array(level).max(5),
    })
    .strict(),
]);
export type QuoteFrame = z.infer<typeof frameSchema>;
type Channel = QuoteFrame["channel"];
type SequenceRule = "monotonic" | "contiguous" | "timestamp";
export type QuoteLane = Pick<
  QuoteFrame,
  "provider" | "source" | "exchange" | "symbol" | "segment" | "tradingDate"
>;
export type QuotePolicy = {
  tradeMaxAgeMs: number;
  bookMaxAgeMs: number;
  transportMaxAgeMs: number;
  futureToleranceMs: number;
  lowerPrice4: number;
  upperPrice4: number;
  sequence: Record<Channel, SequenceRule>;
};
type Watermark = { timeUs: string; sequence: string | null; epoch: string; strict: boolean };
type Slot = {
  frame: QuoteFrame | null;
  needsSnapshot: boolean;
  issue: string | null;
  minimum: Watermark | null;
};
export type QuoteDecision = {
  action: "accepted" | "ignored" | "quarantined";
  reason: string | null;
};

const eventTimeMs = (frame: QuoteFrame) => Number(BigInt(frame.marketTimeUs) / 1000n);
const payload = (frame: QuoteFrame) =>
  JSON.stringify(
    frame.channel === "trades"
      ? [frame.marketTimeUs, frame.sequence, frame.price4, frame.shares, frame.phase]
      : [frame.marketTimeUs, frame.sequence, frame.bids, frame.asks, frame.phase],
  );

/** One lane per provider/source/exchange/segment/symbol/trading date. This does
 * not connect a socket and is not yet wired to the classroom replay renderer.
 */
export class QuoteGuard {
  private readonly lane: QuoteLane;
  private readonly policy: QuotePolicy;
  private epoch: string;
  private lastTransportAtMs: number | null = null;
  private lastClockMs = 0;
  private slots: Record<Channel, Slot> = {
    trades: { frame: null, needsSnapshot: true, issue: null, minimum: null },
    books: { frame: null, needsSnapshot: true, issue: null, minimum: null },
  };

  constructor(lane: QuoteLane, epoch: string, policy: QuotePolicy) {
    if (!["broker-live", "broker-sandbox"].includes(lane.source))
      throw new Error("BROKER_SOURCE_REQUIRED");
    if (!epoch || epoch.length > 128) throw new Error("INVALID_EPOCH");
    for (const value of [
      policy.tradeMaxAgeMs,
      policy.bookMaxAgeMs,
      policy.transportMaxAgeMs,
      policy.lowerPrice4,
      policy.upperPrice4,
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("INVALID_QUOTE_POLICY");
    }
    if (
      !Number.isSafeInteger(policy.futureToleranceMs) ||
      policy.futureToleranceMs < 0 ||
      policy.upperPrice4 < policy.lowerPrice4
    )
      throw new Error("INVALID_QUOTE_POLICY");
    for (const rule of [policy.sequence.trades, policy.sequence.books])
      if (!["monotonic", "contiguous", "timestamp"].includes(rule))
        throw new Error("INVALID_SEQUENCE_RULE");
    this.lane = structuredClone(lane);
    this.epoch = epoch;
    this.policy = structuredClone(policy);
  }

  private quarantine(
    channel: Channel,
    reason: string,
    minimum?: QuoteFrame,
    strict = false,
  ): QuoteDecision {
    this.slots[channel].needsSnapshot = true;
    this.slots[channel].issue = reason;
    if (minimum)
      this.slots[channel].minimum = {
        timeUs: minimum.marketTimeUs,
        sequence: minimum.sequence,
        epoch: minimum.epoch,
        strict,
      };
    return { action: "quarantined", reason };
  }

  /** A new socket generation always requires fresh snapshots and subscription ACKs
   * (the latter are tracked by SubscriptionRegistry). Old prices may remain visible.
   */
  reset(epoch: string): void {
    if (!epoch || epoch === this.epoch || epoch.length > 128) throw new Error("NEW_EPOCH_REQUIRED");
    this.epoch = epoch;
    this.lastTransportAtMs = null;
    for (const slot of Object.values(this.slots)) {
      slot.needsSnapshot = true;
      slot.issue = "RECONNECT_SNAPSHOT_REQUIRED";
    }
  }

  heartbeat(epoch: string, nowMs: number): boolean {
    if (epoch !== this.epoch) return false;
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || nowMs < this.lastClockMs)
      throw new Error("INVALID_OR_REGRESSED_CLOCK");
    this.lastClockMs = nowMs;
    this.lastTransportAtMs = nowMs;
    return true;
  }

  receive(input: unknown, nowMs: number): QuoteDecision {
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || nowMs < this.lastClockMs) {
      this.quarantine("trades", "CLOCK_REGRESSION");
      return this.quarantine("books", "CLOCK_REGRESSION");
    }
    this.lastClockMs = nowMs;
    const parsed = frameSchema.safeParse(input);
    if (!parsed.success) {
      this.quarantine("trades", "INVALID_FRAME");
      return this.quarantine("books", "INVALID_FRAME");
    }
    const frame = parsed.data;
    if (
      Object.keys(this.lane).some(
        (key) => frame[key as keyof QuoteLane] !== this.lane[key as keyof QuoteLane],
      )
    )
      return { action: "ignored", reason: "WRONG_LANE" };
    if (frame.epoch !== this.epoch) return { action: "ignored", reason: "OLD_EPOCH" };
    this.lastTransportAtMs = nowMs;
    const slot = this.slots[frame.channel];
    if (frame.phase !== "continuous") return this.quarantine(frame.channel, "NON_CONTINUOUS_PHASE");
    const age = nowMs - eventTimeMs(frame);
    if (age < -this.policy.futureToleranceMs)
      return this.quarantine(frame.channel, "FUTURE_TIMESTAMP");
    if (
      new Date(eventTimeMs(frame) + 8 * 3_600_000).toISOString().slice(0, 10) !==
      this.lane.tradingDate
    )
      return this.quarantine(frame.channel, "WRONG_EVENT_DATE");
    const validPrice = (p: number) => p >= this.policy.lowerPrice4 && p <= this.policy.upperPrice4;
    if (frame.channel === "trades") {
      if (!validPrice(frame.price4)) return this.quarantine(frame.channel, "PRICE_OUT_OF_BAND");
    } else {
      if (![...frame.bids, ...frame.asks].every((l) => validPrice(l.price4)))
        return this.quarantine(frame.channel, "PRICE_OUT_OF_BAND");
      if (
        frame.bids.some((l, i) => i > 0 && l.price4 >= frame.bids[i - 1].price4) ||
        frame.asks.some((l, i) => i > 0 && l.price4 <= frame.asks[i - 1].price4)
      )
        return this.quarantine(frame.channel, "UNSORTED_BOOK");
      if (frame.bids.length && frame.asks.length && frame.bids[0].price4 >= frame.asks[0].price4)
        return this.quarantine(frame.channel, "CROSSED_OR_LOCKED_BOOK");
    }
    if (slot.needsSnapshot && frame.kind !== "snapshot")
      return { action: "ignored", reason: "SNAPSHOT_REQUIRED" };
    const rule = this.policy.sequence[frame.channel];
    if (rule !== "timestamp" && frame.sequence === null)
      return this.quarantine(frame.channel, "MISSING_SEQUENCE");
    if (slot.needsSnapshot && slot.minimum) {
      const min = slot.minimum;
      const currentTime = BigInt(frame.marketTimeUs);
      const minTime = BigInt(min.timeUs);
      const comparableSequence =
        rule !== "timestamp" &&
        min.epoch === frame.epoch &&
        min.sequence !== null &&
        frame.sequence !== null;
      const behind =
        currentTime < minTime ||
        (comparableSequence && BigInt(frame.sequence!) < BigInt(min.sequence!));
      const same = comparableSequence
        ? BigInt(frame.sequence!) === BigInt(min.sequence!)
        : currentTime === minTime;
      if (behind || (min.strict && same))
        return { action: "ignored", reason: "SNAPSHOT_BEHIND_WATERMARK" };
    }
    const previous = slot.frame;
    if (previous) {
      const oldTime = BigInt(previous.marketTimeUs);
      const newTime = BigInt(frame.marketTimeUs);
      const oldSeq = previous.sequence === null ? null : BigInt(previous.sequence);
      const newSeq = frame.sequence === null ? null : BigInt(frame.sequence);
      const sameEpoch = previous.epoch === frame.epoch;
      if (
        newTime < oldTime ||
        (sameEpoch && rule !== "timestamp" && oldSeq !== null && newSeq !== null && newSeq < oldSeq)
      )
        return { action: "ignored", reason: "OUT_OF_ORDER" };
      if (
        !sameEpoch &&
        newTime === oldTime &&
        frame.channel === "trades" &&
        previous.channel === "trades" &&
        (frame.price4 !== previous.price4 || frame.shares !== previous.shares)
      )
        return this.quarantine(frame.channel, "RECONNECT_VALUE_CONFLICT", frame, true);
      const sameId = rule === "timestamp" ? newTime === oldTime : sameEpoch && newSeq === oldSeq;
      if (sameId) {
        if (payload(previous) !== payload(frame))
          return this.quarantine(frame.channel, "QUOTE_ID_CONFLICT", frame, true);
        // A verified reconnect snapshot may re-establish this lane; it never
        // changes the exchange timestamp, so old data cannot become fresh.
        if (frame.kind === "snapshot") {
          slot.frame = frame;
          slot.needsSnapshot = false;
          slot.issue = null;
          slot.minimum = null;
        }
        return { action: "ignored", reason: "DUPLICATE" };
      }
      // Only use +1 when the provider guarantees contiguous per-lane sequence.
      // Fubon serial is NOT assumed contiguous; use monotonic for trades.
      if (
        sameEpoch &&
        rule === "contiguous" &&
        frame.kind !== "snapshot" &&
        oldSeq !== null &&
        newSeq !== null &&
        newSeq !== oldSeq + 1n
      )
        return this.quarantine(frame.channel, "SEQUENCE_GAP", frame);
    }
    this.slots[frame.channel] = { frame, needsSnapshot: false, issue: null, minimum: null };
    return { action: "accepted", reason: null };
  }

  summary(nowMs: number) {
    const transportAgeMs = this.lastTransportAtMs === null ? null : nowMs - this.lastTransportAtMs;
    const clockValid = Number.isSafeInteger(nowMs) && nowMs >= this.lastClockMs;
    const transportHealthy =
      clockValid && transportAgeMs !== null && transportAgeMs <= this.policy.transportMaxAgeMs;
    const channel = (name: Channel, maxAge: number) => {
      const slot = this.slots[name];
      const ageMs = slot.frame ? nowMs - eventTimeMs(slot.frame) : null;
      return {
        frame: slot.frame ? structuredClone(slot.frame) : null,
        ageMs,
        needsSnapshot: slot.needsSnapshot,
        issue: slot.issue,
        fresh:
          clockValid &&
          ageMs !== null &&
          ageMs >= -this.policy.futureToleranceMs &&
          ageMs <= maxAge &&
          !slot.needsSnapshot,
      };
    };
    const trades = channel("trades", this.policy.tradeMaxAgeMs);
    const books = channel("books", this.policy.bookMaxAgeMs);
    const book = books.frame?.channel === "books" ? books.frame : null;
    const twoSidedBook = Boolean(book?.bids[0]?.shares && book?.asks[0]?.shares);
    return {
      transportHealthy,
      transportAgeMs,
      trades,
      books,
      twoSidedBook,
      // Quote suitability only; account authorization/risk/session must ALSO pass.
      quoteUsable: transportHealthy && trades.fresh && books.fresh && twoSidedBook,
    };
  }
}
