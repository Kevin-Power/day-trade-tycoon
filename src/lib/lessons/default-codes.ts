// Which stocks a lesson's 自選 starts with, and the exact desk wording for it. Pure: no I/O, no clock.
// Rules are decisions A–E and L of the radar-watchlist design: the previous trading day's 當沖 list when it is
// fresh and has practisable stocks, otherwise the day's top 5 by turnover (always for guests).

import type { RadarList } from "./types.ts";

/** A run holds 1 to 80 stocks. */
export const MAX_RUN_CODES = 80;

/** What the list held, after removing repeats: all, 上櫃 (not in the course), and neither 上櫃 nor practisable. */
export type ListCounts = { listed: number; otc: number; missing: number };

export type DefaultChoice =
  | { basis: "radar"; radarDate: string; codes: string[]; counts: ListCounts }
  | { basis: "top5"; reason: "guest" | "no-list" | "stale" | "empty"; codes: string[]; counts?: ListCounts };

const compareCodes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function chooseDefaultCodes(input: {
  lessonDate: string;
  fullMarketDays: readonly string[];
  radar: RadarList | null;
  practisable: ReadonlySet<string>;
  otc: ReadonlySet<string>;
  top5: readonly string[];
  guest: boolean;
}): DefaultChoice {
  const top5 = [...input.top5].sort(compareCodes);
  // Guests never see the list (decision L): answer before the list is even looked at.
  if (input.guest) return { basis: "top5", reason: "guest", codes: top5 };

  const radar = input.radar;
  if (!radar || radar.date >= input.lessonDate) return { basis: "top5", reason: "no-list", codes: top5 };
  // Another full-market day between the list and the lesson means the radar skipped a day: the list is stale.
  if (input.fullMarketDays.some((day) => day > radar.date && day < input.lessonDate)) {
    return { basis: "top5", reason: "stale", codes: top5 };
  }

  const unique = [...new Set(radar.symbols.map((symbol) => symbol.code))];
  let otc = 0;
  let missing = 0;
  const codes: string[] = [];
  for (const code of unique) {
    if (input.otc.has(code)) otc += 1;
    else if (!input.practisable.has(code)) missing += 1;
    if (input.practisable.has(code)) codes.push(code);
  }
  const counts: ListCounts = { listed: unique.length, otc, missing };
  if (codes.length === 0) return { basis: "top5", reason: "empty", codes: top5, counts };
  return { basis: "radar", radarDate: radar.date, codes: codes.sort(compareCodes).slice(0, MAX_RUN_CODES), counts };
}

/** "2026-10-27" -> "10/27". */
function monthDay(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}/${match[2]}` : date;
}

/** 「名單 N 檔：上櫃 k 檔不在教材範圍，另 j 檔這天沒有可練習的資料」; a half whose number is 0 is left out. */
function listDetail(counts: ListCounts): string | null {
  const halves: string[] = [];
  if (counts.otc > 0) halves.push(`上櫃 ${counts.otc} 檔不在教材範圍`);
  if (counts.missing > 0) halves.push(`另 ${counts.missing} 檔這天沒有可練習的資料`);
  if (halves.length === 0) return counts.listed === 0 ? "名單 0 檔" : null;
  return `名單 ${counts.listed} 檔：${halves.join("，")}`;
}

export function defaultNote(choice: DefaultChoice): { title: string; detail: string | null } {
  if (choice.basis === "radar") {
    return { title: `預設：前一交易日熱門當沖股（${monthDay(choice.radarDate)} 盤後）`, detail: listDetail(choice.counts) };
  }
  if (choice.reason === "guest") return { title: "預設：成交值前 5 名", detail: null };
  return {
    title: "前一交易日沒有熱門當沖名單，改用成交值前 5 名",
    detail: choice.reason === "empty" && choice.counts ? listDetail(choice.counts) : null,
  };
}
