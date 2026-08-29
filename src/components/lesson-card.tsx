import { Button } from "@/components/ui/button";
import { lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { formatTime } from "@/lib/utils";

export function LessonCard() {
  const beat = useGame((s) => s.activeBeat);
  const scenario = useGame((s) => s.scenario);
  const dismissBeat = useGame((s) => s.dismissBeat);
  const setTeachMode = useGame((s) => s.setTeachMode);
  const lesson = scenario ? lessonById(scenario.id) : undefined;
  if (!beat || !lesson) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-40 flex justify-center px-3 lg:inset-x-auto lg:bottom-4 lg:left-2 lg:top-auto lg:justify-start">
      <div
        role="dialog"
        aria-labelledby="lesson-title"
        className="pointer-events-auto w-full max-w-lg overflow-hidden rounded-md border border-border-strong bg-surface shadow-[var(--shadow-panel)] lg:w-80"
      >
        <div className="pane-title flex h-7 items-center justify-between px-2.5">
          <span>
            {lesson.no} · {lesson.skill}
          </span>
          <span className="font-mono text-micro text-fg/80">{formatTime(beat.atMinute * 60).slice(0, 5)}</span>
        </div>
        <div className="p-2.5">
          <h3 id="lesson-title" className="text-sm font-medium">
            {beat.title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{beat.body}</p>
          <p className="mt-1.5 text-micro text-fg">動作：{beat.hint}</p>
          <div className="mt-2.5 flex gap-2">
            <Button className="flex-1" size="sm" onClick={dismissBeat}>
              繼續盤勢
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTeachMode(false)}>
              關閉教學
            </Button>
          </div>
          <p className="mt-1.5 text-micro text-subtle">Space 繼續 · 盤面仍可看</p>
        </div>
      </div>
    </div>
  );
}
