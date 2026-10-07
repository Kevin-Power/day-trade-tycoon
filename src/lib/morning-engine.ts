import { z } from "zod";
import { commission, DAYTRADE_TAX, LOT_SHARES } from "./market/ticks.ts";
import type { Bar } from "./game/types.ts";
import type { MorningAction, MorningCatalog, MorningPlan, MorningState } from "./morning.ts";

export const MORNING_STARTING_CASH = 10_000_000;
export const MORNING_ADVANCE_INTERVAL = 1_000;
export const MORNING_MAX_ORDERS = 200;
export type MorningStoredState = Omit<MorningState, "bars">;
export type MorningSource = { catalog: MorningCatalog; bars: Record<string, Bar[]> };
export class MorningError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const text = z.string().trim().min(1).max(600)
  .refine(value => [...value].every(character => {
    const code = character.charCodeAt(0);
    return code !== 127 && (code >= 32 || code === 9 || code === 10 || code === 13);
  }));
const planSchema = z.object({
  exerciseId: z.enum(["first-order", "position", "exit", "n-breakout", "patience", "review"]).optional(),
  bias: z.enum(["observe", "bullish", "bearish"]), focusCode: z.string().regex(/^\d{4,6}$/),
  reason: text, entry: text, stop: text,
}).strict();
const base = { requestId: z.string().uuid().transform(value => value.toLowerCase()) };
const existing = { ...base, id: z.string().uuid().transform(value => value.toLowerCase()), expectedRevision: z.number().int().min(0).max(10_000) };
export const morningActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...base, plan: planSchema }).strict(),
  z.object({ action: z.literal("advance"), ...existing }).strict(),
  z.object({ action: z.literal("order"), ...existing, code: z.string().regex(/^\d{4,6}$/), side: z.enum(["buy", "sell"]), lots: z.number().int().min(1).max(3) }).strict(),
  z.object({ action: z.literal("cancel"), ...existing, orderId: z.string().uuid().transform(value => value.toLowerCase()) }).strict(),
  z.object({ action: z.literal("finish"), ...existing, reflection: text }).strict(),
]);
export function parseMorningAction(input: unknown): MorningAction {
  const result = morningActionSchema.safeParse(input);
  if (!result.success) throw new MorningError(400, "請確認練習資料、操作編號與目前進度");
  return result.data;
}
const money = (amount: number) => Math.round(amount * 100) / 100;
function symbolExists(source: MorningSource, code: string): boolean {
  return source.catalog.symbols.some(symbol => symbol.code === code);
}
function barAt(source: MorningSource, code: string, index: number): Bar {
  const bar = source.bars[code]?.[index];
  if (!bar || bar.t !== index * 60 || ![bar.o, bar.h, bar.l, bar.c].every(price => Number.isFinite(price) && price > 0)
    || bar.l > Math.min(bar.o, bar.c) || bar.h < Math.max(bar.o, bar.c) || bar.l > bar.h
    || !Number.isFinite(bar.v) || bar.v < 0) throw new MorningError(503, "這段分鐘資料目前無法讀取");
  return { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v };
}
function assertLesson(state: MorningStoredState, source: MorningSource): void {
  if (state.lessonId !== source.catalog.lessonId || !Number.isInteger(state.cursor)
    || state.cursor < 0 || state.cursor > source.catalog.maxCursor)
    throw new MorningError(409, "課程版本已變更，請聯絡講師確認這份練習");
}
function valueHoldings(state: MorningStoredState, source: MorningSource): void {
  state.equity = money(state.cash + state.positions.reduce((total, position) =>
    total + position.shares * barAt(source, position.code, state.cursor - 1).c, 0));
}
export function createMorningState(id: string, plan: MorningPlan, source: MorningSource, now: number): MorningStoredState {
  if (!symbolExists(source, plan.focusCode)) throw new MorningError(400, "請選擇本課程提供的股票");
  return {
    id, lessonId: source.catalog.lessonId, cursor: 0, revision: 0, plan: structuredClone(plan),
    startingCash: MORNING_STARTING_CASH, cash: MORNING_STARTING_CASH, equity: MORNING_STARTING_CASH,
    positions: [], orders: [], fills: [], completed: false, reflection: "", nextAdvanceAt: now + MORNING_ADVANCE_INTERVAL,
  };
}
/** Only completed bars are materialized. The persisted state never contains source bars. */
export function visibleMorningState(state: MorningStoredState, source: MorningSource): MorningState {
  assertLesson(state, source);
  return { ...structuredClone(state), bars: Object.fromEntries(source.catalog.symbols.map(symbol => [symbol.code,
    Array.from({ length: state.cursor }, (_, index) => barAt(source, symbol.code, index)),
  ])) };
}
/** Pure paper model: one pending order fills at the next minute OPEN, never its high/low. */
export function applyMorningAction(
  previous: MorningStoredState, action: Exclude<MorningAction, { action: "start" }>, source: MorningSource, now: number,
): MorningStoredState {
  assertLesson(previous, source);
  if (action.id !== previous.id) throw new MorningError(404, "找不到這份練習");
  if (action.expectedRevision !== previous.revision) throw new MorningError(409, "練習已更新，請重新讀取目前進度");
  if (previous.completed) throw new MorningError(409, "這份練習已完成，無法再修改");
  const state = structuredClone(previous);
  const pending = state.orders.find(order => order.status === "pending");
  if (action.action === "advance") {
    if (state.cursor >= source.catalog.maxCursor) throw new MorningError(409, "已到本次教材結尾，請完成復盤");
    if (now < state.nextAdvanceAt) throw new MorningError(429, "請稍候一秒，再前進下一個分鐘");
    // Validate this minute for every symbol before changing cash or revealing any bar.
    for (const symbol of source.catalog.symbols) barAt(source, symbol.code, state.cursor);
    if (pending) {
      const bar = barAt(source, pending.code, state.cursor);
      const notional = money(pending.shares * bar.o);
      const fee = commission(notional);
      const tax = pending.side === "sell" ? Math.round(notional * DAYTRADE_TAX) : 0;
      const position = state.positions.find(item => item.code === pending.code);
      if (pending.side === "buy" && notional + fee > state.cash) {
        pending.status = "rejected"; pending.reason = "下一分鐘開盤價變動後，模擬資金不足，未成交";
      } else if (pending.side === "sell" && (!position || position.shares < pending.shares)) {
        pending.status = "rejected"; pending.reason = "持有股數不足，未成交";
      } else {
        if (pending.side === "buy") {
          state.cash = money(state.cash - notional - fee);
          if (position) {
            position.averageCost = (position.averageCost * position.shares + notional) / (position.shares + pending.shares);
            position.shares += pending.shares;
          } else state.positions.push({ code: pending.code, shares: pending.shares, averageCost: bar.o });
        } else {
          state.cash = money(state.cash + notional - fee - tax);
          position!.shares -= pending.shares;
          state.positions = state.positions.filter(item => item.shares > 0);
        }
        pending.status = "filled"; pending.price = bar.o;
        state.fills.push({ id: pending.id, code: pending.code, side: pending.side, shares: pending.shares, price: bar.o, fee, tax, t: bar.t });
      }
    }
    state.cursor++;
    state.nextAdvanceAt = now + MORNING_ADVANCE_INTERVAL;
  } else if (action.action === "order") {
    if (state.cursor < 1 || state.cursor >= source.catalog.maxCursor) throw new MorningError(409, "需先看完第一分鐘，並保留下一分鐘才能委託");
    if (!symbolExists(source, action.code)) throw new MorningError(400, "請選擇本課程提供的股票");
    if (pending) throw new MorningError(409, "已有一筆待成交委託，請先等待下一分鐘或取消");
    if (state.orders.length >= MORNING_MAX_ORDERS) throw new MorningError(409, "本次練習已達委託筆數上限");
    const shares = action.lots * LOT_SHARES;
    const knownNotional = money(shares * barAt(source, action.code, state.cursor - 1).c);
    if (action.side === "buy" && knownNotional + commission(knownNotional) > state.cash)
      throw new MorningError(400, "目前模擬資金不足，無法委託");
    if (action.side === "sell" && (state.positions.find(item => item.code === action.code)?.shares ?? 0) < shares)
      throw new MorningError(400, "只可賣出已持有股數，本課程不提供放空");
    state.orders.push({ id: action.requestId, code: action.code, side: action.side, shares, status: "pending", submittedCursor: state.cursor });
  } else if (action.action === "cancel") {
    if (!pending || pending.id !== action.orderId) throw new MorningError(409, "這筆委託已不在等待成交狀態");
    pending.status = "cancelled";
    pending.reason = "由學員取消";
  } else {
    if (pending) { pending.status = "cancelled"; pending.reason = "結束練習時取消尚未成交委託"; }
    state.completed = true;
    state.reflection = action.reflection;
  }
  state.revision++;
  valueHoldings(state, source);
  return state;
}
