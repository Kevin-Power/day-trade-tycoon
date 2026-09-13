import { Button } from "@/components/ui/button";
import { lessonById, passRulesOf } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { formatMoney, formatTime } from "@/lib/utils";

export function LessonCard() {
  const beat = useGame((s) => s.activeBeat);
  const briefing = useGame((s) => s.briefingOpen);
  const scenario = useGame((s) => s.scenario);
  const dismissBeat = useGame((s) => s.dismissBeat);
  const dismissBriefing = useGame((s) => s.dismissBriefing);
  const setTeachMode = useGame((s) => s.setTeachMode);
  const engine = useGame((s) => s.engine);
  const lesson = scenario ? lessonById(scenario.id) : undefined;
  const clock = formatTime(engine?.startT ?? 0);

  if (briefing && lesson && scenario) {
    const rules = passRulesOf(lesson.id).slice(0, 3);
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg/80 p-3">
        <div
          role="dialog"
          aria-labelledby="brief-title"
          className="w-full max-w-lg overflow-hidden rounded-lg border border-border-strong bg-surface shadow-[var(--shadow-panel)]"
        >
          <div className="pane-title flex h-8 items-center justify-between px-3">
            <span>
              {lesson.no} · {lesson.skill}
            </span>
            <span className="font-mono text-micro text-fg/80">{clock} · 暫停</span>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-micro tracking-[0.18em] text-muted">開場講解</p>
            <h3 id="brief-title" className="mt-1 text-xl font-medium">
              {scenario.name}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{lesson.principle}</p>
            <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border text-sm">
              <div className="bg-bg px-3 py-2">
                <dt className="text-micro text-muted">本金</dt>
                <dd className="font-mono tabular">{formatMoney(scenario.capital, 0)}</dd>
              </div>
              <div className="bg-bg px-3 py-2">
                <dt className="text-micro text-muted">額度</dt>
                <dd className="font-mono tabular">{scenario.leverage}x{scenario.allowShort ? " · 可先賣" : " · 僅先買"}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <div className="text-micro tracking-wide text-muted">本課三條規則</div>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
                {(rules.length ? rules.map((r) => r.label) : lesson.prep.slice(0, 3)).map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-tape" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-micro text-subtle">目標：{scenario.objective}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={dismissBriefing}>
                開始
              </Button>
              <Button variant="ghost" onClick={() => setTeachMode(false)}>
                關閉關鍵分鐘暫停
              </Button>
            </div>
            <p className="mt-2 text-micro text-subtle">Space 開始 · 時間軸停在 {clock}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!beat || !lesson) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/55 p-3">
      <div
        role="dialog"
        aria-labelledby="lesson-title"
        className="w-full max-w-md overflow-hidden rounded-md border border-border-strong bg-surface shadow-[var(--shadow-panel)]"
      >
        <div className="pane-title flex h-7 items-center justify-between px-2.5">
          <span>
            {lesson.no} · {lesson.skill}
          </span>
          <span className="font-mono text-micro text-fg/80">{formatTime(beat.atMinute * 60).slice(0, 8)}</span>
        </div>
        <div className="p-3">
          <h3 id="lesson-title" className="text-sm font-medium">
            {beat.title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{beat.body}</p>
          <p className="mt-1.5 text-micro text-fg">動作：{beat.hint}</p>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" size="sm" onClick={dismissBeat}>
              繼續盤勢
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTeachMode(false)}>
              關閉暫停
            </Button>
          </div>
          <p className="mt-1.5 text-micro text-subtle">Space 繼續 · 盤面仍可看</p>
        </div>
      </div>
    </div>
  );
}
