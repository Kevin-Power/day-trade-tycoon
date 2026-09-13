import { passRulesOf, type PassRule } from "./curriculum.ts";
import type { Fill, Side } from "./types.ts";

export type RuleVerdict = {
  rule: PassRule;
  passed: boolean;
  detail: string;
  at?: number;
};

export type PassInput = {
  lessonId: string;
  pnl: number;
  fees: number;
  maxDrawdown: number;
  endT: number;
  positionsOpen: number;
  fills: Fill[];
  /** 收盤時系統強制平倉（學員未自行平倉） */
  forcedClose?: boolean;
  /** 曾經持有的最大張數時間軸，用於攤平判定 */
  lotSeries?: { t: number; lots: number; avg: number }[];
};

function winningTrades(fills: Fill[]): number {
  const byCode = new Map<string, { lots: number; avg: number; pnl: number }>();
  let wins = 0;
  for (const f of [...fills].sort((a, b) => a.time - b.time)) {
    const cur = byCode.get(f.code) ?? { lots: 0, avg: 0, pnl: 0 };
    const signed = f.side === "buy" ? f.lots : -f.lots;
    if (cur.lots !== 0 && Math.sign(cur.lots) !== Math.sign(cur.lots + signed) || (cur.lots !== 0 && Math.sign(signed) !== Math.sign(cur.lots))) {
      const closeLots = Math.min(Math.abs(signed), Math.abs(cur.lots));
      const dir: Side = cur.lots > 0 ? "buy" : "sell";
      const pnl = dir === "buy" ? (f.price - cur.avg) * closeLots * 1000 : (cur.avg - f.price) * closeLots * 1000;
      if (pnl > 0) wins += 1;
    }
    const nextLots = cur.lots + signed;
    if (nextLots === 0) {
      byCode.set(f.code, { lots: 0, avg: 0, pnl: 0 });
    } else if (Math.sign(nextLots) === Math.sign(cur.lots) || cur.lots === 0) {
      const tot = Math.abs(cur.lots) + (Math.sign(signed) === Math.sign(nextLots) || cur.lots === 0 ? Math.abs(signed) : 0);
      const avg = cur.lots === 0 || Math.sign(cur.lots) === Math.sign(signed) ? (cur.avg * Math.abs(cur.lots) + f.price * Math.abs(signed)) / Math.max(1, Math.abs(cur.lots) + Math.abs(signed)) : cur.avg;
      byCode.set(f.code, { lots: nextLots, avg, pnl: 0 });
    } else {
      byCode.set(f.code, { lots: nextLots, avg: f.price, pnl: 0 });
    }
  }
  return wins;
}

function averagedDown(fills: Fill[]): { hit: boolean; at?: number } {
  const pos = new Map<string, { lots: number; avg: number }>();
  for (const f of [...fills].sort((a, b) => a.time - b.time)) {
    const cur = pos.get(f.code) ?? { lots: 0, avg: 0 };
    if (f.side === "buy" && cur.lots > 0 && f.price < cur.avg * 0.998) {
      return { hit: true, at: f.time };
    }
    if (f.side === "sell" && cur.lots < 0 && f.price > cur.avg * 1.002) {
      return { hit: true, at: f.time };
    }
    const signed = f.side === "buy" ? f.lots : -f.lots;
    const next = cur.lots + signed;
    if (next === 0) pos.set(f.code, { lots: 0, avg: 0 });
    else if (cur.lots === 0 || Math.sign(next) === Math.sign(cur.lots)) {
      const avg = (cur.avg * Math.abs(cur.lots) + f.price * Math.abs(signed)) / Math.max(1, Math.abs(cur.lots) + Math.abs(signed));
      pos.set(f.code, { lots: next, avg });
    } else pos.set(f.code, { lots: next, avg: f.price });
  }
  return { hit: false };
}

function maxHoldMinutes(fills: Fill[]): number {
  const openAt = new Map<string, number>();
  let max = 0;
  for (const f of [...fills].sort((a, b) => a.time - b.time)) {
    const key = f.code;
    const cur = openAt.get(key);
    const buy = f.side === "buy";
    if (!cur) openAt.set(key, f.time);
    else {
      max = Math.max(max, (f.time - cur) / 60);
      openAt.set(key, f.time);
    }
    void buy;
  }
  return max;
}

export function evaluatePass(input: PassInput): { passed: boolean; verdicts: RuleVerdict[] } {
  const rules = passRulesOf(input.lessonId);
  const verdicts: RuleVerdict[] = rules.map((rule) => {
    switch (rule.code) {
      case "max_dd": {
        const max = rule.params?.max ?? 0.02;
        const ok = input.maxDrawdown <= max;
        return { rule, passed: ok, detail: `最大回撤 ${(input.maxDrawdown * 100).toFixed(2)}%（門檻 ${(max * 100).toFixed(0)}%）` };
      }
      case "flatten_before_close": {
        const ok = input.positionsOpen === 0 && !input.forcedClose;
        return {
          rule,
          passed: ok,
          detail: input.forcedClose
            ? "收盤時仍有未平倉，由系統市價出場"
            : ok
              ? "收盤時無庫存"
              : "收盤時仍有未平倉",
        };
      }
      case "no_average_down": {
        const r = averagedDown(input.fills);
        return { rule, passed: !r.hit, detail: r.hit ? "偵測到往下加碼" : "沒有攤平", at: r.at };
      }
      case "profit_gt_fees": {
        const m = rule.params?.multiple ?? 3;
        const ok = input.pnl > input.fees * m;
        return { rule, passed: ok, detail: `損益 ${input.pnl.toFixed(0)} vs 費稅×${m} ${(input.fees * m).toFixed(0)}` };
      }
      case "min_hold_minutes": {
        const min = rule.params?.min ?? 15;
        const hold = maxHoldMinutes(input.fills);
        return { rule, passed: hold >= min, detail: `最長持倉 ${hold.toFixed(0)} 分（門檻 ${min} 分）` };
      }
      case "positive_pnl": {
        return { rule, passed: input.pnl > 0, detail: input.pnl > 0 ? "全日報酬為正" : "全日報酬未轉正" };
      }
      case "min_winning_trade": {
        const n = winningTrades(input.fills);
        const min = rule.params?.min ?? 1;
        return { rule, passed: n >= min, detail: `獲利當沖 ${n} 筆` };
      }
      case "risk_down_after_low": {
        const stillOpen = input.positionsOpen > 0 || !!input.forcedClose;
        return { rule, passed: !stillOpen || input.maxDrawdown <= 0.04, detail: stillOpen ? "低點後仍有部位" : "風險已降下" };
      }
      default:
        return { rule, passed: true, detail: "" };
    }
  });
  return { passed: verdicts.every((v) => v.passed), verdicts };
}
