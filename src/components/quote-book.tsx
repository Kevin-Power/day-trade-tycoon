import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { AuxChip, ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { useGame } from "@/lib/game/store";
import { formatPrice, limitDown, limitUp, LOT_SHARES } from "@/lib/market/ticks";
import { TEACHING_DATES } from "@/lib/market/tape-types";
import {
  AUX_FROZEN,
  classroomBookMicro,
  classroomInnerOuterMicro,
  classroomTapeMicro,
  freezeWeekLabel,
  officialDailyOhlcMicro,
} from "@/lib/provenance";
import { cn, formatLots, formatMoney, formatPct } from "@/lib/utils";

type QuoteTab = "book" | "ladder";

export function QuotePanel() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const flashOrder = useGame((s) => s.flashOrder);
  const setFlashOrder = useGame((s) => s.setFlashOrder);
  const ticketSide = useGame((s) => s.ticket.side);
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
    <div className="relative z-10 flex h-auto min-w-0 flex-col bg-bg lg:h-full lg:min-h-0">
      <div className="pane-title flex h-auto flex-wrap items-center gap-2 px-2 py-1 lg:h-7 lg:flex-nowrap lg:gap-1 lg:px-1 lg:py-0">
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
              "min-h-12 min-w-12 rounded-xs px-3 py-2 text-base leading-relaxed tracking-wide lg:h-6 lg:min-h-0 lg:min-w-0 lg:px-2 lg:py-0 lg:text-micro",
              tab === id ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto min-w-0 break-words px-1 text-base text-fg/80 lg:truncate lg:text-micro">
          {q.code} {q.name}
        </span>
        <ProvenanceBadge kind="classroom" className="text-sm lg:text-2xs" />
      </div>
      <ProvenanceMicro className="text-sm lg:text-2xs" text={tab === "book" ? classroomBookMicro() : classroomTapeMicro()} />
      <div className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-3 lg:gap-2 lg:px-2 lg:py-1">
        <div className="min-w-0 flex-1 basis-48 text-base leading-relaxed lg:basis-28 lg:text-micro">
          <p className={flashOrder ? "text-tape" : "text-muted"}>
            {flashOrder ? "閃電開啟：點價可能立即送出模擬委託" : "閃電關閉：點價帶入委託欄位"}
          </p>
          {flashOrder && (
            <p className="mt-1 text-sm text-muted lg:text-2xs">仍依教學／測驗限制判定是否送出。</p>
          )}
          {tab === "ladder" && (
            <p className="mt-1 text-muted">分價點價沿用委託單目前的「{ticketSide === "buy" ? "買進" : "賣出"}」方向。</p>
          )}
        </div>
        <button
          type="button"
          aria-pressed={flashOrder}
          onClick={() => setFlashOrder(!flashOrder)}
          className={cn(
            "min-h-12 min-w-12 max-w-full whitespace-normal rounded-xs border border-border px-3 py-2 text-base leading-relaxed lg:h-5 lg:min-h-0 lg:min-w-0 lg:px-1.5 lg:py-0 lg:text-2xs",
            flashOrder ? "bg-header-2 text-tape" : "text-muted hover:text-fg",
          )}
        >
          閃電下單 {flashOrder ? "開" : "關"}
        </button>
      </div>
      {tab === "book" ? (
        <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="term-scroll border-b border-border lg:min-h-0 lg:overflow-auto lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-start justify-between gap-2 px-2 pt-1 lg:flex-nowrap">
              <p className="font-mono text-sm leading-relaxed text-muted lg:text-2xs">
                {officialDailyOhlcMicro(freezeWeekLabel(engine?.session.date))}
              </p>
              {engine?.session.date && TEACHING_DATES.has(engine.session.date) ? (
                <AuxChip className="text-sm lg:text-2xs">{AUX_FROZEN}</AuxChip>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-x-3 px-3 py-2 font-mono text-base lg:gap-x-2 lg:px-2 lg:py-1 lg:text-micro">
              {rows.map((r) => (
                <div key={r.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-border/50 py-2 lg:flex-nowrap lg:py-0.5">
                  <span className="text-muted">{r.label}</span>
                  <span className={cn("tabular", r.tone !== undefined ? toneClass(r.tone) : "text-fg")}>
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-2 py-2">
              <p className="mb-1 font-mono text-sm text-muted lg:text-2xs">{classroomInnerOuterMicro()}</p>
              <div className="mb-1 flex flex-wrap justify-between gap-2 font-mono text-base lg:text-micro">
                <span className="text-down">內 {innerPct.toFixed(2)}%</span>
                <span className="text-up">外 {(100 - innerPct).toFixed(2)}%</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-xs">
                <div className="bg-down" style={{ width: `${innerPct}%` }} />
                <div className="bg-up" style={{ width: `${100 - innerPct}%` }} />
              </div>
            </div>
          </div>
          <div className="flex flex-col lg:min-h-0">
            <div className="term-scroll relative z-10 px-1 pb-1 lg:min-h-0 lg:flex-1 lg:overflow-auto">
              {[...q.asks].reverse().map((lvl, i) => (
                <button
                  key={`a${i}`}
                  type="button"
                  onClick={() => clickPrice(lvl.price, "buy")}
                  className="relative z-[1] flex min-h-12 w-full items-center gap-2 px-2 py-2 font-mono text-base hover:bg-up-dim lg:min-h-0 lg:gap-1 lg:px-1 lg:py-0.5 lg:text-micro"
                >
                  <span className="w-16 shrink-0 text-right text-muted lg:w-10 lg:shrink">{formatLots(lvl.lots)}</span>
                  <div className="h-2 flex-1">
                    <div className="ml-auto h-2 bg-up/70" style={{ width: `${Math.min(100, lvl.lots / 2)}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right tabular text-up lg:w-14 lg:shrink">{formatPrice(lvl.price)}</span>
                </button>
              ))}
              <div className="my-0.5 flex flex-wrap items-center justify-center gap-2 border-y border-border py-3 font-mono text-base lg:flex-nowrap lg:py-1 lg:text-xs">
                <Arrow n={q.change} />
                <span className={cn("tabular font-medium", toneClass(q.change))}>{formatPrice(q.last)}</span>
                <span className="text-muted">1 張 = {formatMoney(q.last * LOT_SHARES)}</span>
              </div>
              {q.bids.map((lvl, i) => (
                <button
                  key={`b${i}`}
                  type="button"
                  onClick={() => clickPrice(lvl.price, "sell")}
                  className="relative z-[1] flex min-h-12 w-full items-center gap-2 px-2 py-2 font-mono text-base hover:bg-down-dim lg:min-h-0 lg:gap-1 lg:px-1 lg:py-0.5 lg:text-micro"
                >
                  <span className="w-20 shrink-0 text-left tabular text-down lg:w-14 lg:shrink">{formatPrice(lvl.price)}</span>
                  <div className="h-2 flex-1">
                    <div className="h-2 bg-down/70" style={{ width: `${Math.min(100, lvl.lots / 2)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-left text-muted lg:w-10 lg:shrink">{formatLots(lvl.lots)}</span>
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
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="px-2 py-2 text-base text-muted lg:py-1 lg:text-micro">
        成交量堆積
        {poc != null && (
          <span className="ml-2 font-mono text-fg/80">
            堆 {formatPrice(poc)}
            {poc >= q.last ? " 壓" : " 撐"}
          </span>
        )}
      </div>
      <div className="term-scroll px-1 pb-2 lg:min-h-0 lg:flex-1 lg:overflow-auto">
        {levels.length === 0 && (
          <p className="px-2 py-8 text-center text-base text-muted lg:text-xs">量還在累積。開盤後這裡會出現堆積。</p>
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
                "relative z-[1] flex min-h-12 w-full items-center gap-2 px-2 py-2 font-mono text-base hover:bg-elevated lg:min-h-0 lg:gap-1 lg:px-1 lg:py-0.5 lg:text-micro",
                atLast && "bg-header/40",
              )}
            >
              <span className={cn("w-20 shrink-0 text-right tabular lg:w-14 lg:shrink", above ? "text-up" : "text-down")}>
                {formatPrice(lvl.price)}
              </span>
              <div className="h-2.5 flex-1">
                <div
                  className={cn("h-2.5", isPoc ? "bg-vol/80" : above ? "bg-up/55" : "bg-down/55")}
                  style={{ width: `${Math.max(4, (lvl.lots / maxLots) * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-left text-muted lg:w-10 lg:shrink">{formatLots(lvl.lots)}</span>
              {isPoc && <span className="w-4 text-base text-vol lg:text-micro">堆</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
