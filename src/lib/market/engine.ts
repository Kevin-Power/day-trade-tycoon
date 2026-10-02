import type { Scenario } from "@/lib/game/scenarios";
import type {
  Bar,
  Fill,
  IndexQuote,
  Order,
  Position,
  Quote,
  Side,
  TickPt,
} from "@/lib/game/types";
import { gauss, irand, mulberry32, type Rng } from "@/lib/market/rng";
import {
  clampLimit,
  CLOSE_SECONDS,
  commission,
  DAYTRADE_TAX,
  FEE_RATE,
  formatPrice,
  limitDown,
  limitUp,
  LOT_SHARES,
  MIN_FEE,
  roundToTick,
  stepTick,
} from "@/lib/market/ticks";
import { INDEX_PREV, UNIVERSE, lookupStock, type Sector, type StockDef } from "@/lib/market/universe";
import { sessionById, type IndexSession } from "@/lib/market/week";
import { estimateExecution, executionInputReason, type ExecutionInput } from "./execution.ts";
import {
  indexSeriesFor,
  projectStock,
  sample5,
  stockDayFor,
} from "@/lib/market/real-paths";

export type PlaceResult =
  | { ok: true; order: Order; fills: Fill[] }
  | { ok: false; reason: string };

type BookLevel = { price: number; lots: number };

type StockState = {
  def: StockDef;
  prev: number;
  open: number;
  last: number;
  high: number;
  low: number;
  volume: number;
  inner: number;
  outer: number;
  tickLots: number;
  bids: BookLevel[];
  asks: BookLevel[];
  idio: number;
  path: Float64Array;
  bars: Bar[];
  ticks: TickPt[];
  priceVol: Map<number, number>;
  forming: Bar;
  flash: -1 | 0 | 1;
  flashUntil: number;
};

export class DayMarket {
  readonly scenario: Scenario;
  readonly startT: number;
  readonly endT: number;
  readonly capital: number;

  t = 0;
  ended = false;
  cash: number;
  realized = 0;
  feesPaid = 0;
  taxesPaid = 0;
  peakEquity: number;
  maxDrawdown = 0;
  peakGross = 0;
  news: string | null = null;
  warning: string | null = null;
  shockFired = false;

  indexPrev = INDEX_PREV;
  indexOpen = INDEX_PREV;
  indexLast = INDEX_PREV;
  indexHigh = INDEX_PREV;
  indexLow = INDEX_PREV;
  indexVolume = 0;
  indexTurnoverYi = 0;
  indexPath: Float64Array;
  indexBars: Bar[] = [];
  indexTicks: TickPt[] = [];
  indexForming: Bar;
  readonly session: IndexSession;
  private newsFired = new Set<number>();

  private stocks = new Map<string, StockState>();
  private sectorShock: Record<Sector, number> = {
    semiconductor: 0,
    shipping: 0,
    finance: 0,
    pcb: 0,
    panel: 0,
    petro: 0,
    other: 0,
  };
  private rng: Rng;
  private seq = 1;
  orders: Order[] = [];
  positions = new Map<string, Position>();
  fills: Fill[] = [];
  forcedClose = false;
  private tradeWins = 0;
  private tradeCount = 0;
  private roundTrips: { pnl: number }[] = [];
  private lastCoachAt = -999;
  coachLine: string;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.rng = mulberry32(scenario.seed >>> 0);
    this.session = sessionById(scenario.sessionId);
    this.capital = scenario.capital;
    this.cash = scenario.capital;
    this.peakEquity = scenario.capital;
    this.peakGross = 0;
    this.startT = scenario.startMinute * 60;
    this.endT = (scenario.startMinute + scenario.minutes) * 60;
    this.coachLine = scenario.coach[0] ?? "";
    this.indexPrev = this.session.prevClose;

    this.indexPath = indexSeriesFor(this.session.id);

    for (const def of UNIVERSE) {
      const prev = this.prevFor(def);
      const path = this.buildStockPath(def, prev);
      const day = stockDayFor(def.code, this.session.id);
      const open = day?.open ?? path[0] ?? prev;
      const st: StockState = {
        def,
        prev,
        open,
        last: open,
        high: open,
        low: open,
        volume: 0,
        inner: 0,
        outer: 0,
        tickLots: 0,
        bids: [],
        asks: [],
        idio: 0,
        path,
        bars: [],
        ticks: [{ t: 0, p: open }],
        priceVol: new Map(),
        forming: { t: 0, o: open, h: open, l: open, c: open, v: 0 },
        flash: 0,
        flashUntil: 0,
      };
      this.rebuildBook(st);
      this.stocks.set(def.code, st);
    }

    const i0 = this.session.open;
    this.indexOpen = this.session.open;
    this.indexLast = i0;
    this.indexHigh = i0;
    this.indexLow = i0;
    this.indexForming = { t: 0, o: i0, h: i0, l: i0, c: i0, v: 0 };
    this.indexTicks = [{ t: 0, p: i0 }];

    // Warm up history from 09:00 to session start so charts have context.
    if (this.startT > 0) {
      this.simulateTo(this.startT);
    }
    this.t = this.startT;
    this.refreshCoach();
  }

  private prevFor(def: StockDef): number {
    const hit = this.session.stockPrev[def.code];
    if (hit) return hit;
    const scale = this.session.prevClose / INDEX_PREV;
    return roundToTick(def.prevClose * scale);
  }

  private buildStockPath(def: StockDef, prev: number): Float64Array {
    const day = stockDayFor(def.code, this.session.id);
    if (day) return projectStock(this.indexPath, day);
    return projectStock(this.indexPath, {
      prev,
      open: prev,
      high: prev,
      low: prev,
      close: prev,
    });
  }

  private simulateTo(target: number) {
    const step = 2;
    while (this.t < target) {
      const dt = Math.min(step, target - this.t);
      this.tickOnce(dt);
    }
  }

  step(gameSeconds: number) {
    if (this.ended) return;
    const cap = Math.min(gameSeconds, 8);
    let remain = cap;
    while (remain > 0 && !this.ended) {
      const dt = remain > 4 ? 2 : 1;
      const slice = Math.min(dt, remain, this.endT - this.t);
      if (slice <= 0) break;
      this.tickOnce(slice);
      remain -= slice;
      if (this.t >= this.endT) {
        this.forceFlatten();
        this.ended = true;
      }
    }
  }

  private tickOnce(dt: number) {
    this.t += dt;
    const minute = this.t / 60;
    const shock = this.scenario.shock;

    for (const h of this.session.headlines) {
      if (minute >= h.atMinute && !this.newsFired.has(h.atMinute)) {
        this.newsFired.add(h.atMinute);
        this.news = h.text;
      }
    }
    if (shock && !this.shockFired && minute >= shock.atMinute) {
      this.shockFired = true;
      this.news = shock.headline;
    }
    const lastNewsAt = Math.max(
      ...[...this.newsFired],
      shock && this.shockFired ? shock.atMinute : 0,
      0,
    );
    if (this.news && minute > lastNewsAt + 12) this.news = null;

    for (const k of Object.keys(this.sectorShock) as Sector[]) {
      this.sectorShock[k] = this.sectorShock[k] * 0.9 + gauss(this.rng) * 0.0009;
    }

    const index = sample5(this.indexPath, this.t);
    this.indexLast = index;
    this.indexHigh = Math.max(this.indexHigh, index);
    this.indexLow = Math.min(this.indexLow, index);
    const iVol = irand(this.rng, 80, 420);
    this.indexVolume += iVol;
    const dayFrac = Math.min(1, this.t / Math.max(1, CLOSE_SECONDS));
    this.indexTurnoverYi = this.session.turnoverYi * (0.12 + 0.88 * dayFrac);
    this.pushBar(
      this.indexBars,
      index,
      iVol,
      Math.floor(this.t / 60) * 60,
    );
    this.pushTick(this.indexTicks, this.t, index);
    this.indexForming = this.indexBars[this.indexBars.length - 1] ?? this.indexForming;
    if (this.indexBars.length) this.indexForming = this.indexBars[this.indexBars.length - 1]!;

    for (const st of this.stocks.values()) {
      this.tickStock(st, dt);
    }

    this.matchResting();
    this.updateEquityStats();
    this.refreshCoach();
    this.updateWarning();
  }

  private tickStock(st: StockState, dt: number) {
    const pxPath = sample5(st.path, this.t);
    const px = clampLimit(pxPath, st.prev);
    const prevLast = st.last;
    st.last = px;
    st.high = Math.max(st.high, px);
    st.low = Math.min(st.low, px);
    const lots = Math.max(1, Math.round((0.4 + this.rng()) * st.def.liquidity * dt));
    st.volume += lots;
    st.tickLots = lots;
    if (px > prevLast) st.outer += lots;
    else if (px < prevLast) st.inner += lots;
    else if (this.rng() < 0.5) st.outer += lots;
    else st.inner += lots;
    if (px > prevLast) {
      st.flash = 1;
      st.flashUntil = this.t + 1.8;
    } else if (px < prevLast) {
      st.flash = -1;
      st.flashUntil = this.t + 1.8;
    } else if (this.t > st.flashUntil) {
      st.flash = 0;
    }
    this.pushBar(st.bars, px, lots, Math.floor(this.t / 60) * 60);
    this.pushTick(st.ticks, this.t, px);
    this.addPxVol(st, px, lots);
    st.forming = st.bars[st.bars.length - 1] ?? st.forming;
    this.rebuildBook(st);
  }

  private pushBar(bars: Bar[], px: number, vol: number, minuteT: number) {
    if (bars.length === 0) {
      bars.push({ t: minuteT, o: px, h: px, l: px, c: px, v: vol });
      return;
    }
    const last = bars[bars.length - 1]!;
    if (last.t === minuteT) {
      last.h = Math.max(last.h, px);
      last.l = Math.min(last.l, px);
      last.c = px;
      last.v += vol;
    } else {
      bars.push({ t: minuteT, o: px, h: px, l: px, c: px, v: vol });
      if (bars.length > 280) bars.splice(0, bars.length - 280);
    }
  }

  private pushTick(ticks: TickPt[], t: number, px: number) {
    const last = ticks[ticks.length - 1];
    if (last && last.p === px && t - last.t < 1.2) return;
    ticks.push({ t, p: px });
    if (ticks.length <= 5200) return;
    const keep: TickPt[] = [ticks[0]!];
    const cutoff = ticks.length - 900;
    for (let i = 1; i < cutoff; i += 2) keep.push(ticks[i]!);
    for (let i = Math.max(1, cutoff); i < ticks.length; i++) keep.push(ticks[i]!);
    ticks.length = 0;
    ticks.push(...keep);
  }

  private rebuildBook(st: StockState) {
    const last = st.last;
    const spreadTicks = this.rng() < 0.7 ? 1 : 2;
    const bid0 = stepTick(last, -spreadTicks);
    const ask0 = stepTick(last, this.rng() < 0.35 ? 0 : spreadTicks);
    const lo = limitDown(st.prev);
    const hi = limitUp(st.prev);
    const bids: BookLevel[] = [];
    const asks: BookLevel[] = [];
    for (let i = 0; i < 5; i++) {
      const p = stepTick(bid0, -i);
      if (p <= 0 || p < lo) break;
      if (p > hi) continue;
      bids.push({
        price: p,
        lots: irand(this.rng, 2, 6) * st.def.liquidity + irand(this.rng, 0, 18),
      });
    }
    for (let i = 0; i < 5; i++) {
      const p = stepTick(ask0, i);
      if (p > hi) break;
      if (p <= 0 || p < lo) continue;
      asks.push({
        price: p,
        lots: irand(this.rng, 2, 6) * st.def.liquidity + irand(this.rng, 0, 18),
      });
    }
    st.bids = bids;
    st.asks = asks;
  }

  quote(code: string): Quote | null {
    const st = this.stocks.get(code);
    if (!st) return null;
    return this.toQuote(st);
  }

  allQuotes(): Quote[] {
    return [...this.stocks.values()].map((stock) => this.toQuote(stock));
  }

  /** Add catalogue symbols only when this session contains frozen OHLC data. */
  ensureSymbol(code: string): boolean {
    if (this.stocks.has(code)) return true;
    const def = lookupStock(code);
    const day = stockDayFor(code, this.session.id);
    if (!def || !day) return false;
    const path = projectStock(this.indexPath, day);
    const st: StockState = {
      def, prev: day.prev, open: day.open, last: sample5(path, this.t),
      high: day.open, low: day.open, volume: 0, inner: 0, outer: 0, tickLots: 0,
      bids: [], asks: [], idio: 0, path, bars: [], ticks: [], priceVol: new Map(),
      forming: { t: 0, o: day.open, h: day.open, l: day.open, c: day.open, v: 0 },
      flash: 0, flashUntil: 0,
    };
    // Reconstruct only projected price history. No transactions or account state
    // are replayed, and historical volume is not invented for a newly added name.
    for (let at = 0; at <= this.t; at += 5) {
      const price = sample5(path, at);
      st.high = Math.max(st.high, price);
      st.low = Math.min(st.low, price);
      this.pushBar(st.bars, price, 0, Math.floor(at / 60) * 60);
      this.pushTick(st.ticks, at, price);
    }
    this.pushBar(st.bars, st.last, 0, Math.floor(this.t / 60) * 60);
    st.forming = st.bars[st.bars.length - 1] ?? st.forming;
    this.rebuildBook(st);
    this.stocks.set(code, st);
    return true;
  }

  private toQuote(st: StockState): Quote {
    const change = st.last - st.prev;
    const changePct = (change / st.prev) * 100;
    const hi = limitUp(st.prev);
    const lo = limitDown(st.prev);
    const bids = st.bids.filter((level) => level.lots > 0);
    const asks = st.asks.filter((level) => level.lots > 0);
    return {
      code: st.def.code,
      name: st.def.name,
      sector: st.def.sector,
      market: st.def.market,
      last: st.last,
      prevClose: st.prev,
      open: st.open,
      high: st.high,
      low: st.low,
      change,
      changePct,
      bid: bids[0]?.price ?? st.last,
      ask: asks[0]?.price ?? st.last,
      bidLots: bids[0]?.lots ?? 0,
      askLots: asks[0]?.lots ?? 0,
      tickLots: st.tickLots,
      volume: st.volume,
      vwap: this.vwapOf(st),
      inner: st.inner,
      outer: st.outer,
      bids: bids.map((l) => ({ ...l })),
      asks: asks.map((l) => ({ ...l })),
      atLimitUp: st.last >= hi - 1e-9,
      atLimitDown: st.last <= lo + 1e-9,
      flash: this.t <= st.flashUntil ? st.flash : 0,
    };
  }

  indexQuote(): IndexQuote {
    const change = this.indexLast - this.indexPrev;
    return {
      last: this.indexLast,
      prev: this.indexPrev,
      open: this.indexOpen,
      high: this.indexHigh,
      low: this.indexLow,
      change,
      changePct: (change / this.indexPrev) * 100,
      volume: this.indexVolume,
      turnoverYi: this.indexTurnoverYi,
    };
  }

  bars(code: string): Bar[] {
    return this.stocks.get(code)?.bars ?? [];
  }

  ticks(code: string): TickPt[] {
    return this.stocks.get(code)?.ticks ?? [];
  }

  vwapOf(st: StockState): number {
    let p = 0;
    let v = 0;
    for (const b of st.bars) {
      p += b.c * b.v;
      v += b.v;
    }
    return v > 0 ? p / v : st.last;
  }

  private addPxVol(st: StockState, px: number, lots: number) {
    const p = roundToTick(px);
    st.priceVol.set(p, (st.priceVol.get(p) ?? 0) + lots);
  }

  priceLevels(code: string): { price: number; lots: number }[] {
    const st = this.stocks.get(code);
    if (!st) return [];
    return [...st.priceVol.entries()]
      .map(([price, lots]) => ({ price, lots }))
      .sort((a, b) => b.price - a.price);
  }

  poc(code: string): number | null {
    const st = this.stocks.get(code);
    if (!st || st.priceVol.size === 0) return null;
    let bestP = st.last;
    let bestV = 0;
    for (const [p, v] of st.priceVol) {
      if (v > bestV) {
        bestV = v;
        bestP = p;
      }
    }
    return bestP;
  }

  place(input: ExecutionInput & { code: string }): PlaceResult {
    if (this.ended) return { ok: false, reason: "已收盤" };
    const invalid = executionInputReason(input);
    if (invalid) return { ok: false, reason: invalid };
    const st = this.stocks.get(input.code);
    if (!st) return { ok: false, reason: "找不到商品" };
    const lots = input.lots;
    const tif = input.tif ?? "ROD";
    const estimate = estimateExecution(st, input);
    const px =
      input.type === "market"
        ? (estimate.levels[0]?.price ?? st.last)
        : input.price!;
    const lo = limitDown(st.prev);
    const hi = limitUp(st.prev);
    if (px < lo || px > hi) return { ok: false, reason: "超出漲跌停" };
    const order: Order = {
      id: `O${this.seq++}`,
      code: input.code,
      side: input.side,
      type: input.type,
      price: px,
      lots,
      filled: 0,
      status: "pending",
      time: this.t,
      tif,
    };
    if (input.side === "sell" && !this.scenario.allowShort && lots > this.availableSellLots(input.code)) {
      return { ok: false, reason: "可賣庫存不足（本關不可先賣，未成交賣單也會占用庫存）" };
    }
    if (input.side === "buy") {
      const reserve = tif === "ROD" ? this.buyReservation(order, estimate.remainingLots) : 0;
      if (estimate.notional + estimate.fee + reserve > this.availableCash() + 1e-8) {
        return { ok: false, reason: "可用餘額不足（已扣除未成交買單占用）" };
      }
    }
    this.orders.unshift(order);
    const fills = this.tryFill(order, st);
    return { ok: true, order, fills };
  }

  private working(order: Order): boolean {
    return order.status === "pending" || order.status === "partial";
  }

  private buyReservation(order: Order, remaining = order.lots - order.filled): number {
    if (order.side !== "buy" || remaining <= 0) return 0;
    const st = this.stocks.get(order.code);
    const price = order.type === "market" && st ? limitUp(st.prev) : order.price;
    // A later fill can split arbitrarily; ceil is an upper bound for every split.
    const feePerLot = Math.max(MIN_FEE, Math.ceil(price * LOT_SHARES * FEE_RATE));
    return remaining * (price * LOT_SHARES + feePerLot);
  }

  reservedCash(excludeId?: string): number {
    return this.orders.reduce((total, order) => total + (order.id !== excludeId && this.working(order) ? this.buyReservation(order) : 0), 0);
  }

  availableCash(excludeId?: string): number {
    return Math.max(0, this.cash - this.reservedCash(excludeId));
  }

  private availableSellLots(code: string, excludeId?: string): number {
    const held = this.positions.get(code)?.lots ?? 0;
    const committed = this.orders.reduce((lots, order) => lots + (order.id !== excludeId && order.code === code && order.side === "sell" && this.working(order) ? order.lots - order.filled : 0), 0);
    return Math.max(0, held - committed);
  }

  cancel(id: string): boolean {
    const o = this.orders.find((x) => x.id === id);
    if (!o || o.status === "filled" || o.status === "cancelled") return false;
    o.status = "cancelled";
    o.cancelReason = "使用者取消未成交餘量";
    return true;
  }

  flatten(code: string): PlaceResult {
    const pos = this.positions.get(code);
    if (!pos || pos.lots === 0) return { ok: false, reason: "無庫存" };
    for (const order of this.orders) {
      if (order.code === code && this.working(order)) this.cancel(order.id);
    }
    return this.place({
      code,
      side: pos.lots > 0 ? "sell" : "buy",
      type: "market",
      lots: Math.min(200, Math.abs(pos.lots)),
      tif: "IOC",
    });
  }

  flattenAll(): PlaceResult[] {
    for (const order of this.orders) {
      if (this.working(order)) this.cancel(order.id);
    }
    // Sell long positions first so their proceeds are available for short covers.
    const codes = [...this.positions.values()].filter((p) => p.lots !== 0)
      .sort((a, b) => Number(b.lots > 0) - Number(a.lots > 0)).map((p) => p.code);
    const results: PlaceResult[] = [];
    for (const code of codes) {
      // Large accumulated positions close in valid <=200-lot submissions.
      while (Math.abs(this.positions.get(code)?.lots ?? 0) > 0) {
        const result = this.flatten(code);
        results.push(result);
        if (!result.ok || result.order.filled < result.order.lots) break;
      }
    }
    return results;
  }

  finish() {
    if (this.ended) return;
    this.forceFlatten("結束練習");
    this.ended = true;
  }

  private forceFlatten(label = "收盤") {
    this.forcedClose ||= [...this.positions.values()].some((position) => position.lots !== 0);
    this.flattenAll();
    const remaining = [...this.positions.values()].filter((position) => position.lots !== 0);
    this.warning = remaining.length
      ? `${label}，仍有 ${remaining.length} 檔未能全部平倉；結果保留未平部位，請查看庫存與取消原因。`
      : `${label}，已無未平倉部位，未成交委託已取消。`;
    this.updateEquityStats();
  }

  private matchResting() {
    const pending = this.orders.slice().reverse().filter((order) => this.working(order));
    pending.sort((a, b) => {
      const book = a.code.localeCompare(b.code) || a.side.localeCompare(b.side);
      if (book) return book;
      if (a.type !== b.type) return a.type === "market" ? -1 : 1;
      const price = a.type === "market" ? 0 : a.side === "buy" ? b.price - a.price : a.price - b.price;
      return price || a.time - b.time;
    });
    for (const o of pending) {
      const st = this.stocks.get(o.code);
      if (!st) continue;
      this.tryFill(o, st);
    }
  }

  private fillRiskReason(order: Order, st: StockState, lots: number, price: number,
    state = { cash: this.cash, lots: this.positions.get(order.code)?.lots ?? 0 }): string | null {
    const held = this.positions.get(order.code)?.lots ?? 0;
    const notional = price * lots * LOT_SHARES;
    const cost = commission(notional) + (order.side === "sell" ? Math.round(notional * DAYTRADE_TAX) : 0);
    const cash = state.cash + (order.side === "buy" ? -notional - cost : notional - cost);
    const next = state.lots + (order.side === "buy" ? lots : -lots);
    if (order.side === "buy" && cash + 1e-8 < this.reservedCash(order.id)) return "成交前可用餘額不足，未成交餘量取消";
    if (!this.scenario.allowShort && order.side === "sell") {
      const otherSells = held - this.availableSellLots(order.code, order.id);
      if (lots > Math.max(0, state.lots - otherSells)) return "成交前可賣庫存不足，未成交餘量取消";
    }
    const closes = state.lots * (order.side === "buy" ? 1 : -1) < 0 ? Math.min(Math.abs(state.lots), lots) : 0;
    if (lots > closes) {
      const otherValue = this.equity() - this.cash - held * st.last * LOT_SHARES;
      const otherGross = this.grossExposure() - Math.abs(held) * st.last * LOT_SHARES;
      const equity = cash + next * price * LOT_SHARES + otherValue;
      const gross = Math.abs(next) * price * LOT_SHARES + otherGross;
      if (gross > Math.max(0, equity) * this.scenario.leverage * 1.01 + 1e-8) return `成交前超過當沖額度（${this.scenario.leverage} 倍），未成交餘量取消`;
    }
    return null;
  }

  private consumeDepth(st: StockState, side: Side, price: number, lots: number) {
    const levels = side === "buy" ? st.asks : st.bids;
    let remain = lots;
    for (const level of levels) {
      if (level.price !== price || level.lots <= 0) continue;
      const take = Math.min(remain, level.lots);
      level.lots -= take;
      remain -= take;
      if (remain === 0) break;
    }
  }

  private tryFill(order: Order, st: StockState): Fill[] {
    const out: Fill[] = [];
    const remain = order.lots - order.filled;
    if (remain <= 0 || !this.working(order)) return out;
    const tif = order.tif ?? "ROD";
    const plan = estimateExecution(st, { ...order, lots: remain });
    const cancel = (reason: string) => { order.status = "cancelled"; order.cancelReason = reason; };
    if (tif === "FOK") {
      if (plan.filledLots !== remain) { cancel("FOK 五檔可成交量不足，全筆取消"); return out; }
      const state = { cash: this.cash, lots: this.positions.get(order.code)?.lots ?? 0 };
      for (const level of plan.levels) {
        const reason = this.fillRiskReason(order, st, level.lots, level.price, state);
        if (reason) { cancel(`FOK ${reason}，全筆未成交`); return out; }
        const notional = level.price * level.lots * LOT_SHARES;
        const cost = commission(notional) + (order.side === "sell" ? Math.round(notional * DAYTRADE_TAX) : 0);
        state.cash += order.side === "buy" ? -notional - cost : notional - cost;
        state.lots += order.side === "buy" ? level.lots : -level.lots;
      }
    }
    for (const level of plan.levels) {
      let low = 0;
      let high = level.lots;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (this.fillRiskReason(order, st, mid, level.price)) high = mid - 1;
        else low = mid;
      }
      if (low > 0) {
        out.push(this.execute(order, st, order.side, low, level.price));
        this.consumeDepth(st, order.side, level.price, low);
      }
      if (low < level.lots) {
        cancel(this.fillRiskReason(order, st, 1, level.price) ?? "成交前風險檢查未通過，未成交餘量取消");
        break;
      }
    }
    if (order.filled >= order.lots) order.status = "filled";
    else if (order.status !== "cancelled") {
      if (tif === "IOC") cancel("IOC 未成交餘量已取消");
      else order.status = order.filled > 0 ? "partial" : "pending";
    }
    return out;
  }

  private execute(order: Order, st: StockState, side: Side, lots: number, price: number): Fill {
    const notional = price * lots * LOT_SHARES;
    const fee = commission(notional);
    const tax = side === "sell" ? Math.round(notional * DAYTRADE_TAX) : 0;
    this.feesPaid += fee;
    this.taxesPaid += tax;
    if (side === "buy") this.cash -= notional + fee;
    else this.cash += notional - fee - tax;

    order.filled += lots;
    this.applyPosition(order.code, side, lots, price, fee + tax);

    st.last = price;
    st.volume += lots;
    st.tickLots = lots;
    if (side === "buy") st.outer += lots;
    else st.inner += lots;
    st.high = Math.max(st.high, price);
    st.low = Math.min(st.low, price);
    this.pushTick(st.ticks, this.t, price);
    this.addPxVol(st, price, lots);

    const fill: Fill = {
      id: `F${this.seq++}`,
      orderId: order.id,
      code: order.code,
      side,
      lots,
      price,
      fee,
      tax,
      time: this.t,
      vwapAt: this.vwapOf(st),
    };
    // Canonical session history: display limits belong in the UI, not this ledger.
    this.fills.unshift(fill);
    this.updateEquityStats();
    return fill;
  }

  private applyPosition(code: string, side: Side, lots: number, price: number, cost: number) {
    let pos = this.positions.get(code);
    if (!pos) {
      pos = { code, lots: 0, avg: 0, realized: 0, openCost: 0 };
      this.positions.set(code, pos);
    }
    const signed = side === "buy" ? lots : -lots;
    const prev = pos.lots;
    const next = prev + signed;

    if (prev === 0 || prev * signed > 0) {
      const absPrev = Math.abs(prev);
      const absAdd = Math.abs(signed);
      pos.avg = absPrev + absAdd === 0 ? 0 : (pos.avg * absPrev + price * absAdd) / (absPrev + absAdd);
      pos.lots = next;
      pos.openCost = (pos.openCost ?? 0) + cost;
      return;
    }

    const closeLots = Math.min(Math.abs(prev), lots);
    const openingCost = (pos.openCost ?? 0) * closeLots / Math.abs(prev);
    const closingCost = cost * closeLots / lots;
    const pnl = (price - pos.avg) * closeLots * LOT_SHARES * (prev > 0 ? 1 : -1) - openingCost - closingCost;
    pos.realized += pnl;
    this.realized += pnl;
    this.tradeCount += 1;
    if (pnl > 0) this.tradeWins += 1;
    this.roundTrips.push({ pnl });
    if (Math.abs(next) < 1e-9) {
      pos.lots = 0;
      pos.avg = 0;
      pos.openCost = 0;
    } else if (prev * next < 0) {
      pos.lots = next;
      pos.avg = price;
      pos.openCost = cost - closingCost;
    } else {
      pos.lots = next;
      pos.openCost = (pos.openCost ?? 0) - openingCost;
    }
  }

  equity(): number {
    let mv = 0;
    for (const pos of this.positions.values()) {
      if (pos.lots === 0) continue;
      const st = this.stocks.get(pos.code);
      if (!st) continue;
      mv += pos.lots * st.last * LOT_SHARES;
    }
    return this.cash + mv;
  }

  unrealized(): number {
    let u = 0;
    for (const pos of this.positions.values()) {
      if (pos.lots === 0) continue;
      const st = this.stocks.get(pos.code);
      if (!st) continue;
      u += pos.lots * (st.last - pos.avg) * LOT_SHARES - (pos.openCost ?? 0);
    }
    return u;
  }

  grossExposure(): number {
    let g = 0;
    for (const pos of this.positions.values()) {
      const st = this.stocks.get(pos.code);
      if (!st) continue;
      g += Math.abs(pos.lots) * st.last * LOT_SHARES;
    }
    return g;
  }

  openPositions(): (Position & { last: number; name: string; uPnl: number })[] {
    const out = [];
    for (const pos of this.positions.values()) {
      if (pos.lots === 0) continue;
      const st = this.stocks.get(pos.code);
      if (!st) continue;
      out.push({
        ...pos,
        last: st.last,
        name: st.def.name,
        uPnl: pos.lots * (st.last - pos.avg) * LOT_SHARES - (pos.openCost ?? 0),
      });
    }
    return out;
  }

  private updateEquityStats() {
    const eq = this.equity();
    this.peakEquity = Math.max(this.peakEquity, eq);
    const dd = (this.peakEquity - eq) / this.peakEquity;
    this.maxDrawdown = Math.max(this.maxDrawdown, dd);
    this.peakGross = Math.max(this.peakGross, this.grossExposure());
  }

  private refreshCoach() {
    if (this.t - this.lastCoachAt < 45) return;
    const lines = this.scenario.coach;
    if (!lines.length) return;
    const idx = Math.floor((this.t / 50) % lines.length);
    this.coachLine = lines[idx] ?? lines[0]!;
    this.lastCoachAt = this.t;
  }

  private updateWarning() {
    const left = this.endT - this.t;
    if (left <= 10 * 60 && left > 0 && this.openPositions().length) {
      this.warning = `距離收盤 ${Math.ceil(left / 60)} 分鐘，屆時會撤單並依五檔嘗試平倉；量不足仍會保留庫存。`;
    } else if (left > 10 * 60) {
      this.warning = this.news ? null : this.warning && this.warning.startsWith("距離") ? null : this.warning;
    }
  }

  stats() {
    const eq = this.equity();
    const pnl = eq - this.capital;
    return {
      equity: eq,
      cash: this.cash,
      reservedCash: this.reservedCash(),
      availableCash: this.availableCash(),
      pnl,
      pnlPct: (pnl / this.capital) * 100,
      realized: this.realized,
      unrealized: this.unrealized(),
      fees: this.feesPaid + this.taxesPaid,
      feesOnly: this.feesPaid,
      taxes: this.taxesPaid,
      trades: this.tradeCount,
      wins: this.tradeWins,
      winRate: this.tradeCount ? this.winsRate() : 0,
      maxDrawdown: this.maxDrawdown,
      peakEquity: this.peakEquity,
      peakGross: this.peakGross,
    };
  }

  private winsRate() {
    return this.tradeWins / Math.max(1, this.tradeCount);
  }

  leftoverMinutes() {
    return Math.max(0, (this.endT - this.t) / 60);
  }
}

export function describeFill(fill: Fill, name: string): string {
  const side = fill.side === "buy" ? "買進" : "賣出";
  return `成交 ${side} ${fill.code} ${name} ${fill.lots}張 @ ${formatPrice(fill.price)}`;
}
