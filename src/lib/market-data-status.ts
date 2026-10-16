import { z } from "zod";

const outcome = z.enum(["running", "ok", "closed", "failed", "already-done"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const run = z.object({
  date: isoDate,
  mode: z.enum(["daily", "backfill"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcome,
  reason: z.string().nullable(),
  symbols: z.object({ total: count, fetched: count, failed: count, excluded: count }),
});
const statusSchema = z.object({
  schema: z.literal(1),
  latestDay: isoDate.nullable(),
  lastRun: run.nullable(),
  history: z.array(z.object({ date: isoDate, outcome, finishedAt: z.string().nullable() })),
});
const indexSchema = z.object({
  schema: z.literal(1),
  days: z.array(
    z.object({
      date: isoDate,
      coverage: z.enum(["full-market", "selected"]),
      symbols: count,
      manifestSha256: z.string(),
      publishedAt: z.string(),
    }),
  ),
});

export type MarketDataState =
  | "unconfigured"
  | "never"
  | "ok"
  | "closed"
  | "failed"
  | "running"
  | "stalled"
  | "invalid";

export type MarketDataSummary = {
  state: MarketDataState;
  latestDay: string | null;
  latestSymbols: number | null;
  fullMarketDays: number;
  lastRun: {
    date: string;
    mode: "daily" | "backfill";
    startedAt: string;
    finishedAt: string | null;
    durationMinutes: number | null;
    symbols: { total: number; fetched: number; failed: number; excluded: number };
  } | null;
  reason: string | null;
  missingExpectedDay: string | null;
};

const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const STALLED_AFTER_MS = 2 * 3_600_000;

/** The most recent weekday (Taipei) whose 19:30 has passed: by then its lesson should exist. */
export function expectedTradingDay(now: Date): string {
  const local = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (local.getUTCHours() * 60 + local.getUTCMinutes() < 19 * 60 + 30) day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

export function marketDataSummary(
  input: { configured: boolean; status: unknown; index: unknown },
  now: Date,
): MarketDataSummary {
  const empty = {
    latestDay: null,
    latestSymbols: null,
    fullMarketDays: 0,
    lastRun: null,
    reason: null,
    missingExpectedDay: null,
  };
  if (!input.configured) return { state: "unconfigured", ...empty };
  if (input.status === null && input.index === null) return { state: "never", ...empty };
  const parsedStatus = input.status === null ? null : statusSchema.safeParse(input.status);
  const parsedIndex = input.index === null ? null : indexSchema.safeParse(input.index);
  if ((parsedStatus && !parsedStatus.success) || (parsedIndex && !parsedIndex.success))
    return { state: "invalid", ...empty, reason: "狀態檔格式錯誤，請確認抓取程式版本" };
  const status = parsedStatus?.success ? parsedStatus.data : null;
  const index = parsedIndex?.success ? parsedIndex.data : null;
  const days = [...(index?.days ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = days.at(-1) ?? null;
  const last = status?.lastRun ?? null;
  const history = status?.history ?? [];
  let state: MarketDataState = !last ? "never" : last.outcome === "already-done" ? "ok" : last.outcome;
  let reason = last?.reason ?? null;
  if (last?.outcome === "running" && now.getTime() - Date.parse(last.startedAt) > STALLED_AFTER_MS) {
    state = "stalled";
    reason = "上一次執行超過 2 小時仍未結束，可能已中斷";
  }
  const expected = expectedTradingDay(now);
  const covered =
    days.some((entry) => entry.date === expected) ||
    history.some((entry) => entry.date === expected && entry.outcome === "closed");
  return {
    state,
    latestDay: latest?.date ?? null,
    latestSymbols: latest?.symbols ?? null,
    fullMarketDays: days.filter((entry) => entry.coverage === "full-market").length,
    lastRun: last
      ? {
          date: last.date,
          mode: last.mode,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          durationMinutes: last.finishedAt
            ? Math.round((Date.parse(last.finishedAt) - Date.parse(last.startedAt)) / 60_000)
            : null,
          symbols: last.symbols,
        }
      : null,
    reason,
    missingExpectedDay: last && !covered ? expected : null,
  };
}
