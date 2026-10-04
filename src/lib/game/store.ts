import { create } from "zustand";
import { gradeFor, scenarioById, type Scenario } from "@/lib/game/scenarios";
import {
  applySession,
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
import { orderPresentation } from "@/lib/game/order-presentation";
import { flashBurstBlocked, flashClickDecision, isExamScenario, ticketAfterClickPrice, type FlashActivation, type FlashLastResult, type FlashSubmitInput } from "@/lib/game/flash-order";
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
  type BrokerAck,
} from "@/lib/broker";

export type MobileTab = "watch" | "chart" | "trade" | "pos" | "flash";
export type RightTab = "pos" | "orders" | "fills";
export type Phase = "lobby" | "live" | "result";
export type ChartStyle = "jiangbo" | "tape" | "candles";

type Ticket = {
  side: Side;
  type: "limit" | "market";
  lots: number;
  price: number;
  tif: TimeInForce;
};

type SubmitResult = {
  code: string;
  side: Side;
  lots: number | null;
  simTime: number;
} & ({ ok: true; orderId: string } | { ok: false; reason: string });

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
  lastSubmitResult: SubmitResult | null;
  venue: Venue;
  accountId: string;
  mobileTab: MobileTab;
  rightTab: RightTab;
  orderScope: "working" | "all";
  orderPage: number;
  chartStyle: ChartStyle;
  teachMode: boolean;
  flashOrder: boolean;
  flashActivation: FlashActivation | null;
  flashLastAttemptAt: number | null;
  flashLastResult: FlashLastResult | null;
  flashNotice: string;
  activeBeat: LessonBeat | null;
  dismissedBeats: string[];
  learnerGuideStep: number | null;
  learnerGuideReady: boolean;
  profile: Profile;
  hydrated: boolean;
  profileIdentity: string | null | undefined;
  sessionIdentity: string | null;
  frame: number;
  lastResult: SessionRecord | null;
  lastVerdicts: RuleVerdict[];
  syncStatus: ReviewSyncStatus;
  localReviewSaved: boolean;
  sound: boolean;
  hydrate: () => void;
  ensureSessionIdentity: () => boolean;
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
  setOrderScope: (scope: "working" | "all") => void;
  setOrderPage: (page: number) => void;
  setChartStyle: (s: ChartStyle) => void;
  setTeachMode: (on: boolean) => void;
  setFlashOrder: (on: boolean, expected?: Pick<FlashActivation, "code" | "lots" | "tif">) => void;
  disarmFlash: (reason?: string) => void;
  submitLightning: (input: FlashSubmitInput) => BrokerAck;
  dismissBeat: () => void;
  checkBeats: () => void;
  bump: () => void;
  submit: () => BrokerAck | undefined;
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

const disarmedFlash = { flashOrder: false, flashActivation: null } as const;

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
  lastSubmitResult: null,
  venue: "sim",
  accountId: SIM_ACCOUNT,
  mobileTab: "watch",
  rightTab: "pos",
  orderScope: "working",
  orderPage: 0,
  chartStyle: "jiangbo",
  teachMode: true,
  flashOrder: false,
  flashActivation: null,
  flashLastAttemptAt: null,
  flashLastResult: null,
  flashNotice: "尚未啟用；點價後先核對委託。",
  activeBeat: null,
  dismissedBeats: [],
  learnerGuideStep: null,
  learnerGuideReady: false,
  profile: { ...EMPTY_PROFILE },
  hydrated: false,
  profileIdentity: undefined,
  sessionIdentity: null,
  frame: 0,
  lastResult: null,
  lastVerdicts: [],
  syncStatus: "local",
  localReviewSaved: false,
  sound: true,

  hydrate: () => {
    const identity = getProfileIdentity();
    if (get().phase !== "lobby" && get().sessionIdentity !== identity) {
      const unfinished = get().phase === "live";
      get().leave();
      if (unfinished) toast("帳號已變更，未結算的練習已結束。請使用目前帳號重新開始；原帳號已保存的紀錄仍保留。");
    }
    set({
      profile: loadProfile(),
      profileIdentity: identity,
      hydrated: true,
      teachMode: loadTeachMode(),
      ...disarmedFlash,
    });
  },

  ensureSessionIdentity: () => {
    if (get().sessionIdentity === getProfileIdentity()) return true;
    get().hydrate();
    return false;
  },

  start: (scenarioId) => {
    const sc = scenarioById(scenarioId);
    if (!sc) return;
    if (get().profileIdentity !== getProfileIdentity()) get().hydrate();
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
      sessionIdentity: getProfileIdentity(),
      profileIdentity: getProfileIdentity(),
      engine,
      scenario: sc,
      selected: code,
      speed: initialPracticeSpeed(sc.speed, guide),
      paused: !!beat || guide,
      ticket: { side: "buy", type: "limit", lots: 1, price: roundToTick(px), tif: "ROD" },
      ticketDraft: ticketDraftFrom({ lots: 1, price: roundToTick(px) }),
      tradePlan: null,
      firstPlannedOrder: null,
      lastSubmitResult: null,
      ...disarmedFlash,
      flashLastAttemptAt: null,
      flashLastResult: null,
      flashNotice: "新練習尚未啟用閃電下單。",
      mobileTab: "watch",
      rightTab: "pos",
      orderScope: "working",
      orderPage: 0,
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
    set({ ...learnerGuideStepState(0), ...disarmedFlash, flashNotice: "操作導覽中，閃電下單已解除。" });
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
      lastSubmitResult: null,
      ...disarmedFlash,
      flashLastAttemptAt: null,
      flashLastResult: null,
      paused: false,
      orderScope: "working",
      orderPage: 0,
      lastResult: null,
      lastVerdicts: [],
      syncStatus: "local",
      localReviewSaved: false,
      ticket: { side: "buy", type: "limit", lots: 1, price: 0, tif: "ROD" },
      ticketDraft: { lots: "1", price: "" },
      activeBeat: null,
      dismissedBeats: [],
      learnerGuideStep: null,
      learnerGuideReady: false,
    });
  },

  settle: () => {
    if (!get().ensureSessionIdentity()) return;
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { engine, scenario, profile } = get();
    if (!engine || !scenario || get().phase === "result") return;
    if (!engine.ended) {
      engine.finish();
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
      openPositionsAtEnd: engine.openPositions().map(({ code, lots, last }) => ({ code, lots, last })),
      firstTradePlan: snapshotFirstTradePlan(get().tradePlan, get().firstPlannedOrder) };
    const localReviewSaved = saveReview(bundle);
    set({ phase: "result", ...disarmedFlash, lastResult: rec, lastVerdicts: pass.verdicts, profile: next, paused: true, syncStatus: "local", localReviewSaved, learnerGuideReady: false });
    const ownerId = get().sessionIdentity;
    if (ownerId) {
      if (bundle.fills.length > SERVER_REVIEW_FILL_LIMIT) {
        set({ syncStatus: "too-large" });
        toast.error(reviewSaveMessage("too-large", localReviewSaved));
        return;
      }
      set({ syncStatus: "saving" });
      void import("@/lib/classroom-db").then(async (module) => {
        if (getProfileIdentity() !== ownerId) return false;
        await module.saveClassroomSession({ data: { ...bundle, expectedUserId: ownerId } });
        return true;
      })
        .then((saved) => { if (saved && getProfileIdentity() === ownerId && get().lastResult?.id === rec.id) set({ syncStatus: "saved" }); })
        .catch(() => {
          if (getProfileIdentity() !== ownerId || get().lastResult?.id !== rec.id) return;
          set({ syncStatus: "failed" });
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
      ...disarmedFlash,
      flashNotice: "已選擇商品，請重新核對後啟用閃電下單。",
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
      ...((patch.lots !== undefined && String(next.lots) !== ticketDraft.lots) || (patch.tif !== undefined && patch.tif !== ticket.tif) || (patch.type !== undefined && patch.type !== ticket.type)
        ? { ...disarmedFlash, flashNotice: "委託條件已變更，請重新啟用閃電下單。" } : {}),
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
      ...(field === "lots" && value !== ticketDraft.lots ? { ...disarmedFlash, flashNotice: "張數已變更，請重新啟用閃電下單。" } : {}),
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
    get().disarmFlash("交易通路已重新核對，閃電下單已解除。");
    if (v === "live") {
      playError();
      toast.error(LIVE_UNWIRED_REASON);
      return;
    }
    set({ venue: v, accountId: SIM_ACCOUNT });
  },

  setMobileTab: (t) => set({ mobileTab: t, ...(t !== get().mobileTab ? { ...disarmedFlash, flashNotice: "已切換畫面，閃電下單已解除。" } : {}) }),
  setRightTab: (t) => set({ rightTab: t }),
  setOrderScope: (scope) => set({ orderScope: scope, orderPage: 0 }),
  setOrderPage: (page) => set({ orderPage: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0 }),
  setChartStyle: (s) => set({ chartStyle: s }),
  setTeachMode: (on) => {
    saveTeachMode(on);
    if (!on) set({ teachMode: false, activeBeat: null, paused: get().learnerGuideStep !== null || get().learnerGuideReady });
    else set({ teachMode: true });
  },
  setFlashOrder: (on, expected) => {
    if (!get().ensureSessionIdentity()) return;
    if (!on) {
      get().disarmFlash();
      saveFlashOrder(false);
      return;
    }
    if (get().learnerGuideStep !== null) {
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      get().disarmFlash(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    const { engine, phase, selected, ticket, ticketDraft, venue, accountId, scenario, paused, activeBeat } = get();
    const lots = parseLotsDraft(ticketDraft.lots);
    if (expected && (expected.code !== selected || expected.lots !== lots || expected.tif !== ticket.tif)) {
      get().disarmFlash("畫面上的商品、張數或效期已變更，請重新核對後啟用。");
      return;
    }
    const reason = phase !== "live" || !engine || engine.ended ? "請先進入尚未結束的模擬練習。"
      : venue !== "sim" || accountId !== SIM_ACCOUNT ? "閃電下單僅適用本教室模擬帳戶。"
      : lots === null ? TICKET_LOTS_ERROR
      : rejectUnsupportedTif(ticket.tif)
      ?? (isExamScenario(scenario?.id) && (paused || activeBeat) ? "測驗不可在暫停中下單" : null);
    if (reason || lots === null) {
      get().disarmFlash(reason ?? TICKET_LOTS_ERROR);
      toast.error(reason ?? TICKET_LOTS_ERROR);
      return;
    }
    if (get().flashOrder) return;
    // Activation is explicit and scoped to this lesson; stored preferences never arm it.
    set({ flashOrder: true, flashActivation: { id: crypto.randomUUID(), code: selected, lots, tif: ticket.tif }, flashNotice: `${selected} · ${lots} 張 · 限價 ${ticket.tif} 已啟用。` });
  },
  disarmFlash: (reason = "閃電下單已解除；點價後先核對委託。") => {
    set({ ...disarmedFlash, flashNotice: reason });
  },
  submitLightning: (input) => {
    if (!get().ensureSessionIdentity()) return { ok: false, reason: "登入帳號已變更，請重新開始練習。" };
    const state = get();
    const lots = parseLotsDraft(state.ticketDraft.lots);
    const fail = (reason: string, disarm = false): BrokerAck => {
      set({ ...(disarm ? disarmedFlash : {}), flashNotice: reason, flashLastResult: { ok: false, code: input.code, side: input.side, lots, price: input.price, tif: state.ticket.tif, at: Date.now(), message: reason } });
      toast.error(reason);
      return { ok: false, reason };
    };
    const now = Date.now();
    if (flashBurstBlocked(state.flashLastAttemptAt, now, input.repeat)) {
      const reason = "已略過長按或快速連點；請先核對上一筆結果，再次按下可送新委託。";
      set({ flashNotice: reason });
      return { ok: false, reason };
    }
    if (state.phase !== "live" || !state.engine || state.engine.ended) return fail("練習尚未開始或已結束。", true);
    if (state.venue !== "sim" || state.accountId !== SIM_ACCOUNT) return fail("閃電下單僅適用本教室模擬帳戶。", true);
    if (state.learnerGuideStep !== null) return fail(LEARNER_GUIDE_PAUSE_MESSAGE, true);
    const activation = state.flashActivation;
    if (lots === null) return fail(TICKET_LOTS_ERROR, true);
    if (!state.flashOrder || !activation || input.activationId !== activation.id || input.code !== state.selected || activation.code !== state.selected || lots !== activation.lots || state.ticket.tif !== activation.tif) {
      return fail("商品、張數或效期已變更／尚未啟用；請重新核對並啟用閃電下單。", true);
    }
    const decision = flashClickDecision({ flashOrder: true, teachMode: state.teachMode, guideActive: Boolean(state.activeBeat), paused: state.paused, examMode: isExamScenario(state.scenario?.id) });
    if (decision.action === "block") return fail(decision.reason);
    set({ ticket: { ...state.ticket, side: input.side, type: "limit", lots, price: input.price }, ticketDraft: { lots: state.ticketDraft.lots, price: String(input.price) }, flashLastAttemptAt: now });
    const result = get().submit() ?? { ok: false as const, reason: "委託未送出，請重新核對練習狀態。" };
    const message = result.ok
      ? `委託 ${result.order.id}：${orderPresentation(result.order).statusLabel}，已成交 ${result.order.filled}／${result.order.lots} 張。${result.order.cancelReason ?? ""}`
      : result.reason;
    set({ flashLastResult: { ok: result.ok, code: input.code, side: input.side, lots, price: input.price, tif: state.ticket.tif, at: now, message, ...(result.ok ? { orderId: result.order.id } : {}) }, flashNotice: "" });
    return result;
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
    if (!get().ensureSessionIdentity()) return { ok: false, reason: "登入帳號已變更，請重新開始練習。" };
    const { engine, selected, ticket, ticketDraft, venue, accountId, scenario, paused, activeBeat } = get();
    if (!engine) return;
    const attempt = { code: selected, side: ticket.side, lots: parseLotsDraft(ticketDraft.lots), simTime: engine.t };
    // This feedback is separate from the broker's accepted order/fill ledger.
    const rejected = (reason: string) => set({ lastSubmitResult: { ...attempt, ok: false, reason } });
    if (get().learnerGuideStep !== null) {
      rejected(LEARNER_GUIDE_PAUSE_MESSAGE);
      toast(LEARNER_GUIDE_PAUSE_MESSAGE);
      return;
    }
    if (isExamScenario(scenario?.id) && (paused || activeBeat)) {
      rejected("測驗不可在暫停中下單");
      playError();
      toast.error("測驗不可在暫停中下單");
      return;
    }
    const draft = validateTicketDraft(ticketDraft, ticket.type);
    if (!draft.ok) {
      rejected(draft.reason);
      playError();
      toast.error(draft.reason);
      return { ok: false, reason: draft.reason };
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
      rejected(res.reason);
      playError();
      toast.error(res.reason);
      return res;
    }
    set({ lastSubmitResult: { ...attempt, ok: true, orderId: res.order.id } });
    if (get().firstPlannedOrder === null) {
      // Both regular and flash submissions pass here. Acceptance locks the
      // first intent even if it has no fills yet or no plan was written.
      set({ firstPlannedOrder: firstPlannedOrderSchema.parse(res.order) });
    }
    for (const f of res.fills) {
      if (paused) f.filledWhilePaused = true;
      toastFill(f);
    }
    const outcome = orderPresentation(res.order);
    toast(`委託 ${res.order.id}：${outcome.statusLabel}，已成交 ${res.order.filled}／${res.order.lots} 張。${res.order.cancelReason ?? ""}`);
    get().bump();
    return res;
  },

  flattenSelected: () => {
    if (!get().ensureSessionIdentity()) return;
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
      // Flatten may already have cancelled old orders before the new close is rejected.
      get().bump();
      playError();
      toast.error(res.reason);
      return;
    }
    for (const f of res.fills) {
      if (paused) f.filledWhilePaused = true;
      toastFill(f);
    }
    const remaining = Math.abs(engine.positions.get(selected)?.lots ?? 0);
    toast(remaining > 0
      ? `${selected} 尚有 ${remaining} 張庫存。未成交的平倉數量已取消，請核對後再操作。`
      : `${selected} 已無庫存，此商品原有待單已取消。`);
    get().bump();
  },

  flattenAll: () => {
    if (!get().ensureSessionIdentity()) return;
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
    const remaining = engine.openPositions();
    toast(remaining.length > 0
      ? `尚有 ${remaining.length} 檔、共 ${remaining.reduce((sum, p) => sum + Math.abs(p.lots), 0)} 張未平倉；請到庫存核對。`
      : "已無庫存，原有待單已取消。請核對成交紀錄。");
    get().bump();
  },

  cancelOrder: (id) => {
    if (!get().ensureSessionIdentity()) return;
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
    const { ticket, ticketDraft, flashOrder } = get();
    const next = ticketAfterClickPrice(ticket, price, side);
    set({ ticket: next, ticketDraft: { ...ticketDraft, price: String(next.price) } });
    if (flashOrder) get().submitLightning({ code: get().selected, side: next.side, price: next.price, activationId: get().flashActivation?.id ?? "" });
  },
}));

export function persistOnHide() {
  useGame.getState().disarmFlash("離開視窗後，閃電下單已解除。");
  if (useGame.getState().profileIdentity === getProfileIdentity()) saveProfile(useGame.getState().profile);
}
