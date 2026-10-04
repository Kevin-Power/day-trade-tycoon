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
      {
        atMinute: 12,
        text: "先核對目前選的商品，再看價格相對昨收與均價的位置。其他商品的漲跌，不能代替自己的操作條件。",
      },
      {
        atMinute: 43,
        text: "目前的價格位置不代表接下來的方向。先說出眼前觀察，再對照原計畫；條件未到可以繼續等待。",
      },
      {
        atMinute: 60,
        text: "有送出委託時，先查已成交與待成交張數，再核對庫存。五檔變動不代表自己的委託已成交。",
      },
      {
        atMinute: 200,
        text: "查看目前模擬時間、待成交委託與庫存。需要處理部位時，送出後仍要核對成交與剩餘張數。",
      },
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
      {
        atMinute: 1,
        text: "先確認商品、模擬時間與庫存。已有部位時核對原定出場條件；沒有部位時，也可以先觀察並記下理由。",
      },
      {
        atMinute: 8,
        text: "把目前價格與昨收、均價分開比較。眼前的價格變動不能確認後面走勢，先回看自己寫下的條件。",
      },
      {
        atMinute: 120,
        text: "再次核對原計畫與目前持倉。有操作時查看成交與剩餘張數；沒有符合條件時，可以繼續等待。",
      },
      {
        atMinute: 160,
        text: "有成交時，查看成交時間與費稅，再對照目前庫存。是否操作仍依原計畫核對，不以單次損益認定自己已熟練。",
      },
      {
        atMinute: 250,
        text: "接近本次練習收尾，先查待成交委託與庫存。處理部位後，用成交紀錄與剩餘張數確認結果。",
      },
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
      {
        atMinute: 0,
        text: "先找到商品代號、昨收與目前模擬時間。依眼前資料核對自己的條件，不急著送單；需要慢慢看時，可以暫停。",
      },
      {
        atMinute: 70,
        text: "一檔商品的漲跌不能代替另一檔的條件。先選一檔，核對它自己的價格、庫存與原計畫。",
      },
      {
        atMinute: 200,
        text: "收尾時依序查看待成交委託、庫存與成交。按過出場按鈕不代表已全部成交，仍要核對剩餘張數。",
      },
      {
        atMinute: 248,
        text: "先核對模擬時間與剩餘庫存，再準備查看復盤。結束練習不代表已全部平倉，也不代表操作能力已通過認證。",
      },
    ],
    stockPrev: stockField("wed", "prev"),
    stockClose: stockField("wed", "close"),
  },
};

export function sessionFromTape(day: TapeDay): IndexSession {
  const stockPrev: Record<string, number> = {};
  const stockClose: Record<string, number> = {};
  for (const [code, s] of Object.entries(day.stocks)) {
    stockPrev[code] = s.prev;
    stockClose[code] = s.close;
  }
  const headlines: SessionHeadline[] = [
    {
      atMinute: 0,
      text: `本段開盤 ${formatIndex(day.open)}，昨收 ${formatIndex(day.prevClose)}。先核對目前商品與時間，再對照自己的操作條件。`,
    },
  ];
  if (day.lowMinute >= 2) {
    headlines.push({
      atMinute: Math.round(day.lowMinute),
      text: "查看目前價格相對昨收與均價的位置，再核對原計畫。當下的一個價位，不能確認後續走勢。",
    });
  } else {
    headlines[0]!.text += " 條件未到，可以先觀察。";
  }
  if (Math.abs(day.highMinute - day.lowMinute) > 8) {
    headlines.push({
      atMinute: Math.max(1, Math.round(day.highMinute)),
      text: "若已送出委託，先看原委託的成交狀態，再核對庫存與剩餘張數。不要只憑盤面顏色判斷操作結果。",
    });
  }
  headlines.push({
    atMinute: 250,
    text: "接近本次練習收尾，先核對待成交委託與庫存。處理部位後，再用成交紀錄確認；之後把費稅一併列入復盤。",
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
