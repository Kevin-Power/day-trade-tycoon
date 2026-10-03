import { useEffect, useRef, useState } from "react";
import { ChartNoAxesCombined, ListFilter, Moon, Package, PanelTop, Sun } from "lucide-react";
import { AccountBar, NewsBar } from "@/components/account-bar";
import { TapeChart } from "@/components/charts";
import { LessonCard } from "@/components/lesson-card";
import { OrderTicket } from "@/components/order-ticket";
import { PositionsDock } from "@/components/positions";
import { QuotePanel } from "@/components/quote-book";
import { ResultScreen } from "@/components/result-screen";
import { Watchlist } from "@/components/watchlist";
import { persistOnHide, useGame, type MobileTab } from "@/lib/game/store";
import { lessonById } from "@/lib/game/curriculum";
import { venueLabel } from "@/lib/broker";
import { cn, formatPct, formatTime } from "@/lib/utils";
import { Arrow, toneClass } from "@/components/signed";
import { formatPrice } from "@/lib/market/ticks";
import { formatIndex } from "@/lib/market/week";
import { CoachCorner, ProvenanceBadge, ProvenanceMicro, SimChip } from "@/components/provenance";
import { classroomPathMicro, officialIndexPaneMicro } from "@/lib/provenance";
import { MobileMarket } from "@/components/mobile-market";

const MOBILE_TABS = [
  { id: "watch", label: "自選行情", icon: ListFilter },
  { id: "chart", label: "走勢圖", icon: ChartNoAxesCombined },
  { id: "trade", label: "模擬下單", icon: PanelTop },
  { id: "pos", label: "庫存成交", icon: Package },
] satisfies { id: MobileTab; label: string; icon: typeof ListFilter }[];

export function Terminal() {
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const selected = useGame((s) => s.selected);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const bump = useGame((s) => s.bump);
  const togglePause = useGame((s) => s.togglePause);
  const dismissBeat = useGame((s) => s.dismissBeat);
  const phase = useGame((s) => s.phase);
  const mobileTab = useGame((s) => s.mobileTab);
  const setMobileTab = useGame((s) => s.setMobileTab);
  const activeBeat = useGame((s) => s.activeBeat);
  const venue = useGame((s) => s.venue);
  const frame = useGame((s) => s.frame);
  const raf = useRef(0);
  const last = useRef(0);
  const acc = useRef(0);
  const uiAcc = useRef(0);
  const [marketTheme, setMarketTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("day-tycoon-market-theme-v1");
      if (saved === "light" || saved === "dark") setMarketTheme(saved);
    } catch { /* A blocked preference store does not prevent practice. */ }
  }, []);

  function toggleTheme() {
    const next = marketTheme === "dark" ? "light" : "dark";
    setMarketTheme(next);
    try { localStorage.setItem("day-tycoon-market-theme-v1", next); } catch { /* Session-only preference. */ }
  }

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
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,button,a,summary,canvas,[contenteditable=true],[role=dialog]"))
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (useGame.getState().activeBeat) dismissBeat();
        else togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, dismissBeat]);

  if (!engine || !scenario) return null;
  const q = engine.quote(selected);
  const idx = engine.indexQuote();
  const lesson = lessonById(scenario.id);
  void frame;

  return (
    <div data-market-theme={marketTheme} data-mobile-view={mobileTab} className="terminal-shell relative flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <div className={mobileTab === "chart" ? "hidden lg:contents" : "contents"}>
      <TopMenu
        name={lesson ? `${lesson.no} ${scenario.name}` : scenario.name}
        paused={paused}
        speed={speed}
        code={selected}
        date={engine.session.label}
        venue={venueLabel(venue)}
        theme={marketTheme}
        onToggleTheme={toggleTheme}
      />
      <AccountBar />
      <NewsBar />
      </div>
      {mobileTab === "chart" && (
        <div className="shrink-0 border-b border-border bg-bg lg:hidden">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm text-muted">當沖大富翁 · 模擬看盤</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={togglePause} className="min-h-12 rounded-lg bg-brand px-3 text-sm font-semibold text-brand-fg">
                {paused ? "繼續練習" : "暫停"}
              </button>
              <ThemeButton theme={marketTheme} onToggle={toggleTheme} />
            </div>
          </div>
          <details className="market-practice-controls">
            <summary className="min-h-12 cursor-pointer px-3 py-3 text-sm text-muted">
              練習控制 · {paused ? "已暫停" : `${speed} 倍速`} · {formatTime(engine.t)}
            </summary>
            <AccountBar />
            <NewsBar />
          </details>
          {engine.warning ? <p role="status" className="px-3 pb-2 text-sm leading-6 text-warn">{engine.warning}</p> : null}
        </div>
      )}

      <div className="term-mobile min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mobileTab === "watch" && <Watchlist />}
          {mobileTab === "chart" && (
            <MobileMarket />
          )}
          {mobileTab === "trade" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <OrderTicket />
              <div className="min-h-48 shrink-0 border-t border-border">
                <QuotePanel />
              </div>
            </div>
          )}
          {mobileTab === "pos" && <PositionsDock />}
        </div>
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
        <div className="term-quote relative z-20 isolate min-h-0 overflow-hidden">
          <QuotePanel />
        </div>
        <div className="term-ticket relative z-10 min-h-0 overflow-auto">
          <OrderTicket />
        </div>
        <div className="term-pos min-h-0 overflow-hidden">
          <PositionsDock />
        </div>
      </div>

      <footer className="relative z-0 flex shrink-0 items-center justify-between border-t border-border bg-surface-2 px-2 py-1 text-2xs text-muted">
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
          加權 {formatIndex(idx.last)} {formatPct(idx.changePct)} · {idx.turnoverYi.toFixed(0)} 億 ·
          聚焦送出按鈕後按 Enter · Space 暫停
        </span>
        <span className="term-mobile-nav">{formatTime(engine.t)}</span>
      </footer>

      <nav
        aria-label="模擬操作區"
        className="term-mobile-nav grid grid-cols-4 border-t border-border bg-surface"
      >
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            id={`mobile-tab-${t.id}`}
            type="button"
            onClick={() => setMobileTab(t.id)}
            aria-current={mobileTab === t.id ? "page" : undefined}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 border-t-2 text-xs",
              mobileTab === t.id
                ? "border-brand bg-brand/10 text-brand"
                : "border-transparent text-muted",
            )}
          >
            <t.icon className="size-5" aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>

      {phase === "result" && <ResultScreen />}
      <CoachCorner />
      <LessonCard />
      {paused && phase === "live" && !activeBeat && (
        <div className={cn("pointer-events-none absolute inset-x-0 top-24 flex justify-center", mobileTab === "chart" && "hidden lg:flex")}>
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
  theme,
  onToggleTheme,
}: {
  name: string;
  paused: boolean;
  speed: number;
  code: string;
  date: string;
  venue: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  return (
    <div className="flex min-h-12 min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-1 px-3 py-1 text-xs lg:flex-nowrap lg:py-0">
      <MarkTiny />
      <span className="shrink-0 font-medium tracking-wide">當沖大富翁</span>
      <SimChip label={venue} />
      <ThemeButton theme={theme} onToggle={onToggleTheme} />
      <span className="hidden rounded-xs border border-border-strong/60 px-1.5 py-0.5 text-2xs text-fg/85 sm:inline">
        現股當沖
      </span>
      <span className="ml-1 hidden items-center gap-1 rounded-xs border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-micro sm:flex">
        {code}.TW
      </span>
      <span className="ml-auto min-w-0 basis-full break-words font-mono text-micro text-fg/80 lg:basis-auto lg:truncate">
        {name.startsWith(date) ? name : `${date} · ${name}`} · {paused ? "暫停" : `${speed}x`}
      </span>
    </div>
  );
}

function ThemeButton({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      aria-label={theme === "dark" ? "切換明亮看盤" : "切換深色看盤"}
      className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm text-fg lg:min-h-9">
      {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      {theme === "dark" ? "明亮" : "深色"}
    </button>
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

function IndexPane() {
  const engine = useGame((s) => s.engine);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const idx = engine.indexQuote();
  const asOf = formatTime(engine.t);
  return (
    <div className="flex h-full min-h-80 flex-col bg-bg lg:min-h-0">
      <div className="pane-title flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 lg:h-7 lg:flex-nowrap lg:overflow-hidden lg:px-2 lg:py-0">
        <span className="text-base lg:shrink-0 lg:text-xs">加權指數</span>
        <span className="font-mono text-base tabular text-fg/80 lg:shrink-0 lg:text-micro">
          {asOf}
        </span>
        <span
          className={cn(
            "flex flex-wrap gap-x-2 font-mono text-base tabular lg:shrink-0 lg:gap-x-1 lg:text-xs",
            toneClass(idx.change),
          )}
        >
          <span>{formatIndex(idx.last)}</span>
          <span>
            {idx.change >= 0 ? "▲" : "▼"}
            {Math.abs(idx.change).toFixed(2)}
          </span>
          <span>{formatPct(idx.changePct)}</span>
        </span>
        <span className="font-mono text-base text-fg/80 lg:ml-auto lg:truncate lg:text-micro">
          成交 {idx.turnoverYi.toFixed(2)} 億
        </span>
        <ProvenanceBadge kind="official" className="text-sm lg:text-2xs" />
      </div>
      <ProvenanceMicro
        text={officialIndexPaneMicro(asOf, engine.session.date)}
        className="shrink-0 text-sm lg:text-2xs"
      />
      <div className="pane-sunken min-h-48 flex-1 bg-bg lg:min-h-36">
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

function SelectedChart() {
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
  const candles = chartStyle === "candles";
  return (
    <div className="flex h-full min-h-88 flex-col bg-bg lg:min-h-0">
      <div className="pane-title flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 lg:h-7 lg:flex-nowrap lg:px-2 lg:py-0">
        <span className="min-w-0 basis-full break-words text-base lg:shrink-0 lg:basis-auto lg:text-xs">
          {candles ? "K 線" : wave ? "江波圖" : "分時"} {q.code} {q.name}
        </span>
        <div className="flex items-center gap-2 lg:gap-0.5" role="group" aria-label="走勢圖類型">
          <button
            type="button"
            onClick={() => setChartStyle("jiangbo")}
            aria-pressed={wave}
            className={cn(
              "min-h-12 min-w-16 rounded-md border border-border px-3 text-base tracking-wide lg:h-5 lg:min-h-0 lg:min-w-0 lg:rounded-xs lg:border-0 lg:px-1.5 lg:text-micro",
              wave ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            江波
          </button>
          <button
            type="button"
            onClick={() => setChartStyle("tape")}
            aria-pressed={chartStyle === "tape"}
            className={cn(
              "min-h-12 min-w-16 rounded-md border border-border px-3 text-base tracking-wide lg:h-5 lg:min-h-0 lg:min-w-0 lg:rounded-xs lg:border-0 lg:px-1.5 lg:text-micro",
              chartStyle === "tape" ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            分時
          </button>
          <button type="button" onClick={() => setChartStyle("candles")} aria-pressed={candles}
            className={cn("min-h-12 min-w-16 rounded-md border border-border px-3 text-base lg:h-5 lg:min-h-0 lg:min-w-0 lg:rounded-xs lg:border-0 lg:px-1.5 lg:text-micro", candles ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg")}>
            K 線
          </button>
        </div>
        <span
          className={cn(
            "flex min-w-0 flex-wrap gap-x-2 font-mono text-base tabular lg:ml-auto lg:shrink-0 lg:gap-x-1 lg:text-xs",
            toneClass(q.change),
          )}
        >
          <span>{formatPrice(q.last)}</span>
          <span>{formatPct(q.changePct)}</span>
          <span>{q.volume} 張</span>
        </span>
        <ProvenanceBadge kind="classroom" className="text-sm lg:text-2xs" />
      </div>
      <ProvenanceMicro text={classroomPathMicro()} className="shrink-0 text-sm lg:text-2xs" />
      <div className="pane-sunken min-h-52 flex-1 bg-bg lg:min-h-40">
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
          variant={candles ? "candles" : wave ? "jiangbo" : "stock"}
        />
      </div>
    </div>
  );
}
