// What the desk says the moment one of the learner's orders is done: 成交 (with the holding after a buy, or what a
// sell made, fees and tax included) or 未成交 when the classroom closes it. 2026-11-02, the owner: when a 停利 or 停損
// price is reached the screen should say 成交 at once; during a trade there is no time to keep opening 庫存 or 委託.
// Pure: the caller passes two views of the run, the last one announced and the one now.
import type { MorningState } from "./morning.ts";
import { fillPriceText } from "./morning-ledger.ts";
import { positionMark, type QuoteTone } from "./morning-quote.ts";
import { formatMoney } from "./utils.ts";

type Fill = MorningState["fills"][number];
type Position = MorningState["positions"][number];
export type OrderNoticeView = Pick<MorningState, "id" | "fills" | "orders" | "positions">;
export type OrderNotice = {
  id: string;
  label: "成交" | "未成交";
  text: string;
  /** A sell's result: 「這筆 +38,422」, fees and tax included. */
  result?: { text: string; tone: QuoteTone };
};

/** The learner's own ending of an order: it needs no notice. */
const OWN_ENDINGS = new Set(["由學員取消", "結束練習時取消尚未成交委託", "放棄這局時取消尚未成交委託"]);
const cents = (value: number) => Math.round(value * 100) / 100;
const toneOf = (value: number): QuoteTone => (value > 0 ? "up" : value < 0 ? "down" : "flat");

/** Whole dollars with their sign: 「+46,947」, 「-1,234」, 「0」. */
export function signedMoney(value: number): string {
  const whole = Math.round(value);
  return `${whole > 0 ? "+" : ""}${formatMoney(whole, 0)}`;
}

/**
 * Each sell's result by fill id: what it was sold for, less the average cost of the shares sold, the buy fees that
 * went with them (shared out by shares), its own fee and its tax. Fills in the order they happened.
 */
export function sellResults(fills: readonly Fill[]): Map<string, number> {
  const held = new Map<string, { shares: number; cost: number; fees: number }>();
  const results = new Map<string, number>();
  for (const fill of fills) {
    const book = held.get(fill.code) ?? { shares: 0, cost: 0, fees: 0 };
    if (fill.side === "buy") {
      held.set(fill.code, {
        shares: book.shares + fill.shares,
        cost: book.cost + fill.shares * fill.price,
        fees: book.fees + fill.fee,
      });
      continue;
    }
    const part = book.shares > 0 ? Math.min(1, fill.shares / book.shares) : 0;
    const cost = book.cost * part;
    const fees = book.fees * part;
    results.set(fill.id, cents(fill.shares * fill.price - cost - fees - fill.fee - fill.tax));
    held.set(fill.code, { shares: book.shares - fill.shares, cost: book.cost - cost, fees: book.fees - fees });
  }
  return results;
}

/**
 * What became of the learner's orders between two views of one run: each new fill, then each waiting order the
 * classroom closed without one. A first view, or another run, announces nothing that was already there.
 */
export function orderNotices(
  before: OrderNoticeView | null,
  after: OrderNoticeView,
  names: Readonly<Record<string, string>>,
): OrderNotice[] {
  if (!before || before.id !== after.id) return [];
  const notices: OrderNotice[] = [];
  const announced = new Set(before.fills.map((fill) => fill.id));
  const results = sellResults(after.fills);
  for (const fill of after.fills) {
    if (announced.has(fill.id)) continue;
    const text = `${fill.side === "buy" ? "買進" : "賣出"} ${names[fill.code] ?? fill.code} ${fill.shares / 1000} 張 @ ${fillPriceText(fill.price)}`;
    if (fill.side === "sell") {
      const result = results.get(fill.id) ?? 0;
      notices.push({ id: fill.id, label: "成交", text, result: { text: `這筆 ${signedMoney(result)}`, tone: toneOf(Math.round(result)) } });
      continue;
    }
    const holding = after.positions.find((position) => position.code === fill.code);
    notices.push({
      id: fill.id,
      label: "成交",
      text: holding ? `${text} · 庫存 ${holding.shares / 1000} 張 均 ${fillPriceText(holding.averageCost)}` : text,
    });
  }
  const waiting = new Set(before.orders.filter((order) => order.status === "pending").map((order) => order.id));
  for (const order of after.orders) {
    if (!waiting.has(order.id) || (order.status !== "cancelled" && order.status !== "rejected")) continue;
    if (OWN_ENDINGS.has(order.reason ?? "")) continue;
    const text = `${order.side === "buy" ? "買進" : "賣出"} ${names[order.code] ?? order.code} ${order.shares / 1000} 張`;
    notices.push({ id: order.id, label: "未成交", text: order.reason ? `${text} · ${order.reason}` : text });
  }
  return notices;
}

/**
 * A stock's holding for the quote block in three short parts (a phone stacks them beside the name): 「庫存 2 張」,
 * 「均 1785」 and its 參考損益 at the latest price, fees and tax not included.
 */
export function holdingText(
  position: Position,
  lastClose: number | undefined,
): { lots: string; average: string; result: { text: string; tone: QuoteTone } | null } {
  const mark = positionMark(position, lastClose);
  return {
    lots: `庫存 ${position.shares / 1000} 張`,
    average: `均 ${fillPriceText(position.averageCost)}`,
    result: mark.value === null ? null : { text: signedMoney(mark.value), tone: mark.tone },
  };
}
