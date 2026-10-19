import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "./game/types.ts";
import type { MorningState } from "./morning.ts";
import { createMorningBook } from "./morning-book.ts";
import { lastTrade, liveSession, recentTrades, replayClock, replayStep } from "./morning-live.ts";
import { minuteTicks, tickSeed } from "./market/tick-replay.ts";

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t, o, h, l, c, v });
const BARS: Record<string, Bar[]> = {
  "2317": [bar(0, 263, 266.5, 263, 264.5, 900_000), bar(60, 265, 265, 261.5, 263, 3_951_000), bar(120, 263.5, 263.5, 261.5, 261.5, 2_183_000)],
  "2330": [bar(0, 2580, 2590, 2575, 2585, 2_100_000), bar(60, 2585, 2590, 2580, 2580, 900_000), bar(120, 2580, 2595, 2575, 2590, 1_300_000)],
};
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
const ticksOf = (code: string, minute: number) => minuteTicks(BARS[code][minute], tickSeed("lesson", code, minute));

test("at rest the desk shows the session itself, so nothing re-renders for the replay", () => {
  const s = session();
  assert.equal(liveSession(s, 1), s);
});

test("part-way through a minute every stock's newest bar is still forming; the rest of the session is untouched", () => {
  const s = session();
  const live = liveSession(s, 0.5);
  for (const code of ["2317", "2330"]) {
    assert.deepEqual(live.bars[code].slice(0, 2), BARS[code].slice(0, 2));
    const seen = ticksOf(code, 2).filter((t, i) => i === 0 || t.at <= 0.5);
    assert.equal(live.bars[code][2].c, seen.at(-1)!.price);
    assert.equal(live.bars[code][2].t, 120);
  }
  for (const key of ["id", "cursor", "revision", "cash", "orders", "fills", "positions"] as const)
    assert.deepEqual(live[key], s[key]);
  assert.equal(live.replay?.fraction, 0.5);
  assert.equal(live.replay?.source, s, "the server's session stays at hand for trades and orders");
  // Holdings are valued at the latest trade, and land back on the server's value when the minute closes.
  assert.equal(live.equity, s.equity + 2000 * (live.bars["2317"][2].c - 261.5));
});

test("the latest trade and the replay clock follow the playing minute, and rest on its close", () => {
  const s = session();
  const ticks = ticksOf("2317", 2);
  const mid = ticks[Math.floor(ticks.length / 2)];
  const live = liveSession(s, mid.at);
  const trade = lastTrade(live, "2317")!;
  assert.equal(trade.price, mid.price);
  assert.equal(trade.side, mid.side);
  assert.equal(trade.second, 120 + Math.floor(mid.at * 60));
  assert.equal(replayClock(live), 120 + Math.floor(mid.at * 60));
  const rest = lastTrade(s, "2317")!;
  assert.equal(rest.price, 261.5);
  assert.equal(rest.index, ticks.length - 1);
  assert.equal(replayClock(s), 180);
  assert.equal(lastTrade(session({ cursor: 0, bars: { "2317": [] } }), "2317"), null);
});

test("recent trades run newest first across minutes and never show a trade the replay has not reached", () => {
  const live = liveSession(session(), 0.4);
  const trades = recentTrades(live, "2317", 30);
  assert.ok(trades.length <= 30);
  for (let i = 1; i < trades.length; i++) assert.ok(trades[i].second <= trades[i - 1].second);
  const playing = ticksOf("2317", 2).filter((t, i) => i === 0 || t.at <= 0.4);
  assert.equal(trades.filter((t) => t.second >= 120).length, playing.length);
  assert.equal(trades[0].price, playing.at(-1)!.price);
  // Each trade compares with the one before it, also across a minute boundary.
  const all = recentTrades(session(), "2317", 1000).reverse();
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

test("the teaching book follows the latest trade: an uptick lifted the ask, a downtick hit the bid", () => {
  const lifted = createMorningBook("2317", 3, 262, 254, { index: 4, side: "ask" });
  assert.equal(lifted.asks[0].price, 262);
  assert.equal(lifted.bids[0].price, 261.5);
  const hit = createMorningBook("2317", 3, 262, 254, { index: 4, side: "bid" });
  assert.equal(hit.bids[0].price, 262);
  assert.equal(hit.asks[0].price, 262.5);
  // Quantities move from trade to trade, the same way every time.
  const next = createMorningBook("2317", 3, 262, 254, { index: 5, side: "bid" });
  assert.notDeepEqual(next.bids.map((l) => l.lots), hit.bids.map((l) => l.lots));
  assert.deepEqual(createMorningBook("2317", 3, 262, 254, { index: 5, side: "bid" }), next);
});
