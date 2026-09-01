import { create } from "zustand";
import { gradeFor, scenarioById, type Scenario } from "@/lib/game/scenarios";
import { applySession, loadProfile, loadTeachMode, saveProfile, saveTeachMode } from "@/lib/game/persist";
import { playError, playFill, unlockAudio } from "@/lib/game/audio";
import { DayMarket, describeFill } from "@/lib/market/engine";
import { STOCK_BY_CODE } from "@/lib/market/universe";
import { EMPTY_PROFILE, type Fill, type Profile, type SessionRecord, type Side } from "@/lib/game/types";
import { roundToTick } from "@/lib/market/ticks";
import { toast } from "sonner";
import {
  beatKey,
  lessonById,
  openingBeat,
  type LessonBeat,
} from "@/lib/game/curriculum";
import { getBroker, SIM_ACCOUNT, type TimeInForce, type Venue } from "@/lib/broker";

export type MobileTab = "watch" | "chart" | "trade" | "pos";
export type RightTab = "pos" | "orders" | "fills";
export type Phase = "lobby" | "live" | "result";
export type ChartStyle = "jiangbo" | "tape";

type Ticket = {
  side: Side;
  type: "limit" | "market";
  lots: number;
  price: number;
  tif: TimeInForce;
};

type GameStore = {
  phase: Phase;
  engine: DayMarket | null;
  scenario: Scenario | null;
  selected: string;
  speed: number;
  paused: boolean;
  ticket: Ticket;
  venue: Venue;
  accountId: string;
  mobileTab: MobileTab;
  rightTab: RightTab;
  chartStyle: ChartStyle;
  teachMode: boolean;
  activeBeat: LessonBeat | null;
  dismissedBeats: string[];
  profile: Profile;
  hydrated: boolean;
  frame: number;
  lastResult: SessionRecord | null;
  sound: boolean;
  hydrate: () => void;
  start: (scenarioId: string) => void;
  leave: () => void;
  settle: () => void;
  togglePause: () => void;
  setSpeed: (n: number) => void;
  select: (code: string) => void;
  setTicket: (patch: Partial<Ticket>) => void;
  setVenue: (v: Venue) => void;
  setMobileTab: (t: MobileTab) => void;
  setRightTab: (t: RightTab) => void;
  setChartStyle: (s: ChartStyle) => void;
  setTeachMode: (on: boolean) => void;
  dismissBeat: () => void;
  checkBeats: () => void;
  bump: () => void;
  submit: () => void;
  flattenSelected: () => void;
  flattenAll: () => void;
  cancelOrder: (id: string) => void;
  clickPrice: (price: number, side?: Side) => void;
};

function toastFill(fill: Fill) {
  const name = STOCK_BY_CODE[fill.code]?.name ?? "";
  toast.success(describeFill(fill, name));
  playFill(fill.side);
}

export const useGame = create<GameStore>((set, get) => ({
  phase: "lobby",
  engine: null,
  scenario: null,
  selected: "2330",
  speed: 8,
  paused: false,
  ticket: { side: "buy", type: "limit", lots: 1, price: 0, tif: "ROD" },
  venue: "sim",
  accountId: SIM_ACCOUNT,
  mobileTab: "watch",
  rightTab: "pos",
  chartStyle: "jiangbo",
  teachMode: true,
  activeBeat: null,
  dismissedBeats: [],
  profile: { ...EMPTY_PROFILE },
  hydrated: false,
  frame: 0,
  lastResult: null,
  sound: true,

  hydrate: () => {
    set({ profile: loadProfile(), hydrated: true, teachMode: loadTeachMode() });
  },

  start: (scenarioId) => {
    const sc = scenarioById(scenarioId);
    if (!sc) return;
    unlockAudio();
    const engine = new DayMarket(sc);
    const q = engine.quote("2330") ?? engine.allQuotes()[0];
    const code = q?.code ?? "2330";
    const px = q ? q.ask : 0;
    const teach = get().teachMode;
    const beat = teach ? openingBeat(sc.id, sc.startMinute) : null;
    set({
      phase: "live",
      engine,
      scenario: sc,
      selected: code,
      speed: sc.speed,
      paused: !!beat,
      ticket: { side: "buy", type: "limit", lots: 1, price: roundToTick(px), tif: "ROD" },
      mobileTab: "watch",
      rightTab: "pos",
      lastResult: null,
      frame: 0,
      activeBeat: beat,
      dismissedBeats: [],
    });
  },

  leave: () => {
    set({
      phase: "lobby",
      engine: null,
      scenario: null,
      paused: false,
      lastResult: null,
      activeBeat: null,
      dismissedBeats: [],
    });
  },

  settle: () => {
    const { engine, scenario, profile } = get();
    if (!engine || !scenario) return;
    if (!engine.ended) {
      engine.step(engine.endT - engine.t + 1);
    }
    const st = engine.stats();
    const rec: SessionRecord = {
      id: `S${Date.now()}`,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      endedAt: Date.now(),
      pnl: st.pnl,
      pnlPct: st.pnlPct,
      trades: st.trades,
      wins: st.wins,
      fees: st.fees,
      maxDrawdown: st.maxDrawdown,
      grade: gradeFor(st.pnlPct, st.trades, st.maxDrawdown),
      title: scenario.name,
    };
    const next = applySession(profile, rec);
    set({ phase: "result", lastResult: rec, profile: next, paused: true });
  },

  togglePause: () => set({ paused: !get().paused }),
  setSpeed: (n) => set({ speed: n }),

  select: (code) => {
    const { engine, ticket, frame } = get();
    const q = engine?.quote(code);
    const price = q ? (ticket.side === "buy" ? q.ask : q.bid) : ticket.price;
    set({
      selected: code,
      mobileTab: "chart",
      frame: frame + 1,
      ticket: {
        ...ticket,
        price: roundToTick(price),
      },
    });
  },

  setTicket: (patch) => {
    const { ticket, engine, selected } = get();
    const next = { ...ticket, ...patch };
    if (patch.price !== undefined && !(patch.price > 0)) return;
    if (patch.side && engine) {
      const q = engine.quote(selected);
      if (q) next.price = roundToTick(patch.side === "buy" ? q.ask : q.bid);
    }
    set({ ticket: next });
  },

  setVenue: (v) => {
    if (v === "live") {
      playError();
      toast.error("實盤尚未接上券商 API。下單畫面已共用，接線後即可切換。");
      return;
    }
    set({ venue: v, accountId: SIM_ACCOUNT });
  },

  setMobileTab: (t) => set({ mobileTab: t }),
  setRightTab: (t) => set({ rightTab: t }),
  setChartStyle: (s) => set({ chartStyle: s }),
  setTeachMode: (on) => {
    saveTeachMode(on);
    if (!on) set({ teachMode: false, activeBeat: null, paused: false });
    else set({ teachMode: true });
  },
  dismissBeat: () => {
    const { scenario, activeBeat, dismissedBeats } = get();
    if (!activeBeat || !scenario) {
      set({ activeBeat: null, paused: false });
      return;
    }
    set({
      activeBeat: null,
      paused: false,
      dismissedBeats: [...dismissedBeats, beatKey(scenario.id, activeBeat.atMinute)],
    });
  },
  checkBeats: () => {
    const { teachMode, engine, scenario, activeBeat, dismissedBeats } = get();
    if (!teachMode || !engine || !scenario || activeBeat) return;
    const lesson = lessonById(scenario.id);
    if (!lesson) return;
    const minute = engine.t / 60;
    const hit = lesson.beats.find(
      (b) => minute + 0.02 >= b.atMinute && !dismissedBeats.includes(beatKey(scenario.id, b.atMinute)),
    );
    if (hit) set({ activeBeat: hit, paused: true });
  },
  bump: () => set({ frame: get().frame + 1 }),

  submit: () => {
    const { engine, selected, ticket, venue, accountId } = get();
    if (!engine) return;
    const q = engine.quote(selected);
    const price =
      ticket.price > 0 ? ticket.price : ticket.side === "buy" ? (q?.ask ?? 0) : (q?.bid ?? 0);
    const broker = getBroker(venue, engine);
    const res = broker.place({
      venue,
      accountId,
      kind: "daytrade",
      code: selected,
      side: ticket.side,
      type: ticket.type,
      tif: ticket.tif,
      lots: ticket.lots,
      price,
    });
    if (!res.ok) {
      playError();
      toast.error(res.reason);
      return;
    }
    for (const f of res.fills) toastFill(f);
    if (res.fills.length === 0) toast("已掛出委託");
    get().bump();
  },

  flattenSelected: () => {
    const { engine, selected, venue } = get();
    if (!engine) return;
    const res = getBroker(venue, engine).flatten(selected);
    if (!res.ok) {
      playError();
      toast.error(res.reason);
      return;
    }
    for (const f of res.fills) toastFill(f);
    get().bump();
  },

  flattenAll: () => {
    const { engine } = get();
    if (!engine) return;
    engine.flattenAll();
    toast("已送出全部平倉");
    get().bump();
  },

  cancelOrder: (id) => {
    const { engine, venue } = get();
    getBroker(venue, engine).cancel(id);
    get().bump();
  },

  clickPrice: (price, side) => {
    const { ticket } = get();
    set({
      ticket: {
        ...ticket,
        price: roundToTick(price),
        type: "limit",
        ...(side ? { side } : {}),
      },
    });
  },
}));

export function persistOnHide() {
  saveProfile(useGame.getState().profile);
}
