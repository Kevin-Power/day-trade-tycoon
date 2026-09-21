import { createFileRoute } from "@tanstack/react-router";
import { LicensePage } from "@/components/license-page";

export const Route = createFileRoute("/license")({
  component: LicensePage,
  head: () => ({
    meta: [{ title: "教室授權 · 當沖大富翁" }],
  }),
});
