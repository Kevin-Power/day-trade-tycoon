import { createFileRoute } from "@tanstack/react-router";
import { MorningPractice } from "@/components/morning-practice";
import { getMorningExercise } from "@/lib/morning-exercises";

export const Route = createFileRoute("/morning")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { exercise?: string; lesson?: string; panel?: "trade"; coach?: "1"; new?: "1" } => ({
    exercise:
      typeof search.exercise === "string" ? getMorningExercise(search.exercise)?.id : undefined,
    lesson:
      typeof search.lesson === "string" && /^morning-\d{8}-v\d+-[a-f0-9]{12}$/.test(search.lesson)
        ? search.lesson
        : undefined,
    panel: search.panel === "trade" ? "trade" : undefined,
    // `coach=1` replays the first-time hints (lobby link "第一次使用？看新手教學").
    coach: search.coach === "1" || search.coach === 1 ? "1" : undefined,
    // `new=1` (lobby 開始今天的練習／再練一輪) opens a new plan instead of the last finished round.
    new: search.new === "1" || search.new === 1 ? "1" : undefined,
  }),
  component: MorningPage,
  head: () => ({
    meta: [
      { title: "模擬下單與早盤練習 · 當沖大富翁" },
      {
        name: "description",
        content:
          "選擇交易日與練習主題，先寫觀察計畫，再逐分鐘觀看真實歷史早盤 K 線；以紙上委託練習等待與復盤。沒有真實下單，也不會自動平倉。",
      },
    ],
  }),
});

function MorningPage() {
  const { exercise, lesson, panel, coach, new: fresh } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MorningPractice
      exerciseId={exercise}
      lessonId={lesson ?? ""}
      initialPane={panel}
      coach={coach === "1"}
      fresh={fresh === "1"}
      onLessonChange={(next) => {
        void navigate({ search: (previous) => ({ ...previous, lesson: next }), replace: true });
      }}
    />
  );
}
