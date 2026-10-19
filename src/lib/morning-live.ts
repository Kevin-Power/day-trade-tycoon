// The desk while a newly revealed minute plays out trade by trade (display only; client-side).
//
// The server reveals a whole minute at a time. When the run moves forward one minute, the desk replays that
// minute's generated trades (market/tick-replay.ts) over the next couple of seconds: every stock's newest bar
// grows from its open to its real close, holdings are valued at the latest trade, and the clock runs through
// the minute's seconds. Orders, fills and revisions always come from the server's session.
import type { Bar } from "./game/types.ts";
import type { MorningState } from "./morning.ts";
import { formingBar, minuteTicks, tickSeed, type Tick } from "./market/tick-replay.ts";

export type LiveMorningState = MorningState & {
  /** Present only while a minute is playing: how far through it, and the server's session. */
  replay?: { fraction: number; source: MorningState };
};

export type LastTrade = Tick & { index: number; second: number };
/** `id` names the trade (minute start and its place in the minute), stable while the tape scrolls. */
export type RecentTrade = Pick<Tick, "price" | "lots" | "side"> & { id: string; second: number; move: "up" | "down" | "same" };

const cache = new Map<string, Tick[]>();

function ticksOf(lessonId: string, code: string, bar: Bar): Tick[] {
  const seed = tickSeed(lessonId, code, Math.round(bar.t / 60));
  const key = `${seed}:${bar.o}:${bar.h}:${bar.l}:${bar.c}:${bar.v}`;
  let ticks = cache.get(key);
  if (!ticks) {
    ticks = minuteTicks(bar, seed);
    if (cache.size > 4000) cache.clear();
    cache.set(key, ticks);
  }
  return ticks;
}

const sourceOf = (session: LiveMorningState) => session.replay?.source ?? session;
const fractionOf = (session: LiveMorningState) => session.replay?.fraction ?? 1;

/** The session as the desk shows it `fraction` of the way through its newest minute; the session itself at 1. */
export function liveSession(session: MorningState, fraction: number): LiveMorningState {
  if (fraction >= 1) return session;
  const bars = Object.fromEntries(
    Object.entries(session.bars).map(([code, list]) => {
      const last = list.at(-1);
      return [code, last ? [...list.slice(0, -1), formingBar(last, ticksOf(session.lessonId, code, last), fraction)] : list];
    }),
  );
  const revaluation = session.positions.reduce((sum, position) => {
    const settled = session.bars[position.code]?.at(-1)?.c;
    const latest = bars[position.code]?.at(-1)?.c;
    return settled === undefined || latest === undefined ? sum : sum + position.shares * (latest - settled);
  }, 0);
  return { ...session, bars, equity: session.equity + revaluation, replay: { fraction, source: session } };
}

/** The newest trade of a stock: the one the replay has reached, or the minute's last one at rest. */
export function lastTrade(session: LiveMorningState, code: string): LastTrade | null {
  const source = sourceOf(session);
  const bar = source.bars[code]?.at(-1);
  if (!bar) return null;
  const ticks = ticksOf(source.lessonId, code, bar);
  const fraction = fractionOf(session);
  let index = 0;
  for (let i = 1; i < ticks.length; i++) if (ticks[i].at <= fraction) index = i;
  return { ...ticks[index], index, second: bar.t + Math.floor(ticks[index].at * 60) };
}

/** Seconds after 09:00 on the replay clock: inside the playing minute, or the end of the newest minute. */
export function replayClock(session: LiveMorningState): number {
  const fraction = fractionOf(session);
  const source = sourceOf(session);
  const bar = Object.values(source.bars).find((list) => list.length)?.at(-1);
  return fraction < 1 && bar ? bar.t + Math.floor(fraction * 60) : session.cursor * 60;
}

/** Trades of one stock, newest first, up to the point the replay has reached. */
export function recentTrades(session: LiveMorningState, code: string, limit: number): RecentTrade[] {
  const source = sourceOf(session);
  const fraction = fractionOf(session);
  const bars = source.bars[code] ?? [];
  const minutes: Omit<RecentTrade, "move">[][] = [];
  let count = 0;
  // One trade more than shown, so the oldest shown trade still compares with the one before it.
  for (let i = bars.length - 1; i >= 0 && count <= limit; i--) {
    const ticks = ticksOf(source.lessonId, code, bars[i]);
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
