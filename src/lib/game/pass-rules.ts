import { passRulesOf, type PassRule } from "./curriculum.ts";
import type { Fill } from "./types.ts";

export type RuleVerdict = { rule: PassRule; passed: boolean; detail: string; at?: number };
export type PassInput = {
  lessonId: string;
  pnl: number;
  fees: number;
  maxDrawdown: number;
  endT: number;
  positionsOpen: number;
  fills: Fill[];
  forcedClose?: boolean;
};

export function analyzeFills(fills: Fill[]) {
  const positions = new Map<string, { lots: number; avg: number; fees: number; opened: number }>();
  let winningTrades = 0;
  let maxHoldMinutes = 0;
  let averageDownAt: number | undefined;
  let lowExposure = 0;
  let afterLowExposure = Number.POSITIVE_INFINITY;
  const exposure = () =>
    [...positions.values()].reduce((sum, p) => sum + Math.abs(p.lots) * p.avg * 1000, 0);
  // Engine IDs carry their session sequence, so paused/same-second fills must
  // follow execution order even though the display ledger is newest-first.
  const sequence = (f: Fill) => /^F\d+$/.test(f.id) ? Number(f.id.slice(1)) : null;
  for (const f of [...fills].sort((a, b) => {
    const time = a.time - b.time;
    const aSeq = sequence(a), bSeq = sequence(b);
    return time || (aSeq !== null && bSeq !== null ? aSeq - bSeq : 0);
  })) {
    const current = positions.get(f.code) ?? { lots: 0, avg: 0, fees: 0, opened: f.time };
    const signed = f.side === "buy" ? f.lots : -f.lots;
    const sameSide = current.lots === 0 || Math.sign(current.lots) === Math.sign(signed);
    if (sameSide) {
      if (
        current.lots !== 0 &&
        ((current.lots > 0 && f.price < current.avg * 0.998) ||
          (current.lots < 0 && f.price > current.avg * 1.002))
      )
        averageDownAt ??= f.time;
      const lots = current.lots + signed;
      positions.set(f.code, {
        lots,
        avg: (current.avg * Math.abs(current.lots) + f.price * f.lots) / Math.abs(lots),
        fees: current.fees + f.fee + f.tax,
        opened: current.lots === 0 ? f.time : current.opened,
      });
    } else {
      const closed = Math.min(Math.abs(current.lots), f.lots);
      const openingFees = (current.fees * closed) / Math.abs(current.lots);
      const closingFees = ((f.fee + f.tax) * closed) / f.lots;
      const net =
        (f.price - current.avg) * Math.sign(current.lots) * closed * 1000 -
        openingFees -
        closingFees;
      if (net > 0) winningTrades++;
      maxHoldMinutes = Math.max(maxHoldMinutes, (f.time - current.opened) / 60);
      const lots = current.lots + signed;
      if (lots === 0) positions.delete(f.code);
      else if (Math.sign(lots) === Math.sign(current.lots))
        positions.set(f.code, { ...current, lots, fees: current.fees - openingFees });
      else
        positions.set(f.code, {
          lots,
          avg: f.price,
          fees: f.fee + f.tax - closingFees,
          opened: f.time,
        });
    }
    if (f.time < 120 * 60) lowExposure = exposure();
    if (f.time >= 120 * 60 && f.time <= 130 * 60)
      afterLowExposure = Math.min(afterLowExposure, exposure());
  }
  return { winningTrades, maxHoldMinutes, averageDownAt, lowExposure, afterLowExposure };
}

export function evaluatePass(input: PassInput): { passed: boolean; verdicts: RuleVerdict[] } {
  const analysis = analyzeFills(input.fills);
  const verdicts = passRulesOf(input.lessonId).map((rule): RuleVerdict => {
    switch (rule.code) {
      case "max_dd": {
        const max = rule.params?.max ?? 0.02;
        return {
          rule,
          passed: input.maxDrawdown <= max,
          detail: `最大回撤 ${(input.maxDrawdown * 100).toFixed(2)}%（門檻 ${(max * 100).toFixed(0)}%）`,
        };
      }
      case "flatten_before_close":
        return {
          rule,
          passed: input.positionsOpen === 0 && !input.forcedClose,
          detail: input.forcedClose
            ? input.positionsOpen > 0
              ? "結束時由系統嘗試平倉，仍有未平部位"
              : "結束時仍有部位，由系統強制平倉"
            : input.positionsOpen
              ? "仍有未平部位"
              : "結束前已無部位",
        };
      case "no_average_down":
        return {
          rule,
          passed: analysis.averageDownAt === undefined,
          detail: analysis.averageDownAt === undefined ? "未發現虧損方向加碼" : "發現虧損方向加碼",
          at: analysis.averageDownAt,
        };
      case "profit_gt_fees": {
        const multiple = rule.params?.multiple ?? 3;
        return {
          rule,
          passed: input.pnl > input.fees * multiple,
          detail: `淨損益 ${input.pnl.toFixed(0)}，費稅 × ${multiple} = ${(input.fees * multiple).toFixed(0)}`,
        };
      }
      case "min_hold_minutes":
        return {
          rule,
          passed: analysis.maxHoldMinutes >= (rule.params?.min ?? 15),
          detail: `已平倉部位最長持有 ${analysis.maxHoldMinutes.toFixed(1)} 分鐘`,
        };
      case "positive_pnl":
        return {
          rule,
          passed: input.pnl > 0,
          detail: input.pnl > 0 ? "扣費稅後報酬為正" : "扣費稅後報酬未轉正",
        };
      case "min_winning_trade":
        return {
          rule,
          passed: analysis.winningTrades >= (rule.params?.min ?? 1),
          detail: `扣除分攤進出費稅後獲利平倉 ${analysis.winningTrades} 筆`,
        };
      case "risk_down_after_low": {
        const enough = input.endT >= 130 * 60;
        const reduced =
          analysis.lowExposure === 0 || analysis.afterLowExposure < analysis.lowExposure;
        return {
          rule,
          passed: enough && reduced && !input.forcedClose,
          detail: !enough
            ? "本盤未涵蓋 11:00 至 11:10，資料不足"
            : analysis.lowExposure === 0
              ? "11:00 前已無持倉曝險"
              : reduced
                ? "11:10 前持倉成本曝險已降低"
                : "未觀察到 11:10 前降低持倉曝險",
        };
      }
      default:
        return { rule, passed: false, detail: "規則尚無可驗證資料" };
    }
  });
  return { passed: verdicts.length > 0 && verdicts.every((v) => v.passed), verdicts };
}
