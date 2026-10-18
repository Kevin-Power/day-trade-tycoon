import { createFileRoute } from "@tanstack/react-router";
import { DisciplinePage } from "@/components/discipline-page";

export const Route = createFileRoute("/progress")({
  component: DisciplinePage,
  head: () => ({
    meta: [
      { title: "我的紀律 · 當沖大富翁" },
      { name: "description", content: "紀律等級、稱號與徽章：分數只看練習習慣與紀律，不看賺賠。" },
    ],
  }),
});
