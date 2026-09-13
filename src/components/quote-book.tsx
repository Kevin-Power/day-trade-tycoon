import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import { formatPrice, limitDown, limitUp, LOT_SHARES } from "@/lib/market/ticks";
import { cn, formatLots, formatMoney, formatPct, formatTime } from "@/lib/utils";

type QuoteTab = "book" | "ticks" | "ladder" | "path";

const TABS: { id: QuoteTab; label: string }[] = [
  { id: "book", label: "五檔" },
  { id: "ticks", label: "明細" },
  { id: "ladder", label: "分價" },
  { id: "path", label: "路徑" },
];

export function QuotePanel({ compact = false }: { compact?: boolean }) {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<QuoteTab>("book");
  void frame;
  const q = engine?.quote(selected);
  if (!q) return null;

  const innerPct = q.inner + q.outer === 0 ? 50 : (q.inner / (q.inner + q.outer)) * 100;
  const depth = compact ? 3 : 5;
  const asks = [...q.asks].slice(0, depth).reverse();
  const bids = q.bids.slice(0, depth);
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
      <div className="pane-title flex h-8 items-center gap-1 px-1">
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
        <span className="ml-auto truncate px-1 text-sm text-fg/80">
          {q.code} {q.name}
        </span>
      </div>
      {tab === "book" && (
        <div className={cn("grid min-h-0 flex-1", compact ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]")}>
          {!compact && (
            <div className="term-scroll min-h-0 overflow-auto border-r border-border">
              <div className="grid grid-cols-2 gap-x-2 px-2 py-1 font-mono text-sm">
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
                <div className="mb-1 flex justify-between font-mono text-sm">
                  <span className="text-down">內 {innerPct.toFixed(2)}%</span>
                  <span className="text-up">外 {(100 - innerPct).toFixed(2)}%</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-xs">
                  <div className="bg-down" style={{ width: `${innerPct}%` }} />
                  <div className="bg-up" style={{ width: `${100 - innerPct}%` }} />
                </div>
              </div>
            </div>
          )}
          <div className="flex min-h-0 flex-col">
            {!compact && <div className="px-2 py-1 text-sm text-muted">點價帶入下單</div>}
            <div className="term-scroll min-h-0 flex-1 overflow-auto px-1 pb-1">
              {asks.map((lvl, i) => (
                <button
                  key={`a${i}`}
                  type="button"
                  onClick={() => clickPrice(lvl.price, "buy")}
                  className="flex w-full items-center gap-1 px-1 py-0.5 font-mono text-sm hover:bg-up-dim"
                >
                  <span className="w-10 text-right text-muted">{formatLots(lvl.lots)}</span>
                  <div className="h-2 flex-1">
                    <div className="ml-auto h-2 bg-up/70" style={{ width: `${Math.min(100, lvl.lots / 2)}%` }} />
                  </div>
                  <span className="w-16 text-right tabular text-up">{formatPrice(lvl.price)}</span>
                </button>
              ))}
              <div className="my-0.5 flex items-center justify-center gap-2 border-y border-border py-1 font-mono text-sm">
                <Arrow n={q.change} />
                <span className={cn("tabular text-base font-medium", toneClass(q.change))}>{formatPrice(q.last)}</span>
                {!compact && <span className="text-muted">1 張 = {formatMoney(q.last * LOT_SHARES)}</span>}
              </div>
              {bids.map((lvl, i) => (
                <button
                  key={`b${i}`}
                  type="button"
                  onClick={() => clickPrice(lvl.price, "sell")}
                  className="flex w-full items-center gap-1 px-1 py-0.5 font-mono text-sm hover:bg-down-dim"
                >
                  <span className="w-16 text-left tabular text-down">{formatPrice(lvl.price)}</span>
                  <div className="h-2 flex-1">
                    <div className="h-2 bg-down/70" style={{ width: `${Math.min(100, lvl.lots / 2)}%` }} />
                  </div>
                  <span className="w-10 text-left text-muted">{formatLots(lvl.lots)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab === "ticks" && <TickTape />}
      {tab === "ladder" && <PriceLadder />}
      {tab === "path" && <PathTape />}
    </div>
  );
}

function TickTape() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const frame = useGame((s) => s.frame);
  void frame;
  const q = engine?.quote(selected);
  const ticks = engine?.ticks(selected) ?? [];
  if (!q) return null;
  const recent = ticks.slice(-80).reverse();
  return (
    <div className="term-scroll min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-sm">
      {recent.length === 0 && <p className="py-8 text-center text-muted">成交明細會隨時間軸出現。</p>}
      {recent.map((tk, i) => {
        const prev = recent[i + 1]?.p ?? q.prevClose;
        const ch = tk.p - prev;
        return (
          <button
            key={`${tk.t}-${i}`}
            type="button"
            onClick={() => clickPrice(tk.p)}
            className="flex w-full items-center justify-between border-b border-border/50 py-0.5 hover:bg-elevated"
          >
            <span className="text-muted">{formatTime(tk.t)}</span>
            <span className={cn("tabular", toneClass(ch))}>{formatPrice(tk.p)}</span>
          </button>
        );
      })}
    </div>
  );
}

function PathTape() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const frame = useGame((s) => s.frame);
  void frame;
  const q = engine?.quote(selected);
  const bars = engine?.bars(selected) ?? [];
  if (!q) return null;
  const recent = bars.slice(-60).reverse();
  return (
    <div className="term-scroll min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-sm">
      {recent.length === 0 && <p className="py-8 text-center text-muted">一分 K 路徑會隨時間軸出現。</p>}
      {recent.map((b) => (
        <button
          key={b.t}
          type="button"
          onClick={() => clickPrice(b.c)}
          className="flex w-full items-center gap-2 border-b border-border/50 py-0.5 hover:bg-elevated"
        >
          <span className="w-16 text-muted">{formatTime(b.t).slice(0, 5)}</span>
          <span className={cn("w-16 text-right tabular", toneClass(b.c - q.prevClose))}>{formatPrice(b.c)}</span>
          <span className="ml-auto text-muted">{formatLots(b.v)}</span>
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
      <div className="px-2 py-1 text-sm text-muted">
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
          <p className="px-2 py-8 text-center text-sm text-muted">量還在累積。開盤後這裡會出現堆積。</p>
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
                "flex w-full items-center gap-1 px-1 py-0.5 font-mono text-sm hover:bg-elevated",
                atLast && "bg-header/40",
              )}
            >
              <span className={cn("w-16 text-right tabular", above ? "text-up" : "text-down")}>
                {formatPrice(lvl.price)}
              </span>
              <div className="h-2.5 flex-1">
                <div
                  className={cn("h-2.5", isPoc ? "bg-vol/80" : above ? "bg-up/55" : "bg-down/55")}
                  style={{ width: `${Math.max(4, (lvl.lots / maxLots) * 100)}%` }}
                />
              </div>
              <span className="w-10 text-left text-muted">{formatLots(lvl.lots)}</span>
              {isPoc && <span className="w-4 text-sm text-vol">堆</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
