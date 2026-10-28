// The desk while a newly revealed minute plays out trade by trade (display only; client-side).
//
// The server reveals a whole minute at a time, with every real Fubon trade in it. When the run moves forward one
// minute, the desk replays that minute's trades on their real seconds over the next couple of seconds (the minute's
// 60 s in REPLAY_DELAY × 0.9; trades that land in the same screen update show together): every stock's newest bar is
// rebuilt from the trades played so far, holdings are valued at the latest trade, and the clock runs through the
// minute's seconds. Orders, fills, order defaults, alerts and minute tables come from the server's session
// (serverSession / settledSession), so nothing played here reaches the server and nothing is announced early.
import type { Bar } from "./game/types.ts";
import { CELL_MS, type TradeRow } from "./lessons/trades.ts";
import type { MorningBookCell, MorningCatalog, MorningState } from "./morning.ts";
import { formingBar, liveTrade, tradesUpTo, type LiveTrade, type ReplayState } from "./market/real-replay.ts";
import { displayBook, type DisplayedBook } from "./morning-book.ts";
import { formingIndexBar } from "./morning-index.ts";

export type LiveMorningState = ReplayState & {
  /**
   * Present only while a minute is playing: how far through it, the moment of the day it has reached (ms after
   * 09:00; every trade at or before it has played), and the server's session.
   */
  replay?: { fraction: number; playedMs: number; source: ReplayState };
};

/** The lesson as the desk's callers pass it; real trades need nothing from it. */
export type ReplayCatalog = Pick<MorningCatalog, "volumeUnit"> & {
  symbols: readonly Pick<MorningCatalog["symbols"][number], "code" | "previousClose">[];
};

/** The newest trade of a stock; `index` is its place among the stock's trades the desk holds. */
export type LastTrade = LiveTrade & { index: number; second: number };
/** `id` names the trade (its ms and how many later trades share it), stable while the tape scrolls. */
export type RecentTrade = LiveTrade & { id: string; second: number; move: "up" | "down" | "same" };

/** The newest cell's trades when the desk can replay them: they came with the advance that revealed the cell. */
function playingCell(session: ReplayState): ReplayState["latest"] {
  const latest = session.latest;
  return latest && latest.cell === session.cursor - 1 ? latest : undefined;
}

/** The server's session behind what the desk shows. */
export function serverSession(session: LiveMorningState): ReplayState {
  return session.replay?.source ?? session;
}

/** A stock's trades on the desk: the tape before the newest cell, that cell's, and how many of those have played. */
function shownTrades(session: LiveMorningState, code: string): { tape: readonly TradeRow[]; cell: readonly TradeRow[]; count: number } {
  const source = serverSession(session);
  const tape = source.tape?.[code] ?? [];
  const cell = playingCell(source)?.trades[code] ?? [];
  const count = session.replay ? tradesUpTo(cell, session.replay.playedMs) : cell.length;
  return { tape, cell, count };
}

/**
 * The session as the desk shows it `fraction` of the way through its newest minute: each stock's newest bar made of
 * the trades up to that moment of the minute (none before a stock's first trade; the minute's own bar once all have
 * played). The session itself at 1, or when the newest minute's trades did not come with it (a loaded run).
 */
export function liveSession(session: ReplayState, fraction: number, _catalog?: ReplayCatalog): LiveMorningState {
  const latest = playingCell(session);
  if (fraction >= 1 || !latest) return session;
  const cellStart = latest.cell * CELL_MS;
  const t = latest.cell * 60;
  const playedMs = cellStart + Math.max(0, fraction) * CELL_MS;
  const bars = Object.fromEntries(
    Object.entries(session.bars).map(([code, list]): [string, Bar[]] => {
      const last = list.at(-1);
      if (!last || last.t !== t) return [code, list];
      const rows = latest.trades[code] ?? [];
      const count = tradesUpTo(rows, playedMs);
      if (count >= rows.length) return [code, list];
      const earlier = list.slice(0, -1);
      const volumeBefore = earlier.reduce((sum, bar) => sum + bar.v, 0);
      const forming = formingBar(cellStart, rows, count, earlier.at(-1), volumeBefore);
      return [code, forming ? [...earlier, forming] : earlier];
    }),
  );
  const revaluation = session.positions.reduce((sum, position) => {
    const settled = session.bars[position.code]?.at(-1)?.c;
    const latestPrice = bars[position.code]?.at(-1)?.c;
    return settled === undefined || latestPrice === undefined ? sum : sum + position.shares * (latestPrice - settled);
  }, 0);
  // The TAIEX minute replays with its real 5-second values, in step with the stocks; only when the index has the
  // playing minute (an index that stops earlier keeps its completed minutes as they are).
  const indexBars = session.index?.bars;
  const index =
    session.index && indexBars?.length && indexBars[indexBars.length - 1].t === t
      ? { ...session.index, bars: [...indexBars.slice(0, -1), formingIndexBar(indexBars[indexBars.length - 1], fraction)] }
      : session.index;
  return {
    ...session,
    bars,
    ...(index ? { index } : {}),
    equity: session.equity + revaluation,
    replay: { fraction, playedMs, source: session },
  };
}

/** The session one minute earlier: without its newest minute. */
export function withoutNewestMinute(session: MorningState): MorningState {
  const end = (session.cursor - 1) * 60;
  const before = <T extends { t: number }>(list: T[]) => (list.length && list[list.length - 1].t >= end ? list.slice(0, -1) : list);
  return {
    ...session,
    cursor: session.cursor - 1,
    bars: Object.fromEntries(Object.entries(session.bars).map(([code, list]) => [code, before(list)])),
    // At most the minutes before the newest one; an index that stops earlier keeps all of its minutes.
    ...(session.index ? { index: { ...session.index, bars: session.index.bars.filter((bar) => bar.t < end) } } : {}),
  };
}

/** While a minute replays: the server's session without that minute, for alerts, swing highs and minute tables. */
export function settledSession(session: LiveMorningState): MorningState {
  const source = session.replay?.source;
  return source ? withoutNewestMinute(source) : session;
}

/** The newest trade of a stock: the last one the replay has played, or the newest revealed one at rest. */
export function lastTrade(session: LiveMorningState, code: string, _catalog?: ReplayCatalog): LastTrade | null {
  const { tape, cell, count } = shownTrades(session, code);
  const row = count > 0 ? cell[count - 1] : tape[tape.length - 1];
  if (!row) return null;
  return { ...liveTrade(row), index: tape.length + count - 1, second: Math.floor(row[0] / 1000) };
}

/** Seconds after 09:00 on the replay clock: inside the playing minute, or the end of the newest minute. */
export function replayClock(session: LiveMorningState): number {
  return session.replay ? Math.floor(session.replay.playedMs / 1000) : session.cursor * 60;
}

/**
 * How far the desk has played, in ms after 09:00: inside the playing minute, or at rest the last millisecond of the
 * newest minute (its end itself belongs to the minute after). A book is shown at this moment and no later one.
 */
export function replayMs(session: LiveMorningState): number {
  return session.replay ? session.replay.playedMs : session.cursor * CELL_MS - 1;
}

/**
 * The five-level area of one stock now. `book` is what the server sent for the newest minute (one stock's); it only
 * counts for its own stock. Without it, or inside a recording gap, the real best bid and ask of the last played trade.
 */
export function shownBook(
  session: LiveMorningState | null,
  catalog: Pick<MorningCatalog, "booksAvailable">,
  book: MorningBookCell | undefined,
  code: string,
): DisplayedBook {
  return displayBook({
    catalog,
    book: book?.code === code ? book : undefined,
    lastTrade: session ? lastTrade(session, code) : null,
    playedMs: session ? replayMs(session) : 0,
  });
}

/** The close of a stock's newest settled minute: while a minute replays, the one before it. */
function settledClose(session: LiveMorningState, code: string): number | undefined {
  const source = serverSession(session);
  const list = source.bars[code] ?? [];
  const last = list.at(-1);
  if (!session.replay || !last) return last?.c;
  // The server's newest bar is the playing minute's own: its close has not been played yet.
  return last.t >= (source.cursor - 1) * 60 ? list.at(-2)?.c : last.c;
}

/**
 * The price an order ticket starts from and values an order at: the last trade the replay has played, else the
 * newest settled minute's close, else the previous close. Never the playing minute's close before it is reached.
 */
export function referencePrice(session: LiveMorningState | null, code: string, previousClose?: number): number | null {
  if (!session) return null;
  return lastTrade(session, code)?.price ?? settledClose(session, code) ?? previousClose ?? null;
}

/** Trades of one stock, newest first, up to the point the replay has reached. */
export function recentTrades(session: LiveMorningState, code: string, limit: number, _catalog?: ReplayCatalog): RecentTrade[] {
  if (!(limit >= 1)) return [];
  const { tape, cell, count } = shownTrades(session, code);
  // One trade more than shown, so the oldest shown trade still compares with the one before it.
  const wanted = Math.floor(limit) + 1;
  const fromCell = cell.slice(Math.max(0, count - wanted), count);
  const rows = [...tape.slice(Math.max(0, tape.length - (wanted - fromCell.length))), ...fromCell];
  // Trades of the same moment are told apart by how many of them come later: those never change as the tape scrolls.
  const later = new Map<number, number>();
  const ids = rows.map(() => "");
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const ms = rows[i][0];
    const after = later.get(ms) ?? 0;
    ids[i] = `${ms}:${after}`;
    later.set(ms, after + 1);
  }
  const trades = rows.map((row, i): RecentTrade => {
    const before = i > 0 ? rows[i - 1][1] : row[1];
    return {
      ...liveTrade(row),
      id: ids[i],
      second: Math.floor(row[0] / 1000),
      move: row[1] > before ? "up" : row[1] < before ? "down" : "same",
    };
  });
  return trades.slice(-Math.floor(limit)).reverse();
}

/**
 * Whether a new session should play its newest minute: only when the same run moved forward one minute and that
 * minute's trades came with it.
 */
export function replayStep(
  previous: { id: string; cursor: number } | null,
  session: ReplayState | null,
): "play" | "keep" | "rest" {
  if (!previous || !session || previous.id !== session.id) return "rest";
  if (session.cursor === previous.cursor + 1) return playingCell(session) ? "play" : "rest";
  return session.cursor === previous.cursor ? "keep" : "rest";
}

/** Where the replay stands: for which run and minute, how far through it, and when that was measured. */
export type ReplayProgress = { id?: string; cursor?: number; fraction: number; at: number };

/** The progress for a new session: play its newest minute from the start, keep going, or rest on it. */
export function startReplay(previous: ReplayProgress, session: ReplayState | null, now: number): ReplayProgress {
  const step = replayStep(
    previous.id === undefined || previous.cursor === undefined ? null : { id: previous.id, cursor: previous.cursor },
    session,
  );
  const id = session?.id;
  const cursor = session?.cursor;
  if (step === "play") return { id, cursor, fraction: 0, at: now };
  if (step === "keep") return { ...previous, id, cursor };
  return { id, cursor, fraction: 1, at: now };
}

/** Moves the replay on by the time since it was last measured, at the current speed; it never goes back. */
export function advanceReplay(progress: ReplayProgress, now: number, durationMs: number): ReplayProgress {
  const fraction = Math.min(1, progress.fraction + Math.max(0, now - progress.at) / durationMs);
  return { ...progress, fraction, at: now };
}
