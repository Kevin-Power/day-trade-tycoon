import { useEffect, useRef } from "react";
import { LEARNER_GUIDE_STEPS } from "@/lib/game/learner-guide";
import { useGame } from "@/lib/game/store";

export function LearnerGuide() {
  const step = useGame((state) => state.learnerGuideStep);
  const changeStep = useGame((state) => state.setLearnerGuideStep);
  const finish = useGame((state) => state.finishLearnerGuide);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (surfaceRef.current) surfaceRef.current.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);
  if (step === null) return null;
  const item = LEARNER_GUIDE_STEPS[step];
  const last = step === LEARNER_GUIDE_STEPS.length - 1;
  return (
    <section
      ref={surfaceRef}
      role="dialog"
      aria-labelledby="learner-guide-title"
      aria-describedby="learner-guide-description"
      className="term-scroll fixed inset-x-3 top-4 z-40 mx-auto max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-brand/30 bg-surface shadow-xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="text-sm font-medium text-brand">
          操作導覽 {step + 1} / {LEARNER_GUIDE_STEPS.length} · 已暫停
        </p>
        <button
          type="button"
          onClick={finish}
          className="min-h-12 rounded-lg px-3 text-base text-muted"
        >
          略過
        </button>
      </div>
      <div className="px-5 py-4">
        <h2
          ref={titleRef}
          tabIndex={-1}
          id="learner-guide-title"
          className="text-xl font-semibold outline-none"
        >
          {item.title}
        </h2>
        <p id="learner-guide-description" className="mt-3 text-base leading-7">
          {item.body}
        </p>
        <p className="mt-3 rounded-lg bg-bg p-3 text-base leading-7 text-muted">{item.detail}</p>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => changeStep(step - 1)}
            className="min-h-12 rounded-xl border border-border px-4 text-base"
          >
            上一步
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => (last ? finish() : changeStep(step + 1))}
          className="min-h-12 flex-1 rounded-xl bg-brand px-4 py-3 text-base font-semibold text-brand-fg"
        >
          {last ? "完成導覽，準備練習" : "下一步"}
        </button>
      </div>
    </section>
  );
}

export function LearnerGuideReady() {
  const start = useGame((state) => state.dismissBeat);
  const reopen = useGame((state) => state.openLearnerGuide);
  return (
    <section
      aria-label="準備開始練習"
      className="term-scroll fixed inset-x-3 top-4 z-30 mx-auto max-h-[calc(100dvh-2rem)] max-w-lg overflow-auto overscroll-contain rounded-2xl border border-border bg-surface p-5 shadow-xl"
    >
      <h2 className="text-xl font-semibold">盤勢仍暫停，準備好再開始</h2>
      <p className="mt-3 text-base leading-7 text-muted">
        導覽沒有送出任何委託。按下方按鈕後，模擬時間才會繼續；也可隨時用上方「暫停」停下來查看。
      </p>
      <button
        type="button"
        onClick={start}
        className="mt-4 min-h-12 w-full rounded-xl bg-brand px-4 py-3 text-base font-semibold text-brand-fg"
      >
        開始練習
      </button>
      <button
        type="button"
        onClick={reopen}
        className="mt-2 min-h-12 w-full rounded-xl px-4 text-base text-muted"
      >
        重看操作導覽
      </button>
    </section>
  );
}
