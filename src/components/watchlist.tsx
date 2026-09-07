import { useState, type ReactNode } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { PaneTab, PaneTitle } from "@/components/ui/pane";
import { useGame } from "@/lib/game/store";
import type { Quote } from "@/lib/game/types";
import { formatPrice } from "@/lib/market/ticks";
import { cn, formatLots } from "@/lib/utils";

type ListTab = "all" | "tse" | "otc";

const TABS: { id: ListTab; label: string }[] = [
  { id: "all", label: "自選" },
  { id: "tse", label: "上市" },
  { id: "otc", label: "上櫃" },
];

type SortKey =
  | "bid"
  | "ask"
  | "last"
  | "change"
  | "changePct"
  | "tickLots"
  | "volume"
  | "bidLots"
  | "askLots"
  | "prevClose"
  | "inner"
  | "outer";

type Sort = { key: SortKey; dir: 1 | -1 };

/**
 * Columns appear as the pane widens (container query, not viewport):
 *   base   商品 成交 漲跌
 *   wl-sm  + 漲幅 總量
 *   wl-md  + 買進 賣出
 *   wl-lg  + 單量 委買 委賣
 *   wl-xl  + 昨收 內盤 外盤
 * Numeric headers sort: click once for high→low, again for low→high, again to clear.
 */
const TH = "whitespace-nowrap px-1.5 py-1 text-right font-medium";
const TD = "whitespace-nowrap px-1.5 py-[3px] text-right tabular";

function pct(n: number) {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function nextSort(cur: Sort | null, key: SortKey): Sort | null {
  if (!cur || cur.key !== key) return { key, dir: -1 };
  if (cur.dir === -1) return { key, dir: 1 };
  return null;
}

export function Watchlist() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<ListTab>("all");
  const [sort, setSort] = useState<Sort | null>(null);
  void frame;
  const quotes = (engine?.allQuotes() ?? []).filter((q) => tab === "all" || q.market === tab);
  if (sort) {
    const { key, dir } = sort;
    quotes.sort((a, b) => (a[key] - b[key]) * dir);
  }

  const Th = ({
    k,
    className,
    children,
  }: {
    k?: SortKey;
    className?: string;
    children: ReactNode;
  }) => {
    if (!k) return <th className={cn(TH, className)}>{children}</th>;
    const on = sort?.key === k;
    return (
      <th className={cn(TH, className, "p-0")}>
        <button
          type="button"
          onClick={() => setSort((cur) => nextSort(cur, k))}
          aria-sort={on ? (sort.dir === -1 ? "descending" : "ascending") : "none"}
          title="點擊排序"
          className={cn(
            "h-full w-full px-1.5 py-1 text-right font-medium transition-colors hover:text-fg",
            on && "text-tape",
          )}
        >
          {children}
          {on && <span className="ml-0.5 text-2xs">{sort.dir === -1 ? "▼" : "▲"}</span>}
        </button>
      </th>
    );
  };

  return (
    <div className="cq-watch flex h-full min-h-0 flex-col bg-bg">
      <PaneTitle>
        {TABS.map((t) => (
          <PaneTab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </PaneTab>
        ))}
        {sort && (
          <button
            type="button"
            onClick={() => setSort(null)}
            className="ml-1 rounded-xs px-1 text-2xs text-tape hover:bg-white/10"
            title="清除排序"
          >
            排序 ✕
          </button>
        )}
        <span className="wl-meta ml-auto truncate px-1 font-mono text-micro text-fg/80">
          {engine?.session.label} · {quotes.length} 檔
        </span>
      </PaneTitle>
      <div className="term-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-micro">
          <thead className="sticky top-0 z-10 bg-surface-2 text-2xs text-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]">
            <tr>
              <Th className="text-left">商品</Th>
              <Th k="bid" className="wl-md">
                買進
              </Th>
              <Th k="ask" className="wl-md">
                賣出
              </Th>
              <Th k="last">成交</Th>
              <Th k="change">漲跌</Th>
              <Th k="changePct" className="wl-sm">
                漲幅%
              </Th>
              <Th k="tickLots" className="wl-lg">
                單量
              </Th>
              <Th k="volume" className="wl-sm">
                總量
              </Th>
              <Th k="bidLots" className="wl-lg">
                委買
              </Th>
              <Th k="askLots" className="wl-lg">
                委賣
              </Th>
              <Th k="prevClose" className="wl-xl">
                昨收
              </Th>
              <Th k="inner" className="wl-xl">
                內盤
              </Th>
              <Th k="outer" className="wl-xl">
                外盤
              </Th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <Row
                key={q.code}
                q={q}
                active={q.code === selected}
                onSelect={() => select(q.code)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ q, active, onSelect }: { q: Quote; active: boolean; onSelect: () => void }) {
  const flash = q.flash === 1 ? "flash-up" : q.flash === -1 ? "flash-down" : "";
  const limitCls = q.atLimitUp ? "bg-up text-fg" : q.atLimitDown ? "bg-down text-bg" : "";
  const ch = toneClass(q.change);
  return (
    <tr
      onClick={onSelect}
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
}
