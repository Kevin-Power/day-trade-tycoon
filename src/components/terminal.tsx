import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  Briefcase,
  List,
  Monitor,
  MonitorSmartphone,
  Smartphone,
} from "lucide-react";
import { AccountBar, NewsBar, SessionControls } from "@/components/account-bar";
import { TapeChart } from "@/components/charts";
import { LessonCard } from "@/components/lesson-card";
import { OrderTicket } from "@/components/order-ticket";
import { PositionsDock } from "@/components/positions";
import { QuotePanel } from "@/components/quote-book";
import { ResultScreen } from "@/components/result-screen";
import { Watchlist } from "@/components/watchlist";
import { PaneTab, PaneTitle } from "@/components/ui/pane";
import { persistOnHide, useGame, type LayoutPref, type MobileTab } from "@/lib/game/store";
import { lessonById } from "@/lib/game/curriculum";
import { venueLabel } from "@/lib/broker";
import { cn, formatLots, formatPct, formatTime } from "@/lib/utils";
import { Arrow, toneClass } from "@/components/signed";
import { formatPrice } from "@/lib/market/ticks";
import { formatIndex } from "@/lib/market/week";

/** Same breakpoint as `.term-desk` in styles.css. */
const DESK_QUERY = "(min-width: 720px)";

/**
 * Which layout to render. Only one is mounted so hidden panes don't keep
 * painting. `auto` follows the viewport width; a projector zoomed to 200%+
 * or a laptop with 175% display scaling can drop under the breakpoint, so the
 * user can pin 桌機版 (or 手機版) from the top menu.
 */
function useIsDesk(pref: LayoutPref) {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(DESK_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(DESK_QUERY);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  if (pref === "desk") return true;
  if (pref === "phone") return false;
  return wide;
}

const LAYOUTS: { id: LayoutPref; label: string; hint: string; icon: typeof Monitor }[] = [
  { id: "auto", label: "自動", hint: "依視窗寬度切換", icon: MonitorSmartphone },
  { id: "desk", label: "桌機", hint: "鎖定桌機版（投影、放大時用）", icon: Monitor },
  { id: "phone", label: "手機", hint: "鎖定手機版", icon: Smartphone },
];

function LayoutSwitch() {
  const pref = useGame((s) => s.layoutPref);
  const setPref = useGame((s) => s.setLayoutPref);
  return (
    <div
      role="group"
      aria-label="版面"
      className="inline-flex h-6 items-stretch overflow-hidden rounded-sm border border-border-strong/60 bg-bg/40 p-0.5"
    >
      {LAYOUTS.map((l) => {
        const on = pref === l.id;
        const Icon = l.icon;
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            title={`版面：${l.label} · ${l.hint}`}
            onClick={() => setPref(l.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-xs px-1.5 text-2xs transition-colors",
              on ? "bg-header-2 text-fg" : "text-fg/60 hover:bg-white/10 hover:text-fg",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden lg:inline">{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const MOBILE_TABS: { id: MobileTab; label: string; icon: typeof List }[] = [
  { id: "watch", label: "自選", icon: List },
  { id: "chart", label: "江波", icon: Activity },
  { id: "trade", label: "下單", icon: ArrowLeftRight },
  { id: "pos", label: "庫存", icon: Briefcase },
];

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
  const mobileTab = useGame((s) => s.mobileTab);
  const setMobileTab = useGame((s) => s.setMobileTab);
  const activeBeat = useGame((s) => s.activeBeat);
  const venue = useGame((s) => s.venue);
  const layoutPref = useGame((s) => s.layoutPref);
  const desk = useIsDesk(layoutPref);
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
        if (useGame.getState().activeBeat) dismissBeat();
        else togglePause();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (useGame.getState().activeBeat) return;
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, togglePause, dismissBeat]);

  if (!engine || !scenario) return null;
  const lesson = lessonById(scenario.id);

  return (
    <div
      data-layout={desk ? "desk" : "phone"}
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-fg"
    >
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

      {/* Phone: one pane at a time. */}
      {!desk && (
        <div className="term-mobile flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mobileTab === "watch" && <Watchlist />}
            {mobileTab === "chart" && (
              <div className="flex min-h-0 flex-1 flex-col gap-px bg-border">
                <div className="min-h-0 flex-[0.7]">
                  <IndexPane />
                </div>
                <div className="min-h-0 flex-[1.5]">
                  <SelectedChart />
                </div>
              </div>
            )}
            {mobileTab === "trade" && (
              <div className="term-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
                <OrderTicket />
                <div className="h-[24rem] shrink-0 border-t border-border-strong">
                  <QuotePanel />
                </div>
              </div>
            )}
            {mobileTab === "pos" && <PositionsDock />}
          </div>
        </div>
      )}

      {/* Desk: 自選 | 加權 / 江波 / 帳務 | 五檔 + 委託單 */}
      {desk && (
        <div className="term-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="term-desk term-grid grid h-full min-w-[48rem] gap-px bg-border">
            <div className="term-watch min-h-0 overflow-hidden">
              <Watchlist />
            </div>
            <div className="term-index min-h-0 overflow-hidden">
              <IndexPane />
            </div>
            <div className="term-chart min-h-0 overflow-hidden">
              <SelectedChart />
            </div>
            <div className="term-dock min-h-0 overflow-hidden">
              <PositionsDock />
            </div>
            <div className="term-rail min-h-0 overflow-hidden">
              <TradeRail />
            </div>
          </div>
        </div>
      )}

      <StatusBar />

      {!desk && (
        <nav className="term-mobile-nav grid grid-cols-4 border-t border-border bg-surface">
          {MOBILE_TABS.map((t) => {
            const on = mobileTab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMobileTab(t.id)}
                aria-pressed={on}
                className={cn(
                  "flex h-12 flex-col items-center justify-center gap-0.5 text-2xs transition-colors",
                  on ? "bg-header text-fg" : "text-muted hover:text-fg",
                )}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      )}

      {phase === "result" && <ResultScreen />}
      <LessonCard />
      {paused && phase === "live" && !activeBeat && (
        <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center">
          <div className="rounded-sm border border-warn/40 bg-surface/95 px-3 py-1 text-xs text-warn shadow-[var(--shadow-panel)]">
            已暫停 · 可繼續下單，時間軸凍結
          </div>
        </div>
      )}
    </div>
  );
}

/** Right rail: book on top takes the slack, ticket below keeps its natural height. */
function TradeRail() {
  return (
    <div className="cq-rail term-scroll flex h-full min-h-0 flex-col overflow-y-auto bg-bg">
      <div className="min-h-[15rem] flex-1 overflow-hidden">
        <QuotePanel />
      </div>
      <div className="shrink-0 border-t border-border-strong">
        <OrderTicket />
      </div>
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
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border bg-header px-2 text-xs">
      <MarkTiny />
      <span className="shrink-0 font-medium tracking-wide">當沖大富翁</span>
      <span className="shrink-0 rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape">
        {venue}
      </span>
      <span className="hidden shrink-0 rounded-xs border border-border-strong/60 px-1.5 py-0.5 text-2xs text-fg/85 md:inline">
        現股當沖
      </span>
      <span className="hidden shrink-0 rounded-xs border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-micro sm:inline">
        {code}.TW
      </span>
      <span className="ml-auto hidden truncate font-mono text-micro text-fg/80 md:inline">
        {name.startsWith(date) ? name : `${date} · ${name}`}
      </span>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-2xs tabular md:ml-0",
          paused ? "bg-warn/20 text-warn" : "bg-bg/40 text-fg/85",
        )}
      >
        {paused ? "PAUSE" : `${speed}x`}
      </span>
      <div className="mx-0.5 hidden h-4 w-px bg-white/15 sm:block" />
      <LayoutSwitch />
      <SessionControls />
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

function StatusBar() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const q = engine.quote(selected);
  const idx = engine.indexQuote();
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-surface-2 px-2 font-mono text-2xs text-muted">
      {q && (
        <span className="flex min-w-0 shrink-0 items-center gap-1.5 tabular">
          <span className="text-fg">
            {q.code} {q.name}
          </span>
          <Arrow n={q.change} />
          <span className={toneClass(q.change)}>{formatPrice(q.last)}</span>
          <span className={toneClass(q.changePct)}>{formatPct(q.changePct)}</span>
          <span>{formatLots(q.volume)} 張</span>
        </span>
      )}
      <span className="hidden shrink-0 tabular sm:inline">
        加權{" "}
        <span className={toneClass(idx.change)}>
          {formatIndex(idx.last)} {formatPct(idx.changePct)}
        </span>{" "}
        · {idx.turnoverYi.toFixed(0)} 億
      </span>
      <span className="ml-auto hidden shrink-0 md:inline">
        Enter 送單 · Space 暫停 · 點五檔帶價
      </span>
      <span className="shrink-0 tabular text-fg/80 md:ml-0 ml-auto">{formatTime(engine.t)}</span>
    </footer>
  );
}

function IndexPane() {
  const engine = useGame((s) => s.engine);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const idx = engine.indexQuote();
  const tone = toneClass(idx.change);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTitle className="gap-x-3 overflow-hidden px-2">
        <span className="shrink-0">加權指數</span>
        <span className={cn("shrink-0 font-mono text-sm tabular", tone)}>
          {formatIndex(idx.last)}
        </span>
        <span className={cn("shrink-0 font-mono text-micro tabular", tone)}>
          {idx.change >= 0 ? "▲" : "▼"}
          {Math.abs(idx.change).toFixed(2)} {formatPct(idx.changePct)}
        </span>
        <span className="hidden shrink-0 font-mono text-micro tabular text-fg/70 lg:inline">
          開 {formatIndex(idx.open)} · 高 {formatIndex(idx.high)} · 低 {formatIndex(idx.low)}
        </span>
        <span className="ml-auto truncate font-mono text-micro tabular text-fg/80">
          成交 {idx.turnoverYi.toFixed(2)} 億
        </span>
      </PaneTitle>
      <div className="min-h-0 flex-1">
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
  const tone = toneClass(q.change);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTitle className="gap-2 px-2">
        <span className="shrink-0">
          <span className="font-mono tabular">{q.code}</span> {q.name}
        </span>
        <div className="flex items-center gap-0.5">
          <PaneTab active={wave} onClick={() => setChartStyle("jiangbo")}>
            江波
          </PaneTab>
          <PaneTab active={!wave} onClick={() => setChartStyle("tape")}>
            分時
          </PaneTab>
        </div>
        <span className={cn("ml-auto shrink-0 font-mono text-sm tabular", tone)}>
          {formatPrice(q.last)}
        </span>
        <span className={cn("shrink-0 font-mono text-micro tabular", tone)}>
          {q.change >= 0 ? "▲" : "▼"}
          {formatPrice(Math.abs(q.change))} {formatPct(q.changePct)}
        </span>
      </PaneTitle>
      <div className="relative min-h-0 flex-1">
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
        <div className="pointer-events-none absolute left-[58px] top-1.5 flex max-w-[calc(100%-8rem)] flex-wrap gap-x-2.5 gap-y-0.5 rounded-xs bg-bg/75 px-1.5 py-0.5 font-mono text-2xs tabular">
          <Legend k="開" v={formatPrice(q.open)} tone={toneClass(q.open - q.prevClose)} />
          <Legend k="高" v={formatPrice(q.high)} tone={toneClass(q.high - q.prevClose)} />
          <Legend k="低" v={formatPrice(q.low)} tone={toneClass(q.low - q.prevClose)} />
          <Legend k="均" v={formatPrice(q.vwap)} tone="text-vwap" />
          <Legend k="昨收" v={formatPrice(q.prevClose)} tone="text-tape" />
          <Legend k="量" v={`${formatLots(q.volume)} 張`} />
          {cost !== undefined && <Legend k="成本" v={formatPrice(cost)} tone="text-warn" />}
        </div>
      </div>
    </div>
  );
}

function Legend({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{k} </span>
      <span className={tone ?? "text-fg"}>{v}</span>
    </span>
  );
}
