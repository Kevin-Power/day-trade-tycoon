import { createFileRoute } from "@tanstack/react-router";
import { ManualPage } from "@/components/manual-page";

export const Route = createFileRoute("/manual")({
  component: ManualPage,
  head: () => ({
    meta: [{ title: "說明書 · 當沖大富翁" }],
  }),
});
