// The desk while a newly revealed minute plays out trade by trade (display only; client-side).
//
// The server reveals a whole minute at a time. When the run moves forward one minute, the desk replays that
// minute's generated trades (market/tick-replay.ts) over the next couple of seconds: every stock's newest bar
// grows from its open to its real close, holdings are valued at the latest trade, and the clock runs through
// the minute's seconds. Orders, fills, order defaults, alerts and minute tables come from the server's session
// (serverSession / settledSession), so nothing generated reaches the server and nothing is announced early.
import type { Bar } from "./game/types.ts";
import type { MorningCatalog, MorningState } from "./morning.ts";
import { formingBar, minuteTicks, tickSeed, type Tick } from "./market/tick-replay.ts";

export type LiveMorningState = MorningState & {
  /** Present only while a minute is playing: how far through it, and the server's session. */
  replay?: { fraction: number; source: MorningState };
};

/** What the replay needs from the lesson: each stock's previous close, and whether volume is in lots. */
export type ReplayCatalog = Pick<MorningCatalog, "volumeUnit"> & {
  symbols: readonly Pick<MorningCatalog["symbols"][number], "code" | "previousClose">[];
};

export type LastTrade = Tick & { index: number; second: number };
/** `id` names the trade (minute start and its place in the minute), stable while the tape scrolls. */
export type RecentTrade = Pick<Tick, "price" | "lots" | "side"> & { id: string; second: number; move: "up" | "down" | "same" };

const cache = new Map<string, Tick[]>();

function ticksAt(lessonId: string, catalog: ReplayCatalog, code: string, bars: readonly Bar[], index: number): Tick[] {
  const bar = bars[index];
  const previous = index > 0 ? bars[index - 1].c : (catalog.symbols.find((s) => s.code === code)?.previousClose ?? bar.o);
  // Lot sizes only where the lesson's volume is verified and in lots; otherwise the tape shows none.
  const lots = catalog.volumeUnit === "lot" ? bar.v : null;
  const seed = tickSeed(lessonId, code, Math.round(bar.t / 60));
  const key = `${seed}:${bar.o}:${bar.h}:${bar.l}:${bar.c}:${bar.v}:${previous}:${lots}`;
  let ticks = cache.get(key);
  if (!ticks) {
    ticks = minuteTicks(bar, seed, { previous, lots });
    if (cache.size > 4000) cache.clear();
    cache.set(key, ticks);
  }
  return ticks;
}

/** The server's session behind what the desk shows. */
export function serverSession(session: LiveMorningState): MorningState {
  return session.replay?.source ?? session;
}

const fractionOf = (session: LiveMorningState) => session.replay?.fraction ?? 1;

/** The session as the desk shows it `fraction` of the way through its newest minute; the session itself at 1. */
export function liveSession(session: MorningState, fraction: number, catalog: ReplayCatalog): LiveMorningState {
  if (fraction >= 1) return session;
  const bars = Object.fromEntries(
    Object.entries(session.bars).map(([code, list]) => {
      const last = list.at(-1);
      if (!last) return [code, list];
      const ticks = ticksAt(session.lessonId, catalog, code, list, list.length - 1);
      return [code, [...list.slice(0, -1), formingBar(last, ticks, fraction, list.at(-2)?.a)]];
    }),
  );
  const revaluation = session.positions.reduce((sum, position) => {
    const settled = session.bars[position.code]?.at(-1)?.c;
    const latest = bars[position.code]?.at(-1)?.c;
    return settled === undefined || latest === undefined ? sum : sum + position.shares * (latest - settled);
  }, 0);
  return { ...session, bars, equity: session.equity + revaluation, replay: { fraction, source: session } };
}

/** The session one minute earlier: without its newest minute. */
export function withoutNewestMinute(session: MorningState): MorningState {
  return {
    ...session,
    cursor: session.cursor - 1,
    bars: Object.fromEntries(Object.entries(session.bars).map(([code, list]) => [code, list.slice(0, -1)])),
  };
}

/** While a minute replays: the server's session without that minute, for alerts, swing highs and minute tables. */
export function settledSession(session: LiveMorningState): MorningState {
  const source = session.replay?.source;
  return source ? withoutNewestMinute(source) : session;
}

/** The newest trade of a stock: the one the replay has reached, or the minute's last one at rest. */
export function lastTrade(session: LiveMorningState, code: string, catalog: ReplayCatalog): LastTrade | null {
  const source = serverSession(session);
  const bars = source.bars[code] ?? [];
  if (!bars.length) return null;
  const ticks = ticksAt(source.lessonId, catalog, code, bars, bars.length - 1);
  if (!ticks.length) return null;
  const fraction = fractionOf(session);
  let index = 0;
  for (let i = 1; i < ticks.length; i++) if (ticks[i].at <= fraction) index = i;
  return { ...ticks[index], index, second: bars[bars.length - 1].t + Math.floor(ticks[index].at * 60) };
}

/** Seconds after 09:00 on the replay clock: inside the playing minute, or the end of the newest minute. */
export function replayClock(session: LiveMorningState): number {
  const fraction = fractionOf(session);
  const bar = Object.values(serverSession(session).bars).find((list) => list.length)?.at(-1);
  return fraction < 1 && bar ? bar.t + Math.floor(fraction * 60) : session.cursor * 60;
}

/** Trades of one stock, newest first, up to the point the replay has reached. */
export function recentTrades(session: LiveMorningState, code: string, limit: number, catalog: ReplayCatalog): RecentTrade[] {
  const source = serverSession(session);
  const fraction = fractionOf(session);
  const bars = source.bars[code] ?? [];
  const minutes: Omit<RecentTrade, "move">[][] = [];
  let count = 0;
  // One trade more than shown, so the oldest shown trade still compares with the one before it.
  for (let i = bars.length - 1; i >= 0 && count <= limit; i--) {
    const ticks = ticksAt(source.lessonId, catalog, code, bars, i);
    const shown = i === bars.length - 1 ? ticks.filter((tick, k) => k === 0 || tick.at <= fraction) : ticks;
    minutes.unshift(
      shown.map((tick, k) => ({
        id: `${bars[i].t}:${k}`,
        second: bars[i].t + Math.floor(tick.at * 60),
        price: tick.price,
        lots: tick.lots,
        side: tick.side,
      })),
    );
    count += shown.length;
  }
  const trades = minutes.flat().map((trade, i, all): RecentTrade => {
    const before = all[i - 1]?.price ?? trade.price;
    return { ...trade, move: trade.price > before ? "up" : trade.price < before ? "down" : "same" };
  });
  return trades.slice(-limit).reverse();
}

/** Whether a new session should play its newest minute: only when the same run moved forward one minute. */
export function replayStep(
  previous: { id: string; cursor: number } | null,
  session: MorningState | null,
): "play" | "keep" | "rest" {
  if (!previous || !session || previous.id !== session.id) return "rest";
  if (session.cursor === previous.cursor + 1) return "play";
  return session.cursor === previous.cursor ? "keep" : "rest";
}

/** Where the replay stands: for which run and minute, how far through it, and when that was measured. */
export type ReplayProgress = { id?: string; cursor?: number; fraction: number; at: number };

/** The progress for a new session: play its newest minute from the start, keep going, or rest on it. */
export function startReplay(previous: ReplayProgress, session: MorningState | null, now: number): ReplayProgress {
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
