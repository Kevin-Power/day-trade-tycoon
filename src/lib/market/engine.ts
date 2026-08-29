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
  formatPrice,
  limitDown,
  limitUp,
  LOT_SHARES,
  roundToTick,
  tickSize,
} from "@/lib/market/ticks";
import { INDEX_PREV, UNIVERSE, type Sector, type StockDef } from "@/lib/market/universe";
import { sessionById, type IndexSession } from "@/lib/market/week";
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
        this.warning = "收盤，未平倉部位已市價出場。";
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
    let px = clampLimit(pxPath, st.prev);
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
    const t = tickSize(last);
    const spreadTicks = this.rng() < 0.7 ? 1 : 2;
    const bid0 = roundToTick(last - spreadTicks * t);
    const ask0 = roundToTick(last + (this.rng() < 0.35 ? 0 : spreadTicks * t));
    const lo = limitDown(st.prev);
    const hi = limitUp(st.prev);
    const bids: BookLevel[] = [];
    const asks: BookLevel[] = [];
    let bp = Math.min(bid0, ask0 - t);
    let ap = Math.max(ask0, bp + t);
    bp = Math.max(lo, roundToTick(bp));
    ap = Math.min(hi, roundToTick(ap));
    for (let i = 0; i < 5; i++) {
      const p = roundToTick(bp - i * tickSize(bp));
      if (p < lo) break;
      bids.push({
        price: p,
        lots: irand(this.rng, 2, 6) * st.def.liquidity + irand(this.rng, 0, 18),
      });
    }
    for (let i = 0; i < 5; i++) {
      const p = roundToTick(ap + i * tickSize(ap));
      if (p > hi) break;
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
    return UNIVERSE.map((s) => this.toQuote(this.stocks.get(s.code)!));
  }

  private toQuote(st: StockState): Quote {
    const change = st.last - st.prev;
    const changePct = (change / st.prev) * 100;
    const hi = limitUp(st.prev);
    const lo = limitDown(st.prev);
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
      bid: st.bids[0]?.price ?? st.last,
      ask: st.asks[0]?.price ?? st.last,
      bidLots: st.bids[0]?.lots ?? 0,
      askLots: st.asks[0]?.lots ?? 0,
      tickLots: st.tickLots,
      volume: st.volume,
      vwap: this.vwapOf(st),
      inner: st.inner,
      outer: st.outer,
      bids: st.bids.map((l) => ({ ...l })),
      asks: st.asks.map((l) => ({ ...l })),
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

  place(input: {
    code: string;
    side: Side;
    type: "limit" | "market";
    lots: number;
    price?: number;
  }): PlaceResult {
    if (this.ended) return { ok: false, reason: "已收盤" };
    const st = this.stocks.get(input.code);
    if (!st) return { ok: false, reason: "找不到商品" };
    const lots = Math.floor(input.lots);
    if (lots < 1 || lots > 200) return { ok: false, reason: "張數需介於 1–200" };

    const pos = this.positions.get(input.code);
    const posLots = pos?.lots ?? 0;
    if (input.side === "sell" && posLots <= 0 && !this.scenario.allowShort) {
      return { ok: false, reason: "此關不可先賣（尚未開通現股當沖）" };
    }

    const px =
      input.type === "market"
        ? input.side === "buy"
          ? (st.asks[0]?.price ?? st.last)
          : (st.bids[0]?.price ?? st.last)
        : roundToTick(input.price ?? st.last);
    if (px <= 0) return { ok: false, reason: "價格不正確" };
    const lo = limitDown(st.prev);
    const hi = limitUp(st.prev);
    if (px < lo || px > hi) return { ok: false, reason: "超出漲跌停" };

    if (input.side === "buy") {
      const notional = px * lots * LOT_SHARES;
      if (this.cash < notional + commission(notional)) {
        return { ok: false, reason: "可用餘額不足" };
      }
    }

    const grossNow = this.grossExposure();
    const extra =
      input.side === "buy"
        ? posLots >= 0
          ? px * lots * LOT_SHARES
          : 0
        : posLots <= 0
          ? px * lots * LOT_SHARES
          : 0;
    const cap = this.equity() * this.scenario.leverage;
    if (grossNow + extra > cap * 1.01) {
      return { ok: false, reason: `超過當沖額度（${this.scenario.leverage} 倍）` };
    }

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
    };
    this.orders.unshift(order);
    const fills = this.tryFill(order, st, input.type === "market");
    if (order.status === "pending" && input.type === "market") {
      order.status = "cancelled";
      return { ok: false, reason: "無對手量，未成交" };
    }
    return { ok: true, order, fills };
  }

  cancel(id: string): boolean {
    const o = this.orders.find((x) => x.id === id);
    if (!o || o.status === "filled" || o.status === "cancelled") return false;
    o.status = "cancelled";
    return true;
  }

  flatten(code: string): PlaceResult {
    const pos = this.positions.get(code);
    if (!pos || pos.lots === 0) return { ok: false, reason: "無庫存" };
    return this.place({
      code,
      side: pos.lots > 0 ? "sell" : "buy",
      type: "market",
      lots: Math.abs(pos.lots),
    });
  }

  flattenAll() {
    const codes = [...this.positions.values()].filter((p) => p.lots !== 0).map((p) => p.code);
    for (const c of codes) this.flatten(c);
  }

  private forceFlatten() {
    for (const o of this.orders) {
      if (o.status === "pending" || o.status === "partial") o.status = "cancelled";
    }
    this.flattenAll();
  }

  private matchResting() {
    for (const o of this.orders) {
      if (o.status !== "pending" && o.status !== "partial") continue;
      const st = this.stocks.get(o.code);
      if (!st) continue;
      this.tryFill(o, st, false);
    }
  }

  private tryFill(order: Order, st: StockState, aggressive: boolean): Fill[] {
    const out: Fill[] = [];
    let remain = order.lots - order.filled;
    if (remain <= 0) return out;

    if (order.side === "buy") {
      const levels = aggressive ? st.asks : st.asks.filter((l) => l.price <= order.price + 1e-9);
      if (!aggressive && st.last > order.price + 1e-9 && (st.asks[0]?.price ?? 9e9) > order.price) {
        return out;
      }
      for (const lvl of levels) {
        if (remain <= 0) break;
        if (!aggressive && lvl.price > order.price + 1e-9) break;
        const take = Math.min(remain, Math.max(1, lvl.lots));
        const fillPx = lvl.price;
        const fill = this.execute(order, st, "buy", take, fillPx);
        out.push(fill);
        remain -= take;
        lvl.lots = Math.max(0, lvl.lots - take);
      }
    } else {
      const levels = aggressive ? st.bids : st.bids.filter((l) => l.price >= order.price - 1e-9);
      if (!aggressive && st.last < order.price - 1e-9 && (st.bids[0]?.price ?? 0) < order.price) {
        return out;
      }
      for (const lvl of levels) {
        if (remain <= 0) break;
        if (!aggressive && lvl.price < order.price - 1e-9) break;
        const take = Math.min(remain, Math.max(1, lvl.lots));
        const fill = this.execute(order, st, "sell", take, lvl.price);
        out.push(fill);
        remain -= take;
        lvl.lots = Math.max(0, lvl.lots - take);
      }
    }

    if (order.filled >= order.lots) order.status = "filled";
    else if (order.filled > 0) order.status = "partial";
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
    this.fills.unshift(fill);
    if (this.fills.length > 80) this.fills.length = 80;
    return fill;
  }

  private applyPosition(code: string, side: Side, lots: number, price: number, cost: number) {
    let pos = this.positions.get(code);
    if (!pos) {
      pos = { code, lots: 0, avg: 0, realized: 0 };
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
      return;
    }

    const closeLots = Math.min(Math.abs(prev), lots);
    const pnl = (price - pos.avg) * closeLots * LOT_SHARES * (prev > 0 ? 1 : -1) - cost;
    pos.realized += pnl;
    this.realized += pnl;
    this.tradeCount += 1;
    if (pnl > 0) this.tradeWins += 1;
    this.roundTrips.push({ pnl });
    if (Math.abs(next) < 1e-9) {
      pos.lots = 0;
      pos.avg = 0;
    } else if (prev * next < 0) {
      pos.lots = next;
      pos.avg = price;
    } else {
      pos.lots = next;
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
      u += pos.lots * (st.last - pos.avg) * LOT_SHARES;
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
        uPnl: pos.lots * (st.last - pos.avg) * LOT_SHARES,
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
      this.warning = `距離收盤 ${Math.ceil(left / 60)} 分鐘，未平倉將強制市價出場。`;
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
