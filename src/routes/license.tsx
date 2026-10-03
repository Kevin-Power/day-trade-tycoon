import { createFileRoute } from "@tanstack/react-router";
import { LicensePage } from "@/components/license-page";

export const Route = createFileRoute("/license")({
  component: LicensePage,
  head: () => ({
    meta: [
      { title: "課程介紹 · 當沖大富翁" },
      {
        name: "description",
        content:
          "講師帶班，搭配三階段六組模擬任務。從進場計畫、委託核對到復盤回饋，一次練好一個動作。可先免費體驗。",
      },
    ],
  }),
});
