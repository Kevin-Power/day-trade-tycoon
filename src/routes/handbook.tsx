import { createFileRoute } from "@tanstack/react-router";
import { HandbookPage } from "@/components/handbook-page";

export const Route = createFileRoute("/handbook")({
  component: HandbookPage,
  head: () => ({
    meta: [{ title: "教材 · 當沖大富翁" }],
  }),
});
