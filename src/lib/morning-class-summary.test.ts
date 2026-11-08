import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMorningClass, type MorningClassRow } from "./morning-class-summary.ts";

// 2026-11-08: the teacher's 「本課總結」 — per lesson day, who bought, whose 停利／停損 觸價單 fired, who held to the
// close and how the round ended, so 石大哥 can show the class what the system did for them.
const row = (
  userId: string,
  name: string,
  date: string,
  parts: Partial<Pick<MorningClassRow, "orders" | "fills" | "positions" | "equity" | "startingCash">> = {},
): MorningClassRow => ({
  userId,
  name,
  lessonId: `fubon-${date}`,
  date,
  equity: 10_000_000,
  startingCash: 10_000_000,
  orders: [],
  fills: [],
  positions: [],
  ...parts,
});

test("one lesson: buys, fired 觸價單, holdings left and results per student, the class totals above them", () => {
  const rows = [
    // A: bought, the 停利 fired (+20,000); a second round bought again and held to the close (-3,000).
    row("a", "小安", "2026-11-06", {
      orders: [{ id: "b1" }, { id: "x1", auto: "takeProfit" }],
      fills: [{ id: "b1", side: "buy" }, { id: "x1", side: "sell" }],
      equity: 10_020_000,
    }),
    row("a", "小安", "2026-11-06", {
      orders: [{ id: "b2" }],
      fills: [{ id: "b2", side: "buy" }],
      positions: [{ shares: 1000 }],
      equity: 9_997_000,
    }),
    // B: bought, the 停損 fired (-12,000).
    row("b", "阿明", "2026-11-06", {
      orders: [{ id: "b3" }, { id: "x3", auto: "stopLoss" }],
      fills: [{ id: "b3", side: "buy" }, { id: "x3", side: "sell" }],
      equity: 9_988_000,
    }),
    // C: watched only.
    row("c", "小美", "2026-11-06"),
  ];
  const [lesson] = summarizeMorningClass(rows);
  assert.deepEqual(
    { ...lesson, lines: undefined },
    {
      lessonId: "fubon-2026-11-06",
      date: "2026-11-06",
      students: 3,
      rounds: 4,
      buys: 3,
      takeProfit: 1,
      stopLoss: 1,
      held: 1,
      positive: 1,
      averageResult: Math.round((17_000 - 12_000 + 0) / 3),
      lines: undefined,
    },
  );
  // Best result first; a student's rounds of the day add up.
  assert.deepEqual(lesson!.lines, [
    { userId: "a", name: "小安", rounds: 2, buys: 2, takeProfit: 1, stopLoss: 0, held: true, result: 17_000 },
    { userId: "c", name: "小美", rounds: 1, buys: 0, takeProfit: 0, stopLoss: 0, held: false, result: 0 },
    { userId: "b", name: "阿明", rounds: 1, buys: 1, takeProfit: 0, stopLoss: 1, held: false, result: -12_000 },
  ]);
});

test("lessons come newest first, at most `limit` of them; a manual sell is neither 停利 nor 停損", () => {
  const rows = [
    row("b", "阿明", "2026-11-04", {
      orders: [{ id: "b9" }, { id: "s9", auto: null }],
      fills: [{ id: "b9", side: "buy" }, { id: "s9", side: "sell" }],
      equity: 10_005_000,
    }),
    row("a", "小安", "2026-11-06"),
    row("c", "小美", "2026-11-05"),
  ];
  assert.deepEqual(summarizeMorningClass(rows).map((lesson) => lesson.date), ["2026-11-06", "2026-11-05", "2026-11-04"]);
  assert.deepEqual(summarizeMorningClass(rows, 2).map((lesson) => lesson.date), ["2026-11-06", "2026-11-05"]);
  const oldest = summarizeMorningClass(rows).at(-1)!;
  assert.equal(oldest.buys, 1);
  assert.equal(oldest.takeProfit + oldest.stopLoss, 0);
  assert.equal(oldest.positive, 1);
  assert.deepEqual(summarizeMorningClass([]), []);
});
