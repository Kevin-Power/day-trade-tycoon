/** MarketDataAdapter：日後換券商 API 只改實作，不改盤面。 */
export type PremarketRow = {
  code: string;
  name: string;
  sectorLabel: string;
  prevClose: number;
  impliedOpen: number | null;
  changePct: number | null;
  hasData: boolean;
};

export type QuoteSnapshot = {
  asOf: string;
  label: string;
  source: string;
  disclaimer: string;
};

export interface MarketDataAdapter {
  id: string;
  snapshotMeta(): QuoteSnapshot;
  premarket(date: string): Promise<PremarketRow[]>;
}

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

function taipeiNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatStamp(d: Date): string {
  const wd = WEEKDAY[d.getDay()] ?? "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}（${wd}）${hh}:${mm}`;
}

function sessionClosed(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes < 9 * 60 || minutes >= 13 * 60 + 30;
}

/** TWSE MIS 僅供教學展示，非即時報價、不可轉發做商業用途。 */
export const twseMisAdapter: MarketDataAdapter = {
  id: "twse-mis",
  snapshotMeta() {
    const now = taipeiNow();
    const closed = sessionClosed(now);
    return {
      asOf: formatStamp(now),
      label: closed ? "顯示上一交易日收盤快照" : "教學展示 · 延遲資料",
      source: "TWSE MIS",
      disclaimer: "資料來源：TWSE MIS，僅供教學展示，非即時報價",
    };
  },
  async premarket() {
    return [];
  },
};

export function getMarketAdapter(): MarketDataAdapter {
  return twseMisAdapter;
}
