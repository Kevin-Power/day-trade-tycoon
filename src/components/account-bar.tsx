import * as Dialog from "@radix-ui/react-dialog";
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
import { useRef, useState, type ComponentProps, type ReactNode } from "react";

const SPEEDS = [1, 4, 6, 8, 12, 16, 24];
const DIALOG_ACTION_CLASS = "h-auto min-h-12 min-w-0 whitespace-normal px-3 py-3 text-base leading-relaxed";

function pauseForReading() {
  const state = useGame.getState();
  if (state.phase === "live" && !state.paused) state.togglePause();
}

export function EndPracticeButton({ className }: { className?: string }) {
  const engine = useGame((s) => s.engine);
  const phase = useGame((s) => s.phase);
  const guideStep = useGame((s) => s.learnerGuideStep);
  const [requestedEngine, setRequestedEngine] = useState<typeof engine>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const risk = leaveDeskRisk(engine);
  const canFinish = engine !== null && phase === "live" && guideStep === null;
  const open = canFinish && requestedEngine === engine;

  function confirmFinish() {
    const state = useGame.getState();
    if (
      !state.ensureSessionIdentity() ||
      state.engine !== requestedEngine ||
      state.phase !== "live" ||
      state.learnerGuideStep !== null
    ) {
      setRequestedEngine(null);
      return;
    }
    confirmedRef.current = true;
    setRequestedEngine(null);
    state.settle();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRequestedEngine(null);
          return;
        }
        const state = useGame.getState();
        if (!state.ensureSessionIdentity() || state.phase !== "live" || state.learnerGuideStep !== null || !state.engine) return;
        confirmedRef.current = false;
        pauseForReading();
        setRequestedEngine(state.engine);
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          type="button"
          size="md"
          variant="outline"
          disabled={!canFinish}
          title="結束這次練習，查看練習成果"
          className={className}
        >
          <Square aria-hidden />
          結束練習
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/25 backdrop-blur-sm" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            if (confirmedRef.current) event.preventDefault();
          }}
          className="term-scroll fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-5 text-fg shadow-xl outline-none"
        >
          <Dialog.Title className="text-xl font-semibold">結束本次練習？</Dialog.Title>
          <Dialog.Description className="mt-3 text-base leading-7 text-muted">
            結算後不能回到這一盤繼續。現在已暫停，你可以先返回盤面，核對庫存與委託。
          </Dialog.Description>
          <p className="mt-4 rounded-xl border border-border bg-bg p-3 text-base leading-7">
            目前庫存 {risk.openPositions} 檔 · 待成交委託 {risk.openOrders} 筆
          </p>
          <p className="mt-3 text-base leading-7 text-muted">
            結算會取消待成交委託，並按目前模擬五檔嘗試平倉；量不足時仍可能保留庫存。請到結算結果確認庫存和保存狀態。
          </p>
          <div className="mt-5 grid gap-2">
            <Dialog.Close asChild>
              <Button ref={cancelRef} variant="outline" className={DIALOG_ACTION_CLASS}>
                返回盤面，保持暫停
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={confirmFinish} className={DIALOG_ACTION_CLASS}>
              確認結束，查看復盤
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AccountBar() {
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const togglePause = useGame((s) => s.togglePause);
  const setSpeed = useGame((s) => s.setSpeed);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const afterSettingsClose = useRef<"guide" | "leave" | null>(null);
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
      <Stat label="可用" value={formatMoney(st.availableCash, 0)} className="hidden md:flex" />
      <Stat label="未實現" value={formatSigned(st.unrealized, 0)} tone={st.unrealized} className="hidden lg:flex" />
      <Stat label="使用" value={`${used.toFixed(0)}%`} className="hidden xl:flex" />
      <div className="flex-1" />
      <div className="account-controls account-primary flex flex-wrap items-center gap-2" role="group" aria-label="練習主要操作">
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
          <EndPracticeButton />
        <Dialog.Root
          open={settingsOpen}
          onOpenChange={(open) => {
            if (open) pauseForReading();
            setSettingsOpen(open);
          }}
        >
          <Dialog.Trigger asChild>
            <Button ref={settingsTriggerRef} variant="outline" className={cn("account-settings flex-wrap", DIALOG_ACTION_CLASS)}>
              更多設定 <span className="hidden font-normal text-muted lg:inline">· {speed} 倍速</span>
            </Button>
          </Dialog.Trigger>
          <ReadingDialogContent
            title="更多設定"
            description="開啟設定時，模擬時間會先暫停。關閉後仍保持暫停，準備好再按「繼續練習」。"
            onCloseAutoFocus={(event) => {
              const action = afterSettingsClose.current;
              afterSettingsClose.current = null;
              if (action === "guide") {
                event.preventDefault();
                openLearnerGuide();
              } else if (action === "leave") {
                requestLeave();
              }
            }}
          >
            <fieldset className="min-w-0">
              <legend className="mb-3 text-base font-medium">練習速度</legend>
              <div className="grid grid-cols-3 gap-2">
                {SPEEDS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSpeed(n)}
                    aria-label={`${n} 倍速`}
                    aria-pressed={speed === n}
                    className={cn(
                      "min-h-12 min-w-0 rounded-lg border px-2 py-3 font-mono text-base",
                      speed === n ? "border-brand bg-header-2 text-fg" : "border-border text-muted hover:text-fg",
                    )}
                  >
                    {n} 倍
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 grid gap-3">
              {scenario.id === "wed-open" && phase === "live" && (
                <Button className={DIALOG_ACTION_CLASS} variant="subtle" onClick={() => {
                  afterSettingsClose.current = "guide";
                  setSettingsOpen(false);
                }}>
                  <BookOpen aria-hidden />
                  重看操作導覽
                </Button>
              )}
              <Button
                className={DIALOG_ACTION_CLASS}
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
              <Button className={DIALOG_ACTION_CLASS} variant="outline" onClick={() => {
                afterSettingsClose.current = "leave";
                setSettingsOpen(false);
              }}>
                回大廳
              </Button>
            </div>
          </ReadingDialogContent>
        </Dialog.Root>
      </div>
      <LeaveDeskDialog
        returnFocusRef={settingsTriggerRef}
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
  const [expandedMessage, setExpandedMessage] = useState<{ label: string; text: string } | null>(null);
  void frame;
  const news = engine?.news;
  const warning = engine?.warning;
  const coach = engine?.coachLine;
  const line = news || warning || coach;
  const label = news ? "快訊" : warning ? "風控" : "教練";
  if (!line && !expandedMessage) return null;
  return (
    <Dialog.Root
      open={expandedMessage !== null}
      onOpenChange={(open) => {
        if (open && line) {
          pauseForReading();
          setExpandedMessage({ label, text: line });
        } else if (!open) {
          setExpandedMessage(null);
        }
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-border px-3 py-2 text-sm",
          news ? "bg-up-dim text-up" : warning ? "bg-elevated text-warn" : "bg-surface-2 text-muted",
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="font-medium tracking-wide">{label}</span>
          <p className="line-clamp-2 leading-relaxed [overflow-wrap:anywhere]">{line}</p>
        </div>
        <Dialog.Trigger asChild>
          <Button variant="outline" className={cn("max-w-[45%] shrink-0", DIALOG_ACTION_CLASS)}>
            查看完整提示
          </Button>
        </Dialog.Trigger>
      </div>
      <ReadingDialogContent
        title={`${expandedMessage?.label ?? label}完整提示`}
        description="閱讀提示時，模擬時間會先暫停。關閉後仍保持暫停，準備好再按「繼續練習」。"
      >
        <p className="whitespace-pre-wrap text-base leading-relaxed [overflow-wrap:anywhere]">
          {expandedMessage?.text}
        </p>
      </ReadingDialogContent>
    </Dialog.Root>
  );
}

function ReadingDialogContent({
  title,
  description,
  children,
  onCloseAutoFocus,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onCloseAutoFocus?: ComponentProps<typeof Dialog.Content>["onCloseAutoFocus"];
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/25 backdrop-blur-sm" />
      <Dialog.Content
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className="term-scroll fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface text-fg shadow-xl outline-none"
      >
        <header className="shrink-0 border-b border-border px-5 py-4">
          <Dialog.Title ref={titleRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {title}
          </Dialog.Title>
        </header>
        <div className="px-5 py-4">
          <Dialog.Description className="mb-5 text-base leading-relaxed text-muted">
            {description}
          </Dialog.Description>
          {children}
        </div>
        <footer className="shrink-0 border-t border-border p-3">
          <Dialog.Close asChild>
            <Button className={cn("w-full", DIALOG_ACTION_CLASS)}>關閉，保持暫停</Button>
          </Dialog.Close>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
