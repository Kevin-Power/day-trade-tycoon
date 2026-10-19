import { AlertCircle, CheckCircle2, Clock3 } from "@/lib/icons";
import type { RuleVerdict } from "@/lib/game/pass-rules";
import { groupReviewVerdicts } from "@/lib/game/review-presentation";
import { cn, formatTime } from "@/lib/utils";

export function ReviewConditions({
  verdicts,
  compact = false,
}: {
  verdicts: readonly RuleVerdict[];
  compact?: boolean;
}) {
  const groups = groupReviewVerdicts(verdicts);
  return (
    <div className={compact ? "mb-5 space-y-3" : "space-y-6"}>
      {groups.map((group) => (
        <section key={group.id} aria-label={group.title}>
          <h3 className="text-base font-semibold">{group.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{group.description}</p>
          {compact ? (
            <p className="mt-2 text-base leading-7">
              {group.verdicts.filter((verdict) => verdict.passed).length} / {group.verdicts.length}{" "}
              項已達成
            </p>
          ) : (
            <ul className="mt-3 grid gap-3 lg:grid-cols-2">
              {group.verdicts.map((verdict) => (
                <li
                  key={verdict.rule.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-bg/50 p-4 text-base"
                >
                  {verdict.passed ? (
                    <CheckCircle2 aria-hidden className="mt-0.5 shrink-0 text-brand" />
                  ) : (
                    <AlertCircle aria-hidden className="mt-0.5 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{verdict.rule.label}</span>
                      <span className={cn("text-sm", verdict.passed ? "text-brand" : "text-muted")}>
                        {verdict.passed ? "已達成" : group.id === "outcome" ? "本盤未達" : "待練習"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-muted">{verdict.detail}</p>
                    {verdict.at !== undefined ? (
                      <p className="mt-2 flex items-center gap-1.5 font-mono text-sm text-subtle">
                        <Clock3 aria-hidden />
                        {formatTime(verdict.at)}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
