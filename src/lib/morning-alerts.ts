import { deriveSwingHighs } from "./market/swing-highs.ts";
import { formatPrice } from "./market/ticks.ts";
import type { MorningCatalog, MorningState } from "./morning.ts";

export type MorningAlertKind = "fill" | "swing-high" | "cross-up" | "cross-down";
export type MorningAlert = { t: number; kind: MorningAlertKind; code: string; text: string };

// Within one minute the learner's own fill is the most important, so it sorts last.
const PRIORITY: Record<MorningAlertKind, number> = {
  "cross-up": 0,
  "cross-down": 0,
  "swing-high": 1,
  fill: 2,
};

/**
 * Events derived only from what the server has already revealed: completed minutes up to the
 * cursor and the learner's own fills. Nothing after `state.cursor` can influence the result.
 */
export function deriveMorningAlerts(catalog: MorningCatalog, state: MorningState): MorningAlert[] {
  const cutoff = Math.max(0, state.cursor) * 60;
  const alerts: MorningAlert[] = [];
  for (const symbol of catalog.symbols) {
    const bars = (state.bars[symbol.code] ?? [])
      .filter((bar) => Number.isFinite(bar.t) && bar.t + 60 <= cutoff)
      .slice()
      .sort((a, b) => a.t - b.t);
    for (const high of deriveSwingHighs(bars, cutoff, 0, catalog.maxCursor * 60).confirmed) {
      if (high.confirmedAt > cutoff) continue;
      alerts.push({
        t: high.confirmedAt,
        kind: "swing-high",
        code: symbol.code,
        text: `${symbol.name} 前高確認 ${formatPrice(high.p)}`,
      });
    }
    for (let index = 1; index < bars.length; index++) {
      const before = bars[index - 1]!.c - symbol.previousClose;
      const after = bars[index]!.c - symbol.previousClose;
      const t = bars[index]!.t + 60;
      const reference = formatPrice(symbol.previousClose);
      if (before <= 0 && after > 0)
        alerts.push({ t, kind: "cross-up", code: symbol.code, text: `${symbol.name} 站上昨收 ${reference}` });
      else if (before >= 0 && after < 0)
        alerts.push({ t, kind: "cross-down", code: symbol.code, text: `${symbol.name} 跌破昨收 ${reference}` });
    }
  }
  for (const fill of state.fills) {
    if (!Number.isFinite(fill.t) || fill.t > cutoff) continue;
    const name = catalog.symbols.find((item) => item.code === fill.code)?.name ?? fill.code;
    alerts.push({
      t: fill.t,
      kind: "fill",
      code: fill.code,
      text: `你的委託成交：${name} ${fill.side === "buy" ? "買進" : "賣出"} ${fill.shares / 1000} 張 @ ${formatPrice(fill.price)}`,
    });
  }
  return alerts.sort((a, b) => a.t - b.t || PRIORITY[a.kind] - PRIORITY[b.kind]);
}
