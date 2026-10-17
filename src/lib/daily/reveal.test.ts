import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import { dataDateText, entryResult, priceText, questionText, revealCopy, timeText } from "./reveal.ts";
import type { DailyOutcome } from "./types.ts";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c, v: 1 });

test("entry uses the next minute's open and a gap through the stop exits at the open", () => {
  const bars = [bar(0, 99, 99.5, 98.9, 99.4), bar(60, 100, 100.5, 99.8, 100.2), bar(120, 97, 97.5, 96, 96.5), bar(180, 96.5, 97, 96, 96.8)];
  assert.deepEqual(entryResult({ bars, questionT: 0 }, 98), { entryT: 60, entryPrice: 100, stopPrice: 98, stopT: 120, exitPrice: 97, pct: -3 });
});

test("an untouched stop exits at the close", () => {
  const bars = [bar(0, 99, 99.5, 98.9, 99.4), bar(60, 100, 100.5, 99.8, 100.2), bar(120, 100.2, 101, 100, 100.7)];
  assert.deepEqual(entryResult({ bars, questionT: 0 }, 98), { entryT: 60, entryPrice: 100, stopPrice: 98, stopT: null, exitPrice: 100.7, pct: 0.7 });
});

test("prices and percents read cleanly", () => {
  assert.equal(priceText(2590), "2,590");
  assert.equal(priceText(36.75), "36.75");
  assert.equal(priceText(98.5), "98.5");
  assert.equal(timeText(4320), "10:12");
  assert.equal(timeText(16200), "13:30");
  const flat = [bar(0, 36.75, 36.8, 36.7, 36.75), bar(60, 36.75, 36.8, 36.7, 36.75)];
  const entry = entryResult({ bars: flat, questionT: 0 }, 36.5);
  assert.equal(Object.is(entry.pct, -0), false);
  const copy = revealCopy({ kind: "intraday-high", level: 36.8, outcome: { ...brokeOut, higherHigh: false, firstBreakT: null, firstBreakPrice: null, maxAfter: 36.8, close: 36.75 }, choice: "enter", entry });
  assert.equal(copy.facts[1], "假設 09:01 開盤價 36.75 買進、停損 36.5：停損沒有被觸發，收盤約 0.0%（不含手續費與稅）。");
});

const brokeOut: DailyOutcome = { higherHigh: true, higherHighT: 5700, firstBreakT: 5460, firstBreakPrice: 2595, maxAfter: 2615, close: 2605 };

test("reveal copy follows the fixed sentences", () => {
  const copy = revealCopy({ kind: "intraday-high", level: 2590, outcome: brokeOut, choice: "watch", entry: null });
  assert.equal(copy.headline, "做出後高");
  assert.equal(copy.facts[0], "10:31 突破 2,590，最高到 2,615（+1.0%）；收盤 2,605。");
  assert.equal(copy.facts.length, 1);
  assert.deepEqual(copy.lessons, [
    "前高後高：先出現一個高點，回檔之後，後面又做出更高的高點。",
    "這次回到前高後，買盤把價格推上去，做出後高：多方結構延續。進場的人有停損保護，風險有限。",
    "不論判斷對錯，先設停損，錯了也只虧一小段。",
  ]);
  const poked = revealCopy({ kind: "previous-high", level: 2590, outcome: { ...brokeOut, higherHigh: false, higherHighT: null, close: 2580 }, choice: "skip", entry: null });
  assert.equal(poked.headline, "沒有突破昨高");
  assert.equal(poked.facts[0], "10:31 一度碰到 2,595 又回落，沒有站穩；收盤 2,580。");
  assert.equal(poked.lessons[1], "昨天的最高價擋住了價格，昨高成了壓力。等真的突破再說，比提前追價安全。");
  const never = revealCopy({ kind: "intraday-high", level: 2590, outcome: { ...brokeOut, higherHigh: false, higherHighT: null, firstBreakT: null, firstBreakPrice: null, maxAfter: 2585, close: 2560 }, choice: "skip", entry: null });
  assert.equal(never.headline, "沒有突破前高");
  assert.equal(never.facts[0], "之後最高只到 2,585，沒有越過 2,590；收盤 2,560。");
  assert.equal(never.lessons[1], "這次前高成了壓力，價格沒能做出後高。觀望或不追，避開了之後的回落。");
  assert.equal(revealCopy({ kind: "previous-high", level: 2590, outcome: brokeOut, choice: "enter", entry: null }).headline, "突破昨高");
});

const fellBack = (copy: { facts: string[]; lessons: string[] }) => /回落|站穩/.test([...copy.facts, ...copy.lessons].join(""));

test("a breakout held into the close is told as a breakout, never as falling back", () => {
  // 台虹 on 2026-10-16: limit-up 311.5 from 09:18 to the close, over the 308.5 level. The lock never
  // confirms a high, so an outcome stored before the close rule says higherHigh: false.
  const locked: DailyOutcome = { higherHigh: false, higherHighT: null, firstBreakT: 1080, firstBreakPrice: 311.5, maxAfter: 311.5, close: 311.5 };
  const copy = revealCopy({ kind: "intraday-high", level: 308.5, outcome: locked, choice: "enter",
    entry: { entryT: 1080, entryPrice: 307.5, stopPrice: 300, stopT: null, exitPrice: 311.5, pct: 1.3 } });
  assert.equal(copy.headline, "做出後高");
  assert.equal(copy.facts[0], "09:18 突破 308.5，最高到 311.5（+1.0%）；收盤 311.5。");
  assert.equal(copy.lessons[1], "這次回到前高後，買盤把價格推上去，做出後高：多方結構延續。進場的人有停損保護，風險有限。");
  assert.equal(fellBack(copy), false);
  assert.equal(revealCopy({ kind: "previous-high", level: 308.5, outcome: locked, choice: "watch", entry: null }).headline, "突破昨高");
});

test("a close at or above the level is never told as falling back", () => {
  // 中鋼 on 2026-10-16: one tick over 19.5, closing at 19.55. Stored before the two-tick rule it was a higher high.
  const stalled: DailyOutcome = { higherHigh: false, higherHighT: null, firstBreakT: 4320, firstBreakPrice: 19.55, maxAfter: 19.55, close: 19.55 };
  for (const outcome of [stalled, { ...stalled, higherHigh: true, higherHighT: 9000 }]) {
    const copy = revealCopy({ kind: "intraday-high", level: 19.5, outcome, choice: "watch", entry: null });
    assert.equal(copy.headline, "沒有突破前高");
    assert.equal(copy.facts[0], "之後最高到 19.55，只比 19.5 高一個跳動單位；收盤 19.55，停在前高附近。");
    assert.equal(copy.lessons[1], "這次價格停在前高附近，沒有做出後高。等它真的突破再說，判斷比較清楚。");
    assert.equal(fellBack(copy), false);
  }
  const previous = revealCopy({ kind: "previous-high", level: 19.5, outcome: stalled, choice: "watch", entry: null });
  assert.equal(previous.headline, "沒有突破昨高");
  assert.equal(previous.facts[0], "之後最高到 19.55，只比 19.5 高一個跳動單位；收盤 19.55，停在昨高附近。");
  assert.equal(previous.lessons[1], "這次價格停在昨高附近，沒有真的突破。等真的突破再說，比提前追價安全。");
  assert.equal(fellBack(previous), false);
  // A spike two ticks up that never confirms, then a close one tick above the level.
  const spike = revealCopy({ kind: "intraday-high", level: 100, outcome: { ...stalled, firstBreakT: 780, firstBreakPrice: 100.5, maxAfter: 101.5, close: 100.5 },
    choice: "watch", entry: null });
  assert.equal(spike.headline, "沒有突破前高");
  assert.equal(spike.facts[0], "之後最高到 101.5（+1.5%），收盤回到 100.5，停在前高附近。");
  assert.equal(fellBack(spike), false);
});

test("a one-tick poke that closes below the level reads as falling back, even if stored as a higher high", () => {
  // 日月光投控 on 2026-10-16: 677 → 678, closing at 671.
  const poke: DailyOutcome = { higherHigh: true, higherHighT: 1560, firstBreakT: 1560, firstBreakPrice: 678, maxAfter: 678, close: 671 };
  const copy = revealCopy({ kind: "intraday-high", level: 677, outcome: poke, choice: "skip", entry: null });
  assert.equal(copy.headline, "沒有突破前高");
  assert.equal(copy.facts[0], "09:26 一度碰到 678 又回落，沒有站穩；收盤 671。");
  assert.equal(copy.lessons[1], "這次前高成了壓力，價格沒能做出後高。觀望或不追，避開了之後的回落。");
});

test("a higher high that closes back under the level does not claim the trend carried on", () => {
  // 華新 on 2026-10-16 (wider search): 39.1 → 39.3, closing at 38.5.
  const faded: DailyOutcome = { higherHigh: true, higherHighT: 780, firstBreakT: 780, firstBreakPrice: 39.25, maxAfter: 39.3, close: 38.5 };
  const copy = revealCopy({ kind: "intraday-high", level: 39.1, outcome: faded, choice: "enter",
    entry: { entryT: 780, entryPrice: 38.95, stopPrice: 38.85, stopT: 960, exitPrice: 38.85, pct: -0.3 } });
  assert.equal(copy.headline, "做出後高");
  assert.equal(copy.facts[0], "09:13 突破 39.1，最高到 39.3（+0.5%）；收盤 38.5。");
  assert.equal(copy.lessons[1], "這次回到前高後做出後高，但收盤又跌回前高之下。突破不保證守得住，進場的人靠停損控制風險。");
});

test("a triggered stop is described with its time and loss", () => {
  const copy = revealCopy({ kind: "intraday-high", level: 100, outcome: { ...brokeOut, higherHigh: false }, choice: "enter",
    entry: { entryT: 780, entryPrice: 100, stopPrice: 99.5, stopT: 2400, exitPrice: 99.5, pct: -0.5 } });
  assert.equal(copy.facts[1], "假設 09:13 開盤價 100 買進、停損 99.5：停損在 09:40 被觸發，約 −0.5%（不含手續費與稅）。");
});

test("the question sentence names the kind of high", () => {
  assert.equal(questionText({ name: "台積電", code: "2330", kind: "intraday-high", questionT: 4320, level: 2590 }),
    "台積電（2330）10:12 回到前高 2,590 附近。接下來你會怎麼做？");
  assert.equal(questionText({ name: "鴻海", code: "2317", kind: "previous-high", questionT: 600, level: 247 }),
    "鴻海（2317）09:10 漲到昨天最高價 247 附近。接下來你會怎麼做？");
});

test("the data day reads as month/day and weekday", () => {
  assert.equal(dataDateText("2026-10-14"), "10/14（三）");
  assert.equal(dataDateText("2026-10-19"), "10/19（一）");
});
