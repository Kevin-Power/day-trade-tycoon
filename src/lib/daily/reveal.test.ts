import test from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../game/types.ts";
import { entryResult, priceText, questionText, revealCopy, timeText } from "./reveal.ts";
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
  const poked = revealCopy({ kind: "previous-high", level: 2590, outcome: { ...brokeOut, higherHigh: false, higherHighT: null }, choice: "skip", entry: null });
  assert.equal(poked.headline, "沒有突破昨高");
  assert.equal(poked.facts[0], "10:31 一度碰到 2,595 又回落，沒有站穩；收盤 2,605。");
  assert.equal(poked.lessons[1], "昨天的最高價擋住了價格，昨高成了壓力。等真的突破再說，比提前追價安全。");
  const never = revealCopy({ kind: "intraday-high", level: 2590, outcome: { ...brokeOut, higherHigh: false, higherHighT: null, firstBreakT: null, firstBreakPrice: null, maxAfter: 2585, close: 2560 }, choice: "skip", entry: null });
  assert.equal(never.headline, "沒有突破前高");
  assert.equal(never.facts[0], "之後最高只到 2,585，沒有越過 2,590；收盤 2,560。");
  assert.equal(never.lessons[1], "這次前高成了壓力，價格沒能做出後高。觀望或不追，避開了之後的回落。");
  assert.equal(revealCopy({ kind: "previous-high", level: 2590, outcome: brokeOut, choice: "enter", entry: null }).headline, "突破昨高");
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
