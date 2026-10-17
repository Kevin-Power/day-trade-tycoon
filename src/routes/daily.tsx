import { createFileRoute } from "@tanstack/react-router";
import { DailyQuestionPage } from "@/components/daily-question";

export const Route = createFileRoute("/daily")({
  // `teacher=1` (teacher card) shows the reveal without answering.
  validateSearch: (search: Record<string, unknown>): { teacher?: "1" } => ({
    teacher: search.teacher === "1" || search.teacher === 1 ? "1" : undefined,
  }),
  component: DailyPage,
  head: () => ({
    meta: [
      { title: "每日一題 · 當沖大富翁" },
      { name: "description", content: "每個交易日早上一題：用前一天的真實 1 分 K，練習判斷前高後高。" },
    ],
  }),
});

function DailyPage() {
  const { teacher } = Route.useSearch();
  return <DailyQuestionPage teacher={teacher === "1"} />;
}
