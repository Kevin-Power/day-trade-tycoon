import { Button } from "@/components/ui/button";
import { debrief, lessonById, nextLesson } from "@/lib/game/curriculum";
import { rankFor } from "@/lib/game/scenarios";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";

export function ResultScreen() {
  const rec = useGame((s) => s.lastResult);
  const profile = useGame((s) => s.profile);
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const start = useGame((s) => s.start);
  const leave = useGame((s) => s.leave);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-3 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="result-title"
        className="max-h-[92dvh] w-full max-w-xl overflow-auto rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6"
      >
        <p className="text-micro tracking-[0.22em] text-muted">
          {lesson ? `${lesson.no} · ${lesson.skill}` : "SESSION SETTLED"}
        </p>
        <h2 id="result-title" className="mt-1 text-2xl font-medium">
          {rec.scenarioName} · {rec.grade}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{review?.headline ?? ""}</p>
        {review && review.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {review.tags.map((t) => (
              <span key={t} className="rounded-xs bg-elevated px-1.5 py-0.5 text-2xs tracking-wide text-muted">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border">
          <Cell label="損益" value={formatSigned(rec.pnl, 0)} tone={rec.pnl} />
          <Cell label="報酬率" value={formatPct(rec.pnlPct)} tone={rec.pnlPct} />
          <Cell label="交易次數" value={String(rec.trades)} />
          <Cell label="勝率" value={rec.trades ? `${((rec.wins / rec.trades) * 100).toFixed(0)}%` : "—"} />
          <Cell label="費稅" value={formatMoney(rec.fees, 0)} />
          <Cell label="最大回撤" value={`${(rec.maxDrawdown * 100).toFixed(2)}%`} />
        </div>

        {review && (
          <div className="mt-4 rounded-md border border-border bg-bg px-3 py-3">
            <div className="text-micro tracking-wide text-muted">課後復盤</div>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted">
              {review.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm">
          <span className="text-muted">生涯段位</span>
          <span>
            {rank.title} · 累計 {formatSigned(profile.careerPnl, 0)}
          </span>
        </div>

        <p className="mt-3 text-micro text-subtle">
          權益 {formatMoney(st.equity, 0)} · 本金 {formatMoney(scenario.capital)}
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {nxt ? (
            <Button className="flex-1" onClick={() => start(nxt.id)}>
              下一課 {nxt.no}
            </Button>
          ) : (
            <Button className="flex-1" onClick={() => start(scenario.id)}>
              再打一盤
            </Button>
          )}
          <Button className="flex-1" variant="outline" onClick={() => start(scenario.id)}>
            重打本課
          </Button>
          <Button className="flex-1" variant="ghost" onClick={leave}>
            回大廳
          </Button>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="bg-bg px-3 py-2.5">
      <div className="text-micro text-muted">{label}</div>
      <div className={cn("mt-0.5 font-mono text-base tabular", tone !== undefined ? toneClass(tone) : "text-fg")}>
        {value}
      </div>
    </div>
  );
}