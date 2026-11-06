// The phone's trade bar on 行情 (2026-11-04, the owner: 「江波圖、買進按鈕、買完馬上看到庫存，通通在一個手機畫面搞定」):
// what its 買進 and 賣出 say and whether they can be pressed, or the learner's waiting order in their place. The same
// rules as the ticket: one waiting order a run, no order of a stock while its 自動出場 sell waits, no buy the cash
// cannot pay for, a second look at a buy of half the cash or more. Pure; nothing here sends an order.
import type { MorningState } from "./morning.ts";
import { formatPrice } from "./market/ticks.ts";
import { EXIT_NAME } from "./morning-exit.ts";
import { lotProgress } from "./morning-ledger.ts";
import { MAX_LOTS } from "./morning-lots.ts";
import { exceedsCash, isLargeOrder } from "./morning-orders.ts";

export type PhoneTradeInput = {
  session: Pick<MorningState, "cursor" | "completed" | "cash" | "orders" | "positions">;
  /** The stock on screen. */
  code: string;
  names: Readonly<Record<string, string>>;
  /** Lots a 買進 buys (賣出 sells the whole holding). */
  lots: number;
  /** The last trade shown, for the amount a market buy would cost; null before the stock's first trade. */
  reference: number | null;
  /**
   * The last trade of the newest minute the classroom revealed, which it prices a market buy at; mid-replay it is
   * ahead of the trade shown. The checks take the higher of the two, so a buy the classroom would refuse cannot be
   * pressed.
   */
  serverReference: number | null;
  atEnd: boolean;
  /** A request is out, or an error or notice waits above the desk. */
  busy: boolean;
  /** Which button's order is being sent. */
  sending: "buy" | "sell" | null;
  /** Which button's last send the classroom did not take (refused, or the connection dropped). */
  missed: "buy" | "sell" | null;
  /** 買進 was tapped once for a large buy of these lots of this stock; the next tap sends it. */
  armed: boolean;
};

/** A tap this soon after the bar changed under the finger (a large buy armed, the waiting order gone) is ignored. */
export const TAP_GUARD_MS = 600;

/** Whether a tap at `now` counts, the bar having changed at `changedAt` (null: not lately). */
export function tapAllowed(changedAt: number | null, now: number): boolean {
  return changedAt === null || now - changedAt >= TAP_GUARD_MS;
}

export type PhoneTradeButton = { enabled: boolean; label: string; sub: string };
export type PhoneTradeView =
  | { kind: "waiting"; orderId: string; text: string; progress: string }
  | {
      kind: "ready";
      /** `arm`: the tap only asks for a second one (a large buy). */
      buy: PhoneTradeButton & { tap: "send" | "arm" };
      /** `lots`: what a 賣出 sells, the whole holding up to the 400 lots one order may have. */
      sell: PhoneTradeButton & { lots: number };
    };

export function phoneTrade(input: PhoneTradeInput): PhoneTradeView {
  const { session, code, names, lots, reference, serverReference, atEnd, busy, sending, missed, armed } = input;
  const waiting = session.orders.find((order) => order.status === "pending" && !order.auto);
  if (waiting)
    return {
      kind: "waiting",
      orderId: waiting.id,
      text: `委託中 · ${waiting.side === "buy" ? "買進" : "賣出"} ${names[waiting.code] ?? waiting.code} ${waiting.shares / 1000} 張 ${
        waiting.limitPrice === undefined ? "市價" : `限價 ${formatPrice(waiting.limitPrice)}`
      }`,
      progress: lotProgress(waiting),
    };
  const holdingLots = (session.positions.find((position) => position.code === code)?.shares ?? 0) / 1000;
  const exiting = session.orders.find((order) => order.status === "pending" && order.auto && order.code === code);
  const closed = atEnd || session.completed;
  const open = !closed && session.cursor >= 1;
  const price =
    reference === null ? serverReference : serverReference === null ? reference : Math.max(reference, serverReference);
  const amount = price === null ? null : price * lots * 1000;
  const sellLots = Math.min(holdingLots, MAX_LOTS);
  const short = exceedsCash({ side: "buy", amount, availableCash: session.cash });
  const large = isLargeOrder({ side: "buy", amount, availableCash: session.cash });
  const shut = closed ? "已收盤" : !open ? "第一分鐘後" : null;

  const buy: PhoneTradeButton & { tap: "send" | "arm" } = {
    enabled: open && !busy && !exiting && !short,
    label: large && armed && !short ? "確認買進" : "買進",
    sub:
      shut ??
      (sending === "buy"
        ? "送出中…"
        : exiting
          ? "觸價賣出中"
          : short
            ? "資金不足"
            : large && armed && amount !== null
              ? `大額 ${Math.round((amount / session.cash) * 100)}%`
              : missed === "buy"
                ? "未送出"
                : "市價"),
    tap: large && !short && !armed ? "arm" : "send",
  };
  const sell: PhoneTradeButton & { lots: number } = {
    enabled: open && !busy && !exiting && holdingLots > 0,
    label: "賣出",
    sub:
      shut ??
      (sending === "sell"
        ? "送出中…"
        : exiting?.auto
          ? `${EXIT_NAME[exiting.auto]}觸發中`
          : holdingLots === 0
            ? "沒有庫存"
            : missed === "sell"
              ? "未送出"
              : holdingLots > MAX_LOTS
                ? `${MAX_LOTS} 張（共 ${holdingLots}）`
                : `全部 ${holdingLots} 張`),
    lots: sellLots,
  };
  return { kind: "ready", buy, sell };
}
