import type { Market, Sector } from "@/lib/market/universe";

export type Side = "buy" | "sell";
export type OrderType = "limit" | "market";
export type OrderStatus = "pending" | "partial" | "filled" | "cancelled";

export type BookLevel = { price: number; lots: number };

export type TickPt = {
  t: number;
  p: number;
};

export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};


export type Quote = {
  code: string;
  name: string;
  sector: Sector;
  market: Market;
  last: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  bidLots: number;
  askLots: number;
  tickLots: number;
  volume: number;
  vwap: number;
  inner: number;
  outer: number;
  bids: BookLevel[];
  asks: BookLevel[];
  atLimitUp: boolean;
  atLimitDown: boolean;
  flash: -1 | 0 | 1;
};

export type IndexQuote = {
  last: number;
  prev: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  turnoverYi: number;
};

export type Order = {
  id: string;
  code: string;
  side: Side;
  type: OrderType;
  price: number;
  lots: number;
  filled: number;
  status: OrderStatus;
  time: number;
};

export type Position = {
  code: string;
  lots: number;
  avg: number;
  realized: number;
};

export type Fill = {
  id: string;
  orderId: string;
  code: string;
  side: Side;
  lots: number;
  price: number;
  fee: number;
  tax: number;
  time: number;
  vwapAt: number;
};

export type SessionRecord = {
  id: string;
  scenarioId: string;
  scenarioName: string;
  endedAt: number;
  pnl: number;
  pnlPct: number;
  trades: number;
  wins: number;
  fees: number;
  maxDrawdown: number;
  grade: string;
  title: string;
};

export type Profile = {
  version: number;
  careerPnl: number;
  sessions: number;
  wins: number;
  bestPnl: number;
  bestPct: number;
  history: SessionRecord[];
};

export const PROFILE_VERSION = 1;

export const EMPTY_PROFILE: Profile = {
  version: PROFILE_VERSION,
  careerPnl: 0,
  sessions: 0,
  wins: 0,
  bestPnl: 0,
  bestPct: 0,
  history: [],
};
