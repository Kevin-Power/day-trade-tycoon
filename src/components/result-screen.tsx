import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { lessonById, nextLesson } from "@/lib/game/curriculum";
import { rankFor } from "@/lib/game/scenarios";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { classroomSampleMicro } from "@/lib/provenance";
import { ReviewConditions } from "@/components/review-conditions";
import { reviewSaveMessage } from "@/lib/game/review-storage-status";

export function ResultScreen() {
  const rec = useGame((s) => s.lastResult);
  const profile = useGame((s) => s.profile);
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const start = useGame((s) => s.start);
  const leave = useGame((s) => s.leave);
  const syncStatus = useGame((s) => s.syncStatus);
  const localReviewSaved = useGame((s) => s.localReviewSaved);
  const verdicts = useGame((s) => s.lastVerdicts);
  const titleRef = useRef<HTMLHeadingElement>(null);
  if (!rec || !engine || !scenario) return null;
  const st = engine.stats();
  const rank = rankFor(profile.careerPnl);
  const lesson = lessonById(scenario.id);
  const nxt = nextLesson(scenario.id);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) leave();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/25 backdrop-blur-sm" />
        <Dialog.Content
          aria-labelledby="result-title"
          aria-describedby="result-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus({ preventScroll: true });
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="term-scroll fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface text-fg shadow-xl outline-none"
        >
          <header className="shrink-0 border-b border-border px-5 py-5 sm:px-7">
            <p className="academy-eyebrow flex flex-wrap items-center gap-2">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              練習已結算
              <span aria-hidden="true" className="text-subtle">
                /
              </span>
              {lesson ? `${lesson.no} · ${lesson.skill}` : "SESSION SETTLED"}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Dialog.Title
                ref={titleRef}
                tabIndex={-1}
                id="result-title"
                className="text-xl font-semibold leading-snug outline-none sm:text-2xl"
              >
                {rec.scenarioName}
              </Dialog.Title>
              <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2">
                <span className="text-sm text-muted">本盤模擬結果</span>
                <span className="font-mono text-xl font-semibold">{rec.grade}</span>
              </span>
            </div>
            <Dialog.Description
              id="result-description"
              className="mt-3 text-sm leading-6 text-muted"
            >
              結果標記反映本盤模擬數值，不能單靠盈虧判斷操作紀律。請檢視成交、紀律與成本，再選一項下次練習重點。
            </Dialog.Description>
          </header>
          <div className="px-5 py-5 sm:px-7">
            {engine.fills.length === 0 ? (
              <p className="mb-4 text-base leading-7 text-muted">
                本盤沒有成交，尚無資料確認買進或平倉操作。
              </p>
            ) : null}
            {verdicts.length ? <ReviewConditions verdicts={verdicts} compact /> : null}

            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
              <Cell prominent label="模擬淨損益" value={formatSigned(rec.pnl, 0)} tone={rec.pnl} />
              <Cell prominent label="報酬率" value={formatPct(rec.pnlPct)} tone={rec.pnlPct} />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
              <Cell label="交易次數" value={String(rec.trades)} />
              <Cell
                label="勝率"
                value={rec.trades ? `${((rec.wins / rec.trades) * 100).toFixed(0)}%` : "—"}
                badge="classroom"
                note={classroomSampleMicro(rec.trades)}
              />
              <Cell label="費稅" value={formatMoney(rec.fees, 0)} />
              <Cell label="最大回撤" value={`${(rec.maxDrawdown * 100).toFixed(2)}%`} />
            </div>

            {lesson && (
              <div className="mt-5 rounded-xl border border-border bg-bg/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen aria-hidden="true" className="size-4 text-brand" />
                  這次值得回看的地方
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                  {lesson.review.map((n) => (
                    <li key={n} className="flex gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-2.5 size-1 shrink-0 rounded-full bg-brand/60"
                      />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
              <span className="text-muted">模擬累計段位</span>
              <span>
                {rank.title} · 累計 {formatSigned(profile.careerPnl, 0)}
              </span>
            </div>

            <p className="mt-2 text-xs leading-6 text-muted">
              權益 {formatMoney(st.equity, 0)} · 本金 {formatMoney(scenario.capital)}
            </p>
          </div>
          <footer className="shrink-0 border-t border-border bg-surface px-5 py-4 sm:px-7">
            <p role="status" className="mb-3 text-base leading-7 text-muted">
              {reviewSaveMessage(syncStatus, localReviewSaved)}
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Link
                to="/session/$id/review"
                params={{ id: rec.id }}
                onClick={leave}
                className="academy-button-primary"
              >
                <BookOpen aria-hidden="true" className="size-4" />
                查看完整復盤
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <button
                type="button"
                className="academy-button-secondary"
                onClick={() => start(nxt?.id ?? scenario.id)}
              >
                {nxt ? `下一課 ${nxt.no}` : "再打一盤"}
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="academy-nav-link min-h-10 text-xs"
                onClick={() => start(scenario.id)}
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                重打本課
              </button>
              <button type="button" className="academy-nav-link min-h-10 text-xs" onClick={leave}>
                回大廳
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Cell({
  label,
  value,
  tone,
  badge,
  note,
  prominent,
}: {
  label: string;
  value: string;
  tone?: number;
  badge?: "official" | "classroom";
  note?: string;
  prominent?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-border bg-bg/50 p-3.5 sm:p-4",
        prominent && "bg-bg",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted">{label}</div>
        {badge ? <ProvenanceBadge kind={badge} /> : null}
      </div>
      <div
        className={cn(
          "mt-2 break-words font-mono font-medium tabular",
          prominent ? "text-2xl sm:text-3xl" : "text-lg",
          tone !== undefined ? toneClass(tone) : "text-fg",
        )}
      >
        {value}
      </div>
      {note ? <ProvenanceMicro className="mt-1 border-0 bg-transparent px-0" text={note} /> : null}
    </div>
  );
}
