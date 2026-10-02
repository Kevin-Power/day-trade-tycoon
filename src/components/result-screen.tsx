import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { debrief, lessonById, nextLesson } from "@/lib/game/curriculum";
import { rankFor } from "@/lib/game/scenarios";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { classroomSampleMicro } from "@/lib/provenance";

export function ResultScreen() {
  const rec = useGame((s) => s.lastResult);
  const profile = useGame((s) => s.profile);
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const start = useGame((s) => s.start);
  const leave = useGame((s) => s.leave);
  const syncStatus = useGame((s) => s.syncStatus);
  if (!rec || !engine || !scenario) return null;
  const st = engine.stats();
  const rank = rankFor(profile.careerPnl);
  const lesson = lessonById(scenario.id);
  const nxt = nextLesson(scenario.id);
  const review = lesson
    ? debrief(lesson, {
        trades: st.trades,
        pnl: st.pnl,
        fees: st.fees,
        maxDrawdown: st.maxDrawdown,
        equity: st.equity,
        exposure: st.peakGross,
        fills: engine.fills.map((f) => ({ side: f.side, price: f.price, vwapAt: f.vwapAt })),
      })
    : null;

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
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-surface text-fg shadow-xl outline-none"
        >
          <header className="shrink-0 border-b border-border px-5 py-5 sm:px-7">
            <p className="academy-eyebrow flex items-center gap-2">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              練習已結算
              <span aria-hidden="true" className="text-subtle">
                /
              </span>
              {lesson ? `${lesson.no} · ${lesson.skill}` : "SESSION SETTLED"}
            </p>
            <div className="mt-3 flex items-center justify-between gap-4">
              <Dialog.Title
                id="result-title"
                className="text-xl font-semibold leading-snug sm:text-2xl"
              >
                {rec.scenarioName}
              </Dialog.Title>
              <span className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2">
                <span className="text-xs text-muted">評等</span>
                <span className="font-mono text-xl font-semibold">{rec.grade}</span>
              </span>
            </div>
            <Dialog.Description
              id="result-description"
              className="mt-3 text-sm leading-6 text-muted"
            >
              {review?.headline || "檢視這次的成交與成本，再選擇下一步練習。"}
            </Dialog.Description>
          </header>
          <div className="term-scroll min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
            {review && review.tags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {review.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Cell prominent label="模擬淨損益" value={formatSigned(rec.pnl, 0)} tone={rec.pnl} />
              <Cell prominent label="報酬率" value={formatPct(rec.pnlPct)} tone={rec.pnlPct} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
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

            {review && (
              <div className="mt-5 rounded-xl border border-border bg-bg/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen aria-hidden="true" className="size-4 text-brand" />
                  這次值得回看的地方
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                  {review.notes.map((n) => (
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
              <span className="text-muted">生涯段位</span>
              <span>
                {rank.title} · 累計 {formatSigned(profile.careerPnl, 0)}
              </span>
            </div>

            <p className="mt-2 text-xs leading-6 text-muted">
              權益 {formatMoney(st.equity, 0)} · 本金 {formatMoney(scenario.capital)}
            </p>
          </div>
          <footer className="shrink-0 border-t border-border bg-surface px-5 py-4 sm:px-7">
            <p role="status" className="mb-3 text-xs leading-5 text-muted">
              {syncStatus === "saved"
                ? "已儲存至教室主機"
                : syncStatus === "saving"
                  ? "正在儲存至教室主機…"
                  : syncStatus === "failed"
                    ? "伺服器儲存失敗，本機復盤已保留"
                    : "本機復盤紀錄"}
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
            <div className="mt-2 flex items-center justify-between gap-3">
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
      <div className="flex items-center justify-between gap-2">
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
