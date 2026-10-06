import { useState } from "react";
import { TapeChart } from "@/components/charts";
import { toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import type { Quote } from "@/lib/game/types";
import { formatPrice } from "@/lib/market/ticks";
import { formatIndex } from "@/lib/market/week";
import { classroomBookMicro, classroomPathMicro, officialIndexPaneMicro } from "@/lib/provenance";
import { cn, formatLots, formatPct, formatTime } from "@/lib/utils";
import { deriveSwingHighs } from "@/lib/market/swing-highs";
import { SwingHighSummary } from "@/components/swing-high-summary";
import { SyntheticChartNotice } from "@/components/real-candles-entry";

const RANGES = [
  { minutes: 0, label: "全程" },
  { minutes: 30, label: "近 30 分" },
  { minutes: 10, label: "近 10 分" },
] as const;

export function MobileMarket() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const frame = useGame((s) => s.frame);
  const chartStyle = useGame((s) => s.chartStyle);
  const setChartStyle = useGame((s) => s.setChartStyle);
  const setTicket = useGame((s) => s.setTicket);
  const setMobileTab = useGame((s) => s.setMobileTab);
  const [bookOpen, setBookOpen] = useState(false);
  const [minutes, setMinutes] = useState<0 | 30 | 10>(0);
  void frame;

  const q = engine?.quote(selected);
  if (!engine || !q) return null;
  const idx = engine.indexQuote();
  const candles = chartStyle === "candles";
  const wave = chartStyle === "jiangbo";
  const bars = engine.bars(q.code);
  const swingHighs = wave ? deriveSwingHighs(bars, engine.t, engine.startT, engine.endT) : undefined;
  const clock = formatTime(engine.t);
  const elapsed = Math.max(0, engine.t - engine.startT);
  const range = {
    start: minutes > 0 ? Math.max(engine.startT, engine.t - minutes * 60) : engine.startT,
    end: engine.t,
  };
  const rangeNote = elapsed < 60
    ? "剛開盤，資料持續累積"
    : minutes > 0 && elapsed < minutes * 60
      ? `尚未滿 ${minutes} 分鐘，顯示目前已有資料`
      : null;
  const pos = engine.positions.get(q.code);
  const cost = pos && pos.lots !== 0 ? pos.avg : undefined;
  const quoteStats = [
    { label: "昨收", value: formatPrice(q.prevClose) },
    { label: "開盤", value: formatPrice(q.open) },
    { label: "最高", value: formatPrice(q.high) },
    { label: "最低", value: formatPrice(q.low) },
    { label: "總量", value: `${formatLots(q.volume)} 張` },
    { label: "模擬時間", value: clock },
  ];

  return (
    <section aria-label={`${q.code} ${q.name} 模擬行情`} className="mobile-market @container min-w-0 bg-bg text-fg">
      <header className="px-3 pb-3 pt-3 @min-[40rem]:px-5 @min-[40rem]:py-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 break-words text-xl font-semibold">{q.name}</h2>
          <span className="font-mono text-base text-muted">{q.code}</span>
          <span className="rounded border border-border px-2 py-1 text-sm text-muted">模擬行情</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 @min-[40rem]:gap-6">
          <div className="min-w-0 flex-1 basis-36">
            <p className="mb-1 text-sm text-muted">目前模擬價</p>
            <p className={cn("break-all font-mono text-[2.5rem] font-semibold leading-tight tabular", toneClass(q.change))}>
              {formatPrice(q.last)}
            </p>
            <p className={cn("mt-1 flex flex-wrap gap-x-2 font-mono text-base tabular", toneClass(q.change))}>
              <span>{q.change > 0 ? "▲" : q.change < 0 ? "▼" : "—"} {q.change > 0 ? "+" : q.change < 0 ? "−" : ""}{formatPrice(Math.abs(q.change))}</span>
              <span>{formatPct(q.changePct)}</span>
            </p>
          </div>
          <dl className="grid min-w-0 flex-1 basis-40 grid-cols-2 gap-2 @min-[40rem]:max-w-sm @min-[40rem]:gap-3">
            <div className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2">
              <dt className="text-base text-muted">買價</dt>
              <dd className={cn("mt-1 break-all font-mono text-lg font-semibold tabular", q.bidLots > 0 ? toneClass(q.bid - q.prevClose) : "text-muted")}>
                {q.bidLots > 0 ? formatPrice(q.bid) : "—"}
              </dd>
              <dd className="mt-1 break-words text-sm text-muted">{q.bidLots > 0 ? `${formatLots(q.bidLots)} 張` : "暫無買量"}</dd>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2">
              <dt className="text-base text-muted">賣價</dt>
              <dd className={cn("mt-1 break-all font-mono text-lg font-semibold tabular", q.askLots > 0 ? toneClass(q.ask - q.prevClose) : "text-muted")}>
                {q.askLots > 0 ? formatPrice(q.ask) : "—"}
              </dd>
              <dd className="mt-1 break-words text-sm text-muted">{q.askLots > 0 ? `${formatLots(q.askLots)} 張` : "暫無賣量"}</dd>
            </div>
          </dl>
        </div>
      </header>

      <SyntheticChartNotice />

      <div role="group" aria-label="行情檢視方式" className="grid grid-cols-4 border-y border-border">
        <button type="button" aria-pressed={!bookOpen && !candles && !wave}
          onClick={() => { setBookOpen(false); setChartStyle("tape"); }}
          className={cn("min-h-12 min-w-0 border-b-2 px-2 py-2 text-base font-semibold", !bookOpen && !candles && !wave ? "border-brand bg-elevated text-fg" : "border-transparent text-muted")}>
          分時
        </button>
        <button type="button" aria-pressed={!bookOpen && wave}
          onClick={() => { setBookOpen(false); setChartStyle("jiangbo"); }}
          className={cn("min-h-12 min-w-0 border-b-2 px-2 py-2 text-base font-semibold", !bookOpen && wave ? "border-brand bg-elevated text-fg" : "border-transparent text-muted")}>
          江波
        </button>
        <button type="button" aria-pressed={!bookOpen && candles}
          onClick={() => { setBookOpen(false); setChartStyle("candles"); }}
          className={cn("min-h-12 min-w-0 border-b-2 px-2 py-2 text-base font-semibold", !bookOpen && candles ? "border-brand bg-elevated text-fg" : "border-transparent text-muted")}>
          合成 K
        </button>
        <button type="button" aria-pressed={bookOpen} onClick={() => setBookOpen(true)}
          className={cn("min-h-12 min-w-0 border-b-2 px-2 py-2 text-base font-semibold", bookOpen ? "border-brand bg-elevated text-fg" : "border-transparent text-muted")}>
          五檔
        </button>
      </div>

      {bookOpen ? <ReadOnlyBook quote={q} /> : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pt-2">
            <span className="text-base font-medium">{candles ? "1 分鐘合成 K" : wave ? "江波圖 · 前後高" : "分時走勢"}</span>
            <span className="font-mono text-sm text-muted">模擬 {clock}</span>
          </div>
          <div role="group" aria-label="走勢時間範圍" className="grid grid-cols-3 gap-1 px-3 py-2">
            {RANGES.map((item) => (
              <button key={item.minutes} type="button" aria-pressed={minutes === item.minutes}
                onClick={() => setMinutes(item.minutes)}
                className={cn("min-h-12 min-w-0 rounded-md border px-1 py-2 text-base", minutes === item.minutes ? "border-border-strong bg-elevated text-fg" : "border-transparent text-muted")}>
                {item.label}
              </button>
            ))}
          </div>
          {rangeNote && <p className="px-3 pb-2 text-sm text-muted">{rangeNote}</p>}
          <div className="market-chart-frame h-[clamp(18rem,45dvh,28rem)] min-w-0 @min-[44rem]:h-[clamp(22rem,48dvh,32rem)]">
            <TapeChart
              bars={bars}
              ticks={engine.ticks(q.code)}
              prev={q.prevClose}
              high={q.high}
              low={q.low}
              last={q.last}
              open={q.open}
              cost={cost}
              fills={engine.fills.filter((fill) => fill.code === q.code).map((fill) => ({ t: fill.time, p: fill.price, side: fill.side }))}
              showVolume
              startT={engine.startT}
              endT={engine.endT}
              now={engine.t}
              variant={candles ? "candles" : wave ? "jiangbo" : "stock"}
              swingHighs={swingHighs?.confirmed}
              range={range}
              interactive
              ariaLabel={`${q.code} ${q.name} 模擬${candles ? "1 分鐘合成 K" : wave ? "江波圖" : "分時走勢"}與成交量，${minutes ? `近 ${minutes} 分鐘` : "本盤全程"}`}
            />
          </div>
          {swingHighs && <SwingHighSummary data={swingHighs} visibleStart={range.start} />}
          <div className="space-y-1 px-3 py-2 text-sm leading-relaxed text-muted">
            <p>點按圖表查看時間與價格，也可使用左右方向鍵。</p>
            <p>{classroomPathMicro()}</p>
          </div>
        </div>
      )}

      <div className="border-y border-border px-3 py-3">
        <p className="mb-2 text-sm text-muted">選擇方向後，前往委託頁核對價格與張數。</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => { setTicket({ side: "buy" }); setMobileTab("trade"); }}
            className="min-h-14 min-w-0 rounded-lg border border-up bg-up/10 px-3 py-2 text-lg font-semibold text-up">
            買進 · 填委託
          </button>
          <button type="button" onClick={() => { setTicket({ side: "sell" }); setMobileTab("trade"); }}
            className="min-h-14 min-w-0 rounded-lg border border-down bg-down/10 px-3 py-2 text-lg font-semibold text-down">
            賣出 · 填委託
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-3 py-4 @min-[40rem]:grid-cols-3 @min-[40rem]:gap-x-6 @min-[40rem]:px-5">
        {quoteStats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <dt className="text-base text-muted">{stat.label}</dt>
            <dd className="min-w-0 break-all font-mono text-base tabular">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <details className="border-t border-border">
        <summary className="min-h-12 cursor-pointer px-3 py-3 text-base font-medium">加權指數參考</summary>
        <div className="px-3 pb-4">
          <p className={cn("flex flex-wrap gap-x-3 gap-y-1 font-mono text-lg tabular", toneClass(idx.change))}>
            <span>{formatIndex(idx.last)}</span>
            <span>{formatPct(idx.changePct)}</span>
          </p>
          <p className="mt-2 text-base text-muted">成交 {idx.turnoverYi.toFixed(2)} 億</p>
          <p className="mt-2 break-words text-sm leading-relaxed text-muted">{officialIndexPaneMicro(clock, engine.session.date)}</p>
        </div>
      </details>
    </section>
  );
}

function ReadOnlyBook({ quote }: { quote: Quote }) {
  const bids = quote.bids.filter((level) => level.lots > 0).slice(0, 5);
  const asks = quote.asks.filter((level) => level.lots > 0).slice(0, 5);
  return (
    <div className="px-3 py-3">
      <p className="mb-3 text-base leading-relaxed text-muted">五檔僅供查看；填寫委託請使用下方買進／賣出。</p>
      <table className="w-full table-fixed border-collapse text-base">
        <caption className="sr-only">模擬五檔報價，張數為目前顯示量，不保證成交。</caption>
        <thead>
          <tr className="border-b border-border text-muted">
            <th scope="col" className="px-1 py-2 text-left font-normal">買量</th>
            <th scope="col" className="px-1 py-2 text-right font-normal">買價</th>
            <th scope="col" className="px-1 py-2 text-left font-normal">賣價</th>
            <th scope="col" className="px-1 py-2 text-right font-normal">賣量</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(bids.length, asks.length, 1) }, (_, index) => {
            const bid = bids[index];
            const ask = asks[index];
            return (
              <tr key={index} className="border-b border-border/60 font-mono tabular">
                <td className="break-all px-1 py-3 text-left text-muted">{bid ? formatLots(bid.lots) : "—"}</td>
                <td className={cn("break-all px-1 py-3 text-right", bid ? toneClass(bid.price - quote.prevClose) : "text-muted")}>{bid ? formatPrice(bid.price) : "—"}</td>
                <td className={cn("break-all px-1 py-3 text-left", ask ? toneClass(ask.price - quote.prevClose) : "text-muted")}>{ask ? formatPrice(ask.price) : "—"}</td>
                <td className="break-all px-1 py-3 text-right text-muted">{ask ? formatLots(ask.lots) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-sm leading-relaxed text-muted">量的單位為張。沒有可見量時顯示「—」，不代表可以成交。</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{classroomBookMicro()}</p>
    </div>
  );
}
