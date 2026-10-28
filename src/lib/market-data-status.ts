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

// What the fetcher writes into status.json after the candles ("ticks", "taiex", "radar"). The file's own schema
// above is not strict, and these keys are read on their own: one that is missing or damaged only makes its own line
// neutral, and never the whole card. Only counts and dates are kept; the 當沖 list itself is never read.
const finishedAt = z.string().nullable().optional();
const ticksSchema = z.object({
  date: isoDate,
  outcome: z.enum(["ok", "partial", "failed"]),
  reason: z.string().nullable().optional(),
  symbols: z.object({ total: count, fetched: count, failed: count }),
  trades: count,
  finishedAt,
});
const taiexSchema = z.object({
  date: isoDate.nullable().optional(),
  outcome: z.enum(["ok", "failed"]),
  reason: z.string().nullable().optional(),
  points: count.nullable().optional(),
  failed: z.array(isoDate).optional(),
  finishedAt,
});
const radarSchema = z.object({
  outcome: z.enum(["ok", "failed", "not-configured"]),
  reason: z.string().nullable().optional(),
  latest: isoDate.nullable().optional(),
  symbols: count.nullable().optional(),
  finishedAt,
});

/** The most of a fetcher's reason the card keeps (a long list of stocks that were not fetched is cut). */
const REASON_LIMIT = 200;
const reasonOf = (value: string | null | undefined): string | null =>
  value ? (value.length > REASON_LIMIT ? `${value.slice(0, REASON_LIMIT)}…` : value) : null;

/** 逐筆: the newest day the trade-by-trade fetch handled. `complete` is every stock fetched. */
export type TicksSummary =
  | { state: "none" }
  | { state: "unreadable" }
  | {
      state: "ok" | "partial" | "failed";
      date: string;
      symbols: { total: number; fetched: number; failed: number };
      trades: number;
      complete: boolean;
      reason: string | null;
    };
/** 大盤: the newest day the run handled, stored or not; `failedDays` are the days it could not store. */
export type TaiexSummary =
  | { state: "none" }
  | { state: "unreadable" }
  | {
      state: "ok" | "failed";
      date: string | null;
      points: number | null;
      reason: string | null;
      failedDays: string[];
    };
/** 熱門當沖名單: the newest stored list's date and its number of stocks; never the stocks. */
export type RadarSummary =
  | { state: "none" }
  | { state: "unreadable" }
  | { state: "not-configured" }
  | { state: "ok" | "failed"; latest: string | null; count: number | null; reason: string | null };

const NONE = { state: "none" } as const;

function readKey<T>(
  status: unknown,
  key: string,
  schema: z.ZodType<T>,
): { found: false } | { found: true; value: T | null } {
  if (typeof status !== "object" || status === null || !(key in status)) return { found: false };
  const parsed = schema.safeParse((status as Record<string, unknown>)[key]);
  return { found: true, value: parsed.success ? parsed.data : null };
}

function ticksOf(status: unknown): TicksSummary {
  const read = readKey(status, "ticks", ticksSchema);
  if (!read.found) return NONE;
  if (!read.value) return { state: "unreadable" };
  const { outcome, date, symbols, trades, reason } = read.value;
  return { state: outcome, date, symbols, trades, complete: outcome === "ok", reason: reasonOf(reason) };
}

function taiexOf(status: unknown): TaiexSummary {
  const read = readKey(status, "taiex", taiexSchema);
  if (!read.found) return NONE;
  if (!read.value) return { state: "unreadable" };
  const { outcome, date, points, reason, failed } = read.value;
  return { state: outcome, date: date ?? null, points: points ?? null, reason: reasonOf(reason), failedDays: failed ?? [] };
}

function radarOf(status: unknown): RadarSummary {
  const read = readKey(status, "radar", radarSchema);
  if (!read.found) return NONE;
  if (!read.value) return { state: "unreadable" };
  const { outcome, latest, symbols, reason } = read.value;
  if (outcome === "not-configured") return { state: "not-configured" };
  return { state: outcome, latest: latest ?? null, count: symbols ?? null, reason: reasonOf(reason) };
}

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
  ticks: TicksSummary;
  taiex: TaiexSummary;
  radar: RadarSummary;
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
    ticks: NONE,
    taiex: NONE,
    radar: NONE,
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
    // Read from the raw file: the schema above leaves these keys out of what it parses.
    ticks: ticksOf(input.status),
    taiex: taiexOf(input.status),
    radar: radarOf(input.status),
  };
}

export type ExtraLine = { key: "ticks" | "taiex" | "radar"; label: string; text: string; tone: "ok" | "warn" | "muted" };

const NO_RECORD = "尚無紀錄";
const UNREADABLE = "紀錄格式無法讀取";
const NO_REASON = "原因未記錄";
const grouped = (value: number) => value.toLocaleString("en-US");
const neutralText = (state: "none" | "unreadable") => (state === "none" ? NO_RECORD : UNREADABLE);

/** The teacher card's three lines under the candles' status: 逐筆, 大盤 and 熱門當沖名單 (dates and counts only). */
export function extraLines(summary: Pick<MarketDataSummary, "ticks" | "taiex" | "radar">): ExtraLine[] {
  const { ticks, taiex, radar } = summary;

  let ticksLine: Pick<ExtraLine, "text" | "tone">;
  if (ticks.state === "none" || ticks.state === "unreadable") ticksLine = { text: neutralText(ticks.state), tone: "muted" };
  else if (ticks.state === "failed")
    ticksLine = { text: `${ticks.date}・失敗：${ticks.reason ?? NO_REASON}`, tone: "warn" };
  else
    ticksLine = {
      text: `${ticks.date}・${grouped(ticks.symbols.fetched)}／${grouped(ticks.symbols.total)} 檔・${grouped(ticks.trades)} 筆・${ticks.complete ? "完整" : "未完整"}`,
      tone: ticks.complete ? "ok" : "warn",
    };

  let taiexLine: Pick<ExtraLine, "text" | "tone">;
  if (taiex.state === "none" || taiex.state === "unreadable") taiexLine = { text: neutralText(taiex.state), tone: "muted" };
  else if (taiex.state === "failed") taiexLine = { text: `失敗：${taiex.reason ?? NO_REASON}`, tone: "warn" };
  else
    taiexLine = {
      text: `${taiex.date ?? "最新一天"} 已存${taiex.points !== null ? `（${grouped(taiex.points)} 點）` : ""}`,
      tone: "ok",
    };

  const stored = (latest: string | null, count: number | null) =>
    latest ? `${latest}${count !== null ? `・${grouped(count)} 檔` : ""}` : null;
  let radarLine: Pick<ExtraLine, "text" | "tone">;
  if (radar.state === "none" || radar.state === "unreadable") radarLine = { text: neutralText(radar.state), tone: "muted" };
  else if (radar.state === "not-configured") radarLine = { text: "尚未設定", tone: "muted" };
  else if (radar.state === "failed") {
    const kept = stored(radar.latest, radar.count);
    radarLine = { text: `失敗：${radar.reason ?? NO_REASON}${kept ? `（最新已存 ${kept}）` : ""}`, tone: "warn" };
  } else {
    const kept = stored(radar.latest, radar.count);
    radarLine = { text: kept ? `最新 ${kept}` : "還沒有已存的名單", tone: kept ? "ok" : "muted" };
  }

  return [
    { key: "ticks", label: "逐筆", ...ticksLine },
    { key: "taiex", label: "大盤", ...taiexLine },
    { key: "radar", label: "熱門當沖名單", ...radarLine },
  ];
}
