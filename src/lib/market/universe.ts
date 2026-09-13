import pack from "@/lib/market/symbols.json";

export type Sector =
  | "semiconductor"
  | "shipping"
  | "finance"
  | "pcb"
  | "panel"
  | "petro"
  | "thermal"
  | "other";

export type Market = "tse" | "otc";

export const SECTOR_LABEL: Record<Sector, string> = {
  semiconductor: "半導體",
  shipping: "航運",
  finance: "金融",
  pcb: "電子",
  panel: "面板",
  petro: "塑化",
  thermal: "散熱",
  other: "其他",
};

export type StockDef = {
  code: string;
  name: string;
  sector: Sector;
  sectorLabel: string;
  market: Market;
  prevClose: number;
  refPrice: number;
  vol: number;
  beta: number;
  liquidity: number;
};

type RawSymbol = {
  code: string;
  name: string;
  sector: Sector;
  sectorLabel: string;
  market: "TWSE" | "TPEx";
  refPrice: number;
};

function toDef(s: RawSymbol): StockDef {
  return {
    code: s.code,
    name: s.name,
    sector: s.sector,
    sectorLabel: s.sectorLabel,
    market: s.market === "TPEx" ? "otc" : "tse",
    prevClose: s.refPrice,
    refPrice: s.refPrice,
    vol: 0.024,
    beta: 1,
    liquidity: 6,
  };
}

/** 全站名稱／族群唯一來源：data/symbols.json（建置時同步到此檔）。 */
export const UNIVERSE: StockDef[] = (pack.symbols as RawSymbol[]).map(toDef);

export const INDEX_PREV = 45169.46;

export const STOCK_BY_CODE = Object.fromEntries(UNIVERSE.map((s) => [s.code, s])) as Record<
  string,
  StockDef
>;

export function symbolName(code: string): string {
  return STOCK_BY_CODE[code]?.name ?? code;
}

export function symbolSectorLabel(code: string): string {
  const s = STOCK_BY_CODE[code];
  return s?.sectorLabel ?? (s ? SECTOR_LABEL[s.sector] : "");
}
