import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
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
  const rows: { label: string; value: string; tone?: number }[] = [
    { label: "成交", value: formatPrice(q.last), tone: q.change },
    { label: "漲跌", value: `${q.change >= 0 ? "▲" : "▼"} ${formatPrice(Math.abs(q.change))}`, tone: q.change },
    { label: "漲跌幅", value: formatPct(q.changePct), tone: q.changePct },
    { label: "開盤", value: formatPrice(q.open), tone: q.open - q.prevClose },
    { label: "最高", value: formatPrice(q.high), tone: 1 },
    { label: "最低", value: formatPrice(q.low), tone: -1 },
    { label: "均價", value: formatPrice(q.vwap) },
    { label: "昨收", value: formatPrice(q.prevClose) },
    { label: "漲停", value: formatPrice(limitUp(q.prevClose)), tone: 1 },
    { label: "跌停", value: formatPrice(limitDown(q.prevClose)), tone: -1 },
    { label: "總量", value: formatLots(q.volume) },
    { label: "單量", value: formatLots(q.tickLots) },
    { label: "內盤量", value: formatLots(q.inner) },
    { label: "外盤量", value: formatLots(q.outer) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="pane-title flex h-7 items-center gap-1 px-1">
        {(
          [
            ["book", "五檔"],
            ["ladder", "分價"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-6 rounded-xs px-2 text-micro tracking-wide",
              tab === id ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto truncate px-1 text-micro text-fg/80">
          {q.code} {q.name}
        </span>
      </div>
      {tab === "book" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="term-scroll min-h-0 overflow-auto border-r border-border">
            <div className="grid grid-cols-2 gap-x-2 px-2 py-1 font-mono text-micro">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-0.5">
                  <span className="text-muted">{r.label}</span>
                  <span className={cn("tabular", r.tone !== undefined ? toneClass(r.tone) : "text-fg")}>
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-2 py-2">
              <div className="mb-1 flex justify-between font-mono text-micro">
                <span className="text-down">內 {innerPct.toFixed(2)}%</span>
                <span className="text-up">外 {(100 - innerPct).toFixed(2)}%</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-xs">
                <div className="bg-down" style={{ width: `${innerPct}%` }} />
                <div className="bg-up" style={{ width: `${100 - innerPct}%` }} />
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="px-2 py-1 text-micro text-muted">點價帶入下單</div>
            <div className="term-scroll min-h-0 flex-1 overflow-auto px-1 pb-1">
              {[...q.asks].reverse().map((lvl, i) => (
                <button
                  key={`a${i}`}
                  type="button"
                  onClick={() => clickPrice(lvl.price, "buy")}
                  className="flex w-full items-center gap-1 px-1 py-0.5 font-mono text-micro hover:bg-up-dim"
                >
                  <span className="w-10 text-right text-muted">{formatLots(lvl.lots)}</span>
                  <div className="h-2 flex-1">
                    <div className="ml-auto h-2 bg-up/70" style={{ width: `${Math.min(100, lvl.lots / 2)}%` }} />
                  </div>
                  <span className="w-14 text-right tabular text-up">{formatPrice(lvl.price)}</span>
                </button>
              ))}
              <div className="my-0.5 flex items-center justify-center gap-2 border-y border-border py-1 font-mono text-xs">
                <Arrow n={q.change} />
                <span className={cn("tabular font-medium", toneClass(q.change))}>{formatPrice(q.last)}</span>
                <span className="text-muted">1 張 = {formatMoney(q.last * LOT_SHARES)}</span>
              </div>
              {q.bids.map((lvl, i) => (
                <button
                  key={`b${i}`}
                  type="button"
                  onClick={() => clickPrice(lvl.price, "sell")}
                  className="flex w-full items-center gap-1 px-1 py-0.5 font-mono text-micro hover:bg-down-dim"
                >
                  <span className="w-14 text-left tabular text-down">{formatPrice(lvl.price)}</span>
                  <div className="h-2 flex-1">
                    <div className="h-2 bg-down/70" style={{ width: `${Math.min(100, lvl.lots / 2)}%` }} />
                  </div>
                  <span className="w-10 text-left text-muted">{formatLots(lvl.lots)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <PriceLadder />
      )}
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
      <div className="px-2 py-1 text-micro text-muted">
        成交量堆積 · 點價帶入
        {poc != null && (
          <span className="ml-2 font-mono text-fg/80">
            堆 {formatPrice(poc)}
            {poc >= q.last ? " 壓" : " 撐"}
          </span>
        )}
      </div>
      <div className="term-scroll min-h-0 flex-1 overflow-auto px-1 pb-2">
        {levels.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted">量還在累積。開盤後這裡會出現堆積。</p>
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
                "flex w-full items-center gap-1 px-1 py-0.5 font-mono text-micro hover:bg-elevated",
                atLast && "bg-header/40",
              )}
            >
              <span className={cn("w-14 text-right tabular", above ? "text-up" : "text-down")}>
                {formatPrice(lvl.price)}
              </span>
              <div className="h-2.5 flex-1">
                <div
                  className={cn("h-2.5", isPoc ? "bg-vol/80" : above ? "bg-up/55" : "bg-down/55")}
                  style={{ width: `${Math.max(4, (lvl.lots / maxLots) * 100)}%` }}
                />
              </div>
              <span className="w-10 text-left text-muted">{formatLots(lvl.lots)}</span>
              {isPoc && <span className="w-4 text-micro text-vol">堆</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
