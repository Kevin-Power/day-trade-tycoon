import { z } from "zod";
import { commission, DAYTRADE_TAX, LOT_SHARES } from "./market/ticks.ts";
import type { Bar } from "./game/types.ts";
import type {
  MorningAction,
  MorningCatalog,
  MorningDelta,
  MorningFill,
  MorningIndexBar,
  MorningIndexSeries,
  MorningOrder,
  MorningPlan,
  MorningState,
  MorningTape,
} from "./morning.ts";
import { validMorningLimit } from "./morning-book.ts";
import { MAX_RUN_CODES } from "./lessons/default-codes.ts";
import { endReason, matchOrder, tradesBefore } from "./lessons/matching.ts";
import { MAX_LOTS, MIN_LOTS } from "./morning-lots.ts";
import { cellSlice, CELL_MS, type TradeRow } from "./lessons/trades.ts";

export const MORNING_STARTING_CASH = 10_000_000;
export const MORNING_ADVANCE_INTERVAL = 1_000;
export const MORNING_MAX_ORDERS = 200;
/** The latest revealed trades sent per stock when a run is opened. */
export const MORNING_TAPE_LENGTH = 40;
export type MorningStoredState = Omit<MorningState, "bars" | "index">;
/**
 * A lesson's data for a run. With `trades` (a run of a Fubon lesson day) orders match against the real trades and
 * bars are found by `t`; without them (the old lessons) orders fill at the next minute's open. Callers may hand in
 * cached data by reference: nothing here ever changes a source.
 */
export type MorningSource = {
  catalog: MorningCatalog;
  bars: Record<string, Bar[]>;
  /** The lesson's real TAIEX, when the lesson carries one. Never read by matching, validation or P&L. */
  index?: MorningIndexSeries;
  /** Each stock's real trades of the morning in time order (ms after 09:00). */
  trades?: Record<string, readonly TradeRow[]>;
  /** The published files the data was read from; a run started on other files is refused. */
  sourceHash?: string;
};
export class MorningError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const text = z
  .string()
  .trim()
  .min(1)
  .max(600)
  .refine((value) =>
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code !== 127 && (code >= 32 || code === 9 || code === 10 || code === 13);
    }),
  );
const stockCode = z.string().regex(/^\d{4,6}$/);
export const planSchema = z
  .object({
    exerciseId: z
      .enum(["first-order", "position", "exit", "n-breakout", "patience", "review"])
      .optional(),
    bias: z.enum(["observe", "bullish", "bearish"]),
    focusCode: stockCode,
    reason: text,
    entry: text,
    stop: text,
  })
  .strict();
const base = {
  requestId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
};
const existing = {
  ...base,
  id: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  expectedRevision: z.number().int().min(0).max(10_000),
};
export const morningActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      ...base,
      plan: planSchema,
      // The stocks of the run in the order chosen; checked against the lesson day's picker by the caller.
      codes: z.array(stockCode).min(1).max(MAX_RUN_CODES),
      // A guest accepts the teaching statement by pressing start (see morning-session.server.ts).
      guestTerms: z.literal(true).optional(),
    })
    .strict(),
  // `view`: the stock whose recorded books the desk shows, for the cell this advance reveals.
  z.object({ action: z.literal("advance"), ...existing, view: stockCode.optional() }).strict(),
  z.object({ action: z.literal("abandon"), ...existing }).strict(),
  z
    .object({
      action: z.literal("order"),
      ...existing,
      code: stockCode,
      side: z.enum(["buy", "sell"]),
      lots: z.number().int().min(MIN_LOTS).max(MAX_LOTS),
      limitPrice: z.number().finite().positive().max(1_000_000).optional(),
      entryMode: z.literal("lightning").optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      ...existing,
      orderId: z
        .string()
        .uuid()
        .transform((value) => value.toLowerCase()),
    })
    .strict(),
  z.object({ action: z.literal("finish"), ...existing, reflection: text }).strict(),
]);
export function parseMorningAction(input: unknown): MorningAction {
  const result = morningActionSchema.safeParse(input);
  if (!result.success) throw new MorningError(400, "請確認練習資料、操作編號與目前進度");
  if (
    result.data.action === "order" &&
    result.data.entryMode === "lightning" &&
    result.data.limitPrice === undefined
  )
    throw new MorningError(400, "閃電下單需指定限價");
  return result.data;
}
const money = (amount: number) => Math.round(amount * 100) / 100;
function symbolExists(source: MorningSource, code: string): boolean {
  return source.catalog.symbols.some((symbol) => symbol.code === code);
}
/** The stocks of a run: the ones chosen, or every stock of the lesson for an old run, which chose none. */
function runCodes(state: MorningStoredState, source: MorningSource): string[] {
  return state.codes ?? source.catalog.symbols.map((symbol) => symbol.code);
}
function validBar(bar: Bar): boolean {
  return (
    [bar.o, bar.h, bar.l, bar.c].every((price) => Number.isFinite(price) && price > 0) &&
    bar.l <= Math.min(bar.o, bar.c) &&
    bar.h >= Math.max(bar.o, bar.c) &&
    bar.l <= bar.h &&
    Number.isFinite(bar.v) &&
    bar.v >= 0
  );
}
/** An old lesson's bar: every stock has every minute, at the minute's index. */
function barAt(source: MorningSource, code: string, index: number): Bar {
  const bar = source.bars[code]?.[index];
  if (!bar || bar.t !== index * 60 || !validBar(bar)) throw new MorningError(503, "這段分鐘資料目前無法讀取");
  return { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v };
}
/** A real run's bar of a cell (a copy, average kept), found by `t`; none before the stock's first trade. */
function cellBar(source: MorningSource, code: string, cell: number): Bar | null {
  const bars = source.bars[code] ?? [];
  const t = cell * 60;
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bars[middle].t < t) low = middle + 1;
    else high = middle;
  }
  const bar = bars[low];
  if (!bar || bar.t !== t) return null;
  if (!validBar(bar)) throw new MorningError(503, "這段分鐘資料目前無法讀取");
  return { ...bar };
}
/** A stock's bars of the cells before the cursor (copies). A real run's stock has none before its first trade. */
function revealedBars(state: MorningStoredState, source: MorningSource, code: string): Bar[] {
  if (!source.trades) return Array.from({ length: state.cursor }, (_, index) => barAt(source, code, index));
  const end = state.cursor * 60;
  return (source.bars[code] ?? [])
    .filter((bar) => bar.t < end)
    .map((bar) => {
      if (!validBar(bar)) throw new MorningError(503, "這段分鐘資料目前無法讀取");
      return { ...bar };
    });
}
const copyIndexBar = (bar: MorningIndexBar): MorningIndexBar => ({ ...bar, p: [...bar.p] });
function stockTrades(source: MorningSource, code: string): readonly TradeRow[] {
  return source.trades?.[code] ?? [];
}
/** The price of a real run's last revealed trade of a stock; null before its first trade. */
function lastTradePrice(source: MorningSource, code: string, cursor: number): number | null {
  const rows = stockTrades(source, code);
  const count = tradesBefore(rows, cursor * CELL_MS);
  return count > 0 ? rows[count - 1][1] : null;
}
/** The last revealed price: a real run's last trade (the reference price before the first), else the last close. */
function revealedPrice(state: MorningStoredState, source: MorningSource, code: string): number {
  if (!source.trades) return barAt(source, code, state.cursor - 1).c;
  return (
    lastTradePrice(source, code, state.cursor) ??
    source.catalog.symbols.find((symbol) => symbol.code === code)!.previousClose
  );
}
function assertLesson(state: MorningStoredState, source: MorningSource): void {
  if (
    state.lessonId !== source.catalog.lessonId ||
    !Number.isInteger(state.cursor) ||
    state.cursor < 0 ||
    state.cursor > source.catalog.maxCursor ||
    (state.sourceHash !== undefined && state.sourceHash !== source.sourceHash) ||
    (state.codes !== undefined && !state.codes.every((code) => symbolExists(source, code)))
  )
    throw new MorningError(409, "課程版本已變更，請聯絡講師確認這份練習");
}
/** Holdings at the last revealed price (a real run's last revealed trade). */
function valueHoldings(state: MorningStoredState, source: MorningSource): void {
  state.equity = money(
    state.cash +
      state.positions.reduce(
        (total, position) => total + position.shares * revealedPrice(state, source, position.code),
        0,
      ),
  );
}
/** Fills `order` at `price` when cash and holdings still allow it, checked now at the fill; otherwise rejects it. */
function fillOrder(
  state: MorningStoredState,
  order: MorningOrder,
  price: number,
  at: { t: number; ms?: number },
  shortOfCash: string,
): void {
  const notional = money(order.shares * price);
  const fee = commission(notional);
  const tax = order.side === "sell" ? Math.round(notional * DAYTRADE_TAX) : 0;
  const position = state.positions.find((item) => item.code === order.code);
  if (order.side === "buy" && notional + fee > state.cash) {
    order.status = "rejected";
    order.reason = shortOfCash;
    return;
  }
  if (order.side === "sell" && (!position || position.shares < order.shares)) {
    order.status = "rejected";
    order.reason = "持有股數不足，未成交";
    return;
  }
  if (order.side === "buy") {
    state.cash = money(state.cash - notional - fee);
    if (position) {
      position.averageCost =
        (position.averageCost * position.shares + notional) / (position.shares + order.shares);
      position.shares += order.shares;
    } else state.positions.push({ code: order.code, shares: order.shares, averageCost: price });
  } else {
    state.cash = money(state.cash + notional - fee - tax);
    position!.shares -= order.shares;
    state.positions = state.positions.filter((item) => item.shares > 0);
  }
  order.status = "filled";
  order.price = price;
  const fill: MorningFill = {
    id: order.id,
    code: order.code,
    side: order.side,
    shares: order.shares,
    price,
    fee,
    tax,
    t: at.t,
  };
  if (at.ms !== undefined) fill.ms = at.ms;
  state.fills.push(fill);
}
/** An old lesson: a waiting order meets this minute's OPEN only; limits wait, never infer intraminute fills. */
function advanceOnOpens(state: MorningStoredState, source: MorningSource, pending: MorningOrder | undefined): void {
  // Validate this minute for every symbol before changing cash or revealing any bar.
  for (const symbol of source.catalog.symbols) barAt(source, symbol.code, state.cursor);
  if (pending) {
    const bar = barAt(source, pending.code, state.cursor);
    const eligible =
      pending.limitPrice === undefined ||
      (pending.side === "buy" ? bar.o <= pending.limitPrice : bar.o >= pending.limitPrice);
    if (eligible) fillOrder(state, pending, bar.o, { t: bar.t }, "下一分鐘開盤價變動後，模擬資金不足，未成交");
  }
  state.cursor++;
  if (state.cursor === source.catalog.maxCursor && pending?.status === "pending") {
    pending.status = "cancelled";
    pending.reason = "教材已結束，限價未達價，取消未成交委託";
  }
}
/**
 * A real run: a waiting order meets the real trades of the cell being revealed (③ §5 with 量夠才成交), in their
 * order. What the cell gathers for it (lots and value of the touching trades) is saved on the order for the next.
 */
function advanceOnTrades(state: MorningStoredState, source: MorningSource, pending: MorningOrder | undefined): void {
  const cell = state.cursor;
  // Check the cell's bars before changing cash or revealing anything.
  for (const code of runCodes(state, source)) cellBar(source, code, cell);
  if (pending) {
    const result = matchOrder(
      { ...pending, lots: pending.shares / LOT_SHARES },
      cellSlice(stockTrades(source, pending.code), cell),
    );
    if (result.kind === "fill") {
      delete pending.filledLots;
      delete pending.filledValue;
      delete pending.atLimit;
      pending.seen = true;
      fillOrder(
        state,
        pending,
        result.price,
        { t: Math.floor(result.ms / 1000), ms: result.ms },
        "成交價變動後，模擬資金不足，未成交",
      );
    } else {
      if (result.seen) pending.seen = true;
      if (result.filledLots > 0) {
        pending.filledLots = result.filledLots;
        pending.filledValue = result.filledValue;
      }
      if (result.atLimit) pending.atLimit = true;
    }
  }
  state.cursor++;
  if (state.cursor === source.catalog.maxCursor && pending?.status === "pending") {
    pending.status = "cancelled";
    pending.reason = endReason(pending);
  }
}
/** A new run; `codes` are its stocks in the order chosen (an old lesson's run may have none: all its stocks). */
export function createMorningState(
  id: string,
  plan: MorningPlan,
  source: MorningSource,
  now: number,
  codes?: readonly string[],
): MorningStoredState {
  if (!symbolExists(source, plan.focusCode)) throw new MorningError(400, "請選擇本課程提供的股票");
  if (
    codes !== undefined &&
    (codes.length === 0 ||
      new Set(codes).size !== codes.length ||
      !codes.every((code) => symbolExists(source, code)))
  )
    throw new MorningError(400, "請選擇本課程提供的股票");
  return {
    id,
    lessonId: source.catalog.lessonId,
    ...(codes !== undefined ? { codes: [...codes] } : {}),
    ...(source.sourceHash !== undefined ? { sourceHash: source.sourceHash } : {}),
    cursor: 0,
    revision: 0,
    plan: structuredClone(plan),
    startingCash: MORNING_STARTING_CASH,
    cash: MORNING_STARTING_CASH,
    equity: MORNING_STARTING_CASH,
    positions: [],
    orders: [],
    fills: [],
    completed: false,
    reflection: "",
    nextAdvanceAt: now + MORNING_ADVANCE_INTERVAL,
    startedAt: now,
  };
}
/** Only completed cells are materialized, for the run's stocks only. The persisted state never contains source data. */
export function visibleMorningState(
  state: MorningStoredState,
  source: MorningSource,
): MorningState {
  assertLesson(state, source);
  const end = state.cursor * 60;
  return {
    ...structuredClone(state),
    bars: Object.fromEntries(
      runCodes(state, source).map((code) => [code, revealedBars(state, source, code)]),
    ),
    ...(source.index
      ? { index: { ...source.index, bars: source.index.bars.filter((bar) => bar.t < end).map(copyIndexBar) } }
      : {}),
  };
}
/**
 * What the advance that brought the run to its cursor revealed: cell `cursor − 1` of every stock of the run (its bar,
 * null before the stock's first trade, and all its real trades) and of the TAIEX. Nothing at or after the cursor.
 * `book` is left to the caller, which reads the recorded books.
 */
export function advanceDelta(state: MorningStoredState, source: MorningSource): MorningDelta {
  assertLesson(state, source);
  const cell = state.cursor - 1;
  const bars: Record<string, Bar | null> = {};
  const trades: Record<string, TradeRow[]> = {};
  for (const code of runCodes(state, source)) {
    bars[code] = cell < 0 ? null : source.trades ? cellBar(source, code, cell) : barAt(source, code, cell);
    trades[code] = cell < 0 ? [] : [...cellSlice(stockTrades(source, code), cell)];
  }
  const index = cell < 0 ? undefined : source.index?.bars.find((bar) => bar.t === cell * 60);
  return { cell, bars, index: index ? copyIndexBar(index) : null, trades };
}
/** The last `limit` revealed trades of every stock of the run, for the trade list when a run is opened. */
export function visibleTape(
  state: MorningStoredState,
  source: MorningSource,
  limit = MORNING_TAPE_LENGTH,
): MorningTape {
  assertLesson(state, source);
  const end = state.cursor * CELL_MS;
  const keep = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  return Object.fromEntries(
    runCodes(state, source).map((code) => {
      const rows = stockTrades(source, code);
      const count = tradesBefore(rows, end);
      return [code, rows.slice(Math.max(0, count - keep), count)];
    }),
  );
}
/**
 * One action on a run. Old lessons fill at the next minute's OPEN; real runs match against the real trades of each
 * cell as it is revealed. Abandon ends a run without a reflection (never counted for discipline).
 */
export function applyMorningAction(
  previous: MorningStoredState,
  action: Exclude<MorningAction, { action: "start" }>,
  source: MorningSource,
  now: number,
): MorningStoredState {
  assertLesson(previous, source);
  assertActionable(previous, action);
  const state = structuredClone(previous);
  const pending = state.orders.find((order) => order.status === "pending");
  if (action.action === "advance") {
    if (state.cursor >= source.catalog.maxCursor)
      throw new MorningError(409, "已到本次教材結尾，請完成復盤");
    if (now < state.nextAdvanceAt) throw new MorningError(429, "請稍候一秒，再前進下一個分鐘");
    if (source.trades) advanceOnTrades(state, source, pending);
    else advanceOnOpens(state, source, pending);
    state.nextAdvanceAt = now + MORNING_ADVANCE_INTERVAL;
  } else if (action.action === "order") {
    if (state.cursor < 1 || state.cursor >= source.catalog.maxCursor)
      throw new MorningError(409, "需先看完第一分鐘，並保留下一分鐘才能委託");
    if (!runCodes(state, source).includes(action.code))
      throw new MorningError(400, "請選擇本課程提供的股票");
    if (
      action.limitPrice !== undefined &&
      !validMorningLimit(
        action.limitPrice,
        source.catalog.symbols.find((symbol) => symbol.code === action.code)!.previousClose,
      )
    )
      throw new MorningError(400, "限價需符合股價升降單位及本課昨收上下 10% 範圍");
    if (action.entryMode === "lightning" && action.limitPrice === undefined)
      throw new MorningError(400, "閃電下單需指定限價");
    if (pending) throw new MorningError(409, "已有待撮合委託，請先等待達價或撤回");
    if (state.orders.length >= MORNING_MAX_ORDERS)
      throw new MorningError(409, "本次練習已達委託筆數上限");
    const shares = action.lots * LOT_SHARES;
    const knownNotional = money(
      shares * (action.limitPrice ?? revealedPrice(state, source, action.code)),
    );
    if (action.side === "buy" && knownNotional + commission(knownNotional) > state.cash)
      throw new MorningError(400, "目前模擬資金不足，無法委託");
    if (
      action.side === "sell" &&
      (state.positions.find((item) => item.code === action.code)?.shares ?? 0) < shares
    )
      throw new MorningError(400, "只可賣出已持有股數，本課程不提供放空");
    state.orders.push({
      id: action.requestId,
      code: action.code,
      side: action.side,
      shares,
      status: "pending",
      submittedCursor: state.cursor,
      ...(action.limitPrice !== undefined ? { limitPrice: action.limitPrice } : {}),
      ...(action.entryMode ? { entryMode: action.entryMode } : {}),
    });
  } else if (action.action === "cancel") {
    if (!pending || pending.id !== action.orderId)
      throw new MorningError(409, "這筆委託已不在等待成交狀態");
    pending.status = "cancelled";
    pending.reason = "由學員取消";
  } else closeRun(state, action);
  state.revision++;
  valueHoldings(state, source);
  return state;
}
/** The checks every action on a saved run passes first, in this order. */
function assertActionable(previous: MorningStoredState, action: Exclude<MorningAction, { action: "start" }>): void {
  if (action.id !== previous.id) throw new MorningError(404, "找不到這份練習");
  // Abandoning an ended run gets the same answer whatever revision it is sent with.
  if (action.action === "abandon" && previous.completed) throw new MorningError(409, "這局已經結束");
  if (action.expectedRevision !== previous.revision)
    throw new MorningError(409, "練習已更新，請重新讀取目前進度");
  if (previous.completed) throw new MorningError(409, "這份練習已完成，無法再修改");
}
/** Finish (with the reflection) or abandon: the waiting order is cancelled and the run is completed. */
function closeRun(state: MorningStoredState, action: Extract<MorningAction, { action: "finish" | "abandon" }>): void {
  const pending = state.orders.find((order) => order.status === "pending");
  if (action.action === "abandon") {
    if (pending) {
      pending.status = "cancelled";
      pending.reason = "放棄這局時取消尚未成交委託";
    }
    state.completed = true;
    state.abandoned = true;
  } else {
    if (pending) {
      pending.status = "cancelled";
      pending.reason = "結束練習時取消尚未成交委託";
    }
    state.completed = true;
    state.reflection = action.reflection;
  }
}
/**
 * Finish or abandon from what is saved, without the lesson's data (③ decision R): holdings keep the value saved
 * with the last action, which is what valuing them again would give, since nothing is revealed in between. A run
 * whose data can no longer be read (republished, not agreeing, unreadable) can still be ended.
 */
export function endMorningRun(
  previous: MorningStoredState,
  action: Extract<MorningAction, { action: "finish" | "abandon" }>,
): MorningStoredState {
  assertActionable(previous, action);
  const state = structuredClone(previous);
  closeRun(state, action);
  state.revision++;
  return state;
}
