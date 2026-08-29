import { UNIVERSE } from "@/lib/market/universe";
import { TEACHING_DATES, type TapeDay, type TapePayload, type TapeStock } from "@/lib/market/tape-types";

const UA = "Mozilla/5.0 (compatible; DayTradeTycoon/1.0; +https://grok.com)";
const WD = ["日", "一", "二", "三", "四", "五", "六"] as const;
const TTL_MS = 10 * 60 * 1000;

type Mem = { key: string; at: number; payload: TapePayload };
let mem: Mem | null = null;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function taipeiNow(): {
  y: number;
  m: number;
  d: number;
  dow: number;
  hour: number;
  minute: number;
  ymd: string;
  iso: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    y,
    m,
    d,
    dow: dt.getUTCDay(),
    hour,
    minute,
    ymd: `${y}${pad2(m)}${pad2(d)}`,
    iso: `${y}-${pad2(m)}-${pad2(d)}`,
  };
}

function ymdParts(offsetDays: number): { ymd: string; iso: string; dow: number } {
  const n = taipeiNow();
  const dt = new Date(Date.UTC(n.y, n.m - 1, n.d + offsetDays));
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return {
    ymd: `${y}${pad2(m)}${pad2(d)}`,
    iso: `${y}-${pad2(m)}-${pad2(d)}`,
    dow: dt.getUTCDay(),
  };
}

function weekdaysBack(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 22 && out.length < n; i++) {
    const p = ymdParts(-i);
    if (p.dow === 0 || p.dow === 6) continue;
    if (TEACHING_DATES.has(p.iso)) continue;
    out.push(p.ymd);
  }
  return out;
}

function bucketKey(): string {
  const n = taipeiNow();
  const closed = n.hour > 13 || (n.hour === 13 && n.minute >= 50);
  return `${n.iso}:${closed ? "c" : "o"}`;
}

function isoFromYmd(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

async function getJson(url: string, timeoutMs = 16000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

async function fetchIndex5s(yyyymmdd: string): Promise<{
  date: string;
  series: number[];
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  highIndex: number;
  lowIndex: number;
} | null> {
  const url = `https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json&date=${yyyymmdd}`;
  try {
    const raw = asRecord(await getJson(url));
    if (String(raw.stat) !== "OK") return null;
    const rows = Array.isArray(raw.data) ? (raw.data as unknown[]) : [];
    if (rows.length < 3000) return null;
    const series: number[] = [];
    for (const row of rows) {
      const cells = Array.isArray(row) ? row : [];
      const px = parseNum(cells[1]);
      if (!Number.isFinite(px)) return null;
      series.push(round2(px));
    }
    const prevClose = series[0]!;
    const open = series[1] ?? series[0]!;
    let high = open;
    let low = open;
    let highIndex = 1;
    let lowIndex = 1;
    for (let i = 1; i < series.length; i++) {
      const v = series[i]!;
      if (v > high) {
        high = v;
        highIndex = i;
      }
      if (v < low) {
        low = v;
        lowIndex = i;
      }
    }
    return {
      date: isoFromYmd(yyyymmdd),
      series,
      prevClose,
      open,
      high,
      low,
      close: series[series.length - 1]!,
      highIndex,
      lowIndex,
    };
  } catch {
    return null;
  }
}

function rocToIso(s: string): string | null {
  const m = String(s).trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

async function fetchTurnover(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const raw = asRecord(
      await getJson(
        `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date=${taipeiNow().ymd}`,
      ),
    );
    const rows = Array.isArray(raw.data) ? (raw.data as unknown[]) : [];
    for (const row of rows) {
      const cells = Array.isArray(row) ? row : [];
      const day = rocToIso(String(cells[0] ?? ""));
      const amt = parseNum(cells[2]);
      if (day && Number.isFinite(amt)) out[day] = round2(amt / 1e8);
    }
  } catch {
    /* optional */
  }
  return out;
}

async function fetchStocks(start: string, end: string): Promise<Record<string, Record<string, TapeStock>>> {
  const byCode: Record<string, Record<string, TapeStock>> = {};
  const codes = UNIVERSE.map((s) => s.code);
  await Promise.all(
    codes.map(async (code) => {
      const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${code}&start_date=${start}&end_date=${end}`;
      try {
        const raw = asRecord(await getJson(url, 14000));
        const rows = Array.isArray(raw.data) ? (raw.data as Record<string, unknown>[]) : [];
        rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const map: Record<string, TapeStock> = {};
        for (let r = 0; r < rows.length; r++) {
          const cur = rows[r]!;
          const prevRow = rows[r - 1];
          const date = String(cur.date);
          const open = parseNum(cur.open);
          const high = parseNum(cur.max);
          const low = parseNum(cur.min);
          const close = parseNum(cur.close);
          const prev = prevRow ? parseNum(prevRow.close) : close;
          if (![open, high, low, close, prev].every(Number.isFinite)) continue;
          map[date] = { prev, open, high, low, close };
        }
        if (Object.keys(map).length) byCode[code] = map;
      } catch {
        /* skip name */
      }
    }),
  );
  return byCode;
}

function labelOf(dateIso: string): { label: string; weekday: string } {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const weekday = WD[dt.getUTCDay()] ?? "";
  return { label: `${Number(m)}/${Number(d)}（${weekday}）`, weekday };
}

async function pullFresh(): Promise<TapePayload> {
  const candidates = weekdaysBack(3);
  const rangeStart = ymdParts(-20).iso;
  const rangeEnd = ymdParts(0).iso;

  const [indexHits, turnover, stockBook] = await Promise.all([
    Promise.all(candidates.map((d) => fetchIndex5s(d))),
    fetchTurnover(),
    fetchStocks(rangeStart, rangeEnd),
  ]);

  const days: TapeDay[] = [];
  for (const hit of indexHits) {
    if (!hit) continue;
    if (TEACHING_DATES.has(hit.date)) continue;
    const { label, weekday } = labelOf(hit.date);
    const stocks: Record<string, TapeStock> = {};
    for (const [code, byDate] of Object.entries(stockBook)) {
      const row = byDate[hit.date];
      if (row) stocks[code] = row;
    }
    days.push({
      id: `d${hit.date.replaceAll("-", "")}`,
      date: hit.date,
      label,
      weekday,
      prevClose: hit.prevClose,
      open: hit.open,
      high: hit.high,
      low: hit.low,
      close: hit.close,
      highIndex: hit.highIndex,
      lowIndex: hit.lowIndex,
      highMinute: hit.highIndex / 12,
      lowMinute: hit.lowIndex / 12,
      turnoverYi: turnover[hit.date] ?? 0,
      index5s: hit.series,
      stocks,
      complete: hit.series.length >= 3200,
    });
  }

  days.sort((a, b) => b.date.localeCompare(a.date));

  if (!days.length) {
    return {
      ok: false,
      source: "TWSE MI_5MINS_INDEX + FinMind TaiwanStockPrice",
      fetchedAt: new Date().toISOString(),
      days: [],
      error: "沒有抓到完整交易日",
    };
  }

  return {
    ok: true,
    source: "TWSE MI_5MINS_INDEX + FinMind TaiwanStockPrice",
    fetchedAt: new Date().toISOString(),
    days,
  };
}

export async function pullRecentTape(opts?: { fresh?: boolean }): Promise<TapePayload> {
  const key = bucketKey();
  if (!opts?.fresh && mem && mem.key === key && Date.now() - mem.at < TTL_MS && mem.payload.ok) {
    return mem.payload;
  }
  const payload = await pullFresh();
  if (payload.ok) mem = { key, at: Date.now(), payload };
  return payload;
}
