import { Button } from "@/components/ui/button";
import { lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { formatTime } from "@/lib/utils";
import { LearnerGuide, LearnerGuideReady } from "@/components/learner-guide";

export function LessonCard() {
  const beat = useGame((s) => s.activeBeat);
  const scenario = useGame((s) => s.scenario);
  const dismissBeat = useGame((s) => s.dismissBeat);
  const setTeachMode = useGame((s) => s.setTeachMode);
  const guideStep = useGame((s) => s.learnerGuideStep);
  const guideReady = useGame((s) => s.learnerGuideReady);
  const reopenGuide = useGame((s) => s.openLearnerGuide);
  const lesson = scenario ? lessonById(scenario.id) : undefined;
  if (guideStep !== null) return <LearnerGuide />;
  if (guideReady && !beat) return <LearnerGuideReady />;
  if (!beat || !lesson) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-28 z-30 flex max-h-[calc(100dvh-13rem)] justify-center px-4 lg:left-[min(22rem,30%)] lg:right-[min(20rem,26%)]">
      <div
        role="dialog"
        aria-labelledby="lesson-title"
        className="pointer-events-auto w-full max-w-md overflow-auto rounded-xl border border-border-strong bg-surface shadow-[var(--shadow-panel)]"
      >
        <div className="pane-title flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="min-w-0 break-words text-base leading-6">
            {lesson.no} · {lesson.skill}
          </span>
          <span className="font-mono text-base leading-6 text-fg/80">
            {formatTime(beat.atMinute * 60).slice(0, 5)}
          </span>
        </div>
        <div className="p-5">
          <h3 id="lesson-title" className="text-lg font-semibold">
            {beat.title}
          </h3>
          <p className="mt-3 text-base leading-7 text-muted">{beat.body}</p>
          <p className="mt-3 rounded-lg bg-brand/5 p-3 text-base leading-7 text-fg">
            這一步：{beat.hint}
          </p>
          {guideReady ? (
            <p className="mt-3 text-base leading-7 text-brand">
              操作導覽已結束，盤勢仍暫停。準備好再按「開始練習」。
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button className="h-auto min-h-12 min-w-0 whitespace-normal py-3 text-base leading-6" size="sm" onClick={dismissBeat}>
              {guideReady ? "開始練習" : "繼續盤勢"}
            </Button>
            <Button
              className="h-auto min-h-12 min-w-0 whitespace-normal py-3 text-base leading-6"
              size="sm"
              variant="ghost"
              onClick={() => setTeachMode(false)}
            >
              關閉教學
            </Button>
          </div>
          <p className="mt-2 text-base leading-7 text-subtle">Space 繼續 · 盤面仍可看</p>
          {scenario?.id === "wed-open" ? (
            <button
              type="button"
              onClick={reopenGuide}
              className="mt-2 min-h-12 w-full whitespace-normal rounded-lg px-3 py-3 text-base leading-6 text-brand"
            >
              重看操作導覽
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
