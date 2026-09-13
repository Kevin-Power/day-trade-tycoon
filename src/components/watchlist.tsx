import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import { formatPrice } from "@/lib/market/ticks";
import { STOCK_BY_CODE } from "@/lib/market/universe";
import { cn, formatLots } from "@/lib/utils";

type ListTab = "all" | "tse" | "otc";

const TABS: { id: ListTab; label: string }[] = [
  { id: "all", label: "自選" },
  { id: "tse", label: "上市" },
  { id: "otc", label: "上櫃" },
];

function chg(n: number) {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

export function Watchlist({ variant = "table" }: { variant?: "table" | "chips" }) {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<ListTab>("all");
  void frame;
  const quotes = (engine?.allQuotes() ?? []).filter((q) => tab === "all" || q.market === tab);

  if (variant === "chips") {
    return (
      <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-surface px-2 py-1.5">
        {quotes.map((q) => {
          const active = q.code === selected;
          return (
            <button
              key={q.code}
              type="button"
              onClick={() => select(q.code)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-sm",
                active ? "border-tape bg-header-2 text-fg" : "border-border bg-bg text-muted",
              )}
            >
              <span>{q.code}</span>
              <span className={cn("tabular", toneClass(q.changePct))}>{chg(q.changePct)}%</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="pane-title flex h-8 items-center gap-0.5 px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "h-7 border-b-2 px-2 text-sm tracking-wide",
              tab === t.id ? "border-tape bg-header-2/70 text-fg" : "border-transparent text-fg/70 hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto px-1 text-sm text-fg/80">
          {engine?.session.label} · {quotes.length} 檔
        </span>
      </div>
      <div className="term-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-watchlist border-collapse font-mono text-sm">
          <thead className="sticky top-0 z-10 bg-header-2 text-fg">
            <tr className="text-left">
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">商品</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium md:table-cell">買進</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium md:table-cell">賣出</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">成交</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">漲跌</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">漲幅%</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium lg:table-cell">單量</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">總量</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium lg:table-cell">委買</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium lg:table-cell">委賣</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium xl:table-cell">昨收</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium xl:table-cell">內盤</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium xl:table-cell">外盤</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const active = q.code === selected;
              const flash = q.flash === 1 ? "flash-up" : q.flash === -1 ? "flash-down" : "";
              const limitCls = q.atLimitUp ? "bg-up text-fg" : q.atLimitDown ? "bg-down text-bg" : "";
              const ch = toneClass(q.change);
              return (
                <tr
                  key={q.code}
                  onClick={() => select(q.code)}
                  className={cn(
                    "cursor-pointer border-b border-border/70 hover:bg-elevated",
                    active && "bg-header/35",
                    flash,
                    limitCls,
                  )}
                >
                  <td className="whitespace-nowrap px-1.5 py-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="tabular">{q.code}</span>
                      <span className="text-micro text-muted">{q.name}</span>
                      <span className="hidden text-micro text-subtle lg:inline">{STOCK_BY_CODE[q.code]?.sectorLabel}</span>
                    </div>
                  </td>
                  <td className={cn("hidden whitespace-nowrap px-1.5 py-1 tabular md:table-cell", ch)}>
                    {formatPrice(q.bid)}
                  </td>
                  <td className={cn("hidden whitespace-nowrap px-1.5 py-1 tabular md:table-cell", ch)}>
                    {formatPrice(q.ask)}
                  </td>
                  <td className={cn("whitespace-nowrap px-1.5 py-1 tabular", ch)}>
                    {formatPrice(q.last)}
                  </td>
                  <td className={cn("whitespace-nowrap px-1.5 py-1 tabular", ch)}>
                    <Arrow n={q.change} /> {chg(q.change)}
                  </td>
                  <td className={cn("whitespace-nowrap px-1.5 py-1 tabular", ch)}>{chg(q.changePct)}%</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1 tabular lg:table-cell">{formatLots(q.tickLots)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 tabular">{formatLots(q.volume)}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1 tabular lg:table-cell">{formatLots(q.bidLots)}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1 tabular lg:table-cell">{formatLots(q.askLots)}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1 tabular xl:table-cell">{formatPrice(q.prevClose)}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1 tabular xl:table-cell">{formatLots(q.inner)}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-1 tabular xl:table-cell">{formatLots(q.outer)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
