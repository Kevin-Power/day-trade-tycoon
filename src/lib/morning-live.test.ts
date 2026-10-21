import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "./game/types.ts";
import type { MorningState } from "./morning.ts";
import { createMorningBook } from "./morning-book.ts";
import {
  advanceReplay,
  lastTrade,
  liveSession,
  recentTrades,
  replayClock,
  replayStep,
  serverSession,
  settledSession,
  startReplay,
  type ReplayCatalog,
  withoutNewestMinute,
} from "./morning-live.ts";
import { minuteTicks, tickSeed } from "./market/tick-replay.ts";

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t, o, h, l, c, v });
const BARS: Record<string, Bar[]> = {
  "2317": [bar(0, 263, 266.5, 263, 264.5, 900_000), bar(60, 265, 265, 261.5, 263, 3_951_000), bar(120, 263.5, 263.5, 261.5, 261.5, 2_183_000)],
  "2330": [bar(0, 2580, 2590, 2575, 2585, 2_100_000), bar(60, 2585, 2590, 2580, 2580, 900_000), bar(120, 2580, 2595, 2575, 2590, 1_300_000)],
};
// The real lessons: volume not yet verified, so no lot sizes.
const CATALOG: ReplayCatalog = { symbols: [{ code: "2317", previousClose: 254 }, { code: "2330", previousClose: 2575 }] };
const IN_LOTS: ReplayCatalog = { ...CATALOG, volumeUnit: "lot" };
const session = (over: Partial<MorningState> = {}): MorningState => ({
  id: "run-1",
  lessonId: "lesson",
  cursor: 3,
  revision: 9,
  plan: { focusCode: "2317" } as MorningState["plan"],
  bars: BARS,
  startingCash: 10_000_000,
  cash: 9_000_000,
  equity: 9_000_000 + 2000 * 261.5,
  positions: [{ code: "2317", shares: 2000, averageCost: 263 }],
  orders: [],
  fills: [],
  completed: false,
  reflection: "",
  nextAdvanceAt: 0,
  ...over,
});
const ticksOf = (code: string, minute: number, lots: number | null = null) =>
  minuteTicks(BARS[code][minute], tickSeed("lesson", code, minute), {
    previous: minute > 0 ? BARS[code][minute - 1].c : CATALOG.symbols.find((s) => s.code === code)!.previousClose,
    lots,
  });

test("at rest the desk shows the session itself, so nothing re-renders for the replay", () => {
  const s = session();
  assert.equal(liveSession(s, 1, CATALOG), s);
  assert.equal(settledSession(s), s);
  assert.equal(serverSession(s), s);
});

test("part-way through a minute every stock's newest bar is still forming; the rest of the session is untouched", () => {
  const s = session();
  const live = liveSession(s, 0.5, CATALOG);
  for (const code of ["2317", "2330"]) {
    assert.deepEqual(live.bars[code].slice(0, 2), BARS[code].slice(0, 2));
    const seen = ticksOf(code, 2).filter((t, i) => i === 0 || t.at <= 0.5);
    assert.equal(live.bars[code][2].c, seen.at(-1)!.price);
    assert.equal(live.bars[code][2].t, 120);
  }
  for (const key of ["id", "cursor", "revision", "cash", "orders", "fills", "positions"] as const)
    assert.deepEqual(live[key], s[key]);
  assert.equal(live.replay?.fraction, 0.5);
  assert.equal(serverSession(live), s, "orders and their defaults use the server's session");
  // Holdings are valued at the latest trade, and land back on the server's value when the minute closes.
  assert.equal(live.equity, s.equity + 2000 * (live.bars["2317"][2].c - 261.5));
});

test("while a minute replays, alerts, swing highs and minute tables see only the minutes before it", () => {
  const settled = settledSession(liveSession(session(), 0.3, CATALOG));
  assert.equal(settled.cursor, 2);
  for (const code of ["2317", "2330"]) assert.deepEqual(settled.bars[code], BARS[code].slice(0, 2));
});

test("the latest trade and the replay clock follow the playing minute, and rest on its close", () => {
  const s = session();
  const ticks = ticksOf("2317", 2);
  const mid = ticks[Math.floor(ticks.length / 2)];
  const live = liveSession(s, mid.at, CATALOG);
  const trade = lastTrade(live, "2317", CATALOG)!;
  assert.equal(trade.price, mid.price);
  assert.equal(trade.side, mid.side);
  assert.equal(trade.second, 120 + Math.floor(mid.at * 60));
  assert.equal(replayClock(live), 120 + Math.floor(mid.at * 60));
  const rest = lastTrade(s, "2317", CATALOG)!;
  assert.equal(rest.price, 261.5);
  assert.equal(rest.index, ticks.length - 1);
  assert.equal(replayClock(s), 180);
  assert.equal(lastTrade(session({ cursor: 0, bars: { "2317": [] } }), "2317", CATALOG), null);
});

test("the first minute opens against the previous session's close", () => {
  const first = session({ cursor: 1, bars: { "2317": BARS["2317"].slice(0, 1), "2330": BARS["2330"].slice(0, 1) } });
  // 263 opened above the previous close of 254: the opening trade lifted the ask.
  assert.equal(lastTrade(liveSession(first, 0, CATALOG), "2317", CATALOG)!.side, "ask");
});

test("recent trades run newest first across minutes and never show a trade the replay has not reached", () => {
  const live = liveSession(session(), 0.4, CATALOG);
  const trades = recentTrades(live, "2317", 30, CATALOG);
  assert.ok(trades.length <= 30);
  for (let i = 1; i < trades.length; i++) assert.ok(trades[i].second <= trades[i - 1].second);
  const playing = ticksOf("2317", 2).filter((t, i) => i === 0 || t.at <= 0.4);
  assert.equal(trades.filter((t) => t.second >= 120).length, playing.length);
  assert.equal(trades[0].price, playing.at(-1)!.price);
  assert.ok(trades.every((t) => t.lots === 0), "no sizes from unverified volume");
  assert.ok(recentTrades(session(), "2317", 30, IN_LOTS).some((t) => t.lots > 0), "sizes when the lesson's volume is in lots");
  const all = recentTrades(session(), "2317", 1000, CATALOG).reverse();
  for (let i = 1; i < all.length; i++) {
    const move = all[i].price > all[i - 1].price ? "up" : all[i].price < all[i - 1].price ? "down" : "same";
    assert.equal(all[i].move, move);
  }
});

test("a new minute plays only when the run moves forward exactly one minute", () => {
  const before = { id: "run-1", cursor: 3 };
  assert.equal(replayStep(null, session({ cursor: 3 })), "rest");
  assert.equal(replayStep(before, session({ cursor: 4 })), "play");
  assert.equal(replayStep(before, session({ cursor: 3, revision: 10 })), "keep");
  assert.equal(replayStep(before, session({ cursor: 6 })), "rest");
  assert.equal(replayStep(before, session({ cursor: 2 })), "rest");
  assert.equal(replayStep(before, session({ id: "run-2", cursor: 4 })), "rest");
  assert.equal(replayStep(before, null), "rest");
});

test("replay progress starts with the new minute, runs at the current speed and never rewinds", () => {
  const resting = startReplay({ fraction: 1, at: 0 }, session({ cursor: 3 }), 1000);
  assert.deepEqual(resting, { id: "run-1", cursor: 3, fraction: 1, at: 1000 });
  const playing = startReplay(resting, session({ cursor: 4 }), 2000);
  assert.deepEqual(playing, { id: "run-1", cursor: 4, fraction: 0, at: 2000 });
  const at1x = advanceReplay(playing, 2900, 1800);
  assert.equal(at1x.fraction, 0.5);
  // Switching to 2x halfway: the replay carries on from where it is, only faster.
  const at2x = advanceReplay(at1x, 3350, 900);
  assert.equal(at2x.fraction, 1);
  assert.equal(advanceReplay(advanceReplay(playing, 2900, 1800), 2950, 3600).fraction > 0.5, true);
});

test("the teaching book follows the latest trade: an uptick lifted the ask, a downtick hit the bid", () => {
  const lifted = createMorningBook("2317", 3, 262, 254, { index: 4, side: "ask" });
  assert.equal(lifted.asks[0].price, 262);
  assert.equal(lifted.bids[0].price, 261.5);
  const hit = createMorningBook("2317", 3, 262, 254, { index: 4, side: "bid" });
  assert.equal(hit.bids[0].price, 262);
  assert.equal(hit.asks[0].price, 262.5);
  const next = createMorningBook("2317", 3, 262, 254, { index: 5, side: "bid" });
  assert.notDeepEqual(next.bids.map((l) => l.lots), hit.bids.map((l) => l.lots));
  assert.deepEqual(createMorningBook("2317", 3, 262, 254, { index: 5, side: "bid" }), next);
});

const indexBar = (minute: number) => {
  const p = Array.from({ length: 12 }, (_, point) => 49700 + minute * 10 + ((point * 7) % 12));
  return { t: minute * 60, o: p[0], h: Math.max(...p), l: Math.min(...p), c: p[11], p };
};
const INDEX = {
  code: "TAIEX" as const,
  name: "加權指數",
  previousClose: 49712.04,
  source: "fixture",
  bars: [indexBar(0), indexBar(1), indexBar(2)],
};

test("while a minute replays, the index's newest minute shows its real 5-second values so far", () => {
  const live = liveSession(session({ index: INDEX }), 0.25, CATALOG);
  const newest = live.index!.bars.at(-1)!;
  assert.equal(newest.c, INDEX.bars[2].p[2]);
  assert.equal(newest.h, Math.max(...INDEX.bars[2].p.slice(0, 3)));
  assert.deepEqual(live.index!.bars.slice(0, 2), INDEX.bars.slice(0, 2));
  assert.deepEqual(serverSession(live).index, INDEX);
});

test("a run without index data replays and settles without one", () => {
  const live = liveSession(session(), 0.4, CATALOG);
  assert.equal(live.index, undefined);
  assert.equal(withoutNewestMinute(session()).index, undefined);
  assert.equal(settledSession(live).index, undefined);
});

test("the settled run leaves out the replaying index minute too", () => {
  assert.equal(withoutNewestMinute(session({ index: INDEX })).index!.bars.length, 2);
  assert.equal(settledSession(liveSession(session({ index: INDEX }), 0.5, CATALOG)).index!.bars.length, 2);
});

// A lesson whose index stops before the run (not the case today) must not replay or drop an older minute.
test("an index shorter than the run is never replayed or trimmed as the playing minute", () => {
  const short = { ...INDEX, bars: INDEX.bars.slice(0, 2) };
  assert.deepEqual(liveSession(session({ index: short }), 0.25, CATALOG).index, short);
  assert.deepEqual(withoutNewestMinute(session({ index: short })).index, short);
});
