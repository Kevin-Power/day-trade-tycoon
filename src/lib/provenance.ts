import { TEACHING_DATES } from "@/lib/market/tape-types";

/** Only two primary badges are allowed site-wide. */
export const BADGE_OFFICIAL = "官方" as const;
export const BADGE_CLASSROOM = "教室生成" as const;

export const AUX_FROZEN = "教材凍結";
export const AUX_CLASSROOM_SIM = "CLASSROOM-SIM";
export const AUX_NOT_LIVE = "非即時快照";
export const AUX_SAMPLE = "教室樣本";

export const TEACHING_WEEK_RANGE = "2026-08-24～08-26";
export const TEACHING_WEEK_DAYS = 3;

export const DISCLAIMER =
  "本站為模擬教學環境。加權指數等標「官方」的欄位來自證交所／櫃買公開資料（可能延遲或教材凍結）。標「教室生成」的個股分時、五檔、明細是教學投影，不是逐筆行情。模擬績效不代表實盤，不構成投資建議或勸誘。";

export const CONSENT =
  "我已閱讀並同意上述免責。我理解官方與教室生成的差異。這是教學模擬，不是投顧、不是勸誘下單。";

export const COACH_CORNER =
  "這是證交所 5 秒指數。個股盤中用大盤節奏投影，沒有官方 1 分 K。";

export const SIM_CHIP_NOTE = "指數可為官方；個股盤中多為教室生成";

export const BLOTTER_NOTE = "模擬通路 · 券商 API 未接線";

export const CLASSROOM_SHORT = "教室生成 · 非逐筆 · 僅教學";

export type ProvenanceKind = "official" | "classroom";

export function freezeWeekLabel(date?: string): string {
  if (!date || TEACHING_DATES.has(date)) return TEACHING_WEEK_RANGE;
  return date;
}

export function officialIndexMicro(asOf: string): string {
  return `官方 · TWSE MI_5MINS · as-of ${asOf}`;
}

export function officialTurnoverMicro(asOf: string): string {
  return `官方 · TWSE FMTQIK · as-of ${asOf}`;
}

export function officialIndexPaneMicro(clock: string, date: string): string {
  return `${officialIndexMicro(clock)} · ${officialTurnoverMicro(date)}`;
}

export function officialDailyOhlcMicro(week: string): string {
  return `官方日K · TWSE MI_INDEX / TPEx dailyQuotes · 教材週 ${week}`;
}

export function officialWatchlistMicro(week: string): string {
  return `官方 · TWSE/TPEx ISIN 核對 · 教材週 ${week}`;
}

export function classroomPathMicro(): string {
  return "教室生成 · 大盤節奏投影 · 無官方 1 分 K";
}

export function classroomBookMicro(): string {
  return "教室生成 · 教學五檔 · 非撮合現場逐筆";
}

export function classroomTapeMicro(): string {
  return "教室生成 · 非官方 tick";
}

export function classroomInnerOuterMicro(): string {
  return "教室生成 · 由模擬路徑推估";
}

export function officialMisMicro(asOf: string): string {
  return `官方快照 · TWSE MIS · 非即時 · as-of ${asOf}`;
}

export function classroomSampleMicro(n: number): string {
  return `教室樣本 · n=${n} · 不可外推實盤`;
}

export function blotterMicro(): string {
  return `${AUX_CLASSROOM_SIM} · ${BLOTTER_NOTE}`;
}

export type DisclosureKind = typeof BADGE_OFFICIAL | typeof BADGE_CLASSROOM | "全域";

export type DisclosureRow = {
  area: string;
  kind: DisclosureKind;
  aux?: string;
  note: string;
};

/** Manual / disclosure table — wording must match on-screen badges. */
export const DISCLOSURE_ROWS: readonly DisclosureRow[] = [
  {
    area: "加權指數（5 秒）",
    kind: BADGE_OFFICIAL,
    note: "官方 · TWSE MI_5MINS · as-of {hh:mm:ss}；可併 + FinMind TaiwanStockPrice 若該層有接",
  },
  {
    area: "大盤成交額",
    kind: BADGE_OFFICIAL,
    note: "官方 · TWSE FMTQIK · as-of {日期或時間}",
  },
  {
    area: "個股日 O/H/L/C、昨收、漲跌停參考",
    kind: BADGE_OFFICIAL,
    aux: AUX_FROZEN,
    note: "官方日K · TWSE MI_INDEX / TPEx dailyQuotes · 教材週 2026-08-24～08-26（自由練習週改對應凍結區間）",
  },
  {
    area: "自選／上市／上櫃清單（代碼名稱）",
    kind: BADGE_OFFICIAL,
    note: "官方 · TWSE/TPEx ISIN 核對 · 教材週 …",
  },
  {
    area: "個股分時／江波路徑",
    kind: BADGE_CLASSROOM,
    note: "教室生成 · 大盤節奏投影 · 無官方 1 分 K",
  },
  {
    area: "五檔",
    kind: BADGE_CLASSROOM,
    note: "教室生成 · 教學五檔 · 非撮合現場逐筆",
  },
  {
    area: "成交明細／分價／路徑表",
    kind: BADGE_CLASSROOM,
    note: "教室生成 · 非官方 tick",
  },
  {
    area: "內外盤統計（若由生成路徑推）",
    kind: BADGE_CLASSROOM,
    note: "教室生成 · 由模擬路徑推估",
  },
  {
    area: "盤前缺口／MIS 快照",
    kind: BADGE_OFFICIAL,
    aux: AUX_NOT_LIVE,
    note: "官方快照 · TWSE MIS · 非即時 · as-of {戳記}",
  },
  {
    area: "委託／成交 blotter",
    kind: BADGE_CLASSROOM,
    aux: AUX_CLASSROOM_SIM,
    note: "CLASSROOM-SIM · 模擬通路 · 券商 API 未接線",
  },
  {
    area: "策略勝率卡",
    kind: BADGE_CLASSROOM,
    aux: AUX_SAMPLE,
    note: "教室樣本 · n=教材週天數 · 不可外推實盤",
  },
  {
    area: "頂欄「模擬盤」chip",
    kind: "全域",
    note: "指數可為官方；個股盤中多為教室生成",
  },
];
