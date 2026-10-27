import { z } from "zod";

export const MAX_WATCH = 20;
export const FEED_PREFIX = "FUBON_FEED ";
export const watchRequest = z.object({
  client: z.uuid(),
  symbols: z.array(z.string().regex(/^\d{4}$/)).min(1).max(MAX_WATCH),
}).strict();
const positive = z.number().finite().positive().max(1_000_000);
const quantity = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const level = z.object({ price: positive, size: quantity });
const trade = z.object({ price: positive, size: quantity.optional(), time: timestamp, serial: quantity.optional() });
const boundsSchema = z.object({ symbol: z.string().regex(/^\d{4}$/), date: z.iso.date(), limitUpPrice: positive.optional(), limitDownPrice: positive.optional() });
const rawQuote = z.object({
  symbol: z.string().regex(/^\d{4}$/), type: z.literal("EQUITY"), exchange: z.enum(["TWSE", "TPEx", "TPEX"]),
  date: z.iso.date().optional(), name: z.string().max(50).optional(),
  referencePrice: positive.optional(), previousClose: positive.optional(),
  price: positive.optional(), size: quantity.optional(), time: timestamp.optional(), serial: quantity.optional(),
  lastUpdated: timestamp.optional(), lastTrade: trade.optional(), closePrice: positive.optional(), closeTime: timestamp.optional(),
  bids: z.array(level).max(5).optional(), asks: z.array(level).max(5).optional(),
  isTrial: z.boolean().optional(), isContinuous: z.boolean().optional(), isOpen: z.boolean().optional(),
  isClose: z.boolean().optional(), isLimitUpHalt: z.boolean().optional(), isLimitDownHalt: z.boolean().optional(),
  isDelayedOpen: z.boolean().optional(), isDelayedClose: z.boolean().optional(),
});
export type FeedPhase = "continuous" | "trial" | "halted" | "closed";
type Image<T> = { time: number; epoch: number; value: T; signature: string };
type Quote = {
  symbol: string; name: string; exchange: string; reference: number | null; metaTime: number;
  trade: Image<{ price: number; serial?: number }> | null;
  book: Image<{ bids: { price: number; size: number }[]; asks: { price: number; size: number }[]; phase: FeedPhase }> | null;
  phase: FeedPhase; phaseTime: number; issue: string | null; issueTime: number;
};
export const taipeiDate = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
const price4 = (v: number) => Math.round(v * 10000);
const phaseOf = (q: z.infer<typeof rawQuote>): FeedPhase => q.isTrial ? "trial"
  : q.isLimitDownHalt || q.isLimitUpHalt || q.isDelayedOpen || q.isDelayedClose ? "halted" : q.isClose ? "closed" : "continuous";

/** Display-only full images. Never used to authorize any order. */
export class FubonQuoteStore {
  private rows = new Map<string, Quote>();
  private epoch = 0;
  private active = new Set<string>();
  private errors = new Map<string, string>();
  private bounds = new Map<string, z.infer<typeof boundsSchema>>();
  reset(epoch: number) { this.epoch = epoch; this.active.clear(); }
  retain(symbols: string[]) {
    for (const s of this.rows.keys()) if (!symbols.includes(s)) this.rows.delete(s);
    for (const s of this.errors.keys()) if (!symbols.includes(s)) this.errors.delete(s);
    for (const s of this.bounds.keys()) if (!symbols.includes(s)) this.bounds.delete(s);
  }
  symbolError(symbol: string, code: string) { this.errors.set(symbol, code); }
  setBounds(input: unknown) {
    const parsed = boundsSchema.safeParse(input);
    if (parsed.success && !(parsed.data.limitUpPrice && parsed.data.limitDownPrice && parsed.data.limitUpPrice < parsed.data.limitDownPrice))
      this.bounds.set(parsed.data.symbol, parsed.data);
  }
  ack(epoch: number, channel: string, symbol: string, remove = false) {
    if (epoch !== this.epoch || !["books", "trades"].includes(channel)) return;
    if (remove) this.active.delete(`${channel}:${symbol}`); else this.active.add(`${channel}:${symbol}`);
  }
  receive(epoch: number, channel: string, input: unknown, now: number): string {
    if (epoch !== this.epoch) return "OLD_EPOCH";
    const parsed = rawQuote.safeParse(input);
    if (!parsed.success || !["snapshot", "books", "trades"].includes(channel)) {
      const symbol = input && typeof input === "object" && "symbol" in input ? input.symbol : null;
      const row = typeof symbol === "string" ? this.rows.get(symbol) : null;
      if (row) { row.issue = "INVALID_QUOTE"; row.issueTime = now * 1000; }
      return "INVALID_QUOTE";
    }
    const d = { ...parsed.data, exchange: parsed.data.exchange === "TPEx" ? "TPEX" : parsed.data.exchange };
    if ((channel === "snapshot" && (!this.active.has(`books:${d.symbol}`) || !this.active.has(`trades:${d.symbol}`))) ||
      (channel !== "snapshot" && !this.active.has(`${channel}:${d.symbol}`))) return "UNSUBSCRIBED";
    this.errors.delete(d.symbol);
    const row = this.rows.get(d.symbol) ?? { symbol: d.symbol, name: d.symbol, exchange: d.exchange,
      reference: null, metaTime: 0, trade: null, book: null, phase: "continuous" as FeedPhase, phaseTime: 0, issue: null, issueTime: 0 };
    this.rows.set(d.symbol, row);
    if (row.exchange !== d.exchange) { row.issue = "EXCHANGE_CONFLICT"; return row.issue; }
    const marketTime = d.time ?? d.lastUpdated;
    let fault = false;
    const quarantine = (reason: string, time: number) => {
      row.issue = reason; row.issueTime = Math.max(row.issueTime, Math.min(time, now * 1000)); fault = true;
    };
    if (!marketTime || marketTime / 1000 > now + 2000 || marketTime < 1_000_000_000_000_000 ||
      (d.date && d.date !== taipeiDate(marketTime / 1000))) { quarantine("INVALID_TIME", now * 1000); return "INVALID_TIME"; }
    const phase = phaseOf(d);
    const withinBand = (price: number, time: number) => {
      const b = this.bounds.get(d.symbol);
      return !b || b.date !== taipeiDate(time / 1000) ||
        ((!b.limitDownPrice || price4(price) >= price4(b.limitDownPrice)) && (!b.limitUpPrice || price4(price) <= price4(b.limitUpPrice)));
    };
    if (marketTime >= row.phaseTime) { row.phase = phase; row.phaseTime = marketTime; }
    if (channel === "snapshot" && marketTime >= row.metaTime) {
      row.name = d.name ?? row.name;
      row.reference = d.referencePrice ?? d.previousClose ?? null;
      row.metaTime = marketTime;
    }
    const replace = <T>(old: Image<T> | null, time: number, value: T): Image<T> | null => {
      if (time / 1000 > now + 2000 || time < 1_000_000_000_000_000) { quarantine("INVALID_TIME", now * 1000); return old; }
      if (old && time < old.time) return old;
      const signature = JSON.stringify(value);
      if (old && time === old.time && old.signature !== signature) { quarantine("VALUE_CONFLICT", time); return old; }
      return { time, epoch, value, signature };
    };
    if (channel === "snapshot" || channel === "trades") {
      // lastPrice can be an indicative auction price: only real lastTrade or
      // explicitly timestamped closePrice may populate the 成交 column.
      const t = channel === "snapshot" ? d.lastTrade ?? (d.closePrice && d.closeTime ? { price: d.closePrice, time: d.closeTime } : null)
        : !d.isTrial && d.price && d.time ? { price: d.price, time: d.time, serial: d.serial } : null;
      if (t) {
        if (!withinBand(t.price, t.time)) { quarantine("PRICE_OUT_OF_BAND", t.time); return "PRICE_OUT_OF_BAND"; }
        const old = row.trade;
        const sameDay = old && taipeiDate(old.time / 1000) === taipeiDate(t.time / 1000);
        if (!(old && t.time < old.time) && !(old && sameDay && old.epoch === epoch && t.serial !== undefined && old.value.serial !== undefined && t.serial < old.value.serial)) {
          // REST may omit serial; use price/time identity for the displayed last trade.
          const next = replace(old && { ...old, signature: JSON.stringify({ price: old.value.price }) }, t.time, { price: t.price });
          if (!fault && next !== null) row.trade = { ...next, value: { ...next.value, serial: t.serial ?? (sameDay ? old?.value.serial : undefined) } };
        }
      }
    }
    if ((channel === "snapshot" || channel === "books") && d.bids && d.asks) {
      if (![...d.bids, ...d.asks].every(level => withinBand(level.price, marketTime))) {
        quarantine("PRICE_OUT_OF_BAND", marketTime); return "PRICE_OUT_OF_BAND";
      }
      const ordered = d.bids.every((v, i) => !i || price4(v.price) < price4(d.bids![i - 1].price)) &&
        d.asks.every((v, i) => !i || price4(v.price) > price4(d.asks![i - 1].price));
      const crossed = phase === "continuous" && d.bids[0] && d.asks[0] && price4(d.bids[0].price) >= price4(d.asks[0].price);
      if (!ordered || crossed) { quarantine("INVALID_BOOK", marketTime); return "INVALID_BOOK"; }
      const old = row.book;
      const next = replace(old, marketTime, { bids: d.bids, asks: d.asks, phase });
      if (next !== old) row.book = next;
      if (!fault && channel === "snapshot" && marketTime > row.issueTime) { row.issue = null; row.issueTime = 0; }
    }
    return row.issue ?? "ACCEPTED";
  }
  view(symbols: string[], now: number, connected: boolean) {
    return symbols.map(symbol => {
      const q = this.rows.get(symbol);
      const issue = q?.issue ?? this.errors.get(symbol) ?? null;
      const fresh = (image: Image<unknown> | null | undefined) => Boolean(connected && image && image.epoch === this.epoch &&
        now - image.time / 1000 <= 15000 && now - image.time / 1000 >= -2000 && taipeiDate(image.time / 1000) === taipeiDate(now));
      const acknowledged = this.active.has(`trades:${symbol}`) && this.active.has(`books:${symbol}`);
      const refCurrent = q?.trade && taipeiDate(q.metaTime / 1000) === taipeiDate(q.trade.time / 1000);
      return { symbol, name: q?.name ?? symbol, exchange: q?.exchange ?? null, reference: refCurrent ? q.reference : null,
        price: q?.trade?.value.price ?? null, tradeTime: q?.trade?.time ?? null, bookTime: q?.book?.time ?? null,
        bids: q?.book?.value.bids ?? [], asks: q?.book?.value.asks ?? [], phase: q?.phase ?? null,
        bookPhase: q?.book?.value.phase ?? null, issue, acknowledged,
        tradeFresh: acknowledged && !issue && fresh(q?.trade), bookFresh: acknowledged && !issue && fresh(q?.book) };
    });
  }
}
export type FubonRow = ReturnType<FubonQuoteStore["view"]>[number];
export type FeedState = "disabled" | "connecting" | "syncing" | "connected" | "reconnecting" | "stopped";
export type FeedResponse = {
  ok: true; readOnly: true; liveOrders: false; state: FeedState; reason: string | null;
  serverTime: number; retryAt: number | null; generation: number; rows: FubonRow[];
};
