import { createFileRoute } from "@tanstack/react-router";
import { DailyQuestionPage } from "@/components/daily-question";

export const Route = createFileRoute("/daily")({
  component: DailyPage,
  head: () => ({
    meta: [
      { title: "每日一題 · 當沖大富翁" },
      { name: "description", content: "每個交易日早上一題：用前一天的真實 1 分 K，練習判斷前高後高。" },
    ],
  }),
});

function DailyPage() {
  return <DailyQuestionPage />;
}
