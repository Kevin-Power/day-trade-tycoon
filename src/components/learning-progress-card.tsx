import { useId } from "react";
import { Check, Circle, Footprints, ArrowRight } from "lucide-react";
import type { ReviewBundle } from "@/lib/game/persist";
import { deriveLearningProgress } from "@/lib/game/learning-progress";
import { courseStepFor } from "@/lib/game/learning-path";

export function LearningProgressCard({ bundle }: { bundle: ReviewBundle }) {
  const titleId = useId();
  const progress = deriveLearningProgress(bundle);
  const course = courseStepFor(bundle.rec.scenarioId);
  const unknownPlan = progress.milestones.some(
    (item) => item.id === "plan-recorded" && item.status === "unknown",
  );
  const hasPlan = progress.milestones.some(
    (item) => item.id === "plan-recorded" && item.status === "achieved",
  );
  const open = bundle.openPositionsAtEnd;
  const next =
    open && open.length > 0
      ? "先回看仍有庫存的那一筆，記下一個下次要執行的出場動作。"
      : unknownPlan
        ? "這份紀錄沒有可判定的計畫資料。先核對當時的筆記，再選一個下次要保留的動作。"
        : !hasPlan
          ? "下次先寫一個進場條件、一個離場條件與模擬虧損額度。條件未到，可以繼續觀察。"
          : progress.noRecordedFills
            ? "你已留下計畫。回看這次條件是否出現；沒有出現，也可以保持空手並記下原因。"
            : "挑一筆成交，對照自己寫的計畫：保留一個做對的動作，再選一個下次要調整的地方。";
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-brand/25 bg-brand/5 p-4 sm:p-5"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-brand">
        <Footprints className="size-5 shrink-0" aria-hidden />
        本次練習足跡
      </p>
      <h2 id={titleId} className="mt-2 text-xl font-semibold leading-8">
        {progress.achievedCount > 0
          ? `這次留下 ${progress.achievedCount} 項練習足跡`
          : "先找到一個可以帶走的觀察"}
      </h2>
      <p className="mt-2 text-base leading-7 text-muted">
        {progress.achievedCount > 0
          ? "先看已留下的紀錄，再選下一步。賺賠與是否依計畫執行，分開檢視。"
          : "目前還沒有足夠紀錄確認下列動作。先看懂一個環節，再依自己的進度練習。"}
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {progress.milestones.map((item) => (
          <li key={item.id} className="min-w-0 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start gap-2.5">
              {item.status === "achieved" ? (
                <Check className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-base font-semibold leading-7">{item.title}</p>
                <p className="mt-1 text-sm font-medium text-brand">
                  {item.status === "achieved"
                    ? "本次已記錄"
                    : item.status === "unknown"
                      ? "資料不足，保留未判定"
                      : "本次尚未記錄"}
                </p>
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-brand/20 pt-4">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <ArrowRight className="size-5 shrink-0 text-brand" aria-hidden />
          下一步，只帶走一件事
        </h3>
        <p className="mt-2 text-base leading-7">{next}</p>
        {course && (
          <p className="mt-2 text-sm leading-6 text-muted">本課復盤：{course.reflection}</p>
        )}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        以上是模擬操作紀錄，並非能力認證。零庫存不等於自行平倉；是否依計畫執行，仍要對照完整復盤。
      </p>
    </section>
  );
}
