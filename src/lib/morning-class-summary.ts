// The teacher's 「本課總結」 (2026-11-08, the owner: 石大哥 should be able to show the class what the system did for
// them): the class's completed rounds of each daily lesson, summed per student and per lesson day. Pure: rows in,
// numbers out; the server picks the rows (completed, not abandoned, class members only).
import type { ExitKind } from "./morning-exit.ts";

export type MorningClassRow = {
  userId: string;
  name: string;
  lessonId: string;
  /** The lesson day, YYYY-MM-DD. */
  date: string;
  equity: number;
  startingCash: number;
  /** The round's orders: a fill's `id` is its order's; `auto` names the 觸價單 that sent it. */
  orders: readonly { id: string; auto?: ExitKind | null }[];
  fills: readonly { id: string; side: "buy" | "sell" }[];
  /** Holdings at the end of the round: 留到收盤 when any has shares. */
  positions: readonly { shares: number }[];
};

export type MorningStudentLine = {
  userId: string;
  name: string;
  rounds: number;
  buys: number;
  takeProfit: number;
  stopLoss: number;
  held: boolean;
  /** The day's rounds added up: equity minus starting cash, fees and tax already paid. */
  result: number;
};

export type MorningLessonSummary = {
  lessonId: string;
  date: string;
  students: number;
  rounds: number;
  buys: number;
  takeProfit: number;
  stopLoss: number;
  held: number;
  positive: number;
  averageResult: number;
  /** Best result first. */
  lines: MorningStudentLine[];
};

export const MORNING_CLASS_LESSONS = 8;

export function summarizeMorningClass(
  rows: readonly MorningClassRow[],
  limit = MORNING_CLASS_LESSONS,
): MorningLessonSummary[] {
  const byLesson = new Map<string, { date: string; rows: MorningClassRow[] }>();
  for (const row of rows) {
    const group = byLesson.get(row.lessonId) ?? { date: row.date, rows: [] };
    group.rows.push(row);
    byLesson.set(row.lessonId, group);
  }
  return [...byLesson.entries()]
    .sort((a, b) => b[1].date.localeCompare(a[1].date) || b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([lessonId, group]) => {
      const students = new Map<string, MorningStudentLine>();
      for (const row of group.rows) {
        const line = students.get(row.userId) ?? {
          userId: row.userId,
          name: row.name,
          rounds: 0,
          buys: 0,
          takeProfit: 0,
          stopLoss: 0,
          held: false,
          result: 0,
        };
        const autoOf = new Map(row.orders.map((order) => [order.id, order.auto ?? null]));
        line.rounds += 1;
        for (const fill of row.fills) {
          if (fill.side === "buy") line.buys += 1;
          else if (autoOf.get(fill.id) === "takeProfit") line.takeProfit += 1;
          else if (autoOf.get(fill.id) === "stopLoss") line.stopLoss += 1;
        }
        if (row.positions.some((position) => position.shares > 0)) line.held = true;
        line.result += Math.round(row.equity - row.startingCash);
        students.set(row.userId, line);
      }
      const lines = [...students.values()].sort(
        (a, b) => b.result - a.result || a.name.localeCompare(b.name, "zh-Hant"),
      );
      const total = (pick: (line: MorningStudentLine) => number) =>
        lines.reduce((sum, line) => sum + pick(line), 0);
      return {
        lessonId,
        date: group.date,
        students: lines.length,
        rounds: group.rows.length,
        buys: total((line) => line.buys),
        takeProfit: total((line) => line.takeProfit),
        stopLoss: total((line) => line.stopLoss),
        held: lines.filter((line) => line.held).length,
        positive: lines.filter((line) => line.result > 0).length,
        averageResult: lines.length ? Math.round(total((line) => line.result) / lines.length) : 0,
        lines,
      };
    });
}
