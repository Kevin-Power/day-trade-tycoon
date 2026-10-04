import { createFileRoute } from "@tanstack/react-router";
import { TryExperience } from "@/components/try-experience";

export const Route = createFileRoute("/try")({
  component: TryExperience,
  head: () => ({
    meta: [{ title: "免費操作體驗 · 當沖大富翁" }],
  }),
});
