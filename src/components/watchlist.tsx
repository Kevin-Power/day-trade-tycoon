import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { PaneTab, PaneTitle } from "@/components/ui/pane";
import { useGame } from "@/lib/game/store";
import { formatPrice } from "@/lib/market/ticks";
import { cn, formatLots } from "@/lib/utils";

type ListTab = "all" | "tse" | "otc";

const TABS: { id: ListTab; label: string }[] = [
  { id: "all", label: "自選" },
  { id: "tse", label: "上市" },
  { id: "otc", label: "上櫃" },
];

/**
 * Columns appear as the pane widens (container query, not viewport):
 *   base   商品 成交 漲跌
 *   wl-sm  + 漲幅 總量
 *   wl-md  + 買進 賣出
 *   wl-lg  + 單量 委買 委賣
 *   wl-xl  + 昨收 內盤 外盤
 */
const TH = "whitespace-nowrap px-1.5 py-1 text-right font-medium";
const TD = "whitespace-nowrap px-1.5 py-[3px] text-right tabular";

function pct(n: number) {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

export function Watchlist() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<ListTab>("all");
  void frame;
  const quotes = (engine?.allQuotes() ?? []).filter((q) => tab === "all" || q.market === tab);

  return (
    <div className="cq-watch flex h-full min-h-0 flex-col bg-bg">
      <PaneTitle>
        {TABS.map((t) => (
          <PaneTab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </PaneTab>
        ))}
        <span className="wl-meta ml-auto truncate px-1 font-mono text-micro text-fg/80">
          {engine?.session.label} · {quotes.length} 檔
        </span>
      </PaneTitle>
      <div className="term-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-micro">
          <thead className="sticky top-0 z-10 bg-surface-2 text-2xs text-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]">
            <tr>
              <th className={cn(TH, "text-left")}>商品</th>
              <th className={cn(TH, "wl-md")}>買進</th>
              <th className={cn(TH, "wl-md")}>賣出</th>
              <th className={TH}>成交</th>
              <th className={TH}>漲跌</th>
              <th className={cn(TH, "wl-sm")}>漲幅%</th>
              <th className={cn(TH, "wl-lg")}>單量</th>
              <th className={cn(TH, "wl-sm")}>總量</th>
              <th className={cn(TH, "wl-lg")}>委買</th>
              <th className={cn(TH, "wl-lg")}>委賣</th>
              <th className={cn(TH, "wl-xl")}>昨收</th>
              <th className={cn(TH, "wl-xl")}>內盤</th>
              <th className={cn(TH, "wl-xl")}>外盤</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const active = q.code === selected;
              const flash = q.flash === 1 ? "flash-up" : q.flash === -1 ? "flash-down" : "";
              const limitCls = q.atLimitUp
                ? "bg-up text-fg"
                : q.atLimitDown
                  ? "bg-down text-bg"
                  : "";
              const ch = toneClass(q.change);
              return (
                <tr
                  key={q.code}
                  onClick={() => select(q.code)}
                  aria-selected={active}
                  className={cn(
                    "cursor-pointer border-b border-border/70 transition-colors hover:bg-elevated/80",
                    active && "bg-header/35 shadow-[inset_2px_0_0_var(--color-tape)]",
                    flash,
                  )}
                >
                  <td className={cn(TD, "text-left")}>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-muted">{q.code}</span>
                      <span className="font-sans text-xs text-fg">{q.name}</span>
                    </div>
                  </td>
                  <td className={cn(TD, "wl-md", ch, limitCls)}>{formatPrice(q.bid)}</td>
                  <td className={cn(TD, "wl-md", ch, limitCls)}>{formatPrice(q.ask)}</td>
                  <td className={cn(TD, "font-medium", ch, limitCls)}>{formatPrice(q.last)}</td>
                  <td className={cn(TD, ch)}>
                    <Arrow n={q.change} />
                    {formatPrice(Math.abs(q.change))}
                  </td>
                  <td className={cn(TD, "wl-sm", toneClass(q.changePct))}>{pct(q.changePct)}</td>
                  <td className={cn(TD, "wl-lg text-muted")}>{formatLots(q.tickLots)}</td>
                  <td className={cn(TD, "wl-sm")}>{formatLots(q.volume)}</td>
                  <td className={cn(TD, "wl-lg text-down")}>{formatLots(q.bidLots)}</td>
                  <td className={cn(TD, "wl-lg text-up")}>{formatLots(q.askLots)}</td>
                  <td className={cn(TD, "wl-xl text-muted")}>{formatPrice(q.prevClose)}</td>
                  <td className={cn(TD, "wl-xl text-down")}>{formatLots(q.inner)}</td>
                  <td className={cn(TD, "wl-xl text-up")}>{formatLots(q.outer)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
