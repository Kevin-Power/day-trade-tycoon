import { createFileRoute } from "@tanstack/react-router";
import { MorningPractice } from "@/components/morning-practice";
import { getMorningExercise } from "@/lib/morning-exercises";

export const Route = createFileRoute("/morning")({
  validateSearch: (search: Record<string, unknown>): { exercise?: string; lesson?: string } => ({
    exercise:
      typeof search.exercise === "string" ? getMorningExercise(search.exercise)?.id : undefined,
    lesson:
      typeof search.lesson === "string" && /^morning-\d{8}-v\d+-[a-f0-9]{12}$/.test(search.lesson)
        ? search.lesson
        : undefined,
  }),
  component: MorningPage,
  head: () => ({
    meta: [
      { title: "真實早盤練習 · 當沖大富翁" },
      {
        name: "description",
        content:
          "選擇交易日與練習主題，先寫觀察計畫，再逐分鐘觀看真實歷史早盤 K 線；以紙上委託練習等待與復盤。沒有真實下單，也不會自動平倉。",
      },
    ],
  }),
});

function MorningPage() {
  const { exercise, lesson } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MorningPractice
      exerciseId={exercise}
      lessonId={lesson ?? ""}
      onLessonChange={(next) => {
        void navigate({ search: (previous) => ({ ...previous, lesson: next }), replace: true });
      }}
    />
  );
}
