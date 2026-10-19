// Trade-by-trade replay of one real 1-minute bar, for display only.
//
// The lesson data has 1-minute OHLCV bars, not the exchange's trade records, so the trades inside a minute
// are generated: they open at the real open, visit the real low and high, close at the real close, stay on
// the TWSE price grid and add up to the lesson's volume. Nothing in them gives away how the minute ends: the
// opening trade's side follows the open against the previous trade, and which extreme comes first is drawn
// (the nearer one more often). The same lesson, stock and minute always give the same trades. Paper orders
// still fill at later minute opens on the server; nothing here feeds matching.
import type { Bar } from "../game/types.ts";
import { roundToTick, stepTick } from "./ticks.ts";

export type Tick = {
  /** Fraction of the minute, 0 < at < 1. */
  at: number;
  price: number;
  /** Lots of 1,000 shares; 0 when the lesson's volume is unverified or the minute has none. */
  lots: number;
  /** Uptick trades lift the ask (外盤), downticks hit the bid (內盤); unchanged prices keep the last side. */
  side: "ask" | "bid";
};

export type MinuteContext = {
  /** The trade before this minute: the previous minute's close, or the previous session's close. */
  previous: number;
  /** The minute's volume in lots, or null when the lesson's volume is unverified. */
  lots: number | null;
};

const MAX_STEPS_PER_LEG = 10;
const MAX_BACKSTEPS_PER_LEG = 3;
const MAX_TRADES = 60;
const MAX_TICKS_COUNTED = 2_000;

export function tickSeed(lessonId: string, code: string, minute: number): string {
  return `${lessonId}:${code}:${minute}`;
}

function random(seed: string): () => number {
  // FNV-1a hash into mulberry32.
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole ticks from `from` to `to` (positive upward), both on the TWSE grid; capped so it always ends. */
function ticksBetween(from: number, to: number): number {
  const dir = Math.sign(to - from);
  let count = 0;
  for (let p = from; p > 0 && count < MAX_TICKS_COUNTED && (dir > 0 ? p < to : p > to); p = stepTick(p, dir)) count++;
  return dir * count;
}

/** How many trades a minute shows: more with more volume, between 10 and 22 when it traded at all. */
function busyTrades(lots: number): number {
  return lots <= 0 ? 2 : Math.min(22, Math.max(10, 6 + Math.round(Math.sqrt(lots) / 3)));
}

/** The grid prices inside [low, high]: the lowest legal price at or above low, the highest at or below high. */
function gridRange(low: number, high: number): [number, number] | null {
  let floor = roundToTick(low);
  if (floor < low) floor = stepTick(floor, 1);
  let ceiling = roundToTick(high);
  if (ceiling > high) ceiling = stepTick(ceiling, -1);
  return floor > 0 && ceiling > 0 && floor <= ceiling ? [floor, ceiling] : null;
}

function pricePath(bar: Bar, rand: () => number, busy: number): number[] {
  const range = gridRange(bar.l, bar.h);
  // A minute narrower than one tick (only possible off the grid): the open and the close are the trades.
  if (!range) return [bar.o, bar.c];
  const [low, high] = range;
  const clamp = (price: number) => Math.min(high, Math.max(low, price));
  const open = clamp(roundToTick(bar.o));
  const fromOpenUp = ticksBetween(open, high);
  const fromOpenDown = -ticksBetween(open, low);
  // The nearer extreme comes first more often, but either can.
  const lowFirst = fromOpenUp + fromOpenDown === 0 ? rand() < 0.5 : rand() < fromOpenUp / (fromOpenUp + fromOpenDown);
  const legs = [lowFirst ? low : high, lowFirst ? high : low, clamp(roundToTick(bar.c))];
  const path = [open];
  for (const target of legs) {
    let backsteps = 0;
    // Fast minutes skip levels, as real trades do, so a wide minute stays a readable number of trades.
    const stride = Math.max(1, Math.ceil(Math.abs(ticksBetween(path[path.length - 1], target)) / MAX_STEPS_PER_LEG));
    for (let guard = 0; path[path.length - 1] !== target && guard < 4 * MAX_STEPS_PER_LEG; guard++) {
      const here = path[path.length - 1];
      const distance = ticksBetween(here, target);
      let next = clamp(stepTick(here, Math.sign(distance) * Math.min(stride, Math.abs(distance))));
      if (Math.abs(distance) > 1 && backsteps < MAX_BACKSTEPS_PER_LEG && rand() < 0.25) {
        next = clamp(stepTick(here, -Math.sign(distance)));
        backsteps++;
      }
      path.push(next);
      if (rand() < 0.3) path.push(next);
    }
    if (path[path.length - 1] !== target) path.push(target);
  }
  // A busy minute trades often even when its range is one or two ticks: fill in trades at the same price or
  // bouncing one tick between bid and ask, turning back at the edge of the range.
  while (path.length < busy) {
    const at = 1 + Math.floor(rand() * (path.length - 1));
    const before = path[at - 1];
    let price = before;
    if (rand() < 0.6) {
      const dir = rand() < 0.5 ? 1 : -1;
      const there = stepTick(before, dir);
      const back = stepTick(before, -dir);
      price = there >= low && there <= high ? there : back >= low && back <= high ? back : before;
    }
    path.splice(Math.max(1, at), 0, price);
  }
  // Drop same-price repeats first if a very wide minute still has too many trades.
  for (let i = path.length - 2; path.length > MAX_TRADES && i > 0; i--) if (path[i] === path[i - 1]) path.splice(i, 1);
  // The real open and close, even where the source is off the grid.
  path[0] = bar.o;
  path[path.length - 1] = bar.c;
  return path;
}

function splitLots(total: number | null, count: number, rand: () => number): number[] {
  if (!total || total <= 0) return Array(count).fill(0);
  const base = total >= count ? 1 : 0;
  const rest = total - base * count;
  // Heavy-tailed sizes: most trades are small, a few are blocks.
  const weights = Array.from({ length: count }, () => 0.2 + rand() ** 3 * 6);
  const sum = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (w / sum) * rest);
  const lots = exact.map((x) => base + Math.floor(x));
  let left = total - lots.reduce((s, l) => s + l, 0);
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % count, left--) lots[byRemainder[k][1]]++;
  return lots;
}

function tradeTimes(count: number, rand: () => number): number[] {
  // The open trades in the minute's first second; the rest come in bursts and pauses up to 96% of it.
  const gaps = Array.from({ length: count - 1 }, () => Math.max(1e-3, -Math.log(1 - rand() * 0.98) * (rand() < 0.2 ? 3 : 1)));
  const total = gaps.reduce((s, g) => s + g, 0);
  let running = 0;
  return [
    0.005,
    ...gaps.map((g) => {
      running += g;
      return 0.02 + 0.94 * (running / total);
    }),
  ];
}

export function minuteTicks(bar: Bar, seed: string, context: MinuteContext): Tick[] {
  const prices = [bar.o, bar.h, bar.l, bar.c];
  if (!prices.every((p) => Number.isFinite(p) && p > 0) || bar.l > bar.h || bar.o < bar.l || bar.o > bar.h || bar.c < bar.l || bar.c > bar.h)
    return [];
  const rand = random(seed);
  const lots = context.lots === null ? null : Math.max(0, Math.round(context.lots));
  const basis = lots ?? Math.round(bar.v / 1000);
  // Every trade is at least one lot: a thin minute shows fewer trades rather than empty ones.
  const busy = lots !== null && lots > 0 ? Math.min(busyTrades(basis), Math.max(2, lots)) : busyTrades(basis);
  const path = pricePath(bar, rand, busy);
  const times = tradeTimes(path.length, rand);
  const sizes = splitLots(lots, path.length, rand);
  let side: Tick["side"] =
    bar.o > context.previous ? "ask" : bar.o < context.previous ? "bid" : rand() < 0.5 ? "ask" : "bid";
  return path.map((price, i) => {
    if (i > 0 && price !== path[i - 1]) side = price > path[i - 1] ? "ask" : "bid";
    return { at: times[i], price, lots: sizes[i], side };
  });
}

/**
 * The bar as it stands `fraction` of the way through its minute. The opening trade shows from the start, so
 * the bar never disappears; the volume grows with the trades and reaches the real figure with the last one;
 * the session average stays at `previousAverage` until the minute closes. At the end it is exactly the real bar.
 */
export function formingBar(bar: Bar, ticks: Tick[], fraction: number, previousAverage?: number): Bar {
  if (fraction >= 1 || !ticks.length) return { ...bar };
  const seen = ticks.filter((tick, i) => i === 0 || tick.at <= fraction);
  const prices = seen.map((tick) => tick.price);
  const totalLots = ticks.reduce((s, tick) => s + tick.lots, 0);
  const share = totalLots > 0 ? seen.reduce((s, tick) => s + tick.lots, 0) / totalLots : seen.length / ticks.length;
  const forming: Bar = {
    ...bar,
    o: prices[0],
    h: Math.max(...prices),
    l: Math.min(...prices),
    c: prices[prices.length - 1],
    v: Math.round(bar.v * share),
  };
  if (bar.a !== undefined) forming.a = previousAverage ?? bar.o;
  return forming;
}
