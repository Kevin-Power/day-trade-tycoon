import type { Bar } from "./game/types.ts";
import { deriveSwingHighs, type ConfirmedSwingHigh } from "./market/swing-highs.ts";
import { formatPrice } from "./market/ticks.ts";
import type { MorningCatalog, MorningState } from "./morning.ts";
import { EXIT_NAME } from "./morning-exit.ts";
import { fillPriceText } from "./morning-ledger.ts";

export type MorningAlertKind = "fill" | "swing-high" | "break-high" | "cross-up" | "cross-down";
export type MorningAlert = { t: number; kind: MorningAlertKind; code: string; text: string };

// Within one minute the learner's own fill is the most important, so it sorts last.
const PRIORITY: Record<MorningAlertKind, number> = {
  "cross-up": 0,
  "cross-down": 0,
  "swing-high": 1,
  "break-high": 2,
  fill: 3,
};

/**
 * N 字攻擊's breakouts (「過前高」): for each confirmed 前高, the first completed minute after its confirmation that
 * closes above it, with that close; a minute that goes above several (or two at one price) is one breakout, of
 * the highest. In time order. Pass only revealed, completed minutes. The 快訊 and the chart's marks share it.
 */
export function breakoutsOf(
  bars: readonly Bar[],
  highs: readonly Pick<ConfirmedSwingHigh, "p" | "confirmedAt">[],
): { t: number; p: number; high: number }[] {
  const byMinute = new Map<number, { t: number; p: number; high: number }>();
  for (const high of highs) {
    const bar = bars.find((item) => item.t >= high.confirmedAt && item.c > high.p);
    if (!bar) continue;
    const seen = byMinute.get(bar.t);
    if (!seen || high.p > seen.high) byMinute.set(bar.t, { t: bar.t, p: bar.c, high: high.p });
  }
  return [...byMinute.values()].sort((a, b) => a.t - b.t);
}

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
    const highs = deriveSwingHighs(bars, cutoff, 0, catalog.maxCursor * 60).confirmed.filter(
      (high) => high.confirmedAt <= cutoff,
    );
    for (const high of highs)
      alerts.push({
        t: high.confirmedAt,
        kind: "swing-high",
        code: symbol.code,
        text: `${symbol.name} 前高確認 ${formatPrice(high.p)}`,
      });
    // N 字攻擊's breakout, at the minute it completes. Only the price is described, never a reason to trade.
    for (const breakout of breakoutsOf(bars, highs))
      alerts.push({
        t: breakout.t + 60,
        kind: "break-high",
        code: symbol.code,
        text: `${symbol.name} 過前高 ${formatPrice(breakout.high)}`,
      });
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
    const auto = state.orders.find((order) => order.id === fill.id)?.auto;
    alerts.push({
      t: fill.t,
      kind: "fill",
      code: fill.code,
      text: `${auto ? `自動${EXIT_NAME[auto]}成交` : "你的委託成交"}：${name} ${fill.side === "buy" ? "買進" : "賣出"} ${fill.shares / 1000} 張 @ ${fillPriceText(fill.price)}`,
    });
  }
  // Order by when each event became visible: a fill happens at a minute's open but is revealed
  // together with that minute, one minute later, alongside any crossing that minute completes.
  const visibleAt = (alert: MorningAlert) => (alert.kind === "fill" ? alert.t + 60 : alert.t);
  return alerts.sort(
    (a, b) => visibleAt(a) - visibleAt(b) || PRIORITY[a.kind] - PRIORITY[b.kind],
  );
}
