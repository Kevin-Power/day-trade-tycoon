import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadReview } from "@/lib/game/persist";
import { lessonById, passRulesOf } from "@/lib/game/curriculum";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";

export const Route = createFileRoute("/session/$id/review")({ component: ReviewRoute });

function ReviewRoute() {
  const { id } = Route.useParams();
  const start = useGame((s) => s.start);
  const leave = useGame((s) => s.leave);
  const [bundle, setBundle] = useState(() => loadReview(id) ?? loadReview());

  useEffect(() => {
    setBundle(loadReview(id) ?? loadReview());
  }, [id]);

  if (!bundle) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg p-6 text-fg">
        <div className="text-center">
          <p>找不到這份復盤。請從盤室結算後再開。</p>
          <Link to="/" className="mt-4 inline-block text-tape">
            回課綱
          </Link>
        </div>
      </main>
    );
  }

  const rec = bundle.rec;
  const lesson = lessonById(rec.scenarioId);
  const rules = bundle.verdicts.length ? bundle.verdicts : passRulesOf(rec.scenarioId).map((rule) => ({ rule, passed: true, detail: "" }));

  return (
    <main className="min-h-dvh bg-bg px-4 py-8 text-fg">
      <div className="mx-auto max-w-3xl">
        <p className="text-micro tracking-[0.2em] text-muted">
          {lesson ? `${lesson.no} · ${lesson.skill}` : rec.scenarioId}
        </p>
        <div className="mt-2 flex items-end gap-3">
          <h1 className="text-3xl font-medium">{rec.scenarioName}</h1>
          <span className={cn("rounded-sm px-2 py-1 text-lg", rec.passed ? "bg-down-dim text-down" : "bg-up-dim text-up")}>
            {rec.passed ? "通過" : "未通過"}
          </span>
        </div>
        {!rec.passed && rec.violations?.length ? <p className="mt-2 text-sm text-up">未達成：{rec.violations.join("、")}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border sm:grid-cols-4">
          <Cell label="總報酬" value={formatSigned(rec.pnl, 0)} tone={rec.pnl} />
          <Cell label="最大回撤" value={`${(rec.maxDrawdown * 100).toFixed(2)}%`} />
          <Cell label="交易筆數" value={String(rec.trades)} />
          <Cell label="費稅" value={formatMoney(rec.fees, 0)} />
          <Cell label="暫停中成交" value={`${rec.pausedFills ?? 0} 筆`} />
          <Cell label="報酬率" value={formatPct(rec.pnlPct)} tone={rec.pnlPct} />
        </div>

        <ul className="mt-6 space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          {rules.map((v) => (
            <li key={v.rule.id} className="flex gap-2">
              <span className={v.passed ? "text-down" : "text-up"}>{v.passed ? "✓" : "✗"}</span>
              <span>
                {v.rule.label}
                <span className="ml-2 text-micro text-muted">{v.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={() => start(rec.scenarioId)}>
            再打一次
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => {
              leave();
              window.location.href = "/";
            }}
          >
            回課綱
          </Button>
        </div>
      </div>
    </main>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="text-micro text-muted">{label}</div>
      <div className={cn("mt-0.5 font-mono text-base tabular", tone !== undefined ? toneClass(tone) : "text-fg")}>{value}</div>
    </div>
  );
}
