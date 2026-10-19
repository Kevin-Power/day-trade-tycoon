import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, RotateCcw } from "@/lib/icons";
import { Link } from "@tanstack/react-router";
import { lessonById, nextLesson } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { classroomSampleMicro } from "@/lib/provenance";
import { ReviewConditions } from "@/components/review-conditions";
import { reviewSaveMessage } from "@/lib/game/review-storage-status";
import { formatPrice } from "@/lib/market/ticks";
import { LearningProgressCard } from "@/components/learning-progress-card";
import { courseStepFor } from "@/lib/game/learning-path";

export function ResultScreen() {
  const rec = useGame((s) => s.lastResult);
  const tradePlan = useGame((s) => s.tradePlan);
  const firstPlannedOrder = useGame((s) => s.firstPlannedOrder);
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const selected = useGame((s) => s.selected);
  const start = useGame((s) => s.start);
  const leave = useGame((s) => s.leave);
  const syncStatus = useGame((s) => s.syncStatus);
  const localReviewSaved = useGame((s) => s.localReviewSaved);
  const verdicts = useGame((s) => s.lastVerdicts);
  const titleRef = useRef<HTMLHeadingElement>(null);
  if (!rec || !engine || !scenario) return null;
  const st = engine.stats();
  const openPositions = engine.openPositions();
  const lesson = lessonById(scenario.id);
  const nxt = nextLesson(scenario.id);
  const course = courseStepFor(scenario.id);
  const bundle = {
    rec,
    verdicts,
    fills: engine.fills,
    code: selected,
    capital: scenario.capital,
    equity: st.equity,
    sessionLabel: engine.session.label,
    firstTradePlan: { plan: tradePlan, order: firstPlannedOrder },
    openPositionsAtEnd: openPositions.map(({ code, lots, last }) => ({ code, lots, last })),
  };

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
              <CheckCircle2 aria-hidden="true" />
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
                {course?.title ?? rec.scenarioName}
              </Dialog.Title>
            </div>
            <Dialog.Description
              id="result-description"
              className="mt-3 text-sm leading-6 text-muted"
            >
              一次練習不用把所有事都做好。先看這次留下的紀錄，再選一個下次要練的重點。
            </Dialog.Description>
          </header>
          <div className="px-5 py-5 sm:px-7">
            <LearningProgressCard bundle={bundle} />
            {engine.fills.length === 0 ? (
              <p className="mt-4 text-base leading-7 text-muted">
                本盤尚無成交。可以先留下觀察或未進場的原因，不必為了完成畫面而勉強交易。
              </p>
            ) : null}
            <details className="mt-5 rounded-xl border border-border p-4">
              <summary className="min-h-12 cursor-pointer text-base font-semibold leading-7">
                查看本盤模擬數字與教材挑戰
              </summary>
              <p className="mb-4 mt-3 text-sm leading-6 text-muted">
                原模擬結果標記：{rec.grade}。教材挑戰包含損益條件，與上方操作足跡分開檢視。
              </p>
              {verdicts.length ? <ReviewConditions verdicts={verdicts} compact /> : null}
              <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
                <Cell
                  prominent
                  label="模擬淨損益"
                  value={formatSigned(rec.pnl, 0)}
                  tone={rec.pnl}
                />
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
              <p className="mt-3 text-sm leading-6 text-muted">
                權益 {formatMoney(st.equity, 0)} · 本金 {formatMoney(scenario.capital)}
              </p>
            </details>

            <section
              className="mt-5 rounded-xl border border-border bg-bg/60 p-4 text-base leading-7"
              aria-labelledby="result-positions-title"
            >
              <h3 id="result-positions-title" className="font-semibold">
                結束時庫存
              </h3>
              {openPositions.length > 0 ? (
                <>
                  <p className="mt-2 font-medium">仍有 {openPositions.length} 檔模擬部位未平倉</p>
                  <ul className="mt-3 space-y-3">
                    {openPositions.map((position) => (
                      <li
                        key={position.code}
                        className="rounded-lg border border-border bg-surface p-3"
                      >
                        <p>
                          <span className="font-mono font-semibold">{position.code}</span>{" "}
                          {position.lots > 0 ? "買進（多單）" : "賣出（空單）"} · 剩餘{" "}
                          {Math.abs(position.lots)} 張
                        </p>
                        <p className="text-muted">最後模擬價 {formatPrice(position.last)}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-muted">
                    模擬淨損益包含未平倉部位按最後模擬價計算的估值，尚未扣除未來平倉的手續費與交易稅。練習結束不代表已全部平倉。
                  </p>
                </>
              ) : (
                <p className="mt-2 text-muted">結束時零庫存，沒有未平倉部位。</p>
              )}
            </section>

            {lesson && (
              <div className="mt-5 rounded-xl border border-border bg-bg/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen aria-hidden="true" className="text-brand" />
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
                <BookOpen aria-hidden="true" />
                看復盤，選下一步
                <ArrowRight aria-hidden="true" />
              </Link>
              <button type="button" className="academy-button-secondary" onClick={leave}>
                回教室看學習足跡
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/session/$id/review"
                params={{ id: rec.id }}
                hash="practice-goal"
                className="academy-nav-link min-h-12 text-sm"
                onClick={leave}
              >
                <RotateCcw aria-hidden="true" />
                選好重點，再練本課
              </Link>
              {nxt && (
                <button
                  type="button"
                  className="academy-nav-link min-h-12 whitespace-normal text-sm"
                  onClick={() => start(nxt.id)}
                >
                  自主前往{nxt.no}：{courseStepFor(nxt.id)?.title ?? nxt.skill}
                </button>
              )}
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
