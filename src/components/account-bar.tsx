import { BookOpen, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toneClass } from "@/components/signed";
import { isSoundEnabled, setSoundEnabled, unlockAudio } from "@/lib/game/audio";
import { useGame } from "@/lib/game/store";
import { leaveDeskNeedsConfirm, leaveDeskRisk, type LeaveDeskRisk } from "@/lib/game/leave-desk";
import { venueLabel } from "@/lib/broker";
import { LeaveDeskDialog } from "@/components/leave-desk-dialog";
import { SimChip } from "@/components/provenance";
import { cn, formatMoney, formatPct, formatSigned, formatTime } from "@/lib/utils";
import { useState } from "react";

const SPEEDS = [1, 4, 6, 8, 12, 16, 24];

export function AccountBar() {
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const togglePause = useGame((s) => s.togglePause);
  const setSpeed = useGame((s) => s.setSpeed);
  const settle = useGame((s) => s.settle);
  const leave = useGame((s) => s.leave);
  const phase = useGame((s) => s.phase);
  const teachMode = useGame((s) => s.teachMode);
  const setTeachMode = useGame((s) => s.setTeachMode);
  const openLearnerGuide = useGame((s) => s.openLearnerGuide);
  const venue = useGame((s) => s.venue);
  const accountId = useGame((s) => s.accountId);
  const frame = useGame((s) => s.frame);
  const [sound, setSound] = useState(isSoundEnabled);
  const [leaveRisk, setLeaveRisk] = useState<LeaveDeskRisk | null>(null);
  void frame;
  if (!engine || !scenario) return null;

  function requestLeave() {
    const risk = leaveDeskRisk(engine);
    if (!leaveDeskNeedsConfirm(risk)) {
      leave();
      return;
    }
    setLeaveRisk(risk);
  }
  const st = engine.stats();
  const left = engine.leftoverMinutes();
  const used = st.equity > 0 ? (st.peakGross / st.equity) * 100 : 0;

  return (
    <div className="account-bar flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2.5 text-xs">
      <div className="account-clock flex flex-wrap items-center gap-2">
        <span className={cn("size-1.5 rounded-full bg-up", !paused && "live-dot")} />
        <span className="font-medium">{paused ? "已暫停" : "練習中"}</span>
        <span className="font-mono text-sm tabular text-fg">{formatTime(engine.t)}</span>
        <span className="text-muted">
          {formatTime(engine.endT)} · 餘 {left.toFixed(0)} 分
        </span>
      </div>
      <SimChip label={venueLabel(venue)} className="text-tape" />
      <span className="hidden font-mono text-2xs text-muted sm:inline">{accountId}</span>
      <div className="hidden h-4 w-px bg-border sm:block" />
      <Stat label="權益" value={formatMoney(st.equity, 0)} />
      <Stat label="損益" value={formatSigned(st.pnl, 0)} tone={st.pnl} />
      <Stat label="報酬" value={formatPct(st.pnlPct)} tone={st.pnlPct} />
      <Stat label="可用" value={formatMoney(st.cash, 0)} className="hidden md:flex" />
      <Stat label="未實現" value={formatSigned(st.unrealized, 0)} tone={st.unrealized} className="hidden lg:flex" />
      <Stat label="使用" value={`${used.toFixed(0)}%`} className="hidden xl:flex" />
      <div className="flex-1" />
      <div className="account-controls flex flex-wrap items-start gap-2">
        <div className="account-primary flex items-center gap-2" role="group" aria-label="練習主要操作">
          <Button size="md" variant={paused ? "default" : "subtle"} onClick={togglePause}>
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            {paused ? "繼續練習" : "暫停"}
          </Button>
          <Button
            size="md"
            variant={teachMode ? "header" : "outline"}
            aria-pressed={teachMode}
            onClick={() => setTeachMode(!teachMode)}
          >
            <BookOpen aria-hidden />
            教學提示
          </Button>
          <Button size="md" variant="outline" onClick={settle} title="結束這次練習，查看練習成果">
            <Square aria-hidden />
            結束練習
          </Button>
        </div>
        <details className="account-settings rounded-md border border-border bg-bg">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            更多設定 <span className="font-normal text-muted">· {speed} 倍速</span>
          </summary>
          <div className="account-settings-content space-y-3 border-t border-border p-3">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm text-muted">練習速度</legend>
              <div className="account-speed flex flex-wrap gap-2">
                {SPEEDS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSpeed(n)}
                    aria-label={`${n} 倍速`}
                    aria-pressed={speed === n}
                    className={cn(
                      "min-h-10 min-w-12 rounded-sm border px-2 font-mono text-sm",
                      speed === n ? "border-brand bg-header-2 text-fg" : "border-border text-muted hover:text-fg",
                    )}
                  >
                    {n} 倍
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="account-extra flex flex-wrap gap-2">
              {scenario.id === "wed-open" && phase === "live" && (
                <Button size="md" variant="subtle" onClick={(event) => {
                  const settings = event.currentTarget.closest("details");
                  if (settings) settings.open = false;
                  openLearnerGuide();
                }}>
                  <BookOpen aria-hidden />
                  重看操作導覽
                </Button>
              )}
              <Button
                size="md"
                variant="subtle"
                aria-pressed={sound}
                onClick={() => {
                  const next = !sound;
                  setSoundEnabled(next);
                  setSound(next);
                  if (next) unlockAudio();
                }}
              >
                {sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                {sound ? "關閉音效" : "開啟音效"}
              </Button>
              <Button size="md" variant="outline" onClick={requestLeave}>
                回大廳
              </Button>
            </div>
          </div>
        </details>
      </div>
      <LeaveDeskDialog
        open={phase === "live" && leaveRisk !== null}
        risk={leaveRisk ?? { openPositions: 0, openOrders: 0 }}
        onCancel={() => setLeaveRisk(null)}
        onConfirm={() => {
          setLeaveRisk(null);
          leave();
        }}
      />
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
    <div className={cn("account-stat flex items-baseline gap-1.5 font-mono", className)}>
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
