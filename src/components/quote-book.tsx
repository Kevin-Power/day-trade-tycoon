import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { KV, PaneTab, PaneTitle } from "@/components/ui/pane";
import { useGame } from "@/lib/game/store";
import type { Quote } from "@/lib/game/types";
import { formatPrice, limitDown, limitUp, LOT_SHARES } from "@/lib/market/ticks";
import { cn, formatLots, formatMoney, formatPct } from "@/lib/utils";

type QuoteTab = "book" | "ladder";

export function QuotePanel() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<QuoteTab>("book");
  void frame;
  const q = engine?.quote(selected);
  if (!q) return null;

  const innerPct = q.inner + q.outer === 0 ? 50 : (q.inner / (q.inner + q.outer)) * 100;
  const stats: { label: string; value: string; tone?: string }[] = [
    { label: "成交", value: formatPrice(q.last), tone: toneClass(q.change) },
    {
      label: "漲跌",
      value: `${q.change >= 0 ? "▲" : "▼"}${formatPrice(Math.abs(q.change))}`,
      tone: toneClass(q.change),
    },
    { label: "漲幅", value: formatPct(q.changePct), tone: toneClass(q.changePct) },
    { label: "總量", value: formatLots(q.volume) },
    { label: "開盤", value: formatPrice(q.open), tone: toneClass(q.open - q.prevClose) },
    { label: "最高", value: formatPrice(q.high), tone: toneClass(q.high - q.prevClose) },
    { label: "最低", value: formatPrice(q.low), tone: toneClass(q.low - q.prevClose) },
    { label: "單量", value: formatLots(q.tickLots) },
    { label: "均價", value: formatPrice(q.vwap), tone: "text-vwap" },
    { label: "昨收", value: formatPrice(q.prevClose), tone: "text-tape" },
    { label: "漲停", value: formatPrice(limitUp(q.prevClose)), tone: "text-up" },
    { label: "跌停", value: formatPrice(limitDown(q.prevClose)), tone: "text-down" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTitle>
        <PaneTab active={tab === "book"} onClick={() => setTab("book")}>
          五檔
        </PaneTab>
        <PaneTab active={tab === "ladder"} onClick={() => setTab("ladder")}>
          分價
        </PaneTab>
        <span className="ml-auto truncate px-1 font-mono text-micro text-fg/80">
          <span className="tabular">{q.code}</span> {q.name}
        </span>
      </PaneTitle>

      <div className="quote-stats shrink-0 gap-x-3 gap-y-px border-b border-border px-2 py-1 text-2xs">
        {stats.map((s) => (
          <KV key={s.label} k={s.label} v={s.value} tone={s.tone} />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 font-mono text-2xs tabular">
        <span className="shrink-0 text-down">
          內 {formatLots(q.inner)} · {innerPct.toFixed(1)}%
        </span>
        <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-elevated">
          <div className="bg-down" style={{ width: `${innerPct}%` }} />
          <div className="bg-up" style={{ width: `${100 - innerPct}%` }} />
        </div>
        <span className="shrink-0 text-up">
          {(100 - innerPct).toFixed(1)}% · {formatLots(q.outer)} 外
        </span>
      </div>

      {tab === "book" ? <Book q={q} clickPrice={clickPrice} /> : <PriceLadder />}
    </div>
  );
}

function Book({
  q,
  clickPrice,
}: {
  q: Quote;
  clickPrice: (p: number, side?: "buy" | "sell") => void;
}) {
  const maxLots = Math.max(1, ...q.asks.map((l) => l.lots), ...q.bids.map((l) => l.lots));
  const width = (lots: number) => `${Math.max(2, Math.min(100, (lots / maxLots) * 100))}%`;
  return (
    <div className="term-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-2 pb-0.5 pt-1 text-2xs text-muted">
        <span>委賣 · 點價買進</span>
        <span>委買 · 點價賣出</span>
      </div>
      {[...q.asks].reverse().map((lvl, i) => (
        <button
          key={`a${i}`}
          type="button"
          onClick={() => clickPrice(lvl.price, "buy")}
          className="group flex h-[18px] w-full items-center gap-1.5 px-2 font-mono text-micro tabular transition-colors hover:bg-up-dim"
        >
          <span className="w-9 shrink-0 text-right text-muted group-hover:text-fg">
            {formatLots(lvl.lots)}
          </span>
          <div className="relative h-2.5 min-w-0 flex-1">
            <div
              className="absolute inset-y-0 right-0 rounded-l-xs bg-up/60"
              style={{ width: width(lvl.lots) }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-up">{formatPrice(lvl.price)}</span>
        </button>
      ))}
      <div className="mx-2 my-1 flex items-center justify-center gap-2 border-y border-border-strong/70 py-1 font-mono text-xs tabular">
        <Arrow n={q.change} />
        <span className={cn("font-medium", toneClass(q.change))}>{formatPrice(q.last)}</span>
        <span className="text-2xs text-muted">1 張 = {formatMoney(q.last * LOT_SHARES)}</span>
      </div>
      {q.bids.map((lvl, i) => (
        <button
          key={`b${i}`}
          type="button"
          onClick={() => clickPrice(lvl.price, "sell")}
          className="group flex h-[18px] w-full items-center gap-1.5 px-2 font-mono text-micro tabular transition-colors hover:bg-down-dim"
        >
          <span className="w-14 shrink-0 text-left text-down">{formatPrice(lvl.price)}</span>
          <div className="relative h-2.5 min-w-0 flex-1">
            <div
              className="absolute inset-y-0 left-0 rounded-r-xs bg-down/60"
              style={{ width: width(lvl.lots) }}
            />
          </div>
          <span className="w-9 shrink-0 text-left text-muted group-hover:text-fg">
            {formatLots(lvl.lots)}
          </span>
        </button>
      ))}
    </div>
  );
}

function PriceLadder() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const frame = useGame((s) => s.frame);
  void frame;
  const q = engine?.quote(selected);
  const levels = engine?.priceLevels(selected) ?? [];
  if (!q) return null;
  const maxLots = Math.max(...levels.map((l) => l.lots), 1);
  const poc = engine?.poc(selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-2 pb-0.5 pt-1 text-2xs text-muted">
        <span>成交量堆積 · 點價帶入</span>
        {poc != null && (
          <span className="ml-auto font-mono tabular text-vol">
            堆 {formatPrice(poc)}
            {poc >= q.last ? " 壓" : " 撐"}
          </span>
        )}
      </div>
      <div className="term-scroll min-h-0 flex-1 overflow-y-auto pb-1">
        {levels.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted">
            量還在累積。開盤後這裡會出現堆積。
          </p>
        )}
        {levels.map((lvl) => {
          const atLast = Math.abs(lvl.price - q.last) < 1e-9;
          const isPoc = poc != null && Math.abs(lvl.price - poc) < 1e-9;
          const above = lvl.price >= q.prevClose;
          return (
            <button
              key={lvl.price}
              type="button"
              onClick={() => clickPrice(lvl.price)}
              className={cn(
                "flex h-[18px] w-full items-center gap-1.5 px-2 font-mono text-micro tabular transition-colors hover:bg-elevated",
                atLast && "bg-header/40",
              )}
            >
              <span className={cn("w-14 shrink-0 text-right", above ? "text-up" : "text-down")}>
                {formatPrice(lvl.price)}
              </span>
              <div className="relative h-2.5 min-w-0 flex-1">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-r-xs",
                    isPoc ? "bg-vol/80" : above ? "bg-up/55" : "bg-down/55",
                  )}
                  style={{ width: `${Math.max(3, (lvl.lots / maxLots) * 100)}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-left text-muted">{formatLots(lvl.lots)}</span>
              <span className="w-3 shrink-0 text-2xs text-vol">{isPoc ? "堆" : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
