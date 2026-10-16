import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { MarketDataSummary } from "@/lib/market-data-status";

type Result = { ok: true; summary: MarketDataSummary } | { ok: false; reason: string };

/** Teacher-only: the fetcher's status files under MARKET_DATA_DIR; never any broker data. */
export const loadMarketDataStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<Result> => {
    const { requireAuthenticatedUser } = await import("@/lib/auth/verify.server");
    const { classroomRole } = await import("@/lib/classroom-policy");
    const user = await requireAuthenticatedUser();
    if (
      classroomRole(user, {
        teacherIds: process.env.CLASSROOM_TEACHER_IDS,
        teacherEmails: process.env.TEACHER_EMAILS,
      }) !== "teacher"
    )
      return { ok: false, reason: "此帳號尚未由管理員授予講師權限" };
    const { marketDataSummary } = await import("@/lib/market-data-status");
    const directory = process.env.MARKET_DATA_DIR?.trim();
    if (!directory)
      return { ok: true, summary: marketDataSummary({ configured: false, status: null, index: null }, new Date()) };
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const read = async (name: string): Promise<unknown> => {
      try {
        return JSON.parse((await readFile(join(directory, name), "utf8")).replace(/^\uFEFF/, ""));
      } catch (error) {
        return (error as { code?: string }).code === "ENOENT" ? null : { invalid: true };
      }
    };
    const [status, index] = await Promise.all([read("status.json"), read("index.json")]);
    return { ok: true, summary: marketDataSummary({ configured: true, status, index }, new Date()) };
  });
