import { BookOpen, LogOut, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toneClass } from "@/components/signed";
import { isSoundEnabled, setSoundEnabled, unlockAudio } from "@/lib/game/audio";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned, formatTime } from "@/lib/utils";

const SPEEDS = [4, 6, 8, 12, 16, 24];
const MOBILE_SPEEDS = new Set([4, 8, 16]);

/** Clock, account figures, pause and replay speed. Second row of the desk. */
export function AccountBar() {
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const togglePause = useGame((s) => s.togglePause);
  const setSpeed = useGame((s) => s.setSpeed);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine || !scenario) return null;
  const st = engine.stats();
  const left = engine.leftoverMinutes();
  const used = st.equity > 0 ? (st.peakGross / st.equity) * 100 : 0;

  return (
    <div className="flex h-9 shrink-0 items-center gap-x-3 overflow-hidden border-b border-border bg-surface px-2 text-micro">
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn("size-1.5 rounded-full", paused ? "bg-warn" : "bg-up live-dot")}
          aria-hidden
        />
        <span className="font-mono text-sm tabular text-fg">{formatTime(engine.t)}</span>
        <span className="hidden font-mono text-2xs tabular text-muted sm:inline">
          收 {formatTime(engine.endT).slice(0, 5)} · 餘 {left.toFixed(0)} 分
        </span>
      </div>
      <div className="hidden h-4 w-px shrink-0 bg-border-strong/70 sm:block" />
      <div className="flex min-w-0 items-center gap-x-3 overflow-hidden">
        <Stat label="權益" value={formatMoney(st.equity, 0)} className="hidden sm:flex" />
        <Stat label="損益" value={formatSigned(st.pnl, 0)} tone={st.pnl} />
        <Stat label="報酬" value={formatPct(st.pnlPct)} tone={st.pnlPct} />
        <Stat label="可用" value={formatMoney(st.cash, 0)} className="hidden md:flex" />
        <Stat
          label="未實現"
          value={formatSigned(st.unrealized, 0)}
          tone={st.unrealized}
          className="hidden lg:flex"
        />
        <Stat label="額度使用" value={`${used.toFixed(0)}%`} className="hidden xl:flex" />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          size="xs"
          variant={paused ? "header" : "subtle"}
          onClick={togglePause}
          className="min-w-14"
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "繼續" : "暫停"}
        </Button>
        <div
          role="group"
          aria-label="回放速度"
          className="inline-flex h-7 items-stretch overflow-hidden rounded-sm border border-border bg-bg p-0.5"
        >
          {SPEEDS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={speed === n}
              onClick={() => setSpeed(n)}
              className={cn(
                "min-w-8 items-center justify-center rounded-xs px-1.5 font-mono text-2xs transition-colors",
                MOBILE_SPEEDS.has(n) ? "inline-flex" : "hidden sm:inline-flex",
                speed === n ? "bg-header-2 text-fg" : "text-muted hover:bg-elevated hover:text-fg",
              )}
            >
              {n}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Sound, teaching mode, settle and leave. Lives in the top menu. */
export function SessionControls() {
  const settle = useGame((s) => s.settle);
  const leave = useGame((s) => s.leave);
  const teachMode = useGame((s) => s.teachMode);
  const setTeachMode = useGame((s) => s.setTeachMode);
  const [sound, setSound] = useState(isSoundEnabled);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="xs"
        variant="ghost"
        aria-label={sound ? "關閉音效" : "開啟音效"}
        title={sound ? "關閉音效" : "開啟音效"}
        className="px-1.5 text-fg/85"
        onClick={() => {
          const next = !sound;
          setSoundEnabled(next);
          setSound(next);
          if (next) unlockAudio();
        }}
      >
        {sound ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
      </Button>
      <Button
        size="xs"
        variant={teachMode ? "header" : "ghost"}
        onClick={() => setTeachMode(!teachMode)}
        className={cn("px-1.5 sm:px-2", !teachMode && "text-fg/85")}
        aria-pressed={teachMode}
      >
        <BookOpen className="size-3.5" />
        <span className="hidden sm:inline">教學</span>
      </Button>
      <Button size="xs" variant="outline" onClick={settle} className="px-1.5 sm:px-2">
        <Square className="size-3.5" />
        <span className="hidden sm:inline">提前結算</span>
      </Button>
      <Button size="xs" variant="ghost" onClick={leave} className="px-1.5 text-fg/85 sm:px-2">
        <LogOut className="size-3.5" />
        <span className="hidden sm:inline">回大廳</span>
      </Button>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-baseline gap-1.5 font-mono", className)}>
      <span className="text-2xs text-muted">{label}</span>
      <span className={cn("tabular text-xs", tone !== undefined ? toneClass(tone) : "text-fg")}>
        {value}
      </span>
    </div>
  );
}

export function NewsBar() {
  const engine = useGame((s) => s.engine);
  const frame = useGame((s) => s.frame);
  void frame;
  const news = engine?.news;
  const warning = engine?.warning;
  const coach = engine?.coachLine;
  const line = news || warning || coach;
  if (!line) return null;
  return (
    <div
      className={cn(
        "flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-xs",
        news ? "bg-up-dim text-up" : warning ? "bg-elevated text-warn" : "bg-surface-2 text-muted",
      )}
    >
      <span className="shrink-0 rounded-xs border border-current/40 px-1 py-px text-2xs font-medium tracking-wide">
        {news ? "快訊" : warning ? "風控" : "教練"}
      </span>
      <span className="truncate">{line}</span>
    </div>
  );
}
