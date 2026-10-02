import { SERVER_REVIEW_FILL_LIMIT } from "./review-schema.ts";

export type ReviewSyncStatus = "local" | "saving" | "saved" | "failed" | "too-large";

export function reviewSaveMessage(status: ReviewSyncStatus, localSaved: boolean): string {
  if (status === "saved") return "已儲存至教室主機。";
  const local = localSaved
    ? "完整復盤已保存在這台裝置。"
    : "尚未保存，僅暫存於目前頁面；重新整理或關閉頁面後會遺失。";
  if (status === "too-large") return `成交超過主機每盤 ${SERVER_REVIEW_FILL_LIMIT.toLocaleString("en-US")} 筆上限，未存入教室主機。${local}`;
  if (status === "saving") return `正在儲存至教室主機…${local}`;
  if (status === "failed") return `教室主機尚未保存本次練習。${local}`;
  return local;
}
