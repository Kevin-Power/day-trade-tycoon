export type TapeStock = {
  prev: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TapeDay = {
  id: string;
  date: string;
  label: string;
  weekday: string;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  highIndex: number;
  lowIndex: number;
  highMinute: number;
  lowMinute: number;
  turnoverYi: number;
  index5s: number[];
  stocks: Record<string, TapeStock>;
  complete: boolean;
};

export type TapePayload = {
  ok: boolean;
  source: string;
  fetchedAt: string;
  days: TapeDay[];
  error?: string;
};

export const TAPE_CACHE_KEY = "day-tycoon-tape-v1";
export const TEACHING_DATES = new Set(["2026-08-24", "2026-08-25", "2026-08-26"]);
