import { createFileRoute } from "@tanstack/react-router";
import { MorningPractice } from "@/components/morning-practice";

export const Route = createFileRoute("/morning")({
  component: MorningPractice,
  head: () => ({
    meta: [
      { title: "真實早盤練習 · 當沖大富翁" },
      { name: "description", content: "先寫觀察計畫，再逐分鐘觀看歷史早盤行情；以紙上委託練習等待與復盤。單日資料教學試行，沒有真實下單，也不會自動平倉。" },
    ],
  }),
});
