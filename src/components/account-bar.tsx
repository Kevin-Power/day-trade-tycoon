import { BookOpen, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toneClass } from "@/components/signed";
import { isSoundEnabled, setSoundEnabled, unlockAudio } from "@/lib/game/audio";
import { useGame } from "@/lib/game/store";
import { venueLabel } from "@/lib/broker";
import { cn, formatMoney, formatPct, formatSigned, formatTime } from "@/lib/utils";
import { useState } from "react";

const SPEEDS = [4, 6, 8, 12, 16, 24];
const MOBILE_SPEEDS = new Set([4, 8, 16]);

export function AccountBar() {
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const togglePause = useGame((s) => s.togglePause);
  const setSpeed = useGame((s) => s.setSpeed);
  const settle = useGame((s) => s.settle);
  const leave = useGame((s) => s.leave);
  const teachMode = useGame((s) => s.teachMode);
  const setTeachMode = useGame((s) => s.setTeachMode);
  const venue = useGame((s) => s.venue);
  const accountId = useGame((s) => s.accountId);
  const frame = useGame((s) => s.frame);
  const [sound, setSound] = useState(isSoundEnabled);
  void frame;
  if (!engine || !scenario) return null;
  const st = engine.stats();
  const left = engine.leftoverMinutes();
  const used = st.equity > 0 ? (st.peakGross / st.equity) * 100 : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-2 py-1.5 text-micro">
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full bg-up", !paused && "live-dot")} />
        <span className="font-mono text-sm tabular text-fg">{formatTime(engine.t)}</span>
        <span className="text-muted">
          {formatTime(engine.endT)} · 餘 {left.toFixed(0)} 分
        </span>
      </div>
      <span className="rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs text-tape">{venueLabel(venue)}</span>
      <span className="hidden font-mono text-2xs text-muted sm:inline">{accountId}</span>
      <div className="hidden h-4 w-px bg-border sm:block" />
      <Stat label="權益" value={formatMoney(st.equity, 0)} />
      <Stat label="損益" value={formatSigned(st.pnl, 0)} tone={st.pnl} />
      <Stat label="報酬" value={formatPct(st.pnlPct)} tone={st.pnlPct} />
      <Stat label="可用" value={formatMoney(st.cash, 0)} className="hidden md:flex" />
      <Stat label="未實現" value={formatSigned(st.unrealized, 0)} tone={st.unrealized} className="hidden lg:flex" />
      <Stat label="使用" value={`${used.toFixed(0)}%`} className="hidden xl:flex" />
      <div className="flex-1" />
      <div className="flex flex-wrap items-center gap-1">
        <Button size="xs" variant="subtle" onClick={togglePause} className="min-w-11">
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "繼續" : "暫停"}
        </Button>
        {SPEEDS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSpeed(n)}
            className={cn(
              "h-7 min-w-9 rounded-xs px-1.5 font-mono text-2xs",
              MOBILE_SPEEDS.has(n) ? "inline-flex" : "hidden sm:inline-flex",
              speed === n ? "bg-header-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            {n}x
          </button>
        ))}
        <Button
          size="xs"
          variant="ghost"
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
          className="min-w-11"
        >
          <BookOpen className="size-3.5" />
          教學
        </Button>
        <Button size="xs" variant="outline" onClick={settle}>
          <Square className="size-3.5" />
          提前結算
        </Button>
        <Button size="xs" variant="ghost" onClick={leave}>
          回大廳
        </Button>
      </div>
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
    <div className={cn("flex items-baseline gap-1.5 font-mono", className)}>
      <span className="text-muted">{label}</span>
      <span className={cn("tabular text-xs", tone !== undefined ? toneClass(tone) : "text-fg")}>{value}</span>
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
        "flex items-center gap-2 border-b border-border px-3 py-1 text-xs",
        news ? "bg-up-dim text-up" : warning ? "bg-elevated text-warn" : "bg-surface-2 text-muted",
      )}
    >
      <span className="shrink-0 font-medium tracking-wide">
        {news ? "快訊" : warning ? "風控" : "教練"}
      </span>
      <span className="truncate">{line}</span>
    </div>
  );
}
