import type { Rng } from "@/lib/market/rng";
import { gauss } from "@/lib/market/rng";
import { stockField } from "@/lib/market/real-paths";
import { getTapeDay } from "@/lib/market/tape";
import type { TapeDay } from "@/lib/market/tape-types";

export type IndexKey = { m: number; px: number };

export type SessionHeadline = { atMinute: number; text: string };

export type IndexSession = {
  id: string;
  date: string;
  label: string;
  weekday: string;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  highMinute: number;
  lowMinute: number;
  turnoverYi: number;
  keys: IndexKey[];
  headlines: SessionHeadline[];
  stockPrev: Record<string, number>;
  stockClose: Record<string, number>;
};

export function formatIndex(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 本週（2026/08/24–08/26）加權：證交所 MI_5MINS 每 5 秒指數。教材凍結。 */
export const WEEK_SESSIONS: Record<string, IndexSession> = {
  mon: {
    id: "mon",
    date: "2026-08-24",
    label: "8/24（一）",
    weekday: "一",
    prevClose: 45224.29,
    open: 45240.3,
    high: 45362.3,
    low: 44761.88,
    close: 44762.32,
    highMinute: 43,
    lowMinute: 265,
    turnoverYi: 6563,
    keys: [
      { m: 0, px: 45240.3 },
      { m: 43, px: 45362.3 },
      { m: 60, px: 44973.51 },
      { m: 90, px: 45103.64 },
      { m: 160, px: 45013.32 },
      { m: 250, px: 44922.39 },
      { m: 265, px: 44761.88 },
      { m: 270, px: 44762.32 },
    ],
    headlines: [
      { atMinute: 12, text: "權值電子開平偏弱，台積電開在平盤附近後往下，半導體供應鏈跟跌。" },
      { atMinute: 43, text: "加權盤中高 45,362 出現在 09:43，隨後翻黑，開高走低格局成形。" },
      { atMinute: 60, text: "加權失守 45,000（約 09:59），外資轉賣，量能沒有跟上反攻。" },
      { atMinute: 200, text: "午後無反攻量能，指數貼近全日低點，成交約 6,563 億。" },
    ],
    stockPrev: stockField("mon", "prev"),
    stockClose: stockField("mon", "close"),
  },
  tue: {
    id: "tue",
    date: "2026-08-25",
    label: "8/25（二）",
    weekday: "二",
    prevClose: 44762.32,
    open: 44728.36,
    high: 45169.46,
    low: 44210.31,
    close: 45169.46,
    highMinute: 270,
    lowMinute: 120,
    turnoverYi: 7243,
    keys: [
      { m: 0, px: 44728.36 },
      { m: 1, px: 44464.98 },
      { m: 8, px: 44273.45 },
      { m: 60, px: 44397.62 },
      { m: 90, px: 44359.71 },
      { m: 120, px: 44210.31 },
      { m: 160, px: 44489.18 },
      { m: 250, px: 44876.15 },
      { m: 270, px: 45169.46 },
    ],
    headlines: [
      { atMinute: 1, text: "低開後 20 秒內急殺，加權由 44,728 落到 44,422。這不是找底的時間。" },
      { atMinute: 8, text: "早盤已到 44,273 一帶。全日低點 44,210 要到 11:00 才印出，不要把反彈當 V 轉。" },
      { atMinute: 120, text: "11:00 附近印出全日低點 44,210。金融先穩，電子午後才接棒。" },
      { atMinute: 160, text: "指數自低點回升，台積電由黑翻紅，電子與科技服務走穩。" },
      { atMinute: 250, text: "尾盤權值回補，加權收 45,169，漲 407 點、+0.91%，收在最高。成交約 7,243 億。" },
    ],
    stockPrev: stockField("tue", "prev"),
    stockClose: stockField("tue", "close"),
  },
  wed: {
    id: "wed",
    date: "2026-08-26",
    label: "8/26（三）",
    weekday: "三",
    prevClose: 45169.46,
    open: 45157.64,
    high: 45878.39,
    low: 44925.84,
    close: 45832.62,
    highMinute: 248,
    lowMinute: 0,
    turnoverYi: 8431,
    keys: [
      { m: 0, px: 45157.64 },
      { m: 0.3, px: 44925.84 },
      { m: 10, px: 45080 },
      { m: 40, px: 45310 },
      { m: 80, px: 45490 },
      { m: 130, px: 45620 },
      { m: 180, px: 45710 },
      { m: 248, px: 45878.39 },
      { m: 270, px: 45832.62 },
    ],
    headlines: [
      { atMinute: 0, text: "開盤 45,158，09:00:20 急殺至全日低 44,926。不要追第一下，也不要因為急殺手癢。" },
      { atMinute: 70, text: "台積電翻紅帶動供應鏈，金融續強，加權站上 45,500。" },
      { atMinute: 200, text: "午後攻高，盤中最高 45,878，漲點超過 600。" },
      { atMinute: 248, text: "尾盤前見高 45,878，終場收 45,832.62，漲 663.16 點、+1.47%，成交約 8,431 億。" },
    ],
    stockPrev: stockField("wed", "prev"),
    stockClose: stockField("wed", "close"),
  },
};

function clock(minute: number): string {
  const total = Math.max(0, Math.round(minute * 60));
  const h = 9 + Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function sessionFromTape(day: TapeDay): IndexSession {
  const chg = day.close - day.prevClose;
  const pct = (chg / day.prevClose) * 100;
  const stockPrev: Record<string, number> = {};
  const stockClose: Record<string, number> = {};
  for (const [code, s] of Object.entries(day.stocks)) {
    stockPrev[code] = s.prev;
    stockClose[code] = s.close;
  }
  const headlines: SessionHeadline[] = [
    {
      atMinute: 0,
      text: `開 ${formatIndex(day.open)}，昨收 ${formatIndex(day.prevClose)}。${day.open >= day.prevClose ? "高開" : "低開"}。`,
    },
  ];
  if (day.lowMinute >= 2) {
    headlines.push({
      atMinute: Math.round(day.lowMinute),
      text: `盤中最低 ${formatIndex(day.low)} 出現在 ${clock(day.lowMinute)}。`,
    });
  } else {
    headlines[0]!.text += ` 開盤附近見低 ${formatIndex(day.low)}。`;
  }
  if (Math.abs(day.highMinute - day.lowMinute) > 8) {
    headlines.push({
      atMinute: Math.max(1, Math.round(day.highMinute)),
      text: `盤中最高 ${formatIndex(day.high)} 出現在 ${clock(day.highMinute)}。`,
    });
  }
  headlines.push({
    atMinute: 250,
    text: `收 ${formatIndex(day.close)}，${chg >= 0 ? "漲" : "跌"} ${formatIndex(Math.abs(chg))} 點（${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%）${day.turnoverYi ? `，成交約 ${Math.round(day.turnoverYi)} 億` : ""}。`,
  });
  return {
    id: day.id,
    date: day.date,
    label: day.label,
    weekday: day.weekday,
    prevClose: day.prevClose,
    open: day.open,
    high: day.high,
    low: day.low,
    close: day.close,
    highMinute: day.highMinute,
    lowMinute: day.lowMinute,
    turnoverYi: day.turnoverYi,
    keys: [
      { m: 0, px: day.open },
      { m: day.lowMinute, px: day.low },
      { m: day.highMinute, px: day.high },
      { m: 270, px: day.close },
    ],
    headlines,
    stockPrev,
    stockClose,
  };
}

export function sessionById(id: string): IndexSession {
  if (WEEK_SESSIONS[id]) return WEEK_SESSIONS[id]!;
  const live = getTapeDay(id);
  if (live) return sessionFromTape(live);
  return WEEK_SESSIONS.wed!;
}

/** Fallback only — live classroom uses the 5-second series. */
export function buildSessionPath(session: IndexSession, minutes: number, rng: Rng): Float64Array {
  const keys = [...session.keys].sort((a, b) => a.m - b.m);
  const path = new Float64Array(minutes);
  for (let m = 0; m < minutes; m++) {
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1]!.m <= m) i += 1;
    const a = keys[i]!;
    const b = keys[Math.min(i + 1, keys.length - 1)]!;
    const span = Math.max(1, b.m - a.m);
    const t = Math.min(1, Math.max(0, (m - a.m) / span));
    const s = t * t * (3 - 2 * t);
    let px = a.px + (b.px - a.px) * s;
    px += gauss(rng) * 6.5;
    px = Math.min(session.high + 4, Math.max(session.low - 4, px));
    path[m] = px;
  }
  path[0] = session.open;
  const hi = Math.min(minutes - 1, Math.max(0, Math.round(session.highMinute)));
  const lo = Math.min(minutes - 1, Math.max(0, Math.round(session.lowMinute)));
  path[hi] = session.high;
  path[lo] = session.low;
  path[minutes - 1] = session.close;
  return path;
}
