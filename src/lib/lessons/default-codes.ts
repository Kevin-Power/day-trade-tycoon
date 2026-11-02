// Which stocks a lesson's 自選 starts with, and the exact desk wording for it. Pure: no I/O, no clock.
// Rules are decisions A–E and L of the radar-watchlist design: the previous trading day's 當沖 list when it is
// fresh and has practisable stocks, otherwise the day's top 20 by turnover (always for guests), taking first the
// stocks a beginner can practise on (the owner, 2026-11-02).

import type { RadarList } from "./types.ts";

/** A run holds 1 to 80 stocks. */
export const MAX_RUN_CODES = 80;

/**
 * Without a list, the default holds this many stocks (「不只五檔請20檔」). Those trading DEFAULT_MIN_LOTS lots or more
 * that day at DEFAULT_MAX_PRICE 元 or less come first: a thin 9,000-元 stock such as 川湖 can top the turnover, yet
 * its 江波圖 hardly moves and one lot nearly empties the 10 M practice cash (「欣興、臻鼎這些一千元左右，成交量在幾萬張的」).
 */
export const DEFAULT_COUNT = 20;
export const DEFAULT_MIN_LOTS = 10_000;
export const DEFAULT_MAX_PRICE = 2_000;
const TOP_TEXT = "成交值前 20 名，先挑成交量 1 萬張以上、股價 2,000 元以下";

/** The same stocks, in any order (a run's stocks against the day's default list). */
export function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === b.length && b.every((code) => set.has(code));
}

/** What the list held, after removing repeats: all, 上櫃 (not in the course), and neither 上櫃 nor practisable. */
export type ListCounts = { listed: number; otc: number; missing: number };

export type DefaultChoice =
  | { basis: "radar"; radarDate: string; codes: string[]; counts: ListCounts }
  | { basis: "top"; reason: "guest" | "no-list" | "stale" | "empty"; codes: string[]; counts?: ListCounts };

const compareCodes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function chooseDefaultCodes(input: {
  lessonDate: string;
  fullMarketDays: readonly string[];
  radar: RadarList | null;
  practisable: ReadonlySet<string>;
  otc: ReadonlySet<string>;
  /** The day's default without a list (DEFAULT_COUNT stocks at most), in any order. */
  top: readonly string[];
  guest: boolean;
}): DefaultChoice {
  const top = [...input.top].sort(compareCodes);
  // Guests never see the list (decision L): answer before the list is even looked at.
  if (input.guest) return { basis: "top", reason: "guest", codes: top };

  const radar = input.radar;
  if (!radar || radar.date >= input.lessonDate) return { basis: "top", reason: "no-list", codes: top };
  // Another full-market day between the list and the lesson means the radar skipped a day: the list is stale.
  if (input.fullMarketDays.some((day) => day > radar.date && day < input.lessonDate)) {
    return { basis: "top", reason: "stale", codes: top };
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
  if (codes.length === 0) return { basis: "top", reason: "empty", codes: top, counts };
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
  if (choice.reason === "guest") return { title: `預設：${TOP_TEXT}`, detail: null };
  return {
    title: `前一交易日沒有熱門當沖名單，改用${TOP_TEXT}`,
    detail: choice.reason === "empty" && choice.counts ? listDetail(choice.counts) : null,
  };
}
