import { create } from "zustand";
import { gradeFor, scenarioById, type Scenario } from "@/lib/game/scenarios";
import {
  applySession,
  loadFlashOrder,
  loadProfile,
  loadTeachMode,
  saveFlashOrder,
  saveProfile,
  saveTeachMode,
  saveReview,
  getProfileIdentity,
} from "@/lib/game/persist";
import { evaluatePass, type RuleVerdict } from "@/lib/game/pass-rules";
import { SERVER_REVIEW_FILL_LIMIT } from "@/lib/game/review-schema";
import {
  parseLotsDraft,
  parsePriceDraft,
  ticketDraftFrom,
  TICKET_LOTS_ERROR,
  validateTicketDraft,
  type TicketDraft,
} from "@/lib/game/ticket-draft";
import {
  firstPlannedOrderSchema,
  snapshotFirstTradePlan,
  tradePlanSchema,
  type FirstPlannedOrder,
  type TradePlan,
  type TradePlanInput,
} from "@/lib/game/trade-plan";
import { reviewSaveMessage, type ReviewSyncStatus } from "@/lib/game/review-storage-status";
import { flashClickDecision, isExamScenario, ticketAfterClickPrice } from "@/lib/game/flash-order";
import {
  finishedLearnerGuideState,
  hasSeenLearnerGuide,
  initialPracticeSpeed,
  learnerGuideStepState,
  LEARNER_GUIDE_PAUSE_MESSAGE,
  rememberLearnerGuide,
  shouldAutoOpenLearnerGuide,
} from "@/lib/game/learner-guide";
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
import {
  CANCEL_FAILED_REASON,
  CANCEL_OK_REASON,
  LIVE_UNWIRED_REASON,
  SIM_ACCOUNT,
  getBroker,
  rejectUnsupportedTif,
  type TimeInForce,
  type Venue,
} from "@/lib/broker";

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
  ticketDraft: TicketDraft;
  tradePlan: TradePlan | null;
  firstPlannedOrder: FirstPlannedOrder | null;
  venue: Venue;
  accountId: string;
  mobileTab: MobileTab;
  rightTab: RightTab;
  chartStyle: ChartStyle;
  teachMode: boolean;
  flashOrder: boolean;
  activeBeat: LessonBeat | null;
  dismissedBeats: string[];
  learnerGuideStep: number | null;
  learnerGuideReady: boolean;
  profile: Profile;
  hydrated: boolean;
  frame: number;
  lastResult: SessionRecord | null;
  lastVerdicts: RuleVerdict[];
  syncStatus: ReviewSyncStatus;
  localReviewSaved: boolean;
  sound: boolean;
  hydrate: () => void;
  start: (scenarioId: string) => void;
  openLearnerGuide: () => void;
  setLearnerGuideStep: (step: number) => void;
  finishLearnerGuide: () => void;
  leave: () => void;
  settle: () => void;
  togglePause: () => void;
  setSpeed: (n: number) => void;
  select: (code: string) => void;
  setTicket: (patch: Partial<Ticket>) => void;
  editTicketDraft: (field: keyof TicketDraft, value: string) => void;
  saveTradePlan: (input: TradePlanInput) => { ok: boolean; reason?: string };
  removeTradePlan: () => void;
  setVenue: (v: Venue) => void;
  setMobileTab: (t: MobileTab) => void;
  setRightTab: (t: RightTab) => void;
  setChartStyle: (s: ChartStyle) => void;
  setTeachMode: (on: boolean) => void;
  setFlashOrder: (on: boolean) => void;
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
  ticketDraft: { lots: "1", price: "" },
  tradePlan: null,
  firstPlannedOrder: null,
  venue: "sim",
  accountId: SIM_ACCOUNT,
  mobileTab: "watch",
  rightTab: "pos",
  chartStyle: "jiangbo",
  teachMode: true,
  flashOrder: false,
  activeBeat: null,
  dismissedBeats: [],
  learnerGuideStep: null,
  learnerGuideReady: false,
  profile: { ...EMPTY_PROFILE },
  hydrated: false,
  frame: 0,
  lastResult: null,
  lastVerdicts: [],
  syncStatus: "local",
  localReviewSaved: false,
  sound: true,

  hydrate: () => {
    set({
      profile: loadProfile(),
      hydrated: true,
      teachMode: loadTeachMode(),
      flashOrder: loadFlashOrder(),
    });
  },

  start: (scenarioId) => {
    const sc = scenarioById(scenarioId);
    if (!sc) return;
    unlockAudio();
    const engine = new DayMarket(sc);
    const q = engine.quote(sc.id === "wed-open" ? "2317" : "2330") ?? engine.allQuotes()[0];
    const code = q?.code ?? "2330";
    const px = q ? q.ask : 0;
    const teach = get().teachMode;
    const beat = teach ? openingBeat(sc.id, sc.startMinute) : null;
    const guide = shouldAutoOpenLearnerGuide(sc.id, get().profile.sessions, hasSeenLearnerGuide(getProfileIdentity()));
    set({
      phase: "live",
      engine,
      scenario: sc,
      selected: code,
      speed: initialPracticeSpeed(sc.speed, guide),
      paused: !!beat || guide,
      ticket: { side: "buy", type: "limit", lots: 1, price: roundToTick(px), tif: "ROD" },
      ticketDraft: ticketDraftFrom({ lots: 1, price: roundToTick(px) }),
      tradePlan: null,
      firstPlannedOrder: null,
      mobileTab: "watch",
      rightTab: "pos",
      lastResult: null,
      lastVerdicts: [],
      syncStatus: "local",
      localReviewSaved: false,
      frame: 0,
      activeBeat: beat,
      dismissedBeats: [],
      learnerGuideStep: guide ? 0 : null,
      learnerGuideReady: false,
    });
  },

  openLearnerGuide: () => {
    if (get().phase !== "live" || get().scenario?.id !== "wed-open") return;
    set(learnerGuideStepState(0));
  },
  setLearnerGuideStep: (step) => {
    if (get().learnerGuideStep === null) return;
    set(learnerGuideStepState(step));
  },
  finishLearnerGuide: () => {
    if (get().learnerGuideStep === null) return;
    rememberLearnerGuide(getProfileIdentity());
    set(finishedLearnerGuideState());
  },

  leave: () => {
    set({
      phase: "lobby",
      engine: null,
      scenario: null,
      tradePlan: null,
      firstPlannedOrder: null,
      paused: false,
      lastResult: null,
      ticket: { side: "buy", type: "limit", lots: 1, price: 0, tif: "ROD" },
      ticketDraft: { lots: "1", price: "" },
      activeBeat: null,
      dismissedBeats: [],
      learnerGuideStep: null,
      learnerGuideReady: false,
    });
  },

  settle: () => {
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { engine, scenario, profile } = get();
    if (!engine || !scenario || get().phase === "result") return;
    if (!engine.ended) {
      engine.step(engine.endT - engine.t + 1);
    }
    const st = engine.stats();
    const pass = evaluatePass({ lessonId: scenario.id, pnl: st.pnl, fees: st.fees, maxDrawdown: st.maxDrawdown,
      endT: engine.t, positionsOpen: [...engine.positions.values()].filter((p) => p.lots !== 0).length,
      fills: engine.fills, forcedClose: engine.forcedClose });
    const rec: SessionRecord = {
      id: crypto.randomUUID(),
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
      pausedFills: engine.fills.filter((fill) => fill.filledWhilePaused).length,
      violations: pass.verdicts.filter((verdict) => !verdict.passed).map((verdict) => verdict.rule.label),
    };
    const next = applySession(profile, rec);
    const bundle = { rec, verdicts: pass.verdicts, fills: [...engine.fills], code: get().selected,
      capital: scenario.capital, equity: st.equity, sessionLabel: engine.session.label,
      firstTradePlan: snapshotFirstTradePlan(get().tradePlan, get().firstPlannedOrder) };
    const localReviewSaved = saveReview(bundle);
    set({ phase: "result", lastResult: rec, lastVerdicts: pass.verdicts, profile: next, paused: true, syncStatus: "local", localReviewSaved, learnerGuideReady: false });
    if (getProfileIdentity()) {
      if (bundle.fills.length > SERVER_REVIEW_FILL_LIMIT) {
        set({ syncStatus: "too-large" });
        toast.error(reviewSaveMessage("too-large", localReviewSaved));
        return;
      }
      set({ syncStatus: "saving" });
      void import("@/lib/classroom-db").then((module) => module.saveClassroomSession({ data: bundle }))
        .then(() => { if (get().lastResult?.id === rec.id) set({ syncStatus: "saved" }); })
        .catch(() => {
          if (get().lastResult?.id === rec.id) set({ syncStatus: "failed" });
          toast.error(reviewSaveMessage("failed", localReviewSaved));
        });
    } else if (!localReviewSaved) {
      toast.error(reviewSaveMessage("local", false));
    }
  },

  togglePause: () => {
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    if (get().paused && (get().learnerGuideReady || get().activeBeat)) {
      get().dismissBeat();
      return;
    }
    set({ paused: !get().paused });
  },
  setSpeed: (n) => set({ speed: n }),

  select: (code) => {
    const { engine, ticket, ticketDraft, frame } = get();
    if (engine && !engine.ensureSymbol(code)) {
      toast.error("這個標的沒有本盤可用教材資料");
      return;
    }
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
      ticketDraft: { ...ticketDraft, price: ticketDraftFrom({ lots: ticket.lots, price: roundToTick(price) }).price },
    });
  },

  setTicket: (patch) => {
    const { ticket, ticketDraft, engine, selected } = get();
    if (patch.tif) {
      const tifReason = rejectUnsupportedTif(patch.tif);
      if (tifReason) {
        playError();
        toast.error(tifReason);
        return;
      }
    }
    const next = { ...ticket, ...patch };
    if (patch.side && engine) {
      const q = engine.quote(selected);
      if (q) next.price = roundToTick(patch.side === "buy" ? q.ask : q.bid);
    }
    set({
      ticket: next,
      ticketDraft: {
        lots: patch.lots !== undefined ? String(next.lots) : ticketDraft.lots,
        price: patch.price !== undefined || patch.side ? String(next.price) : ticketDraft.price,
      },
    });
  },

  editTicketDraft: (field, value) => {
    const { ticket, ticketDraft } = get();
    const parsed = field === "lots" ? parseLotsDraft(value) : parsePriceDraft(value);
    set({
      ticketDraft: { ...ticketDraft, [field]: value },
      ticket: {
        ...ticket,
        ...(parsed === null ? {} : { [field]: parsed }),
        ...(field === "price" ? { type: "limit" as const } : {}),
      },
    });
  },

  saveTradePlan: (input) => {
    const { phase, engine, selected, ticket, ticketDraft, firstPlannedOrder } = get();
    if (phase !== "live" || !engine) {
      return { ok: false, reason: "請先進入一堂模擬練習，再寫第一筆進場計畫。" };
    }
    if (firstPlannedOrder) {
      return { ok: false, reason: "第一筆委託已送出，這一堂的進場計畫已鎖定，不能補寫或改寫。" };
    }
    const lots = parseLotsDraft(ticketDraft.lots);
    if (lots === null) return { ok: false, reason: TICKET_LOTS_ERROR };
    const parsed = tradePlanSchema.safeParse({
      ...input,
      version: 1,
      code: selected,
      side: ticket.side,
      lots,
      simTime: engine.t,
    });
    if (!parsed.success) {
      return { ok: false, reason: "請填寫進場與離場條件（各 1–200 字）、大於 0 的討論虧損額度，並確認張數為 1–200 的整數。" };
    }
    set({ tradePlan: parsed.data });
    return { ok: true };
  },

  removeTradePlan: () => {
    if (get().phase === "live" && get().firstPlannedOrder === null) {
      set({ tradePlan: null });
    }
  },

  setVenue: (v) => {
    if (v === "live") {
      playError();
      toast.error(LIVE_UNWIRED_REASON);
      return;
    }
    set({ venue: v, accountId: SIM_ACCOUNT });
  },

  setMobileTab: (t) => set({ mobileTab: t }),
  setRightTab: (t) => set({ rightTab: t }),
  setChartStyle: (s) => set({ chartStyle: s }),
  setTeachMode: (on) => {
    saveTeachMode(on);
    if (!on) set({ teachMode: false, activeBeat: null, paused: get().learnerGuideStep !== null || get().learnerGuideReady });
    else set({ teachMode: true });
  },
  setFlashOrder: (on) => {
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    if (get().flashOrder === on) return;
    saveFlashOrder(on);
    if (!on) {
      set({ flashOrder: false });
      toast("閃電下單已關 · 點五檔只帶價");
      return;
    }
    const { scenario, activeBeat } = get();
    // 教學關卡：開閃電時清掉分步引導，避免卡在引導卻靜默不送。
    // 期末考 / 盲測：保留引導；暫停中送單由 submit 擋下並 toast。
    if (isExamScenario(scenario?.id)) set({ flashOrder: true });
    else set({ flashOrder: true, ...(activeBeat && !get().learnerGuideReady ? { activeBeat: null, paused: false } : {}) });
    toast("閃電下單已開 · 點五檔即以目前張數送單");
  },
  dismissBeat: () => {
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { scenario, activeBeat, dismissedBeats } = get();
    if (!activeBeat || !scenario) {
      set({ activeBeat: null, paused: false, learnerGuideReady: false });
      return;
    }
    set({
      activeBeat: null,
      paused: false,
      dismissedBeats: [...dismissedBeats, beatKey(scenario.id, activeBeat.atMinute)],
      learnerGuideReady: false,
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
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { engine, selected, ticket, ticketDraft, venue, accountId, scenario, paused, activeBeat } = get();
    if (!engine) return;
    if (isExamScenario(scenario?.id) && (paused || activeBeat)) {
      playError();
      toast.error("測驗不可在暫停中下單");
      return;
    }
    const draft = validateTicketDraft(ticketDraft, ticket.type);
    if (!draft.ok) {
      playError();
      toast.error(draft.reason);
      return;
    }
    const q = engine.quote(selected);
    const price =
      ticket.type === "limit" ? draft.price! : ticket.side === "buy" ? (q?.ask ?? 0) : (q?.bid ?? 0);
    const broker = getBroker(venue, engine);
    const res = broker.place({
      venue,
      accountId,
      kind: "daytrade",
      code: selected,
      side: ticket.side,
      type: ticket.type,
      tif: ticket.tif,
      lots: draft.lots,
      price,
    });
    if (!res.ok) {
      playError();
      toast.error(res.reason);
      return;
    }
    if (get().firstPlannedOrder === null) {
      // Both regular and flash submissions pass here. Acceptance locks the
      // first intent even if it has no fills yet or no plan was written.
      set({ firstPlannedOrder: firstPlannedOrderSchema.parse(res.order) });
    }
    for (const f of res.fills) {
      if (paused) f.filledWhilePaused = true;
      toastFill(f);
    }
    if (res.fills.length === 0) toast("已掛出委託");
    get().bump();
  },

  flattenSelected: () => {
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { engine, selected, venue, paused, scenario, activeBeat } = get();
    if (!engine) return;
    if (isExamScenario(scenario?.id) && (paused || activeBeat)) {
      toast.error("測驗不可在暫停中下單");
      return;
    }
    const res = getBroker(venue, engine).flatten(selected);
    if (!res.ok) {
      playError();
      toast.error(res.reason);
      return;
    }
    for (const f of res.fills) {
      if (paused) f.filledWhilePaused = true;
      toastFill(f);
    }
    get().bump();
  },

  flattenAll: () => {
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { engine, paused, scenario, activeBeat } = get();
    if (!engine) return;
    if (isExamScenario(scenario?.id) && (paused || activeBeat)) {
      toast.error("測驗不可在暫停中下單");
      return;
    }
    const previousFills = new Set(engine.fills);
    engine.flattenAll();
    if (paused) {
      // New fills are prepended; mark only this operation's fills.
      for (const fill of engine.fills) {
        if (!previousFills.has(fill)) fill.filledWhilePaused = true;
      }
    }
    toast("已送出全部平倉");
    get().bump();
  },

  cancelOrder: (id) => {
    const { engine, venue } = get();
    const ok = getBroker(venue, engine).cancel(id);
    if (!ok) {
      playError();
      toast.error(CANCEL_FAILED_REASON);
      return;
    }
    toast(CANCEL_OK_REASON);
    get().bump();
  },

  clickPrice: (price, side) => {
    const { ticket, ticketDraft, flashOrder, teachMode, activeBeat, paused, scenario } = get();
    const next = ticketAfterClickPrice(ticket, price, side);
    set({ ticket: next, ticketDraft: { ...ticketDraft, price: String(next.price) } });
    const decision = flashClickDecision({
      flashOrder,
      teachMode,
      guideActive: Boolean(activeBeat),
      paused,
      examMode: isExamScenario(scenario?.id),
    });
    if (decision.action === "submit") get().submit();
    else if (decision.action === "block") {
      playError();
      toast.error(decision.reason);
    }
  },
}));

export function persistOnHide() {
  saveProfile(useGame.getState().profile);
}
