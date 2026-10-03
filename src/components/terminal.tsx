import { useEffect, useRef, useState } from "react";
import { ChartNoAxesCombined, ListFilter, Moon, Package, PanelTop, Sun, Zap } from "lucide-react";
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
import { ProvenanceBadge, ProvenanceMicro, SimChip } from "@/components/provenance";
import { classroomPathMicro, officialIndexPaneMicro } from "@/lib/provenance";
import { MobileMarket } from "@/components/mobile-market";
import { DisplayControls } from "@/components/display-controls";
import { LightningOrder } from "@/components/lightning-order";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useTerminalLayout } from "@/lib/use-terminal-layout";
import { deriveSwingHighs } from "@/lib/market/swing-highs";
import { SwingHighSummary } from "@/components/swing-high-summary";

const MOBILE_TABS = [
  { id: "watch", label: "自選行情", icon: ListFilter },
  { id: "chart", label: "走勢圖", icon: ChartNoAxesCombined },
  { id: "trade", label: "模擬下單", icon: PanelTop },
  { id: "pos", label: "庫存成交", icon: Package },
  { id: "flash", label: "閃電下單", icon: Zap },
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
  const venue = useGame((s) => s.venue);
  const frame = useGame((s) => s.frame);
  const raf = useRef(0);
  const last = useRef(0);
  const acc = useRef(0);
  const uiAcc = useRef(0);
  const [marketTheme, setMarketTheme] = useState<"dark" | "light">("dark");
  const { mode } = useDisplayPreferences();
  const senior = mode === "senior";
  const layout = useTerminalLayout(senior);
  const singlePane = layout === "phone" || layout === "senior";
  const activeView = !singlePane && mobileTab === "watch" ? "chart" : mobileTab;
  const shellRef = useRef<HTMLDivElement>(null);
  const previousView = useRef(activeView);

  useEffect(() => {
    if (previousView.current === activeView) return;
    previousView.current = activeView;
    const frameId = requestAnimationFrame(() => {
      const pane = shellRef.current?.querySelector<HTMLElement>(`[data-terminal-pane="${activeView}"]`);
      pane?.focus({ preventScroll: true });
      pane?.scrollIntoView({ block: layout === "desktop" ? "nearest" : "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeView, layout]);

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
    <div ref={shellRef} data-market-theme={marketTheme} data-mobile-view={mobileTab} data-terminal-layout={layout} className="terminal-shell relative flex min-h-dvh min-w-0 flex-col bg-bg text-fg">
      {singlePane ? (
        <header className="terminal-compact-header border-b border-border bg-bg">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-base font-medium">當沖大富翁 · 模擬看盤</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" onClick={togglePause} className="min-h-12 rounded-lg bg-brand px-3 py-2 text-base font-semibold text-brand-fg">
                {paused ? "繼續練習" : "暫停"}
              </button>
              <ThemeButton theme={marketTheme} onToggle={toggleTheme} />
              <DisplayControls compact />
            </div>
          </div>
        </header>
      ) : (
        <TopMenu
          name={lesson ? `${lesson.no} ${scenario.name}` : scenario.name}
          paused={paused}
          speed={speed}
          code={selected}
          date={engine.session.label}
          venue={venueLabel(venue)}
          theme={marketTheme}
          onToggleTheme={toggleTheme}
          onTogglePause={togglePause}
        />
      )}
      <details className="terminal-practice-controls border-b border-border bg-surface">
        <summary className="min-h-12 cursor-pointer px-3 py-3 text-base text-muted">
          帳戶與練習設定 · {paused ? "已暫停" : `${speed} 倍速`} · {formatTime(engine.t)}
        </summary>
        <AccountBar />
        <NewsBar />
      </details>
      {engine.warning ? <p role="status" className="px-3 py-2 text-base leading-relaxed text-warn">{engine.warning}</p> : null}

      {!singlePane && <TerminalNavigation active={activeView} onSelect={setMobileTab} singlePane={false} />}

      {singlePane ? (
        <main className="terminal-single">
          <section data-terminal-pane={activeView} tabIndex={-1} aria-label={MOBILE_TABS.find((tab) => tab.id === activeView)?.label} className={cn("terminal-active-pane", (activeView === "watch" || activeView === "pos") && "terminal-list-pane")}>
            <ActivePane key={layout} view={activeView} senior={senior} />
          </section>
        </main>
      ) : layout === "tablet" ? (
        <main className="terminal-tablet-workspace">
          <aside aria-label="自選商品" className="terminal-watch-pane"><Watchlist /></aside>
          <section data-terminal-pane={activeView} tabIndex={-1} aria-label={MOBILE_TABS.find((tab) => tab.id === activeView)?.label} className="terminal-active-pane terminal-tablet-active term-scroll">
            <ActivePane view={activeView} senior={false} />
          </section>
        </main>
      ) : (
        <main data-active-view={activeView} className="terminal-desktop-workspace">
          <aside aria-label="自選商品" className="terminal-watch-pane"><Watchlist /></aside>
          {activeView !== "flash" && <div className="terminal-chart-column">
            <section data-terminal-pane="chart" tabIndex={-1} aria-label="個股走勢" className="terminal-desktop-chart"><SelectedChart /></section>
            <details className="terminal-index-details border-t border-border bg-bg">
              <summary className="min-h-12 cursor-pointer px-3 py-3 text-base text-muted">加權指數參考 · {formatIndex(idx.last)} {formatPct(idx.changePct)}</summary>
              <div className="terminal-index-chart"><IndexPane /></div>
            </details>
          </div>}
          <aside data-terminal-pane={activeView === "flash" ? "flash" : "trade"} tabIndex={-1} aria-label={activeView === "flash" ? "閃電下單" : "委託與五檔"} className="terminal-order-pane term-scroll">
            {activeView === "flash" ? <LightningOrder senior={false} active /> : <OrderStack />}
          </aside>
          {activeView !== "flash" && <section data-terminal-pane="pos" tabIndex={-1} aria-label="庫存成交" className="terminal-desktop-positions">
            <details open={activeView === "pos"} onToggle={(event) => {
              if (event.currentTarget.open && activeView !== "pos") setMobileTab("pos");
              else if (!event.currentTarget.open && activeView === "pos") setMobileTab("chart");
            }}>
              <summary className="min-h-12 cursor-pointer border-t border-border bg-surface px-3 py-3 text-base font-medium">庫存與成交紀錄</summary>
              <div className="terminal-positions-content"><PositionsDock /></div>
            </details>
          </section>}
        </main>
      )}

      <footer className="terminal-status relative z-0 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2 px-3 py-2 text-sm text-muted">
        <span>
          {q ? (
            <>
              {q.code} {q.name} <Arrow n={q.change} />{" "}
              <span className={toneClass(q.change)}>{formatPrice(q.last)}</span>{" "}
              <span className={toneClass(q.changePct)}>{formatPct(q.changePct)}</span>
            </>
          ) : null}
        </span>
        {!singlePane && <span className="font-mono">
          加權 {formatIndex(idx.last)} {formatPct(idx.changePct)} · {idx.turnoverYi.toFixed(0)} 億 ·
          聚焦送出按鈕後按 Enter · Space 暫停
        </span>}
        <span className="font-mono">模擬 {formatTime(engine.t)}</span>
      </footer>

      {singlePane && <TerminalNavigation active={activeView} onSelect={setMobileTab} singlePane />}

      {phase === "result" && <ResultScreen />}
      <LessonCard />
    </div>
  );
}

function ActivePane({ view, senior }: { view: MobileTab; senior: boolean }) {
  if (view === "watch") return <Watchlist />;
  if (view === "trade") return <OrderStack />;
  if (view === "pos") return <PositionsDock />;
  if (view === "flash") return <LightningOrder senior={senior} active />;
  return <MobileMarket />;
}

function OrderStack() {
  return <div className="terminal-order-stack">
    <OrderTicket />
    <div className="terminal-book-pane border-t border-border"><QuotePanel /></div>
  </div>;
}

function TerminalNavigation({ active, onSelect, singlePane }: { active: MobileTab; onSelect: (tab: MobileTab) => void; singlePane: boolean }) {
  return (
    <nav aria-label="模擬操作區" className={cn("terminal-navigation border-y border-border bg-surface", singlePane && "terminal-navigation-bottom")}>
      {MOBILE_TABS.filter((tab) => singlePane || tab.id !== "watch").map((tab) => (
        <button key={tab.id} id={`mobile-tab-${tab.id}`} type="button" onClick={() => onSelect(tab.id)}
          aria-current={active === tab.id ? "page" : undefined}
          className={cn("flex min-h-12 min-w-0 items-center justify-center gap-2 border-b-2 px-3 py-2 text-base font-medium", active === tab.id ? "border-brand bg-brand/10 text-brand" : "border-transparent text-muted")}>
          <tab.icon className="size-5 shrink-0" aria-hidden />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
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
  onTogglePause,
}: {
  name: string;
  paused: boolean;
  speed: number;
  code: string;
  date: string;
  venue: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onTogglePause: () => void;
}) {
  return (
    <div className="terminal-top-menu flex min-h-12 min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-1 px-3 py-2 text-base">
      <MarkTiny />
      <span className="shrink-0 font-medium tracking-wide">當沖大富翁</span>
      <SimChip label={venue} />
      <button type="button" onClick={onTogglePause} className="min-h-12 rounded-lg bg-brand px-3 py-2 text-base font-semibold text-brand-fg">{paused ? "繼續練習" : "暫停"}</button>
      <ThemeButton theme={theme} onToggle={onToggleTheme} />
      <DisplayControls compact />
      <span className="hidden rounded-xs border border-border-strong/60 px-1.5 py-0.5 text-2xs text-fg/85 sm:inline">
        現股當沖
      </span>
      <span className="ml-1 hidden items-center gap-1 rounded-xs border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-micro sm:flex">
        {code}.TW
      </span>
      <span className="ml-auto min-w-0 break-words font-mono text-sm text-fg/80">
        {name.startsWith(date) ? name : `${date} · ${name}`} · {paused ? "暫停" : `${speed}x`}
      </span>
    </div>
  );
}

function ThemeButton({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      aria-label={theme === "dark" ? "切換明亮看盤" : "切換深色看盤"}
      className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-base text-fg">
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
  const bars = engine.bars(q.code);
  const swingHighs = wave ? deriveSwingHighs(bars, engine.t, engine.startT, engine.endT) : undefined;
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
          bars={bars}
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
          swingHighs={swingHighs?.confirmed}
        />
      </div>
      {swingHighs && <SwingHighSummary data={swingHighs} visibleStart={engine.startT} />}
    </div>
  );
}
