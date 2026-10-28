// The desk's copy of a run made of real Fubon trades, and the pieces the replay builds from them (client side).
//
// The server reveals one cell (minute) per advance: its bars, its TAIEX minute and every real trade in it. The desk
// adds that cell to what it already holds and replays its trades on their real seconds before the next advance; it
// never has a trade the server has not revealed. Nothing here reaches the server: orders still match on the server
// against the trades revealed after them.
import type { Bar } from "../game/types.ts";
import type { TradeRow } from "../lessons/trades.ts";
import type { MorningDelta, MorningResponse, MorningState, MorningTape } from "../morning.ts";

/** The latest trades of each stock the desk keeps for 成交明細, as many as a snapshot's tape. */
export const TAPE_LENGTH = 40;

/**
 * A run as the desk holds it: the server's state, with the trades it was sent. At rest the revealed trades are `tape`
 * followed by `latest`; while `latest` replays, only the part of it played so far is shown.
 */
export type ReplayState = MorningState & {
  /** Up to TAPE_LENGTH latest trades of each stock before `latest` (all revealed ones, when there is no `latest`). */
  tape?: MorningTape;
  /** The newest cell's trades, from the advance that revealed it: the minute the desk replays. */
  latest?: { cell: number; trades: MorningTape };
};

/** /api/morning's answer as the desk keeps it: the run with its trades. */
export type DeskResponse = Omit<MorningResponse, "state"> & { state: ReplayState | null };

/**
 * One real trade on the desk: when (ms after 09:00), price, size in lots, 外盤 (ask) or 內盤 (bid) when known, and
 * the best bid and ask the trade came with (null when it carried none, e.g. an auction trade).
 */
export type LiveTrade = {
  ms: number;
  price: number;
  size: number;
  side: "ask" | "bid" | null;
  bid: number | null;
  ask: number | null;
};

const TOLERANCE = 1e-9;
const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= TOLERANCE;

/** 外盤 when the trade was at the ask of the time, 內盤 at the bid, otherwise neither. */
export function tradeSide(row: TradeRow): "ask" | "bid" | null {
  const [, price, , bid, ask] = row;
  if (same(ask, price)) return "ask";
  if (same(bid, price)) return "bid";
  return null;
}

export const liveTrade = (row: TradeRow): LiveTrade => ({
  ms: row[0],
  price: row[1],
  size: row[2],
  side: tradeSide(row),
  bid: row[3],
  ask: row[4],
});

/** How many of the trades (in time order) were at or before `ms`. */
export function tradesUpTo(rows: readonly TradeRow[], ms: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle][0] <= ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * The bar of the cell starting at `cellStart` (ms after 09:00) after its first `count` trades. Volume adds up the
 * trades; the average is the day's: (traded value before + value so far) ÷ (lots before + lots so far), the value
 * before being `previous.a` × `volumeBefore` (the lots of the stock's earlier bars), to the cent like the source.
 * Before the cell's first trade it is flat at the last trade with no volume, or null when the stock has not traded.
 */
export function formingBar(
  cellStart: number,
  rows: readonly TradeRow[],
  count: number,
  previous: Bar | undefined,
  volumeBefore = 0,
): Bar | null {
  const t = Math.round(cellStart / 1000);
  const played = Math.min(Math.max(0, Math.floor(count)), rows.length);
  if (!played) {
    if (!previous) return null;
    const flat: Bar = { t, o: previous.c, h: previous.c, l: previous.c, c: previous.c, v: 0 };
    if (previous.a !== undefined) flat.a = previous.a;
    return flat;
  }
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let value = 0;
  for (let index = 0; index < played; index += 1) {
    const [, price, size] = rows[index];
    high = Math.max(high, price);
    low = Math.min(low, price);
    volume += size;
    value += price * size;
  }
  const bar: Bar = { t, o: rows[0][1], h: high, l: low, c: rows[played - 1][1], v: volume };
  const before = previous && volumeBefore > 0 ? volumeBefore : 0;
  const averageBefore = before > 0 ? previous?.a : 0;
  if (averageBefore !== undefined && before + volume > 0)
    bar.a = cents((averageBefore * before + value) / (before + volume));
  return bar;
}

/**
 * The run with the cell an advance revealed: each stock's bar (none before its first trade) and the TAIEX minute
 * appended, the cell's trades kept as `latest` to replay and the previous cell's moved onto the tape. A new object;
 * only the cell right after the run's cursor is added, so merging the same cell again changes nothing.
 */
export function mergeDelta(state: ReplayState, delta: MorningDelta): ReplayState {
  if (delta.cell !== state.cursor) return state;
  const t = delta.cell * 60;
  const bars: Record<string, Bar[]> = { ...state.bars };
  for (const [code, bar] of Object.entries(delta.bars)) {
    const list = bars[code] ?? [];
    if (bar && !(list.length && list[list.length - 1].t >= t)) bars[code] = [...list, bar];
    else if (!bars[code]) bars[code] = list;
  }
  const index =
    state.index && delta.index && !state.index.bars.some((item) => item.t >= delta.index!.t)
      ? { ...state.index, bars: [...state.index.bars, delta.index] }
      : state.index;
  const tape: MorningTape = { ...state.tape };
  for (const [code, rows] of Object.entries(state.latest?.trades ?? {})) {
    if (rows.length) tape[code] = [...(tape[code] ?? []), ...rows].slice(-TAPE_LENGTH);
  }
  const merged: ReplayState = { ...state, cursor: delta.cell + 1, bars, tape, latest: { cell: delta.cell, trades: delta.trades } };
  if (index) merged.index = index;
  return merged;
}

/**
 * The desk's data after a reply. A snapshot (GET, start, a retired run's text) is taken as it is, its tape on the
 * run. A step (order, cancel, finish, abandon, advance) carries the run without bars, TAIEX or trades: the desk keeps
 * its own, the lesson list only a GET carries and the newest cell's books, and adds an advance's cell. null when the
 * reply cannot be added to what the desk holds (an advance that is not the cell right after the desk's cursor, e.g.
 * a retried advance answered with a later cell, or a step that moved the run on without one): load a snapshot then.
 */
export function adoptReply(previous: DeskResponse | null, reply: MorningResponse): DeskResponse | null {
  const state = reply.state;
  if (!state || reply.tape !== undefined || reply.retired) {
    return state && reply.tape !== undefined ? { ...reply, state: { ...state, tape: reply.tape } } : reply;
  }
  if (!previous?.state || previous.state.id !== state.id) return reply.delta ? null : reply;
  const held = previous.state;
  let merged: ReplayState = held;
  if (reply.delta) {
    if (reply.delta.cell !== held.cursor || state.cursor !== reply.delta.cell + 1) return null;
    merged = mergeDelta(held, reply.delta);
  } else if (state.cursor !== held.cursor) return null;
  const next: ReplayState = { ...state, bars: merged.bars };
  if (merged.index) next.index = merged.index;
  if (merged.tape) next.tape = merged.tape;
  if (merged.latest) next.latest = merged.latest;
  const desk: DeskResponse = { ...reply, state: next };
  // The open lesson days do not change with a step (the records do: a step leaves them for the next GET).
  if (desk.lessons === undefined && previous.lessons !== undefined) desk.lessons = previous.lessons;
  // The books belong to the newest cell: an advance brings its own (or none), any other step keeps the desk's.
  if (reply.delta) {
    if (reply.delta.book) desk.book = reply.delta.book;
    else delete desk.book;
  } else if (desk.book === undefined && previous.book !== undefined) desk.book = previous.book;
  return desk;
}
