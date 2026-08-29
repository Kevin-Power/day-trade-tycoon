import { clampLimit, roundToTick } from "@/lib/market/ticks";
import raw from "@/lib/market/real-paths.json";
import { getTapeDay } from "@/lib/market/tape";

export const PATH_DT = 5;

export type DayOhlc = {
  prev: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type SessionId = "mon" | "tue" | "wed";

type RawPack = {
  source: string;
  index5s: Record<SessionId, number[]>;
  indexMeta: Record<
    SessionId,
    {
      date: string;
      n: number;
      prevClose: number;
      open: number;
      high: number;
      low: number;
      close: number;
      highIndex: number;
      lowIndex: number;
    }
  >;
  stocks: Record<string, Record<SessionId, DayOhlc>>;
};

const pack = raw as RawPack;

export const PATH_SOURCE = pack.source;
export const PATH_NOTE =
  "加權＝證交所每 5 秒指數；個股＝當日公開開高低收，套上同一條大盤節奏（非逐筆成交）。";

function fromSeries(arr: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(arr as ArrayLike<number>);
  if (out.length > 1) out[0] = out[1]!;
  return out;
}

export function indexSeriesFor(sessionId: string): Float64Array {
  const live = getTapeDay(sessionId);
  if (live) return fromSeries(live.index5s);
  const sid = (sessionId in pack.index5s ? sessionId : "wed") as SessionId;
  return fromSeries(pack.index5s[sid]);
}

export function indexMetaFor(sessionId: string) {
  const live = getTapeDay(sessionId);
  if (live) {
    return {
      date: live.date,
      n: live.index5s.length,
      prevClose: live.prevClose,
      open: live.open,
      high: live.high,
      low: live.low,
      close: live.close,
      highIndex: live.highIndex,
      lowIndex: live.lowIndex,
    };
  }
  const sid = (sessionId in pack.indexMeta ? sessionId : "wed") as SessionId;
  return pack.indexMeta[sid];
}

export function stockDayFor(code: string, sessionId: string): DayOhlc | null {
  const live = getTapeDay(sessionId);
  if (live) return live.stocks[code] ?? null;
  const row = pack.stocks[code];
  if (!row) return null;
  const sid = (sessionId in row ? sessionId : "wed") as SessionId;
  return row[sid] ?? null;
}

export function stockField(sessionId: string, field: keyof DayOhlc): Record<string, number> {
  const live = getTapeDay(sessionId);
  if (live) {
    const out: Record<string, number> = {};
    for (const [code, day] of Object.entries(live.stocks)) out[code] = day[field];
    return out;
  }
  const out: Record<string, number> = {};
  for (const [code, days] of Object.entries(pack.stocks)) {
    const sid = (sessionId in days ? sessionId : "wed") as SessionId;
    const day = days[sid];
    if (day) out[code] = day[field];
  }
  return out;
}

export function sample5(path: Float64Array, t: number): number {
  const i = Math.min(path.length - 1, Math.max(0, Math.floor(t / PATH_DT)));
  return path[i] ?? 0;
}

/**
 * Map official daily OHLC onto the session's 5-second index shape.
 * Index[0] is 09:00:00 prev close; index[1] is the official open.
 * Stock path stays at its own open at t=0, then follows scaled index returns.
 */
export function projectStock(index: ArrayLike<number>, ohlc: DayOhlc): Float64Array {
  const n = index.length;
  const out = new Float64Array(n);
  const open = ohlc.open;
  const base = index[1] || index[0] || open;
  const rawPath = new Float64Array(n);
  rawPath[0] = open;
  for (let i = 1; i < n; i++) {
    rawPath[i] = open * (index[i]! / base);
  }

  let rawMax = open;
  let rawMin = open;
  for (let i = 1; i < n; i++) {
    const v = rawPath[i]!;
    if (v > rawMax) rawMax = v;
    if (v < rawMin) rawMin = v;
  }

  const eps = Math.max(Math.abs(open) * 1e-8, 1e-6);
  const upSpan = rawMax - open;
  const dnSpan = open - rawMin;
  const scaleUp = upSpan > eps ? (ohlc.high - open) / upSpan : 0;
  const scaleDn = dnSpan > eps ? (open - ohlc.low) / dnSpan : 0;

  for (let i = 0; i < n; i++) {
    const r = rawPath[i]!;
    const px = r >= open ? open + (r - open) * scaleUp : open + (r - open) * scaleDn;
    out[i] = px;
  }

  const blendFrom = Math.floor(n * 0.88);
  const blendSpan = Math.max(1, n - 1 - blendFrom);
  for (let i = blendFrom; i < n; i++) {
    const w = (i - blendFrom) / blendSpan;
    out[i] = out[i]! * (1 - w) + ohlc.close * w;
  }
  out[0] = open;
  out[n - 1] = ohlc.close;

  for (let i = 0; i < n; i++) {
    out[i] = clampLimit(out[i]!, ohlc.prev);
  }
  out[0] = clampLimit(open, ohlc.prev);
  out[n - 1] = clampLimit(ohlc.close, ohlc.prev);

  for (let i = 0; i < n; i++) {
    out[i] = roundToTick(out[i]!);
  }
  return out;
}
