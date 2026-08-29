export type Sector =
  | "semiconductor"
  | "shipping"
  | "finance"
  | "pcb"
  | "panel"
  | "petro"
  | "other";

export type Market = "tse" | "otc";

export const SECTOR_LABEL: Record<Sector, string> = {
  semiconductor: "半導體",
  shipping: "航運",
  finance: "金融",
  pcb: "電子",
  panel: "面板",
  petro: "塑化",
  other: "其他",
};

export type StockDef = {
  code: string;
  name: string;
  sector: Sector;
  market: Market;
  prevClose: number;
  vol: number;
  beta: number;
  liquidity: number;
};

/** 昨收以 8/25 收盤為準（8/26 盤用之基準）。實際盤中以該日 session.stockPrev 為準。 */
export const UNIVERSE: StockDef[] = [
  { code: "2330", name: "台積電", sector: "semiconductor", market: "tse", prevClose: 2400, vol: 0.016, beta: 1.18, liquidity: 10 },
  { code: "2308", name: "台達電", sector: "pcb", market: "tse", prevClose: 1710, vol: 0.024, beta: 1.08, liquidity: 9 },
  { code: "2317", name: "鴻海", sector: "pcb", market: "tse", prevClose: 243, vol: 0.02, beta: 1.02, liquidity: 9 },
  { code: "2454", name: "聯發科", sector: "semiconductor", market: "tse", prevClose: 3735, vol: 0.022, beta: 1.12, liquidity: 8 },
  { code: "2303", name: "聯電", sector: "semiconductor", market: "tse", prevClose: 125, vol: 0.026, beta: 1.05, liquidity: 8 },
  { code: "2344", name: "華邦電", sector: "semiconductor", market: "tse", prevClose: 179, vol: 0.038, beta: 1.22, liquidity: 7 },
  { code: "6770", name: "力積電", sector: "semiconductor", market: "tse", prevClose: 69, vol: 0.042, beta: 1.25, liquidity: 6 },
  { code: "3036", name: "文曄", sector: "pcb", market: "tse", prevClose: 198.5, vol: 0.028, beta: 1.0, liquidity: 6 },
  { code: "3037", name: "欣興", sector: "pcb", market: "tse", prevClose: 1095, vol: 0.03, beta: 1.12, liquidity: 7 },
  { code: "6488", name: "環球晶", sector: "semiconductor", market: "otc", prevClose: 980, vol: 0.03, beta: 1.05, liquidity: 6 },
  { code: "2603", name: "長榮", sector: "shipping", market: "tse", prevClose: 246, vol: 0.034, beta: 0.82, liquidity: 8 },
  { code: "2609", name: "陽明", sector: "shipping", market: "tse", prevClose: 63.6, vol: 0.038, beta: 0.88, liquidity: 8 },
  { code: "2637", name: "慧洋-KY", sector: "shipping", market: "tse", prevClose: 95.5, vol: 0.036, beta: 0.8, liquidity: 5 },
  { code: "2881", name: "富邦金", sector: "finance", market: "tse", prevClose: 141.5, vol: 0.015, beta: 0.72, liquidity: 9 },
  { code: "6505", name: "台塑化", sector: "petro", market: "tse", prevClose: 71.0, vol: 0.018, beta: 0.75, liquidity: 7 },
  { code: "3481", name: "群創", sector: "panel", market: "tse", prevClose: 46.8, vol: 0.032, beta: 0.95, liquidity: 7 },
  { code: "2409", name: "友達", sector: "panel", market: "tse", prevClose: 25.65, vol: 0.033, beta: 0.95, liquidity: 7 },
];

export const INDEX_PREV = 45169.46;

export const STOCK_BY_CODE = Object.fromEntries(UNIVERSE.map((s) => [s.code, s])) as Record<
  string,
  StockDef
>;
