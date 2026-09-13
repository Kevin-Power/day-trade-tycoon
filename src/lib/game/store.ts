import { create } from "zustand";
import { gradeFor, scenarioById, type Scenario } from "@/lib/game/scenarios";
import { applySession, isFirstVisitLesson, loadProfile, loadTeachMode, markLessonVisited, mergeServerCareer, saveProfile, saveReview, saveTeachMode } from "@/lib/game/persist";
import { playError, playFill, unlockAudio } from "@/lib/game/audio";
import { DayMarket, describeFill } from "@/lib/market/engine";
import { STOCK_BY_CODE } from "@/lib/market/universe";
import { EMPTY_PROFILE, type Fill, type Profile, type SessionRecord, type Side } from "@/lib/game/types";
import { roundToTick } from "@/lib/market/ticks";
import { toast } from "sonner";
import {
  beatKey,
  checkpointsOf,
  lessonById,
  type LessonBeat,
} from "@/lib/game/curriculum";
import { evaluatePass, type RuleVerdict } from "@/lib/game/pass-rules";
import { getBroker, SIM_ACCOUNT, type TimeInForce, type Venue } from "@/lib/broker";

export type MobileTab = "watch" | "chart" | "trade" | "pos";
export type RightTab = "pos" | "orders" | "fills" | "strat";
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
  briefingOpen: boolean;
  activeBeat: LessonBeat | null;
  dismissedBeats: string[];
  profile: Profile;
  hydrated: boolean;
  frame: number;
  lastResult: SessionRecord | null;
  lastVerdicts: RuleVerdict[];
  layoutMode: "auto" | "desk" | "phone";
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
  setLayoutMode: (m: "auto" | "desk" | "phone") => void;
  setTeachMode: (on: boolean) => void;
  dismissBriefing: () => void;
  dismissBeat: () => void;
  checkBeats: () => void;
  bump: () => void;
  submit: () => void;
  flattenSelected: () => void;
  flattenAll: () => void;
  applyCareer: (career: Parameters<typeof mergeServerCareer>[1]) => void;
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
  briefingOpen: false,
  activeBeat: null,
  dismissedBeats: [],
  profile: { ...EMPTY_PROFILE },
  hydrated: false,
  frame: 0,
  lastResult: null,
  lastVerdicts: [],
  layoutMode: "auto",
  sound: true,

  hydrate: () => {
    let layout: "auto" | "desk" | "phone" = "auto";
    try {
      const raw = window.localStorage.getItem("day-tycoon-layout");
      if (raw === "desk" || raw === "phone" || raw === "auto") layout = raw;
    } catch {
      /* quota */
    }
    set({ profile: loadProfile(), hydrated: true, teachMode: loadTeachMode(), layoutMode: layout });
  },

  applyCareer: (career) => {
    const next = mergeServerCareer(get().profile, career);
    set({ profile: next, hydrated: true });
  },

  start: (scenarioId) => {
    const sc = scenarioById(scenarioId);
    if (!sc) return;
    unlockAudio();
    const engine = new DayMarket(sc);
    const preferred = sc.id === "wed-open" ? "2317" : "2330";
    const q = engine.quote(preferred) ?? engine.allQuotes()[0];
    const code = q?.code ?? "2330";
    const px = q ? q.ask : 0;
    const live = sc.id.startsWith("live-");
    const first = isFirstVisitLesson(sc.id);
    const teach = !live && (first || get().teachMode);
    const lesson = lessonById(sc.id);
    const briefing = teach && !!lesson;
    set({
      phase: "live",
      engine,
      scenario: sc,
      selected: code,
      speed: sc.speed,
      paused: briefing,
      ticket: { side: "buy", type: "limit", lots: 1, price: roundToTick(px), tif: "ROD" },
      mobileTab: "watch",
      rightTab: "pos",
      lastResult: null,
      lastVerdicts: [],
      frame: 0,
      briefingOpen: briefing,
      activeBeat: null,
      dismissedBeats: [],
      teachMode: live ? false : teach,
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
      briefingOpen: false,
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
    const pausedFills = engine.fills.filter((f) => f.filledWhilePaused).length;
    const pass = lessonById(scenario.id)
      ? evaluatePass({
          lessonId: scenario.id,
          pnl: st.pnl,
          fees: st.fees,
          maxDrawdown: st.maxDrawdown,
          endT: engine.t,
          positionsOpen: [...engine.positions.values()].filter((p) => p.lots !== 0).length,
          fills: engine.fills,
        })
      : { passed: true, verdicts: [] };
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
      passed: pass.passed,
      pausedFills,
      violations: pass.verdicts.filter((v) => !v.passed).map((v) => v.rule.label),
    };
    const next = applySession(profile, rec);
    saveReview({
      rec,
      verdicts: pass.verdicts,
      fills: engine.fills,
      code: get().selected,
      capital: scenario.capital,
      equity: st.equity,
      sessionLabel: engine.session.label,
    });
    set({ phase: "result", lastResult: rec, lastVerdicts: pass.verdicts, profile: next, paused: true });
    void import("@/lib/classroom-db")
      .then((m) =>
        m.saveClassroomSession({
          data: {
            id: rec.id,
            lessonId: scenario.id,
            initialEquity: scenario.capital,
            finalEquity: st.equity,
            maxDrawdownPct: st.maxDrawdown,
            tradesCount: st.trades,
            violations: rec.violations ?? [],
            passed: pass.passed,
            pausedFills,
            trades: engine.fills.map((f) => ({
              id: f.id,
              simTime: f.time,
              code: f.code,
              side: f.side,
              qty: f.lots,
              price: f.price,
              fee: f.fee,
              tax: f.tax,
              pnl: f.pnl ?? 0,
              filledWhilePaused: f.filledWhilePaused ?? false,
            })),
          },
        }),
      )
      .catch(() => {
        /* 未登入或離線：localStorage 已存 */
      });
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
  setLayoutMode: (m) => {
    try {
      window.localStorage.setItem("day-tycoon-layout", m);
    } catch {
      /* quota */
    }
    set({ layoutMode: m });
  },
  setTeachMode: (on) => {
    saveTeachMode(on);
    if (!on) set({ teachMode: false, activeBeat: null, briefingOpen: false, paused: false });
    else set({ teachMode: true });
  },
  dismissBriefing: () => {
    const { scenario } = get();
    if (scenario) markLessonVisited(scenario.id);
    set({ briefingOpen: false, paused: false, activeBeat: null });
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
    const { teachMode, engine, scenario, activeBeat, dismissedBeats, briefingOpen } = get();
    if (!teachMode || !engine || !scenario || activeBeat || briefingOpen) return;
    const lesson = lessonById(scenario.id);
    if (!lesson) return;
    const minute = engine.t / 60;
    const hit = checkpointsOf(lesson).find(
      (b) => minute + 0.02 >= b.atMinute && !dismissedBeats.includes(beatKey(scenario.id, b.atMinute)),
    );
    if (hit) set({ activeBeat: hit, paused: true });
  },
  bump: () => set({ frame: get().frame + 1 }),

  submit: () => {
    const { engine, selected, ticket, venue, accountId, paused, scenario, briefingOpen } = get();
    if (!engine) return;
    if (briefingOpen) {
      playError();
      toast.error("先看完講解再下單。按 Space 開始。");
      return;
    }
    if (paused && scenario?.id === "tycoon") {
      playError();
      toast.error("期末考不可在暫停中下單");
      return;
    }
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
    if (paused) {
      for (const f of res.fills) f.filledWhilePaused = true;
    }
    for (const f of res.fills) toastFill(f);
    if (res.fills.length === 0) toast(paused ? "暫停中已掛出（將標記為暫停成交）" : "已掛出委託");
    get().bump();
  },

  flattenSelected: () => {
    const { engine, selected, venue, paused, scenario } = get();
    if (!engine) return;
    if (paused && scenario?.id === "tycoon") {
      playError();
      toast.error("期末考不可在暫停中下單");
      return;
    }
    const res = getBroker(venue, engine).flatten(selected);
    if (!res.ok) {
      playError();
      toast.error(res.reason);
      return;
    }
    if (paused) for (const f of res.fills) f.filledWhilePaused = true;
    for (const f of res.fills) toastFill(f);
    get().bump();
  },

  flattenAll: () => {
    const { engine, paused, scenario } = get();
    if (!engine) return;
    if (paused && scenario?.id === "tycoon") {
      playError();
      toast.error("期末考不可在暫停中下單");
      return;
    }
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
