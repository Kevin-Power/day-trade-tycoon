import pack from "./symbols.json" with { type: "json" };

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

type RawSymbol = StockDef;

/** 昨收以 8/25 收盤為準（8/26 盤用之基準）。實際盤中以該日 session.stockPrev 為準。 */
export const UNIVERSE: StockDef[] = (pack.symbols as RawSymbol[]).map((s) => ({ ...s }));

export const TEACHING_SYMBOL_COUNT = UNIVERSE.length;

export const TEACHING_SYMBOL_CODES = UNIVERSE.map((s) => s.code);

export function teachingSymbolsByMarket(market: Market): StockDef[] {
  return UNIVERSE.filter((s) => s.market === market);
}

/** Manual data table — count comes from symbols.json, not a hardcoded 17. */
export function teachingOhlcNote(): string {
  return `釘在當日 O/H/L/C。${TEACHING_SYMBOL_COUNT} 檔權值與觀察股`;
}

/** Lobby / watchlist split. OTC is currently 1 name (環球晶), not a missing table. */
export function teachingUniverseLine(): string {
  const tse = teachingSymbolsByMarket("tse").length;
  const otc = teachingSymbolsByMarket("otc").length;
  return `自選 ${TEACHING_SYMBOL_COUNT} 檔（上市 ${tse}、上櫃 ${otc}）`;
}

export const INDEX_PREV = 45169.46;

export const STOCK_BY_CODE = Object.fromEntries(UNIVERSE.map((s) => [s.code, s])) as Record<
  string,
  StockDef
>;
