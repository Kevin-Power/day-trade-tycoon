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

function focusOrderTicket() {
  requestAnimationFrame(() => {
    const ticket = [...document.querySelectorAll<HTMLElement>("[data-order-ticket-start]")].find(
      (element) => element.getClientRects().length > 0,
    );
    ticket?.scrollIntoView({ block: "start", behavior: "auto" });
    ticket?.focus({ preventScroll: true });
  });
}

export function QuotePanel() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const clickPrice = useGame((s) => s.clickPrice);
  const flashOrder = useGame((s) => s.flashOrder);
  const setFlashOrder = useGame((s) => s.setFlashOrder);
  const setMobileTab = useGame((s) => s.setMobileTab);
  const ticketSide = useGame((s) => s.ticket.side);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<QuoteTab>("book");
  void frame;
  const q = engine?.quote(selected);
  if (!q) return null;
  function pickPrice(price: number, side: "buy" | "sell") {
    clickPrice(price, side);
    if (!flashOrder) focusOrderTicket();
  }

  const innerPct = q.inner + q.outer === 0 ? 50 : (q.inner / (q.inner + q.outer)) * 100;
  const rows: { label: string; value: string; tone?: number }[] = [
    { label: "成交", value: formatPrice(q.last), tone: q.change },
    {
      label: "漲跌",
      value: `${q.change >= 0 ? "▲" : "▼"} ${formatPrice(Math.abs(q.change))}`,
      tone: q.change,
    },
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
    <div className="quote-panel @container relative z-10 flex h-auto min-w-0 flex-col bg-bg">
      <div className="pane-title flex h-auto flex-wrap items-center gap-2 px-3 py-1" role="group" aria-label="報價內容">
        {(
          [
            ["book", "五檔"],
            ["ladder", "分價"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "min-h-12 min-w-12 rounded-md px-3 py-2 text-base leading-relaxed tracking-wide",
              tab === id ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto min-w-0 break-words px-1 text-base text-fg/80">
          {q.code} {q.name}
        </span>
        <ProvenanceBadge kind="classroom" className="text-sm" />
      </div>
      <ProvenanceMicro
        className="text-sm"
        text={tab === "book" ? classroomBookMicro() : classroomTapeMicro()}
      />
      <div className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-3">
        <div className="min-w-0 flex-1 basis-48 text-base leading-relaxed">
          <p className={flashOrder ? "text-tape" : "text-muted"}>
            {flashOrder
              ? "閃電開啟：點價可能立即送出模擬委託"
              : "點價帶入方向與價格，再回下單區核對。要快速送單，請先進入「閃電下單」。"}
          </p>
          {flashOrder && (
            <p className="mt-1 text-sm text-muted">仍依教學／測驗限制判定是否送出。</p>
          )}
          {tab === "ladder" && (
            <p className="mt-1 text-muted">
              分價點價沿用委託單目前的「{ticketSide === "buy" ? "買進" : "賣出"}」方向。
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => flashOrder ? setFlashOrder(false) : setMobileTab("flash")}
          className={cn(
            "min-h-12 min-w-12 max-w-full whitespace-normal rounded-md border border-border px-3 py-2 text-base leading-relaxed",
            flashOrder ? "bg-header-2 text-tape" : "text-muted hover:text-fg",
          )}
        >
          {flashOrder ? "關閉閃電下單" : "前往閃電下單"}
        </button>
      </div>
      {tab === "book" ? (
        <div className="grid grid-cols-1 @min-[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="border-b border-border @min-[44rem]:border-b-0 @min-[44rem]:border-r">
            <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-2">
              <p className="font-mono text-sm leading-relaxed text-muted">
                {officialDailyOhlcMicro(freezeWeekLabel(engine?.session.date))}
              </p>
              {engine?.session.date && TEACHING_DATES.has(engine.session.date) ? (
                <AuxChip className="text-sm">{AUX_FROZEN}</AuxChip>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-x-3 px-3 py-2 font-mono text-base lg:gap-x-2">
              {rows.map((r) => (
                <div
                  key={r.label}
                  className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-border/50 py-2"
                >
                  <span className="text-muted">{r.label}</span>
                  <span
                    className={cn("tabular", r.tone !== undefined ? toneClass(r.tone) : "text-fg")}
                  >
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-2 py-2">
              <p className="mb-1 font-mono text-sm text-muted">
                {classroomInnerOuterMicro()}
              </p>
              <div className="mb-1 flex flex-wrap justify-between gap-2 font-mono text-base">
                <span className="text-down">內 {innerPct.toFixed(2)}%</span>
                <span className="text-up">外 {(100 - innerPct).toFixed(2)}%</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-xs">
                <div className="bg-down" style={{ width: `${innerPct}%` }} />
                <div className="bg-up" style={{ width: `${100 - innerPct}%` }} />
              </div>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="term-scroll relative z-10 px-1 pb-1">
              <p className="px-2 py-2 text-base font-semibold leading-relaxed text-up">
                賣方報價 · 點選買進
              </p>
              {[...q.asks].reverse().map((lvl, i) => (
                <button
                  key={`a${i}`}
                  type="button"
                  aria-label={`賣方第 ${q.asks.length - i} 檔，價格 ${formatPrice(lvl.price)} 元，對手量 ${formatLots(lvl.lots)} 張；${flashOrder ? "以目前張數送出模擬買進" : "帶入買進方向及價格，回下單區核對"}`}
                  onClick={() => pickPrice(lvl.price, "buy")}
                  onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
                  className="relative z-[1] flex min-h-12 w-full flex-wrap items-center gap-2 rounded border-b border-border/50 px-2 py-2 font-mono text-base hover:bg-up-dim"
                >
                  <span className="w-full text-left font-sans text-up">
                    {flashOrder ? "立即送出買進" : "帶入買進"}
                  </span>
                  <span className="min-w-0 break-all text-left text-muted">
                    {formatLots(lvl.lots)} 張
                  </span>
                  <div className="h-2 min-w-4 flex-1" aria-hidden="true">
                    <div
                      className="ml-auto h-2 bg-up/70"
                      style={{ width: `${Math.min(100, lvl.lots / 2)}%` }}
                    />
                  </div>
                  <span className="min-w-0 break-all text-right tabular text-up">
                    {formatPrice(lvl.price)} 元
                  </span>
                </button>
              ))}
              <div className="my-0.5 flex flex-wrap items-center justify-center gap-2 border-y border-border py-3 font-mono text-base">
                <Arrow n={q.change} />
                <span className={cn("tabular font-medium", toneClass(q.change))}>
                  {formatPrice(q.last)}
                </span>
                <span className="text-muted">1 張 = {formatMoney(q.last * LOT_SHARES)}</span>
              </div>
              <p className="px-2 py-2 text-base font-semibold leading-relaxed text-down">
                買方報價 · 點選賣出
              </p>
              {q.bids.map((lvl, i) => (
                <button
                  key={`b${i}`}
                  type="button"
                  aria-label={`買方第 ${i + 1} 檔，價格 ${formatPrice(lvl.price)} 元，對手量 ${formatLots(lvl.lots)} 張；${flashOrder ? "以目前張數送出模擬賣出" : "帶入賣出方向及價格，回下單區核對"}`}
                  onClick={() => pickPrice(lvl.price, "sell")}
                  onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
                  className="relative z-[1] flex min-h-12 w-full flex-wrap items-center gap-2 rounded border-b border-border/50 px-2 py-2 font-mono text-base hover:bg-down-dim"
                >
                  <span className="w-full text-left font-sans text-down">
                    {flashOrder ? "立即送出賣出" : "帶入賣出"}
                  </span>
                  <span className="min-w-0 break-all text-left tabular text-down">
                    {formatPrice(lvl.price)} 元
                  </span>
                  <div className="h-2 min-w-4 flex-1" aria-hidden="true">
                    <div
                      className="h-2 bg-down/70"
                      style={{ width: `${Math.min(100, lvl.lots / 2)}%` }}
                    />
                  </div>
                  <span className="min-w-0 break-all text-left text-muted">
                    {formatLots(lvl.lots)} 張
                  </span>
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
  const flashOrder = useGame((s) => s.flashOrder);
  const ticketSide = useGame((s) => s.ticket.side);
  const frame = useGame((s) => s.frame);
  void frame;
  const q = engine?.quote(selected);
  const levels = engine?.priceLevels(selected) ?? [];
  if (!q) return null;
  const maxLots = Math.max(...levels.map((l) => l.lots), 1);
  const poc = engine?.poc(selected);

  return (
    <div className="flex flex-col">
      <div className="px-2 py-2 text-base text-muted">
        成交量堆積
        {poc != null && (
          <span className="ml-2 font-mono text-fg/80">
            堆 {formatPrice(poc)}
            {poc >= q.last ? " 壓" : " 撐"}
          </span>
        )}
      </div>
      <div className="term-scroll px-1 pb-2">
        {levels.length === 0 && (
          <p className="px-2 py-8 text-center text-base text-muted">
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
              aria-label={`分價 ${formatPrice(lvl.price)} 元，成交量 ${formatLots(lvl.lots)} 張；沿用${ticketSide === "buy" ? "買進" : "賣出"}方向，${flashOrder ? "以目前張數送出模擬委託" : "帶入價格後回下單區核對"}`}
              onClick={() => {
                clickPrice(lvl.price);
                if (!flashOrder) focusOrderTicket();
              }}
              onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
              className={cn(
                "relative z-[1] flex min-h-12 w-full items-center gap-2 px-2 py-2 font-mono text-base hover:bg-elevated",
                atLast && "bg-header/40",
              )}
            >
              <span
                className={cn(
                  "w-20 shrink-0 text-right tabular",
                  above ? "text-up" : "text-down",
                )}
              >
                {formatPrice(lvl.price)}
              </span>
              <div className="h-2.5 flex-1">
                <div
                  className={cn("h-2.5", isPoc ? "bg-vol/80" : above ? "bg-up/55" : "bg-down/55")}
                  style={{ width: `${Math.max(4, (lvl.lots / maxLots) * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-left text-muted">
                {formatLots(lvl.lots)}
              </span>
              {isPoc && <span className="w-4 text-base text-vol">堆</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
