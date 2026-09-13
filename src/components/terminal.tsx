import { Monitor, Smartphone, SquareDashed } from "lucide-react";
import { useEffect, useRef } from "react";
import { AccountBar, NewsBar } from "@/components/account-bar";
import { TapeChart } from "@/components/charts";
import { LessonCard } from "@/components/lesson-card";
import { OrderTicket } from "@/components/order-ticket";
import { PositionsDock } from "@/components/positions";
import { QuotePanel } from "@/components/quote-book";
import { ResultScreen } from "@/components/result-screen";
import { Watchlist } from "@/components/watchlist";
import { persistOnHide, useGame } from "@/lib/game/store";
import { lessonById } from "@/lib/game/curriculum";
import { venueLabel } from "@/lib/broker";
import { cn, formatPct, formatTime } from "@/lib/utils";
import { Arrow, toneClass } from "@/components/signed";
import { formatPrice } from "@/lib/market/ticks";
import { formatIndex } from "@/lib/market/week";

export function Terminal() {
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const selected = useGame((s) => s.selected);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const bump = useGame((s) => s.bump);
  const submit = useGame((s) => s.submit);
  const togglePause = useGame((s) => s.togglePause);
  const dismissBeat = useGame((s) => s.dismissBeat);
  const phase = useGame((s) => s.phase);
  const venue = useGame((s) => s.venue);
  const frame = useGame((s) => s.frame);
  const layoutMode = useGame((s) => s.layoutMode);
  const activeBeat = useGame((s) => s.activeBeat);
  const raf = useRef(0);
  const last = useRef(0);
  const acc = useRef(0);
  const uiAcc = useRef(0);

  useEffect(() => {
    last.current = performance.now();
    const loop = (now: number) => {
      const raw = Math.min(0.1, (now - last.current) / 1000);
      last.current = now;
      const st = useGame.getState();
      if (st.engine && !st.paused && st.phase === "live") {
        acc.current += raw * st.speed;
        const step = acc.current;
        if (step >= 0.25) {
          st.engine.step(step);
          acc.current = 0;
          st.checkBeats();
          if (st.engine.ended) {
            st.settle();
          }
        }
        uiAcc.current += raw;
        if (uiAcc.current >= 0.12) {
          uiAcc.current = 0;
          bump();
        }
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [bump]);

  useEffect(() => {
    const onHide = () => {
      if (document.hidden) persistOnHide();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        const st = useGame.getState();
        if (st.briefingOpen) st.dismissBriefing();
        else if (st.activeBeat) dismissBeat();
        else togglePause();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (useGame.getState().activeBeat || useGame.getState().briefingOpen) return;
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, togglePause, dismissBeat]);

  if (!engine || !scenario) return null;
  const q = engine.quote(selected);
  const idx = engine.indexQuote();
  const lesson = lessonById(scenario.id);
  void frame;
  const layoutClass = layoutMode === "phone" ? "layout-phone" : layoutMode === "desk" ? "layout-desk" : "layout-auto";

  return (
    <div className={cn("relative flex h-dvh min-h-0 flex-col overflow-x-hidden bg-bg text-fg", layoutClass)}>
      <TopMenu
        name={lesson ? `${lesson.no} ${scenario.name}` : scenario.name}
        paused={paused}
        speed={speed}
        code={selected}
        date={engine.session.label}
        venue={venueLabel(venue)}
      />
      <AccountBar />
      <NewsBar />

      <div className="term-phone min-h-0 flex-1 flex-col">
        <IndexLine />
        <Watchlist variant="chips" />
        <div className="term-phone-chart overflow-hidden border-b border-border">
          <SelectedChart compact />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <QuotePanel compact />
        </div>
        <OrderTicket variant="phone" />
      </div>

      <div className="term-desk term-grid min-h-0 flex-1 gap-px bg-border">
        <div className="term-watch min-h-0 overflow-hidden">
          <Watchlist />
        </div>
        <div className="term-index min-h-0 overflow-hidden">
          <IndexPane />
        </div>
        <div className="term-chart min-h-0 overflow-hidden">
          <SelectedChart />
        </div>
        <div className="term-quote min-h-0 overflow-hidden">
          <QuotePanel />
        </div>
        <div className="term-ticket min-h-0 overflow-auto">
          <OrderTicket />
        </div>
        <div className="term-pos min-h-0 overflow-hidden">
          <PositionsDock />
        </div>
      </div>

      <footer className="hidden items-center justify-between border-t border-border bg-surface-2 px-2 py-1 text-2xs text-muted sm:flex">
        <span>
          {q ? (
            <>
              {q.code} {q.name} <Arrow n={q.change} />{" "}
              <span className={toneClass(q.change)}>{formatPrice(q.last)}</span>{" "}
              <span className={toneClass(q.changePct)}>{formatPct(q.changePct)}</span>
            </>
          ) : null}
        </span>
        <span className="hidden font-mono sm:inline">
          加權 {formatIndex(idx.last)} {formatPct(idx.changePct)} · {idx.turnoverYi.toFixed(0)} 億 · Enter 送單 · Space 暫停
        </span>
      </footer>

      {phase === "result" && <ResultScreen />}
      <LessonCard />
      {paused && phase === "live" && !activeBeat && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
          <div className="rounded-sm border border-border bg-surface/95 px-3 py-1 text-xs text-muted">
            已暫停 · 可繼續下單，時間軸凍結
          </div>
        </div>
      )}
    </div>
  );
}

function TopMenu({
  name,
  paused,
  speed,
  code,
  date,
  venue,
}: {
  name: string;
  paused: boolean;
  speed: number;
  code: string;
  date: string;
  venue: string;
}) {
  const layoutMode = useGame((s) => s.layoutMode);
  const setLayoutMode = useGame((s) => s.setLayoutMode);
  return (
    <div className="flex h-9 items-center gap-2 border-b border-border bg-header px-2 text-xs">
      <MarkTiny />
      <span className="font-medium tracking-wide">當沖大富翁</span>
      <span className="rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape">{venue}</span>
      <span className="hidden rounded-xs border border-border-strong/60 px-1.5 py-0.5 text-2xs text-fg/85 sm:inline">
        現股當沖
      </span>
      <span className="ml-1 hidden items-center gap-1 rounded-xs border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-micro sm:flex">
        {code}.TW
      </span>
      <span className="ml-auto truncate font-mono text-micro text-fg/80">
        {name.startsWith(date) ? name : `${date} · ${name}`} · {paused ? "PAUSE" : `${speed}x`}
      </span>
      <div className="flex overflow-hidden rounded-xs border border-border-strong/60">
        {(
          [
            ["auto", SquareDashed, "自動"],
            ["desk", Monitor, "桌機"],
            ["phone", Smartphone, "手機"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setLayoutMode(id)}
            className={cn("grid size-7 place-items-center", layoutMode === id ? "bg-header-2 text-fg" : "text-fg/70")}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MarkTiny() {
  return (
    <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden>
      <rect width="36" height="36" fill="#0c1016" />
      <path d="M8 24 V14 H11 V24 Z" fill="#ff3b3b" />
      <path d="M16 24 V18 H19 V24 Z" fill="#8b9bb0" />
      <path d="M24 24 V11 H27 V24 Z" fill="#17c964" />
    </svg>
  );
}

function IndexLine() {
  const engine = useGame((s) => s.engine);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const idx = engine.indexQuote();
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-surface px-2 font-mono text-sm">
      <span className="text-muted">加權</span>
      <span className={cn("tabular", toneClass(idx.change))}>
        {formatIndex(idx.last)} {formatPct(idx.changePct)}
      </span>
      <span className="ml-auto tabular text-muted">{formatTime(engine.t)}</span>
    </div>
  );
}

function IndexPane() {
  const engine = useGame((s) => s.engine);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const idx = engine.indexQuote();
  return (
    <div className="flex min-h-0 flex-col bg-bg">
      <div className="pane-title flex h-7 shrink-0 items-center gap-x-3 overflow-hidden px-2">
        <span className="shrink-0">加權指數</span>
        <span className="shrink-0 font-mono text-micro tabular text-fg/80">{formatTime(engine.t)}</span>
        <span className={cn("shrink-0 font-mono tabular", toneClass(idx.change))}>
          {formatIndex(idx.last)} {idx.change >= 0 ? "▲" : "▼"}
          {Math.abs(idx.change).toFixed(2)} {formatPct(idx.changePct)}
        </span>
        <span className="ml-auto truncate font-mono text-micro text-fg/80">
          成交 {idx.turnoverYi.toFixed(2)} 億
        </span>
      </div>
      <div className="pane-sunken min-h-36 flex-1 bg-bg">
        <TapeChart
          bars={engine.indexBars}
          ticks={engine.indexTicks}
          prev={idx.prev}
          high={idx.high}
          low={idx.low}
          last={idx.last}
          showVolume
          startT={engine.startT}
          endT={engine.endT}
          now={engine.t}
          variant="index"
        />
      </div>
    </div>
  );
}

function SelectedChart({ compact = false }: { compact?: boolean }) {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const chartStyle = useGame((s) => s.chartStyle);
  const setChartStyle = useGame((s) => s.setChartStyle);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const q = engine.quote(selected);
  if (!q) return null;
  const pos = engine.positions.get(q.code);
  const cost = pos && pos.lots !== 0 ? pos.avg : undefined;
  const wave = chartStyle === "jiangbo";
  return (
    <div className="flex min-h-0 flex-col bg-bg">
      <div className="pane-title flex h-7 items-center gap-2 px-2">
        <span className="shrink-0">
          {wave ? "江波圖" : "分時"} {q.code} {q.name}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setChartStyle("jiangbo")}
            className={cn(
              "h-5 rounded-xs px-1.5 text-micro tracking-wide",
              wave ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            江波
          </button>
          <button
            type="button"
            onClick={() => setChartStyle("tape")}
            className={cn(
              "h-5 rounded-xs px-1.5 text-micro tracking-wide",
              !wave ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            分時
          </button>
        </div>
        <span className={cn("ml-auto shrink-0 font-mono tabular", toneClass(q.change))}>
          {formatPrice(q.last)} {formatPct(q.changePct)}
          {compact ? "" : ` · ${q.volume} 張`}
        </span>
      </div>
      <div className={cn("pane-sunken flex-1 bg-bg", compact ? "min-h-0" : "min-h-40")}>
        <TapeChart
          bars={engine.bars(q.code)}
          ticks={engine.ticks(q.code)}
          prev={q.prevClose}
          high={q.high}
          low={q.low}
          last={q.last}
          open={q.open}
          cost={cost}
          poc={engine.poc(q.code) ?? undefined}
          fills={engine.fills
            .filter((f) => f.code === q.code)
            .map((f) => ({ t: f.time, p: f.price, side: f.side }))}
          newsAt={engine.session.headlines.map((h) => h.atMinute * 60)}
          showVolume
          startT={engine.startT}
          endT={engine.endT}
          now={engine.t}
          variant={wave ? "jiangbo" : "stock"}
        />
      </div>
    </div>
  );
}
