import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "./game/types.ts";
import type { TradeRow } from "./lessons/trades.ts";
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
import type { ReplayState } from "./market/real-replay.ts";

const bar = (t: number, o: number, h: number, l: number, c: number, v: number, a: number): Bar => ({ t, o, h, l, c, v, a });
const row = (ms: number, price: number, size: number, bid: number | null, ask: number | null): TradeRow => [
  ms,
  price,
  size,
  bid,
  ask,
];
// 2317 traded from 09:00; 2330's first trade is at 09:02:20, inside the minute the run just revealed.
const TAPE: Record<string, TradeRow[]> = {
  "2317": [row(1_000, 100, 3, null, 100), row(40_000, 101, 2, 100.5, 101), row(61_000, 101, 1, 101, 101.5), row(100_000, 100.5, 3, 100.5, 101)],
  "2330": [],
};
const PLAYING: Record<string, TradeRow[]> = {
  "2317": [
    row(122_000, 100.5, 1, 100, 100.5),
    row(135_000, 101, 2, 101, 101.5),
    row(135_000, 102, 1, 101.5, 102),
    row(170_000, 101.5, 2, 101, 102),
  ],
  "2330": [row(140_000, 1000, 1, null, null), row(150_000, 1005, 2, 1000, 1005)],
};
const BARS: Record<string, Bar[]> = {
  "2317": [bar(0, 100, 101, 100, 101, 5, 100.4), bar(60, 101, 101, 100.5, 100.5, 4, 100.5), bar(120, 100.5, 102, 100.5, 101.5, 6, 100.8)],
  "2330": [bar(120, 1000, 1005, 1000, 1005, 3, 1003.33)],
};
const CATALOG: ReplayCatalog = { symbols: [{ code: "2317", previousClose: 99 }, { code: "2330", previousClose: 990 }] };
const session = (over: Partial<ReplayState> = {}): ReplayState => ({
  id: "run-1",
  lessonId: "fubon-20261027-am",
  cursor: 3,
  revision: 9,
  plan: { focusCode: "2317" } as ReplayState["plan"],
  codes: ["2317", "2330"],
  bars: BARS,
  startingCash: 10_000_000,
  cash: 9_800_000,
  equity: 9_800_000 + 2000 * 101.5,
  positions: [{ code: "2317", shares: 2000, averageCost: 100 }],
  orders: [],
  fills: [],
  completed: false,
  reflection: "",
  nextAdvanceAt: 0,
  tape: TAPE,
  latest: { cell: 2, trades: PLAYING },
  ...over,
});

test("at rest the desk shows the session itself, so nothing re-renders for the replay", () => {
  const s = session();
  assert.equal(liveSession(s, 1, CATALOG), s);
  assert.equal(settledSession(s), s);
  assert.equal(serverSession(s), s);
});

test("part-way through a minute every stock's newest bar is what its real trades so far made", () => {
  const s = session();
  // 1× plays the minute in 1.8 s: a quarter of the way is 09:02:15, so the two trades at that moment are in.
  const live = liveSession(s, 0.25, CATALOG);
  assert.equal(live.replay?.playedMs, 135_000);
  assert.deepEqual(live.bars["2317"].slice(0, 2), BARS["2317"].slice(0, 2));
  // Volume adds the trades; the average is the day's: (904.5 + 404.5) ÷ (9 + 4).
  assert.deepEqual(live.bars["2317"][2], bar(120, 100.5, 102, 100.5, 102, 4, 100.69));
  assert.deepEqual(live.bars["2330"], [], "no bar before the stock's first trade");
  for (const key of ["id", "cursor", "revision", "cash", "orders", "fills", "positions"] as const)
    assert.deepEqual(live[key], s[key]);
  assert.equal(live.replay?.fraction, 0.25);
  assert.equal(serverSession(live), s, "orders and their defaults use the server's session");
  // Holdings are valued at the latest trade, and land back on the server's value when the minute closes.
  assert.equal(live.equity, s.equity + 2000 * (102 - 101.5));
  // Once every trade of the minute has played, the minute's own bar (the source's average) shows.
  const late = liveSession(s, 0.9, CATALOG);
  assert.deepEqual(late.bars["2317"], BARS["2317"]);
  assert.deepEqual(late.bars["2330"], BARS["2330"]);
});

test("before a minute's first trade the bar is flat at the last trade, with no volume", () => {
  const live = liveSession(session(), 0, CATALOG);
  assert.equal(live.replay?.playedMs, 120_000);
  assert.deepEqual(live.bars["2317"][2], bar(120, 100.5, 100.5, 100.5, 100.5, 0, 100.5));
  assert.equal(live.equity, session().equity + 2000 * (100.5 - 101.5));
});

test("while a minute replays, alerts, swing highs and minute tables see only the minutes before it", () => {
  const settled = settledSession(liveSession(session(), 0.3, CATALOG));
  assert.equal(settled.cursor, 2);
  assert.deepEqual(settled.bars["2317"], BARS["2317"].slice(0, 2));
  assert.deepEqual(settled.bars["2330"], []);
});

test("the latest trade and the replay clock follow the real trades played, and rest on the minute's last one", () => {
  const live = liveSession(session(), 0.25, CATALOG);
  const trade = lastTrade(live, "2317", CATALOG)!;
  assert.deepEqual(
    { ms: trade.ms, price: trade.price, size: trade.size, side: trade.side, second: trade.second },
    { ms: 135_000, price: 102, size: 1, side: "ask", second: 135 },
  );
  assert.equal(trade.index, TAPE["2317"].length + 2);
  assert.equal(replayClock(live), 135);
  assert.equal(lastTrade(live, "2330", CATALOG), null, "not traded yet");
  // Before the minute's first trade, the last trade is the one before the minute.
  const start = lastTrade(liveSession(session(), 0, CATALOG), "2317", CATALOG)!;
  assert.deepEqual([start.price, start.side, start.second], [100.5, "bid", 100]);
  const rest = lastTrade(session(), "2317", CATALOG)!;
  assert.deepEqual([rest.price, rest.side, rest.second], [101.5, null, 170], "between the bid and the ask: neither");
  assert.equal(replayClock(session()), 180);
  assert.equal(lastTrade(session({ cursor: 0, bars: {}, tape: {}, latest: undefined }), "2317", CATALOG), null);
});

test("recent trades run newest first across minutes and never show a trade the replay has not reached", () => {
  const live = liveSession(session(), 0.25, CATALOG);
  const trades = recentTrades(live, "2317", 30, CATALOG);
  assert.deepEqual(
    trades.map((trade) => [trade.second, trade.price, trade.size, trade.side, trade.move]),
    [
      [135, 102, 1, "ask", "up"],
      [135, 101, 2, "bid", "up"],
      [122, 100.5, 1, "ask", "same"],
      [100, 100.5, 3, "bid", "down"],
      [61, 101, 1, "bid", "same"],
      [40, 101, 2, "ask", "up"],
      [1, 100, 3, "ask", "same"],
    ],
  );
  // The trades shown keep their ids as the minute plays on and when it rests.
  const ids = new Map(trades.map((trade) => [`${trade.ms}:${trade.price}`, trade.id]));
  const rest = recentTrades(session(), "2317", 30, CATALOG);
  assert.equal(rest.length, 8);
  assert.equal(new Set(rest.map((trade) => trade.id)).size, 8);
  for (const trade of rest.slice(1)) assert.equal(trade.id, ids.get(`${trade.ms}:${trade.price}`));
  // A short list still compares its oldest trade with the one before it.
  assert.deepEqual(
    recentTrades(live, "2317", 2, CATALOG).map((trade) => trade.move),
    ["up", "up"],
  );
  assert.deepEqual(recentTrades(live, "2330", 30, CATALOG), []);
  assert.deepEqual(recentTrades(live, "2317", 0, CATALOG), []);
});

test("a run loaded as it is replays nothing: its tape holds every revealed trade", () => {
  const loaded = session({ latest: undefined, tape: { "2317": [...TAPE["2317"], ...PLAYING["2317"]], "2330": PLAYING["2330"] } });
  assert.equal(liveSession(loaded, 0.5, CATALOG), loaded);
  assert.equal(lastTrade(loaded, "2330", CATALOG)!.price, 1005);
  assert.equal(recentTrades(loaded, "2317", 3, CATALOG)[0].price, 101.5);
  assert.equal(replayStep({ id: "run-1", cursor: 2 }, loaded), "rest", "no trades to play");
});

test("a new minute plays only when the run moves forward exactly one minute with that minute's trades", () => {
  const before = { id: "run-1", cursor: 2 };
  assert.equal(replayStep(null, session()), "rest");
  assert.equal(replayStep(before, session()), "play");
  assert.equal(replayStep({ id: "run-1", cursor: 3 }, session({ revision: 10 })), "keep");
  assert.equal(replayStep({ id: "run-1", cursor: 1 }, session()), "rest");
  assert.equal(replayStep({ id: "run-1", cursor: 4 }, session()), "rest");
  assert.equal(replayStep(before, session({ id: "run-2" })), "rest");
  assert.equal(replayStep(before, null), "rest");
});

test("replay progress starts with the new minute, runs at the current speed and never rewinds", () => {
  const resting = startReplay({ fraction: 1, at: 0 }, session({ cursor: 2, latest: undefined }), 1000);
  assert.deepEqual(resting, { id: "run-1", cursor: 2, fraction: 1, at: 1000 });
  const playing = startReplay(resting, session(), 2000);
  assert.deepEqual(playing, { id: "run-1", cursor: 3, fraction: 0, at: 2000 });
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
