// Trade-by-trade replay of one real 1-minute bar, for display only.
//
// The lesson data has 1-minute OHLCV bars, not the exchange's trade records, so the trades inside a minute
// are generated: they open at the real open, visit the real low and high (the nearer extreme first), close
// at the real close, stay on the TWSE price grid and add up to the real volume. The same lesson, stock and
// minute always give the same trades. Paper orders still fill at later minute opens on the server; nothing
// here feeds matching.
import type { Bar } from "../game/types.ts";
import { stepTick } from "./ticks.ts";

export type Tick = {
  /** Fraction of the minute, 0 < at < 1. */
  at: number;
  price: number;
  /** Lots of 1,000 shares; 0 when the minute has no recorded volume. */
  lots: number;
  /** Uptick trades lift the ask (外盤), downticks hit the bid (內盤); unchanged prices keep the last side. */
  side: "ask" | "bid";
};

const MAX_STEPS_PER_LEG = 10;
const MAX_BACKSTEPS_PER_LEG = 3;
const MAX_TRADES = 60;

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

/** Whole ticks from `from` to `to` (positive upward), counted on the TWSE grid. */
function ticksBetween(from: number, to: number): number {
  const dir = Math.sign(to - from);
  let count = 0;
  for (let p = from; dir > 0 ? p < to : p > to; p = stepTick(p, dir)) {
    if (p === 0 || ++count > 10_000) break;
  }
  return dir * count;
}

function move(price: number, ticks: number): number {
  let p = price;
  for (let i = 0; i < Math.abs(ticks); i++) p = stepTick(p, Math.sign(ticks));
  return p;
}

function pricePath(bar: Bar, rand: () => number): number[] {
  const legs = bar.c >= bar.o ? [bar.l, bar.h, bar.c] : [bar.h, bar.l, bar.c];
  const path = [bar.o];
  const sameAgain = () => rand() < 0.3 && path.push(path[path.length - 1]);
  for (const target of legs) {
    let backsteps = 0;
    // Fast minutes skip levels, as real trades do, so a wide minute stays a readable number of trades.
    const stride = Math.max(1, Math.ceil(Math.abs(ticksBetween(path[path.length - 1], target)) / MAX_STEPS_PER_LEG));
    while (path[path.length - 1] !== target) {
      const here = path[path.length - 1];
      const distance = ticksBetween(here, target);
      let next = move(here, Math.sign(distance) * Math.min(stride, Math.abs(distance)));
      if (Math.abs(distance) > 1 && backsteps < MAX_BACKSTEPS_PER_LEG && rand() < 0.25) {
        const back = move(here, -Math.sign(distance));
        if (back >= bar.l && back <= bar.h) {
          next = back;
          backsteps++;
        }
      }
      path.push(next);
      sameAgain();
    }
  }
  while (path.length < 2) path.push(bar.o);
  // Drop same-price repeats first if a very wide minute still has too many trades.
  for (let i = path.length - 2; path.length > MAX_TRADES && i > 0; i--) if (path[i] === path[i - 1]) path.splice(i, 1);
  return path;
}

function splitLots(total: number, count: number, rand: () => number): number[] {
  if (total <= 0) return Array(count).fill(0);
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
  // Bursts and pauses: exponential gaps, some stretched, spread over 1%..96% of the minute.
  const gaps = Array.from({ length: count }, () => Math.max(1e-3, -Math.log(1 - rand() * 0.98) * (rand() < 0.2 ? 3 : 1)));
  const total = gaps.reduce((s, g) => s + g, 0);
  let running = 0;
  return gaps.map((g) => {
    running += g;
    return 0.01 + 0.95 * (running / total);
  });
}

export function minuteTicks(bar: Bar, seed: string): Tick[] {
  const rand = random(seed);
  const prices = pricePath(bar, rand);
  const times = tradeTimes(prices.length, rand);
  const lots = splitLots(Math.round(bar.v / 1000), prices.length, rand);
  let side: Tick["side"] = bar.c >= bar.o ? "ask" : "bid";
  return prices.map((price, i) => {
    if (i > 0 && price !== prices[i - 1]) side = price > prices[i - 1] ? "ask" : "bid";
    return { at: times[i], price, lots: lots[i], side };
  });
}

/**
 * The bar as it stands `fraction` of the way through its minute. The opening trade shows from the start, so
 * the bar never disappears; at the end it is exactly the real bar.
 */
export function formingBar(bar: Bar, ticks: Tick[], fraction: number): Bar {
  if (fraction >= 1 || !ticks.length) return { ...bar };
  const seen = ticks.filter((tick, i) => i === 0 || tick.at <= fraction);
  const prices = seen.map((tick) => tick.price);
  return {
    ...bar,
    o: prices[0],
    h: Math.max(...prices),
    l: Math.min(...prices),
    c: prices[prices.length - 1],
    v: Math.min(bar.v, seen.reduce((s, tick) => s + tick.lots, 0) * 1000),
  };
}
