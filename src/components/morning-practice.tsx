import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  ChartCandlestick,
  ListOrdered,
  RotateCcw,
  Star,
  Wallet,
} from "@/lib/icons";
import { TapeChart } from "@/components/charts";
import { DeskBar, HintBar, LessonSelect, StatusBar } from "@/components/morning-desk-bar";
import { LessonPicker } from "@/components/lesson-picker";
import { AbandonRun, RunRecords } from "@/components/run-records";
import { REPLAY_DELAY, type ReplaySpeed } from "@/lib/replay-speed";
import { ReplayNotice } from "@/components/replay-notice";
import { TradeTape } from "@/components/trade-tape";
import { useTickReplay } from "@/components/use-tick-replay";
import {
  AccountSummary,
  DisplayBook,
  PaperOrder,
  PendingOrder,
  Ledger,
  type MorningOrderOptions,
} from "@/components/morning-trading";
import { MinuteTable, QuoteDetailGrid, StockTabs } from "@/components/stock-detail";
import { IndexPanel } from "@/components/index-panel";
import { WatchTable } from "@/components/watch-table";
import { ChartToolbar, QuoteHero, QuoteLine } from "@/components/quote-hero";
import { useGuestBootstrap } from "@/components/use-guest-bootstrap";
import { AccessCard } from "@/components/access-card";
import { GuestBanner, GuestSaveCard, LinkNoticeBanner } from "@/components/guest-prompts";
import { clearLinkNoticeCookie, readLinkNotice, type LinkNotice } from "@/lib/guest-link";
import { describeAccessProblem } from "@/lib/morning-access";
import { bookView } from "@/lib/morning-book";
import { PlanForm } from "@/components/morning-plan-form";
import { CARD, INPUT, PRIMARY, SECONDARY } from "@/components/morning-styles";
import { CoachMarks } from "@/components/coach-marks";
import { readCoachSeen, writeCoachSeen } from "@/lib/coach-steps";
import { browserStorage } from "@/lib/device-storage";
import { useSay } from "@/components/use-speech";
import { fillAnnouncement, SPEECH_TEXT } from "@/lib/speech";
import { openingRevealDelay } from "@/lib/opening-reveal";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { unlockChime } from "@/lib/celebration-sound";
import { DisciplineCelebration } from "@/components/discipline-celebration";
import type { Celebration } from "@/lib/discipline/score";
import { useTerminalLayout, type TerminalLayout } from "@/lib/use-terminal-layout";
import { deriveMorningAlerts } from "@/lib/morning-alerts";
import {
  classifySendFailure,
  sendFailureMessage,
  sendFailureText,
  type LocalOrderFailure,
  type SendOutcome,
} from "@/lib/morning-orders";
import { INDEX_EMPTY_TEXT, indexAvailability } from "@/lib/morning-index";
import {
  replayClock,
  settledSession,
  withoutNewestMinute,
  type LiveMorningState,
} from "@/lib/morning-live";
import { adoptReply, type DeskResponse } from "@/lib/market/real-replay";
import type {
  MorningAction,
  MorningCatalog,
  MorningLessonSummary,
  MorningPlan,
  MorningReply,
  MorningResponse,
  MorningState,
  MorningUnavailable,
} from "@/lib/morning";
import type { RunRecord } from "@/lib/lessons/types";
import {
  RETIRED_TEXT,
  carryHeld,
  dateOptions,
  keepsDefaultNote,
  lessonDayLabel,
  previewCatalog,
  readOwnLists,
  rememberOwnList,
  sameCodes,
  shortDate,
} from "@/lib/lesson-choice";
import { cn, formatTime } from "@/lib/utils";
import { formatPrice } from "@/lib/market/ticks";
import {
  DESK_EMA_PERIODS,
  JIANGBO_BAND,
  candleWindow,
  showVolumeAndAverage,
} from "@/lib/market/chart-data";
import { deriveSwingHighs } from "@/lib/market/swing-highs";
import {
  MORNING_EXERCISES,
  getMorningExercise,
  type MorningExercise,
} from "@/lib/morning-exercises";

/** Phone and large-text tabs; the chart mode (江波／K線) is separate and shared by every layout. */
type MorningPane = "market" | "watch" | "trade" | "positions";
type ChartMode = "quote" | "chart";

/** The classroom has no daily lessons (none here, or none yet): the sentence to show, and the learner's records. */
const isUnavailable = (reply: MorningReply): reply is MorningUnavailable => "unavailable" in reply;

function readResponse(value: unknown): MorningReply {
  if (value && typeof value === "object" && "unavailable" in value && typeof value.unavailable === "string")
    return value as MorningUnavailable;
  if (!value || typeof value !== "object" || !("catalog" in value) || !("state" in value)) {
    throw new Error("教室回傳的資料不完整，請重試。");
  }
  return value as MorningResponse;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("暫時無法讀取教室回覆，請重試同一筆操作或重新載入進度。");
  }
}

async function readAccessProblem(
  response: Response,
): Promise<{ status: 401 | 403; message: string }> {
  let message = "";
  try {
    const payload: unknown = await response.json();
    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
    )
      message = payload.message;
  } catch {
    /* The status alone decides the card. */
  }
  return { status: response.status === 401 ? 401 : 403, message };
}

/**
 * How one request goes: `lesson` names the lesson in the URL (a start on the picked day, any action on its run's
 * lesson), so a retried start after a new day opened still goes to the day picked; without it, the page's own.
 * `adopt: false` leaves the desk as it is (the reply is only returned).
 */
type SendOptions = { lesson?: string; adopt?: boolean };

function useMorningData(lessonId: string) {
  const [data, setData] = useState<DeskResponse | null>(null);
  // No daily lessons in this classroom: the server's sentence (and the learner's records) instead of a desk.
  const [unavailable, setUnavailable] = useState<MorningUnavailable | null>(null);
  // The desk's data as last set: a step's reply carries no bars or trades, so they are kept from here, and a reply
  // without the date list, records or the day's picker keeps the ones held (carryHeld).
  const held = useRef<DeskResponse | null>(null);
  const keep = useCallback((value: DeskResponse | null) => {
    const next = value ? carryHeld(held.current, value) : null;
    held.current = next;
    setData(next);
    if (next) setUnavailable(null);
  }, []);
  const [busy, setBusy] = useState<MorningAction["action"] | "load" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [access, setAccess] = useState<{ status: 401 | 403; message: string } | null>(null);
  const locked = useRef(false);
  const serial = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryAction = useRef<MorningAction | undefined>(undefined);
  const retryOptions = useRef<SendOptions>({});
  const urlFor = useCallback(
    (lesson?: string) => {
      const target = lesson ?? lessonId;
      return target ? `/api/morning?lesson=${encodeURIComponent(target)}` : "/api/morning";
    },
    [lessonId],
  );
  /** A reply that says there are no daily lessons: the desk gives way to the sentence. */
  const showUnavailable = useCallback(
    (reply: MorningUnavailable) => {
      keep(null);
      setUnavailable(reply);
    },
    [keep],
  );

  // Every send reports its own outcome, so an order's 送出失敗 text never comes from another request.
  const send = useCallback(
    async (
      action?: MorningAction,
      options: SendOptions = {},
    ): Promise<{ response: DeskResponse | null; outcome: SendOutcome }> => {
      const quiet = (outcome: SendOutcome) => ({ response: null, outcome });
      if (locked.current) return quiet({ kind: "busy" });
      locked.current = true;
      const endpoint = urlFor(options.lesson);
      const requestSerial = ++serial.current;
      const abort = new AbortController();
      controller.current = abort;
      const current = () => requestSerial === serial.current;
      let timedOut = false;
      const deadline = window.setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, 20_000);
      setBusy(action?.action ?? "load");
      setError("");
      setNotice("");
      retryAction.current = action;
      retryOptions.current = options;
      // Why a 409 refused the action, kept for 委託回報 even if the reload after it fails.
      let conflictReason: string | undefined;
      // The status of the action's own reply, once one arrived.
      let status: number | undefined;
      try {
        const response = await fetch(endpoint, {
          method: action ? "POST" : "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
          ...(action
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }
            : {}),
        });
        if (!current()) return quiet({ kind: "stale" });
        status = response.status;
        if (response.status === 401 || response.status === 403) {
          setAccess(await readAccessProblem(response));
          keep(null);
          retryAction.current = undefined;
          return quiet({ kind: "access" });
        }
        if (response.status === 409) {
          retryAction.current = undefined;
          // The server's reason (e.g. 本次練習已達委託筆數上限) goes to 委託回報 when an order was refused.
          const refusal = (await readJsonResponse(response).catch(() => null)) as {
            message?: unknown;
          } | null;
          const reason =
            typeof refusal?.message === "string" && refusal.message ? refusal.message : "";
          conflictReason = reason;
          const latest = await fetch(endpoint, {
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
          });
          if (!current()) return quiet({ kind: "stale" });
          if (latest.status === 401 || latest.status === 403) {
            setAccess(await readAccessProblem(latest));
            keep(null);
            return quiet({ kind: "access" });
          }
          if (!latest.ok) throw new Error("進度已在另一個分頁更新，請重新載入最新進度。");
          const fresh = readResponse(await readJsonResponse(latest));
          if (!current()) return quiet({ kind: "stale" });
          if (isUnavailable(fresh)) showUnavailable(fresh);
          else keep(adoptReply(null, fresh) ?? fresh);
          // The server's own reason when it gave one (e.g. 本次練習已達委託筆數上限), as in 委託回報. A start
          // refused for its stocks' data says which ones to pick again; nothing was playing then.
          setNotice(
            action?.action === "start" && reason
              ? `${reason}。`
              : `${reason || "進度已更新，可能有另一個分頁正在操作"}。已同步最新紀錄並停止自動播放；請核對後再繼續。`,
          );
          return quiet({ kind: "conflict", reason });
        }
        const payload = await readJsonResponse(response);
        if (!current()) return quiet({ kind: "stale" });
        if (!response.ok) {
          const message =
            payload &&
            typeof payload === "object" &&
            "message" in payload &&
            typeof payload.message === "string"
              ? payload.message
              : "這次操作尚未完成，請重試或重新載入進度。";
          throw new Error(message);
        }
        const reply = readResponse(payload);
        if (isUnavailable(reply)) {
          showUnavailable(reply);
          setAccess(null);
          retryAction.current = undefined;
          return quiet({ kind: "access" });
        }
        if (options.adopt === false) {
          setAccess(null);
          retryAction.current = undefined;
          return { response: reply, outcome: { kind: "sent" } };
        }
        let next = adoptReply(held.current, reply);
        if (!next && reply.state) {
          // The advance revealed a cell the desk cannot add after its own (a retried advance answered with a later
          // cell, or another tab moved the run on): load the run as it is now, by its lesson.
          const snapshot = await fetch(urlFor(reply.state.lessonId), {
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
          });
          if (!current()) return quiet({ kind: "stale" });
          if (snapshot.status === 401 || snapshot.status === 403) {
            setAccess(await readAccessProblem(snapshot));
            keep(null);
            retryAction.current = undefined;
            return quiet({ kind: "access" });
          }
          if (!snapshot.ok) throw new Error("進度已在另一個分頁更新，請重新載入最新進度。");
          const fresh = readResponse(await readJsonResponse(snapshot));
          if (!current()) return quiet({ kind: "stale" });
          if (isUnavailable(fresh)) {
            showUnavailable(fresh);
            retryAction.current = undefined;
            return quiet({ kind: "access" });
          }
          next = adoptReply(null, fresh) ?? fresh;
        }
        keep(next ?? reply);
        setAccess(null);
        retryAction.current = undefined;
        return { response: held.current, outcome: { kind: "sent" } };
      } catch (failure) {
        if (current()) {
          const facts = { timedOut, networkError: failure instanceof TypeError, status, conflictReason };
          const message = sendFailureText({
            ...facts,
            errorMessage: failure instanceof Error ? failure.message : undefined,
          });
          setError(message);
          return quiet(classifySendFailure({ ...facts, message }));
        }
        return quiet({ kind: "stale" });
      } finally {
        window.clearTimeout(deadline);
        if (current()) {
          locked.current = false;
          setBusy(null);
        }
      }
    },
    [urlFor, keep, showUnavailable],
  );
  const request = useCallback(
    async (action?: MorningAction, options?: SendOptions): Promise<DeskResponse | null> =>
      (await send(action, options)).response,
    [send],
  );
  /**
   * After a run ends: the learner's records (a step's reply has none), the day's picker for a new round and the date
   * list, read in the background by the run's lesson and added to what the desk holds. A failure leaves it as it is.
   */
  const refresh = useCallback(
    async (lesson: string) => {
      try {
        const response = await fetch(urlFor(lesson), { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const reply = readResponse(await response.json());
        const desk = held.current;
        if (!desk || isUnavailable(reply)) return;
        const next: DeskResponse = { ...desk };
        if (reply.records) next.records = reply.records;
        if (reply.lessons) next.lessons = reply.lessons;
        if (reply.picker && reply.picker.lessonId === (desk.state?.lessonId ?? desk.catalog.lessonId))
          next.picker = reply.picker;
        keep(next);
      } catch {
        /* The records wait for the next load. */
      }
    },
    [urlFor, keep],
  );

  useEffect(() => {
    void request();
    return () => {
      serial.current += 1;
      controller.current?.abort();
      locked.current = false;
    };
  }, [request]);

  return {
    data,
    unavailable,
    busy,
    error,
    notice,
    access,
    request,
    retry: () => request(retryAction.current, retryOptions.current),
    send,
    refresh,
  };
}

export function MorningPractice({
  exerciseId,
  lessonId,
  initialPane,
  coach = false,
  fresh = false,
  onLessonChange,
}: {
  exerciseId?: string;
  lessonId: string;
  initialPane?: "trade";
  coach?: boolean;
  fresh?: boolean;
  onLessonChange: (lessonId: string) => void;
}) {
  const { user, guest, isPending, status, retry } = useGuestBootstrap();
  const [selectedExercise, setSelectedExercise] = useState(
    () => getMorningExercise(exerciseId)?.id ?? MORNING_EXERCISES[0].id,
  );
  // The open days as last listed: a start's reply and a retired run's page carry none, and the desk is mounted
  // again for each lesson, so the date menus keep them here.
  const [knownLessons, setKnownLessons] = useState<MorningLessonSummary[]>();
  // A day picked in the picker opens a new round on it, even when its latest run is finished.
  const [freshLesson, setFreshLesson] = useState<string | null>(null);
  if (status === "pending")
    return (
      <PageFrame>
        <p role="status" className={CARD}>
          {isPending ? "正在確認登入狀態…" : "正在準備練習…"}
        </p>
      </PageFrame>
    );
  if (status === "failed")
    return (
      <PageFrame>
        <AccessCard problem={describeAccessProblem(401, "")} busy={false} onRetry={retry} />
      </PageFrame>
    );
  return (
    <MorningLesson
      key={`${user?.id ?? guest?.id ?? "none"}:${lessonId}`}
      guest={Boolean(guest)}
      coach={coach}
      fresh={fresh || (lessonId !== "" && freshLesson === lessonId)}
      lessonId={lessonId}
      initialPane={initialPane}
      exerciseId={selectedExercise}
      knownLessons={knownLessons}
      onLessons={setKnownLessons}
      onLessonChange={(next, options) => {
        setFreshLesson(options?.fresh ? next : null);
        onLessonChange(next);
      }}
      onExerciseChange={setSelectedExercise}
    />
  );
}

function MorningLesson({
  guest,
  coach,
  fresh,
  lessonId,
  exerciseId,
  initialPane,
  knownLessons,
  onLessons,
  onLessonChange,
  onExerciseChange,
}: {
  guest: boolean;
  coach: boolean;
  fresh: boolean;
  lessonId: string;
  exerciseId: string;
  initialPane?: "trade";
  knownLessons?: MorningLessonSummary[];
  onLessons: (lessons: MorningLessonSummary[]) => void;
  /** `fresh`: open a new round on that day (picked in the picker), not its last finished run. */
  onLessonChange: (lessonId: string, options?: { fresh?: boolean }) => void;
  onExerciseChange: (exerciseId: string) => void;
}) {
  const { data, unavailable, busy, error, notice, access, request, retry, send, refresh } =
    useMorningData(lessonId);
  const [linkNotice, setLinkNotice] = useState<LinkNotice | null>(null);
  useEffect(() => {
    const value = readLinkNotice(document.cookie);
    if (!value) return;
    document.cookie = clearLinkNoticeCookie();
    setLinkNotice(value);
  }, []);
  const selectedExercise = exerciseId;
  const mode = useDisplayPreferences((value) => value.mode);
  const layout = useTerminalLayout(mode === "senior");
  const [selected, setSelected] = useState("");
  const [activePane, setActivePane] = useState<MorningPane>(initialPane ?? "market");
  // The ±10% 江波 view opens first (2026-10-21); K線 is one tap away.
  const [chartMode, setChartMode] = useState<ChartMode>("quote");
  const [auto, setAuto] = useState(false);
  const [extended, setExtended] = useState(false);
  const [newPlan, setNewPlan] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const planRegion = useRef<HTMLDivElement>(null);
  const autoPlanned = useRef(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const say = useSay();
  // Fills are read out only when they happen while watching, not when progress loads.
  const heardFills = useRef<{ id: string; count: number } | null>(null);
  // First start on this device (or ?coach=1) shows the hints once 09:00 is on screen.
  const coachPending = useRef(coach);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  // Sends that failed in this visit (server refusal or a dropped connection), listed in 委託回報.
  const [failures, setFailures] = useState<LocalOrderFailure[]>([]);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourcesHeading = useRef<HTMLHeadingElement>(null);
  const [clock, setClock] = useState(() => Date.now());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const practiceHeading = useRef<HTMLHeadingElement>(null);
  const session = data?.state;
  const sessionId = session?.id;
  const showPlan = !session || newPlan;
  // A retired lesson's run: text only (no chart, no advancing or orders), it can only be finished or abandoned.
  const retired = Boolean(data?.retired && session);
  // The day's stocks and default list, for a new run (a GET's, kept while a run of that day is on screen).
  const picker = data?.picker;
  // The stocks picked for the next run: the day's default list until the learner changes it, and again for each
  // new run (list decision F).
  const [choice, setChoice] = useState<{ lessonId: string; codes: string[] } | null>(null);
  const pickedCodes = useMemo(
    () => (picker ? (choice?.lessonId === picker.lessonId ? choice.codes : picker.defaults) : []),
    [picker, choice],
  );
  const runLesson = session?.lessonId;
  const runCodes = session?.codes?.join(",") ?? "";
  // What the desk shows: before a run, the picked stocks (the 「預設」 note only while they are the day's
  // defaults); during one, its stocks, without the day's note when they are not the default list (the server
  // attaches the day's note to every run of the day).
  const catalog = useMemo(() => {
    const raw = data?.catalog;
    if (!raw) return raw;
    if (showPlan) return picker && picker.lessonId === raw.lessonId ? previewCatalog(raw, picker, pickedCodes) : raw;
    if (!raw.note || !sessionId) return raw;
    const keeps = keepsDefaultNote({
      runId: sessionId,
      runCodes: runCodes ? runCodes.split(",") : [],
      defaults: picker && picker.lessonId === runLesson ? picker.defaults : null,
      ownLists: readOwnLists(browserStorage()),
    });
    if (keeps) return raw;
    const own = { ...raw };
    delete own.note;
    return own;
  }, [data?.catalog, showPlan, picker, pickedCodes, sessionId, runLesson, runCodes]);
  const lessons = data?.lessons ?? knownLessons;
  useEffect(() => {
    if (data?.lessons) onLessons(data.lessons);
  }, [data?.lessons, onLessons]);
  const lessonOnScreen = catalog ? { lessonId: catalog.lessonId, date: catalog.date, retired } : undefined;
  const dates = dateOptions(lessons ?? [], lessonOnScreen);
  const cursor = session?.cursor ?? 0;
  const completed = session?.completed ?? false;
  const exercise = getMorningExercise(
    session && !newPlan ? session.plan.exerciseId : selectedExercise,
  );
  const atCheckpoint = cursor === 60 && !extended && !completed;
  const atEnd = Boolean(catalog && cursor >= catalog.maxCursor);
  const nextAdvanceAt = session?.nextAdvanceAt ?? 0;
  const canAdvance = Boolean(
    session && !completed && !atCheckpoint && !atEnd && !busy && clock >= nextAdvanceAt,
  );
  const onDesk = (value: string | undefined) =>
    Boolean(value && catalog?.symbols.some((symbol) => symbol.code === value));
  // The stock shown: the one picked, else the run's 主角股, else the first (a stock left out of the picked list in
  // a new plan's preview is never shown).
  const code = onDesk(selected)
    ? selected
    : onDesk(session?.plan.focusCode)
      ? session!.plan.focusCode
      : (catalog?.symbols[0]?.code ?? "");
  const singlePane = layout === "phone" || layout === "senior";
  // The stock whose recorded books the next advance asks for, read when the auto-advance timer fires (so picking
  // another stock never restarts the wait). Its books come with the advance after the pick; until then the desk
  // shows the real best bid and ask.
  const viewing = useRef(code);
  useEffect(() => {
    viewing.current = code;
  }, [code]);
  // Clicking the TAIEX row on a desktop points at the index pane (it is always shown there).
  const [indexPing, setIndexPing] = useState(0);
  // Phones: the TAIEX row in 自選 turns 行情 into the index view until a stock is picked; the view belongs to
  // the run it was picked in, so a new run opens on its stock.
  const runKey = sessionId ?? "plan";
  const [indexViewFor, setIndexViewFor] = useState<string | null>(null);
  const indexView = indexViewFor === runKey;
  // Phones: a price tapped in the 行情 book, handed to 下單 for that stock (filled in, never sent).
  const [prefill, setPrefill] = useState<{
    price: number;
    side: "buy" | "sell";
    nonce: number;
    code: string;
  }>();
  // Desktops: the TAIEX row moves focus to the 大盤 pane it points at.
  const indexPane = useRef<HTMLDivElement>(null);
  // The plan chip opens 教材 at the round's plan, expanded.
  const planDetails = useRef<HTMLDetailsElement>(null);
  const [planFocus, setPlanFocus] = useState(0);
  useEffect(() => {
    if (activePane !== "trade") setPrefill(undefined);
  }, [activePane]);
  useEffect(() => {
    setPrefill(undefined);
  }, [code]);

  useEffect(() => {
    setAuto(false);
    setNewPlan(false);
    setPlanOpen(false);
    setExtended(false);
    setReviewOpen(false);
    setFeedback("");
    setFailures([]);
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(0, nextAdvanceAt - Date.now()) + 30,
    );
    return () => window.clearTimeout(timer);
  }, [nextAdvanceAt]);

  useEffect(() => {
    const stop = () => {
      if (document.hidden) setAuto(false);
    };
    const leave = () => setAuto(false);
    document.addEventListener("visibilitychange", stop);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", stop);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  useEffect(() => {
    if (!auto || !session || session.completed || busy || atCheckpoint || atEnd || error || notice)
      return;
    const timer = window.setTimeout(
      () => {
        if (document.hidden) {
          setAuto(false);
          return;
        }
        void request(
          {
            action: "advance",
            requestId: crypto.randomUUID(),
            id: session.id,
            expectedRevision: session.revision,
            ...bookView(session, viewing.current),
          },
          { lesson: session.lessonId },
        ).then((result) => {
          if (
            !result?.state ||
            result.state.cursor === 60 ||
            result.state.cursor >= result.catalog.maxCursor
          )
            setAuto(false);
        });
      },
      Math.max(REPLAY_DELAY[speed], nextAdvanceAt - Date.now() + 30),
    );
    return () => window.clearTimeout(timer);
  }, [auto, session, busy, atCheckpoint, atEnd, error, notice, nextAdvanceAt, request, speed]);

  useEffect(() => {
    if (resourcesOpen) resourcesHeading.current?.focus({ preventScroll: true });
  }, [resourcesOpen]);

  // After the heading focus above: the plan chip lands on the plan, opened.
  useEffect(() => {
    const plan = planDetails.current;
    if (!planFocus || !plan) return;
    plan.open = true;
    plan.scrollIntoView({ block: "nearest", behavior: "auto" });
    plan.querySelector("summary")?.focus({ preventScroll: true });
  }, [planFocus]);

  useEffect(() => {
    if (planOpen) planRegion.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [planOpen]);

  useEffect(() => {
    const run = data?.state;
    if (!run || !catalog) return;
    const previous = heardFills.current;
    heardFills.current = { id: run.id, count: run.fills.length };
    if (!previous || previous.id !== run.id || run.fills.length <= previous.count) return;
    const fill = run.fills[run.fills.length - 1];
    say(
      fillAnnouncement(
        fill,
        catalog.symbols.find((symbol) => symbol.code === fill.code)?.name ?? fill.code,
      ),
    );
  }, [data?.state, catalog, say]);

  const activeRun = Boolean(data?.state && !data.state.completed);
  useEffect(() => {
    if (!coachPending.current || !activeRun || (data?.state?.cursor ?? 0) === 0) return;
    coachPending.current = false;
    // Step 1 talks about the chart; on one-pane layouts it must be the visible pane.
    setActivePane("market");
    setCoachOpen(true);
  }, [activeRun, data?.state?.cursor]);
  function closeCoach() {
    setCoachOpen(false);
    writeCoachSeen(browserStorage());
  }

  // Decided once, on the first load: no run yet, or the lobby asked for a new round after a finished
  // one, opens the plan right away (lobby tap + start tap = 09:00). An unfinished run is never
  // replaced, and finishing a round later in this page keeps its completion screen.
  useEffect(() => {
    if (!data || autoPlanned.current) return;
    autoPlanned.current = true;
    if (data.state === null) setPlanOpen(true);
    else if (fresh && data.state.completed && !data.retired) {
      setNewPlan(true);
      setPlanOpen(true);
    }
  }, [data, fresh]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!reviewOpen) return;
    reviewHeading.current?.focus({ preventScroll: true });
    reviewHeading.current?.scrollIntoView({ block: "start" });
  }, [reviewOpen]);

  async function advance() {
    if (!session || !canAdvance) return;
    setAuto(false);
    const next = await request(
      {
        action: "advance",
        requestId: crypto.randomUUID(),
        id: session.id,
        expectedRevision: session.revision,
        ...bookView(session, code),
      },
      { lesson: session.lessonId },
    );
    if (next?.state)
      setFeedback(
        `已前進至 ${formatTime(next.state.cursor * 60).slice(0, 5)}。${next.state.fills.length > session.fills.length ? "本分鐘有新的紙上成交，請核對下方紀錄。" : ""}`,
      );
  }

  function openReview() {
    setAuto(false);
    setReviewOpen(true);
  }

  async function start(plan: MorningPlan) {
    // The picked day's stocks; without its picker there is nothing to start on (the plan waits for it).
    if (!picker) return;
    const codes = pickedCodes;
    setAuto(false);
    // Said inside the tap: iPhone only allows speech that starts from one.
    say(SPEECH_TEXT.start);
    const next = await request(
      {
        action: "start",
        requestId: crypto.randomUUID(),
        plan,
        codes,
        ...(guest ? { guestTerms: true as const } : {}),
      },
      // The day picked, in the URL: a retried start after a newer day opened still starts on it.
      { lesson: picker.lessonId },
    );
    const receivedAt = Date.now();
    if (next?.state) {
      // The 自選 title keeps the day's 「預設」 note only on the default list, after a reload too (this device).
      if (!sameCodes(next.state.codes ?? codes, picker.defaults))
        rememberOwnList(browserStorage(), next.state.id);
      // The next run starts from the day's default list again (list decision F).
      setChoice(null);
      setNewPlan(false);
      setSelected(plan.focusCode);
      setPlanOpen(false);
      // Show the chart, then reveal 09:00 by itself; playing on stays the learner's choice.
      setActivePane("market");
      if (!readCoachSeen(browserStorage())) coachPending.current = true;
      window.requestAnimationFrame(() => {
        practiceHeading.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "auto" });
      });
      if (next.state.cursor === 0) {
        const opening = next.state;
        // Timed from the reply, never from nextAdvanceAt: a fast phone clock would be refused.
        await new Promise((resolve) =>
          window.setTimeout(resolve, openingRevealDelay(receivedAt, Date.now())),
        );
        if (!mounted.current) return;
        await request(
          {
            action: "advance",
            requestId: crypto.randomUUID(),
            id: opening.id,
            expectedRevision: opening.revision,
            // The run opens on its 主角股, whose books the first minute brings.
            view: plan.focusCode,
          },
          { lesson: opening.lessonId },
        );
      }
    }
  }

  async function order(
    side: "buy" | "sell",
    lots: number,
    revision: number,
    options?: MorningOrderOptions,
  ) {
    if (!session || session.revision !== revision) return false;
    setAuto(false);
    const requestId = crypto.randomUUID();
    const sent = await send(
      {
        action: "order",
        requestId,
        id: session.id,
        expectedRevision: session.revision,
        code,
        side,
        lots,
        ...options,
      },
      { lesson: session.lessonId },
    );
    const next = sent.response;
    if (next?.state)
      setFeedback("紙上委託已記錄，尚未代表成交。前進一分鐘後，請核對委託與成交紀錄。");
    else {
      const message = sendFailureMessage(sent.outcome);
      if (message)
        setFailures((list) =>
          [
            ...list,
            {
              id: crypto.randomUUID(),
              cursor: session.cursor,
              code,
              side,
              lots,
              ...(options?.limitPrice === undefined ? {} : { limitPrice: options.limitPrice }),
              message,
              ...(sent.outcome.kind === "unknown" ? { unknown: true } : {}),
              requestId,
            },
          ].slice(-20),
        );
    }
    return Boolean(next?.state);
  }

  async function cancel(orderId: string) {
    if (!session) return;
    setAuto(false);
    const next = await request(
      {
        action: "cancel",
        requestId: crypto.randomUUID(),
        id: session.id,
        expectedRevision: session.revision,
        orderId,
      },
      { lesson: session.lessonId },
    );
    if (next?.state) setFeedback("已更新撤單結果，請核對委託狀態。");
  }

  async function finish(reflection: string) {
    if (!session) return;
    setAuto(false);
    // Browsers start audio only inside a tap; the chime itself plays when the points come back.
    if (useDisplayPreferences.getState().sound) unlockChime();
    const next = await request(
      {
        action: "finish",
        requestId: crypto.randomUUID(),
        id: session.id,
        expectedRevision: session.revision,
        reflection,
      },
      { lesson: session.lessonId },
    );
    if (next?.state?.completed) {
      say(SPEECH_TEXT.finish);
      setReviewOpen(false);
      setFeedback("這一輪的計畫、操作與復盤已保存。");
      window.requestAnimationFrame(() => practiceHeading.current?.focus({ preventScroll: true }));
      // The finish reply has no records: the list (and the day's picker for another round) comes from a GET.
      void refresh(next.state.lessonId);
    }
  }

  /**
   * 放棄這局 (asked first): the run ends without a reflection and never counts. A daily lesson's day opens its
   * picker again on the default list; a retired run stays on its page, now given up.
   */
  async function abandon() {
    if (!session || session.completed) return;
    setAuto(false);
    const lesson = session.lessonId;
    const next = await request(
      { action: "abandon", requestId: crypto.randomUUID(), id: session.id, expectedRevision: session.revision },
      { lesson },
    );
    if (!next?.state?.completed) return;
    setReviewOpen(false);
    setResourcesOpen(false);
    await refresh(lesson);
    if (!mounted.current || retired) return;
    setChoice(null);
    setNewPlan(true);
    setPlanOpen(true);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /** The unfinished run that cannot be opened now: given up by its id, then the page loads without it. */
  async function abandonBlocked(blocked: NonNullable<DeskResponse["blockedRun"]>) {
    setAuto(false);
    const done = await request(
      { action: "abandon", requestId: crypto.randomUUID(), id: blocked.id, expectedRevision: blocked.revision },
      { lesson: blocked.lessonId, adopt: false },
    );
    if (!done || !mounted.current) return;
    const fresh = await request();
    // The page's lesson may now open on the run just given up: a new round on that day instead.
    if (fresh?.state?.completed && !fresh.retired) {
      setChoice(null);
      setNewPlan(true);
      setPlanOpen(true);
    } else if (fresh && !fresh.state) setPlanOpen(true);
  }

  /** A run in the records: its lesson opens (on its latest run); the run on screen just comes back into view. */
  function openRecord(record: RunRecord) {
    setAuto(false);
    if (session && record.id === session.id) {
      setNewPlan(false);
      setPlanOpen(false);
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    if (record.lessonId === lessonId) {
      setNewPlan(false);
      setPlanOpen(false);
      void request();
      return;
    }
    onLessonChange(record.lessonId);
  }

  const marketSession = newPlan ? null : session;
  // The recorded book of the newest minute (one stock's); a new plan's preview has none.
  const deskBook = newPlan ? undefined : data?.book;
  const pendingOrder = marketSession?.orders.find((item) => item.status === "pending");
  // What the desk shows: a newly revealed minute plays trade by trade. Orders use the same run and revision.
  const liveMarket = useTickReplay(marketSession ?? null, catalog, REPLAY_DELAY[speed] * 0.9);
  // Alerts and minute tables wait for the replaying minute to finish, so nothing is announced ahead of it.
  const replaying = Boolean(liveMarket?.replay);
  const settled = useMemo(
    () =>
      marketSession && replaying ? withoutNewestMinute(marketSession) : (marketSession ?? null),
    [marketSession, replaying],
  );
  // The lesson's approved notice about the simulated replay greets learners at the top of the desk.
  const replayNotice = catalog?.notices.find((text) => text.includes("模擬逐筆"));
  const orderTicket = catalog ? (
    <PaperOrder
      key={`${marketSession?.id ?? "preview"}:${code}`}
      catalog={catalog}
      session={liveMarket}
      book={deskBook}
      code={code}
      busy={Boolean(busy || error || notice)}
      sending={busy === "order"}
      atEnd={atEnd && !showPlan}
      canAdvance={canAdvance && !showPlan && !error && !notice}
      onSelect={setSelected}
      onPrepare={() => setPlanOpen(true)}
      onReview={() => setAuto(false)}
      onAdvance={advance}
      onOrder={order}
      onCancel={cancel}
      failures={failures}
      variant={singlePane ? "phone" : "desk"}
      prefill={singlePane ? prefill : undefined}
    />
  ) : null;
  const chartBar = catalog ? (
    <ChartToolbar
      catalog={catalog}
      code={code}
      mode={chartMode}
      onMode={setChartMode}
      onSelect={setSelected}
      stepper={!singlePane}
    />
  ) : null;
  const replayClockText = liveMarket ? formatTime(replayClock(liveMarket)) : "09:00:00";
  // Before 09:00 is revealed the pane waits; only a run without index data says the lesson has none.
  const indexState = indexAvailability({
    hasRun: Boolean(marketSession),
    series: liveMarket?.index,
  });
  const indexEmptyText = indexState === "ready" ? "" : INDEX_EMPTY_TEXT[indexState];
  const indexPanel = (
    <IndexPanel series={liveMarket?.index} clock={replayClockText} placeholder={indexEmptyText} />
  );
  const alerts = useMemo(
    () => (catalog && settled ? deriveMorningAlerts(catalog, settled) : []),
    [catalog, settled],
  );
  const latestAlert = alerts.at(-1);
  const latestFill = [...alerts].reverse().find((alert) => alert.kind === "fill");
  const accessCard = access ? (
    <AccessCard
      problem={describeAccessProblem(access.status, access.message)}
      busy={Boolean(busy)}
      onRetry={() => void request()}
    />
  ) : null;
  const banners = (
    <>
      {error && (
        <div role="alert" className="td-banner">
          <p>{error}</p>
          <p className="mt-1 text-sm text-muted">
            操作不會自動重送。請重試同一筆，或重新載入後核對紀錄。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setAuto(false);
                void retry();
              }}
              className={SECONDARY}
            >
              重試這次操作
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setAuto(false);
                void request();
              }}
              className={SECONDARY}
            >
              重新載入進度
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div role="status" className="td-banner">
          <p>{notice}</p>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void request()}
            className={cn(SECONDARY, "mt-3")}
          >
            已核對，載入目前進度
          </button>
        </div>
      )}
    </>
  );

  // Before a run: the day and its stocks (beside the plan on desktops and tablets, inside its card elsewhere).
  const setup =
    picker && catalog ? (
      <LessonPicker
        picker={picker}
        dates={dateOptions(lessons ?? [], picker)}
        codes={pickedCodes}
        busy={Boolean(busy)}
        folded={singlePane}
        onDate={(next) => {
          setAuto(false);
          onLessonChange(next, { fresh: true });
        }}
        onCodes={(codes) => setChoice({ lessonId: picker.lessonId, codes })}
      />
    ) : catalog ? (
      <div className={cn(CARD, "td-picker")} role="status">
        <p>正在讀取這天可練習的股票…</p>
        <button
          type="button"
          className="td-button"
          disabled={Boolean(busy)}
          onClick={() => void refresh(catalog.lessonId)}
        >
          重新讀取
        </button>
      </div>
    ) : null;

  // No daily lessons in this classroom (none here, or none yet): the practice area says so and nothing else; the
  // learner's own runs still list (a retired lesson's open without daily lessons).
  if (unavailable && !data)
    return (
      <PageFrame layout={layout}>
        {accessCard ?? (
          <>
            {banners}
            <section className="td-unavailable" aria-label="真實行情練習">
              <p role="status">{unavailable.unavailable}</p>
            </section>
            {unavailable.records && (
              <RunRecords records={unavailable.records} busy={Boolean(busy)} onOpen={openRecord} />
            )}
          </>
        )}
      </PageFrame>
    );

  // A retired lesson's run (spec §9, decision R): plan, orders, fills, P/L and the review as text, no chart; it can
  // only be finished with a review or given up.
  if (retired && session && catalog)
    return (
      <PageFrame
        layout={layout}
        bar={
          <DeskBar>
            <LessonSelect
              options={dates}
              lessonId={catalog.lessonId}
              disabled={Boolean(busy)}
              onChange={(next) => onLessonChange(next, { fresh: true })}
            />
          </DeskBar>
        }
      >
        {accessCard ?? (
          <>
            {banners}
            <RetiredRun
              catalog={catalog}
              session={session}
              celebration={data?.celebration ?? null}
              records={data?.records ?? []}
              busy={Boolean(busy)}
              saving={busy === "finish"}
              cards={singlePane}
              onFinish={finish}
              onAbandon={() => void abandon()}
              onOpenRecord={openRecord}
            />
          </>
        )}
      </PageFrame>
    );

  return (
    <PageFrame
      layout={layout}
      bar={
        data && catalog ? (
          <StatusBar
            lessons={dates}
            lessonId={catalog.lessonId}
            exercise={exercise}
            session={liveMarket}
            showPlan={showPlan}
            cursor={cursor}
            completed={completed}
            auto={auto}
            speed={speed}
            busy={Boolean(busy)}
            playDisabled={
              Boolean(busy) || atCheckpoint || atEnd || completed || Boolean(error || notice)
            }
            canAdvance={canAdvance && !error && !notice}
            reviewDisabled={Boolean(busy) || completed}
            resourcesOpen={resourcesOpen}
            onLessonChange={(next) => {
              setAuto(false);
              // From the plan, another day opens its own plan; from a run, the day as it was left.
              onLessonChange(next, { fresh: showPlan });
            }}
            onStartPlan={() => setPlanOpen(true)}
            onTogglePlay={() => {
              setFeedback("");
              setAuto((value) => !value);
            }}
            onSpeed={setSpeed}
            onAdvance={() => void advance()}
            onReview={openReview}
            onResources={() => setResourcesOpen((value) => !value)}
          />
        ) : undefined
      }
      hints={
        data && catalog ? (
          <HintBar
            plan={
              marketSession && !showPlan
                ? {
                    code: marketSession.plan.focusCode,
                    label:
                      marketSession.plan.bias === "bullish"
                        ? "偏多觀察"
                        : marketSession.plan.bias === "bearish"
                          ? "偏空觀察"
                          : "等待條件",
                    onOpen: () => {
                      setResourcesOpen(true);
                      setPlanFocus((value) => value + 1);
                    },
                  }
                : undefined
            }
            tip={exercise?.principle}
            alert={latestAlert}
            announcement={latestFill?.text}
            feedback={showPlan ? "" : feedback}
          >
            {linkNotice && (
              <LinkNoticeBanner notice={linkNotice} onDismiss={() => setLinkNotice(null)} />
            )}
            {guest && <GuestBanner compact={layout === "desktop"} />}
            {data.blockedRun && (
              <div role="status" className="td-banner td-blocked">
                <p>
                  {lessonDayLabel(data.blockedRun.date)}未完成的那一局暫時打不開：
                  {data.blockedRun.message}
                </p>
                <AbandonRun
                  label="放棄這局"
                  busy={Boolean(busy)}
                  onConfirm={() => {
                    if (data.blockedRun) void abandonBlocked(data.blockedRun);
                  }}
                />
              </div>
            )}
            {atCheckpoint && !showPlan && (
              <div role="status" className="td-banner">
                <h2>10:00，回看自己的計畫</h2>
                <p>主要練習時段已結束。可以寫復盤，或選擇延伸至 10:30；系統不會自動平倉。</p>
                <div className="td-banner-actions">
                  <button
                    type="button"
                    className="td-button"
                    data-variant="primary"
                    onClick={openReview}
                  >
                    現在寫復盤
                  </button>
                  <button type="button" className="td-button" onClick={() => setExtended(true)}>
                    延伸觀察至 10:30
                  </button>
                </div>
              </div>
            )}
            {atEnd && !completed && !showPlan && (
              <p role="status" className="td-banner">
                已到 {catalog.end}
                ，本課沒有下一分鐘。請核對委託與剩餘庫存，再保存復盤；系統不會自動平倉。
              </p>
            )}
          </HintBar>
        ) : undefined
      }
    >
      {accessCard ?? (
        <>
          {banners}
          {!data && busy && (
            <p role="status" className="td-loading">
              正在載入歷史行情與已保存的進度…
            </p>
          )}
          {data && catalog && (
            <>
              <section
                className="td-workbench"
                data-layout={layout}
                data-active-pane={activePane}
                data-plan-open={showPlan && planOpen}
                aria-label={showPlan ? "當沖大富翁交易盤預覽" : "真實 K 線模擬交易盤"}
              >
                {!singlePane && (
                  <div className="td-watch" data-pane="watch">
                    <WatchTable
                      catalog={catalog}
                      session={liveMarket}
                      book={deskBook}
                      code={code}
                      compact={layout === "tablet"}
                      onSelect={setSelected}
                      onIndex={
                        layout === "desktop"
                          ? () => {
                              setIndexPing((value) => value + 1);
                              indexPane.current
                                ?.querySelector<HTMLElement>(".td-index-panel")
                                ?.focus({ preventScroll: true });
                            }
                          : undefined
                      }
                    />
                  </div>
                )}
                {layout === "desktop" && (
                  <div className="td-index" data-pane="index" ref={indexPane}>
                    {indexPing > 0 && (
                      <span key={indexPing} className="td-index-ping" aria-hidden />
                    )}
                    {indexPanel}
                  </div>
                )}
                <div className="td-center" data-pane="center">
                  {singlePane && replayNotice && (
                    <ReplayNotice key={replayNotice} text={replayNotice} />
                  )}
                  {singlePane && (activePane !== "market" || indexView) && (
                    <h1 className="sr-only" ref={practiceHeading} tabIndex={-1}>
                      真實歷史行情・模擬交易工作台
                    </h1>
                  )}
                  {(!singlePane || (activePane === "market" && !indexView)) && (
                    <>
                      <QuoteHero
                        catalog={catalog}
                        session={liveMarket}
                        book={deskBook}
                        code={code}
                        titleRef={practiceHeading}
                        onSelect={singlePane ? setSelected : undefined}
                        clock={singlePane ? replayClockText : undefined}
                      />
                      {chartBar}
                    </>
                  )}
                  <div className="td-pane">
                    {singlePane && activePane === "market" && indexView && indexPanel}
                    {(!singlePane || (activePane === "market" && !indexView)) && (
                      <div className="td-chart-row">
                        {!singlePane && replayNotice && (
                          <ReplayNotice key={replayNotice} text={replayNotice} floating />
                        )}
                        <MorningChart
                          catalog={catalog}
                          session={liveMarket}
                          code={code}
                          candles={chartMode === "chart"}
                        />
                      </div>
                    )}
                    {singlePane && activePane === "market" && !indexView && (
                      <StockTabs
                        tabs={[
                          {
                            id: "book",
                            label: "五檔",
                            content: (
                              <DisplayBook
                                catalog={catalog}
                                session={liveMarket}
                                book={deskBook}
                                code={code}
                                onPick={(price, side) => {
                                  setPrefill({ price, side, nonce: Date.now(), code });
                                  setActivePane("trade");
                                  window.scrollTo({ top: 0, behavior: "auto" });
                                }}
                              />
                            ),
                          },
                          {
                            id: "tape",
                            label: "明細",
                            content: (
                              <TradeTape catalog={catalog} session={liveMarket} code={code} />
                            ),
                          },
                          {
                            id: "detail",
                            label: "詳細",
                            content: (
                              <>
                                <QuoteDetailGrid
                                  catalog={catalog}
                                  session={liveMarket}
                                  code={code}
                                />
                                <MinuteTable session={liveMarket} code={code} />
                              </>
                            ),
                          },
                        ]}
                      />
                    )}
                    {singlePane && activePane === "watch" && (
                      <WatchTable
                        catalog={catalog}
                        session={liveMarket}
                        book={deskBook}
                        code={code}
                        compact
                        indexSelected={indexView}
                        onSelect={(next) => {
                          setSelected(next);
                          setIndexViewFor(null);
                          setActivePane("market");
                        }}
                        onIndex={() => {
                          setIndexViewFor(runKey);
                          setActivePane("market");
                        }}
                      />
                    )}
                    {singlePane && activePane === "trade" && (
                      <div className="td-mobile-ticket">
                        {indexView && pendingOrder && (
                          <PendingOrder
                            catalog={catalog}
                            pending={pendingOrder}
                            busy={Boolean(busy || error || notice)}
                            canAdvance={canAdvance && !showPlan && !error && !notice}
                            onAdvance={advance}
                            onCancel={cancel}
                          />
                        )}
                        {indexView ? (
                          <div className="td-index-no-order" role="status">
                            <p>指數不能下單，請選一檔股票</p>
                            <button
                              type="button"
                              className="td-button"
                              onClick={() => setActivePane("watch")}
                            >
                              到自選選股票
                            </button>
                          </div>
                        ) : (
                          <>
                            <QuoteLine catalog={catalog} session={liveMarket} code={code} />
                            {orderTicket}
                          </>
                        )}
                      </div>
                    )}
                    {singlePane &&
                      activePane === "positions" &&
                      (marketSession && !showPlan ? (
                        <div className="td-mobile-ticket">
                          <AccountSummary session={liveMarket ?? marketSession} />
                          <Ledger
                            catalog={catalog}
                            session={liveMarket ?? marketSession}
                            busy={Boolean(busy)}
                            onCancel={cancel}
                            cards
                          />
                        </div>
                      ) : (
                        <p className="td-empty">練習開始後，庫存、委託與成交會記錄在這裡。</p>
                      ))}
                  </div>
                </div>
                {!singlePane && <aside className="td-trade">{orderTicket}</aside>}
                {showPlan && planOpen && (
                  <div className="td-plan" ref={planRegion}>
                    <button
                      type="button"
                      className="td-plan-close td-button"
                      onClick={() => setPlanOpen(false)}
                    >
                      收起計畫
                    </button>
                    <div className="td-setup">
                      {!singlePane && setup}
                      <PlanForm
                        key={
                          catalog.lessonId + ":" + (session?.id ?? "first") + ":" + selectedExercise
                        }
                        symbols={picker ? catalog.symbols : []}
                        exerciseId={selectedExercise}
                        busy={Boolean(busy)}
                        guest={guest}
                        onStart={start}
                        onCancel={
                          session
                            ? () => {
                                setNewPlan(false);
                                setPlanOpen(false);
                              }
                            : undefined
                        }
                        setup={singlePane ? setup : undefined}
                      />
                    </div>
                    <RunRecords
                      records={data.records ?? []}
                      currentId={session?.id}
                      busy={Boolean(busy)}
                      onOpen={openRecord}
                    />
                  </div>
                )}
                {!singlePane && session && !newPlan && (
                  <div className="td-ledger" data-pane="ledger" data-coach="ledger">
                    <Ledger
                      catalog={catalog}
                      session={liveMarket ?? session}
                      busy={Boolean(busy)}
                      onCancel={cancel}
                    />
                  </div>
                )}
              </section>
              {singlePane && (
                <MobileDock
                  active={activePane}
                  pending={
                    marketSession?.orders.filter((item) => item.status === "pending").length ?? 0
                  }
                  onSelect={setActivePane}
                />
              )}
              {coachOpen && session && !completed && (
                <CoachMarks
                  layout={layout}
                  onClose={closeCoach}
                  onStep={(step) => say(`${step.title}。${step.body}`, step.id !== "chart")}
                />
              )}
              {completed && session && !newPlan && guest && <GuestSaveCard />}
              {completed && session && !newPlan && (
                <Completion
                  session={session}
                  celebration={data?.celebration ?? null}
                  busy={Boolean(busy)}
                  onRestart={() => {
                    setAuto(false);
                    setNewPlan(true);
                    setPlanOpen(true);
                    window.scrollTo({ top: 0, behavior: "auto" });
                  }}
                />
              )}
              {reviewOpen && session && !completed && (
                <section className={cn(CARD, "my-4")} aria-labelledby="morning-review-title">
                  <h2
                    ref={reviewHeading}
                    id="morning-review-title"
                    tabIndex={-1}
                    className="scroll-mt-4 text-xl font-semibold outline-none"
                  >
                    先寫下這一輪看到的事
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    核對原計畫、委託與目前庫存。保存復盤不會自動平倉，提早完成也不代表看完全部行情。
                  </p>
                  <ReflectionForm
                    session={session}
                    busy={Boolean(busy)}
                    saving={busy === "finish"}
                    onFinish={finish}
                    onBack={() => setReviewOpen(false)}
                  />
                  <div className="td-review-abandon">
                    <AbandonRun
                      label="放棄這局、重新選股"
                      busy={Boolean(busy)}
                      onConfirm={() => void abandon()}
                    />
                  </div>
                </section>
              )}
              <aside
                id="td-resources"
                className="td-resources"
                hidden={!resourcesOpen}
                aria-labelledby="td-resources-title"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setResourcesOpen(false);
                }}
              >
                <header className="td-titlebar td-resources-head">
                  <h2 id="td-resources-title" ref={resourcesHeading} tabIndex={-1}>
                    教材與資料
                  </h2>
                  <button type="button" className="td-tool" onClick={() => setResourcesOpen(false)}>
                    關閉
                  </button>
                </header>
                {singlePane && (
                  <label className="td-section td-drawer-lesson">
                    <span>教材交易日</span>
                    <select
                      value={catalog.lessonId}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        setAuto(false);
                        onLessonChange(event.target.value, { fresh: showPlan });
                      }}
                    >
                      {dates.map((lesson) => (
                        <option key={lesson.lessonId} value={lesson.lessonId}>
                          {lesson.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <details className="td-section">
                  <summary id="morning-lesson-picker">
                    教材與練習 · {catalog.date} · {exercise?.no ?? "自由練習"}
                  </summary>
                  <div className="quote-settings-fields">
                    <label>
                      練習主題
                      <select
                        className={cn(INPUT, "mt-1")}
                        value={
                          session && !newPlan
                            ? (session.plan.exerciseId ?? "legacy")
                            : selectedExercise
                        }
                        disabled={Boolean(busy) || Boolean(session && !completed && !newPlan)}
                        onChange={(event) => {
                          setAuto(false);
                          onExerciseChange(event.target.value);
                          if (session) {
                            setNewPlan(true);
                            setPlanOpen(true);
                          }
                        }}
                      >
                        {session && !session.plan.exerciseId && !newPlan && (
                          <option value="legacy">原有自由練習</option>
                        )}
                        {MORNING_EXERCISES.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.no} · {item.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="px-3 pb-3 text-sm text-muted">
                    兩日分別保存進度；完成本輪復盤後可換主題。同日重練可能已知道後續行情。
                  </p>
                  {session &&
                    !completed &&
                    exerciseId &&
                    exerciseId !== session.plan.exerciseId && (
                      <p role="status" className="td-banner">
                        已恢復這個交易日尚未完成的練習。先保存本輪復盤，再切換主題。
                      </p>
                    )}
                  <Background catalog={catalog} />
                  {exercise && (
                    <ExerciseGuide exercise={exercise} compact={Boolean(session && !newPlan)} />
                  )}
                </details>
                {session && !newPlan && (
                  <details className="td-section" ref={planDetails}>
                    <summary>本輪作戰計畫</summary>
                    <SavedPlan plan={session.plan} catalog={catalog} />
                  </details>
                )}
                {session && !completed && !newPlan && (
                  <div className="td-section td-drawer-abandon">
                    <AbandonRun
                      label="放棄這局、重新選股"
                      busy={Boolean(busy)}
                      onConfirm={() => void abandon()}
                    />
                  </div>
                )}
                <MorningDataDetails catalog={catalog} session={settled} code={code} />
                <details className="td-section">
                  <summary>資料來源與本課使用說明</summary>
                  <ul className="list-disc space-y-2 px-6 pb-4 text-sm text-muted">
                    {catalog.notices.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              </aside>
            </>
          )}
        </>
      )}
    </PageFrame>
  );
}

function PageFrame({
  children,
  layout,
  bar,
  hints,
}: {
  children: ReactNode;
  layout?: TerminalLayout;
  bar?: ReactNode;
  hints?: ReactNode;
}) {
  return (
    <div data-market-theme="dark" data-layout={layout} className="trading-desk">
      {bar ?? <DeskBar />}
      {hints}
      <main className="td-main">{children}</main>
    </div>
  );
}

/** Phone and large-text bottom tabs, within thumb reach: 自選／行情／下單／庫存. */
function MobileDock({
  active,
  pending,
  onSelect,
}: {
  active: MorningPane;
  pending: number;
  onSelect: (pane: MorningPane) => void;
}) {
  const items = [
    { pane: "watch", label: "自選", Icon: Star },
    { pane: "market", label: "行情", Icon: ChartCandlestick },
    { pane: "trade", label: "下單", Icon: ListOrdered },
    { pane: "positions", label: "庫存", Icon: Wallet },
  ] as const;
  return (
    <nav aria-label="主要分頁" className="td-dock">
      {items.map(({ pane, label, Icon }) => (
        <button
          key={pane}
          type="button"
          aria-pressed={active === pane}
          aria-label={
            pane === "positions" && pending > 0 ? `${label}，${pending} 筆待成交` : undefined
          }
          data-coach={`tab-${pane}`}
          onClick={() => {
            onSelect(pane);
            window.scrollTo({ top: 0, behavior: "auto" });
          }}
        >
          <Icon aria-hidden />
          <span>{label}</span>
          {pane === "positions" && pending > 0 && (
            <em className="td-dock-badge" aria-hidden>
              {pending}
            </em>
          )}
        </button>
      ))}
    </nav>
  );
}

function ExerciseGuide({ exercise, compact }: { exercise: MorningExercise; compact: boolean }) {
  const content = (
    <>
      <p className="mt-3 text-base leading-relaxed">{exercise.principle}</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed text-muted">
        {exercise.prep.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </>
  );
  return compact ? (
    <details className={cn(CARD, "mb-6")}>
      <summary className="min-h-12 cursor-pointer text-lg font-semibold">
        {exercise.no} · {exercise.title} · 本輪重點
      </summary>
      {content}
    </details>
  ) : (
    <section className={cn(CARD, "mb-6 border-brand/25 bg-brand/5")} aria-label="本課練習重點">
      <p className="text-sm font-semibold text-brand">{exercise.no} · 真實行情練習</p>
      <h2 className="mt-2 text-xl font-semibold">{exercise.title}</h2>
      {content}
    </section>
  );
}

function Background({
  catalog,
  expanded = false,
}: {
  catalog: MorningCatalog;
  expanded?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <details className={CARD} open={expanded || undefined}>
        <summary className="flex min-h-12 cursor-pointer items-center gap-3 text-xl font-semibold">
          <BookOpen className="shrink-0 text-brand" aria-hidden />
          先讀背景與教材規則
        </summary>
        <div className="mt-4">
          <p className="rounded-xl border border-warn/25 bg-warn/5 p-3 text-base leading-relaxed">
            以下是事後蒐集的歷史參考，未驗證每筆在當日 09:00 前已可取得，不能視為嚴格盤前快照。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {catalog.context.map((item) => (
              <dl
                key={`${item.label}:${item.asOf}`}
                className="min-w-0 rounded-xl border border-border bg-bg p-3"
              >
                <dt className="text-sm text-muted">{item.label}</dt>
                <dd className="mt-1 break-words text-lg font-semibold">{item.value}</dd>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.asOf}</dd>
              </dl>
            ))}
          </div>
          <h3 className="mt-6 text-xl font-semibold">這一課，先練習怎麼觀察</h3>
          <ol className="mt-4 space-y-4">
            {catalog.strategy.map((item, index) => (
              <li key={item} className="flex items-start gap-3 text-base leading-relaxed">
                <span className="mt-0.5 shrink-0 font-mono text-brand">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ol>
          {catalog.videoUrl ? (
            <a
              href={catalog.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(SECONDARY, "mt-5")}
            >
              開啟本課影音（另開視窗）
            </a>
          ) : (
            <p className="mt-5 rounded-xl bg-bg p-3 text-base leading-relaxed text-muted">
              本課尚未提供當日盤前影音，先使用以上文字教材。交易台的 EMA11、EMA24
              以一分鐘收盤價畫線，只供觀察；不會自動判斷 N 字條件或產生買賣訊號。
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function MorningChart({
  catalog,
  session,
  code,
  candles,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  code: string;
  candles: boolean;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const bars = session?.bars[code] ?? [];
  const last = bars.at(-1);
  const now = (session?.cursor ?? 0) * 60;
  const view = candles
    ? candleWindow(session?.cursor ?? 0)
    : { startT: 0, endT: catalog.maxCursor * 60 };
  // Swing highs and the spoken summary use completed minutes only, not the minute being replayed.
  const settled = session ? settledSession(session) : null;
  const settledBars = settled?.bars[code] ?? [];
  const lastComplete = settledBars.at(-1);
  const swingHighs = deriveSwingHighs(
    settledBars,
    (settled?.cursor ?? 0) * 60,
    0,
    catalog.maxCursor * 60,
  ).confirmed;
  const fills = (session?.fills ?? [])
    .filter((fill) => fill.code === symbol.code)
    .map((fill) => ({ t: fill.t, p: fill.price, side: fill.side }));
  const sourceBacked = showVolumeAndAverage(catalog.volumeUnit, bars);
  return (
    <section className="td-chart" data-coach="chart" aria-label={symbol.name + "歷史分鐘行情"}>
      <div className="td-chart-canvas">
        {last && session ? (
          <TapeChart
            bars={bars}
            ticks={[]}
            prev={symbol.previousClose}
            high={Math.max(...bars.map((bar) => bar.h))}
            low={Math.min(...bars.map((bar) => bar.l))}
            last={last.c}
            open={bars[0]?.o}
            startT={view.startT}
            endT={view.endT}
            now={now}
            swingHighs={swingHighs}
            fills={fills}
            variant={candles ? "candles" : "stock"}
            presentation="terminal"
            showVolume={sourceBacked}
            showAverage={sourceBacked}
            showVolumeReadout={sourceBacked}
            appendCurrentQuote={false}
            completedBarSeconds={60}
            priceBand={candles ? undefined : JIANGBO_BAND}
            emaPeriods={DESK_EMA_PERIODS}
            interactive
            ariaLabel={`${catalog.date} ${code} ${symbol.name}歷史${candles ? "一分鐘K線" : "江波圖（昨收上下 10%）"}，含 EMA11、EMA24（一分鐘收盤價），只包含已揭露分鐘，最新一分鐘以模擬逐筆重播後收在真實收盤價，${sourceBacked ? "含均價與成交量（張）" : "不顯示成交量或均價"}。${lastComplete ? `最新完整分鐘 ${formatTime(lastComplete.t).slice(0, 5)} 開 ${formatPrice(lastComplete.o)} 高 ${formatPrice(lastComplete.h)} 低 ${formatPrice(lastComplete.l)} 收 ${formatPrice(lastComplete.c)}。` : "第一分鐘重播中。"}`}
          />
        ) : (
          <div className="td-chart-waiting">
            <strong>09:00</strong>
            <span>等待第一根完整 K 棒</span>
            <small>
              {session ? "前進一分鐘後揭露真實行情" : "先保存作戰計畫，開始當日歷史回放"}
            </small>
          </div>
        )}
      </div>
    </section>
  );
}

function MorningDataDetails({
  catalog,
  session,
  code,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const bars = session?.bars[symbol.code] ?? [];
  const last = bars.at(-1);
  return (
    <details className="td-section">
      <summary>報價彙總與 K 棒明細{last ? " · " + bars.length + " 根" : ""}</summary>
      <div className="td-data-details">
        <dl className="grid grid-cols-2 gap-3">
          <Metric label="前一交易日收盤" value={formatPrice(symbol.previousClose)} />
          <Metric
            label="前 5 個完整交易日收盤均值"
            value={
              symbol.previous5CloseMean === null
                ? "—"
                : symbol.previous5CloseMean.toLocaleString("zh-TW", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
            }
          />
        </dl>
        <p>以上均值不含本日，僅供歷史參考；當日 SMA5 的計算定義尚未確認。</p>
        {last && (
          <div
            className="td-candle-table"
            tabIndex={0}
            role="region"
            aria-label="已完成分鐘 K 線明細，可捲動查看"
          >
            <table>
              <caption>
                {catalog.date} · {symbol.name} {symbol.code} · Yahoo Finance 原始
                OHLC。時間為分鐘起點，整根於下一分鐘揭露。
              </caption>
              <thead>
                <tr>
                  {["分鐘", "開盤", "最高", "最低", "收盤"].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bars.map((bar) => (
                  <tr key={bar.t}>
                    <th scope="row">{formatTime(bar.t).slice(0, 5)}</th>
                    {[bar.o, bar.h, bar.l, bar.c].map((price, index) => (
                      <td key={index}>{formatPrice(price)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          K 線直接使用來源開高低收，該分鐘完成後才揭露。揭露後，交易台用約 2
          秒的模擬逐筆重播這一分鐘：價格只在這分鐘真實的最高與最低之間跳動，最後收在真實收盤價；成交明細與分鐘內的跳動都是模擬，不是真實逐筆紀錄，撮合仍以下一分鐘開盤價為準。江波圖只連接各分鐘收價，點位標在分鐘結束時間，刻度固定為昨收上下 10%；缺漏區間保留斷線。EMA11、EMA24 以已揭露的一分鐘收盤價計算，從 09:00 第一分鐘起算，只供觀察。點按圖表或用左右方向鍵查看資料。
        </p>
        <p>
          來源：Yahoo Finance 歷史 1 分鐘 OHLC。這是真實歷史分鐘 K，尚非富邦即時或逐筆江波行情。
        </p>
        <p>
          分鐘量尚未核對，不顯示量柱、均價或量能訊號，成交明細也不顯示張數；沒有真實五檔或逐筆。資料缺漏不會以生成價格補齊。
        </p>
      </div>
    </details>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-relaxed text-muted">{label}</dt>
      <dd className="break-all font-mono text-sm font-semibold sm:text-base">{value}</dd>
    </div>
  );
}

function SavedPlan({ plan, catalog }: { plan: MorningPlan; catalog: MorningCatalog }) {
  const symbol = catalog.symbols.find((item) => item.code === plan.focusCode);
  return (
    <section className={CARD}>
      <h3 className="text-xl font-semibold">回到開始前寫的計畫</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        這份原始計畫保持不變，新的想法記在本輪復盤中。
      </p>
      <dl className="mt-4 space-y-4">
        <Metric label="關注商品" value={`${plan.focusCode} ${symbol?.name ?? ""}`} />
        <Metric
          label="原始觀察方向"
          value={
            plan.bias === "bullish"
              ? "觀察偏多條件"
              : plan.bias === "bearish"
                ? "觀察偏空條件"
                : "先觀察／不確定"
          }
        />
        {[
          { label: "觀察理由", value: plan.reason },
          { label: "等待的操作條件", value: plan.entry },
          { label: "計畫失效／停止條件", value: plan.stop },
        ].map((item) => (
          <div key={item.label}>
            <dt className="text-sm text-muted">{item.label}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-base leading-relaxed">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReflectionForm({
  session,
  busy,
  saving,
  onFinish,
  onBack,
}: {
  session: MorningState;
  /** Any request is in flight: the form waits. */
  busy: boolean;
  /** The review itself is being saved, so its button says 正在保存…. */
  saving: boolean;
  onFinish: (text: string) => Promise<void>;
  onBack: () => void;
}) {
  const [reflection, setReflection] = useState("");
  const [invalid, setInvalid] = useState(false);
  const exercise = getMorningExercise(session.plan.exerciseId);
  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!reflection.trim()) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        void onFinish(reflection.trim());
      }}
    >
      <p className="rounded-xl bg-bg p-3 text-base leading-relaxed">
        結束時間 {formatTime(session.cursor * 60).slice(0, 5)} · 剩餘庫存 {session.positions.length}{" "}
        檔 · 待處理委託 {session.orders.filter((item) => item.status === "pending").length}{" "}
        筆。請先核對下方紀錄。
      </p>
      {exercise && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-lg font-semibold">{exercise.title} · 復盤想一想</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-muted">
            {exercise.review.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="block text-base font-medium">
        這一輪有沒有依計畫等待？觀察或操作後，我想調整哪一件事？
        <textarea
          required
          maxLength={600}
          rows={5}
          value={reflection}
          onChange={(event) => setReflection(event.target.value)}
          disabled={busy}
          aria-invalid={invalid}
          className={cn(INPUT, "mt-3 resize-y font-normal")}
        />
      </label>
      {invalid && (
        <p role="alert" className="text-base text-warn">
          請先寫下一句自己的觀察，再保存復盤。
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={PRIMARY}>
          {saving ? "正在保存…" : "保存復盤，完成這一輪"}
        </button>
        <button type="button" disabled={busy} onClick={onBack} className={SECONDARY}>
          回看行情，保持暫停
        </button>
      </div>
    </form>
  );
}

function Completion({
  session,
  celebration,
  busy,
  onRestart,
}: {
  session: MorningState;
  celebration: Celebration | null;
  busy: boolean;
  onRestart: () => void;
}) {
  const exercise = getMorningExercise(session.plan.exerciseId);
  if (session.abandoned)
    return (
      <section className="mb-6 rounded-2xl border border-border p-5 sm:p-6">
        <p className="text-base font-semibold">已放棄這局 · 不計紀律分數</p>
        <p className="mt-2 text-sm text-muted">
          記錄至 {formatTime(session.cursor * 60).slice(0, 5)}，委託與成交保留在紀錄中。
        </p>
        <button type="button" disabled={busy} onClick={onRestart} className={cn(SECONDARY, "mt-5")}>
          <RotateCcw className="shrink-0" aria-hidden />
          寫新計畫，再練一輪
        </button>
      </section>
    );
  // The same two checks as the practice points (no orders counts for both).
  const onPlan = session.orders.every((item) => item.code === session.plan.focusCode);
  const flat = session.positions.every((item) => !item.shares);
  const achievements = [
    "寫下自己的計畫",
    ...(onPlan ? ["照計畫的股票操作"] : []),
    ...(flat ? ["收盤前不留倉"] : []),
    "完成這一輪復盤",
  ];
  return (
    <section className="mb-6 rounded-2xl border border-brand/25 bg-brand/5 p-5 sm:p-6">
      <p className="text-base font-semibold text-brand">已保存 · 這是操作足跡，不是獲利能力評分</p>
      {exercise && (
        <h2 className="mt-3 text-xl font-semibold">
          {exercise.no} · {exercise.title}，已完成本輪復盤
        </h2>
      )}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {achievements.map((item) => (
          <li
            key={item}
            className="flex min-w-0 items-start gap-2 rounded-xl border border-brand/15 bg-surface p-3 text-base"
          >
            <Check className="mt-1 shrink-0 text-brand" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {celebration && (
        <div className="mt-4">
          <DisciplineCelebration celebration={celebration} />
        </div>
      )}
      <p className="mt-4 text-sm text-muted">
        本輪記錄至 {formatTime(session.cursor * 60).slice(0, 5)}
        ；沒有強制平倉，剩餘庫存保留在紀錄中。重練已看過的行情不代表首次未知行情的表現。
      </p>
      <h3 className="mt-5 text-lg font-semibold">你留下的復盤</h3>
      <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{session.reflection}</p>
      <button type="button" disabled={busy} onClick={onRestart} className={cn(SECONDARY, "mt-5")}>
        <RotateCcw className="shrink-0" aria-hidden />
        寫新計畫，再練一輪
      </button>
    </section>
  );
}

/**
 * A retired lesson's run (spec §9, decision R): no chart and no market, only what was saved: the plan, P/L, orders
 * and fills, and the review. An unfinished one can be finished with a review (P/L from the last saved equity) or
 * given up; nothing else.
 */
function RetiredRun({
  catalog,
  session,
  celebration,
  records,
  busy,
  saving,
  cards,
  onFinish,
  onAbandon,
  onOpenRecord,
}: {
  catalog: MorningCatalog;
  session: MorningState;
  celebration: Celebration | null;
  records: RunRecord[];
  busy: boolean;
  saving: boolean;
  cards: boolean;
  onFinish: (reflection: string) => Promise<void>;
  onAbandon: () => void;
  onOpenRecord: (record: RunRecord) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus();
  }, [reviewing]);
  // Shown as ended: a retired run's orders cannot be withdrawn (the classroom refuses anything but ending it).
  const ledger = { ...session, completed: true };
  return (
    <div className="td-retired">
      <section className={cn(CARD, "td-retired-head")} aria-labelledby="td-retired-title">
        <h1 id="td-retired-title" tabIndex={-1}>
          {shortDate(catalog.date)} {RETIRED_TEXT}
        </h1>
        <p>這堂舊課已停用，只顯示計畫、委託、成交、損益與復盤，不顯示走勢圖。</p>
      </section>
      <AccountSummary session={session} />
      <Ledger catalog={catalog} session={ledger} busy={busy} onCancel={async () => {}} cards={cards} />
      <SavedPlan plan={session.plan} catalog={catalog} />
      {session.completed ? (
        <section className={CARD} aria-label="復盤">
          {session.abandoned ? (
            <p className="text-base font-semibold">已放棄這局 · 不計紀律分數</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold">你留下的復盤</h2>
              <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{session.reflection}</p>
            </>
          )}
          {celebration && (
            <div className="mt-4">
              <DisciplineCelebration celebration={celebration} />
            </div>
          )}
        </section>
      ) : reviewing ? (
        <section className={CARD} aria-labelledby="td-retired-review">
          <h2
            id="td-retired-review"
            ref={reviewHeading}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            完成並復盤
          </h2>
          <ReflectionForm
            session={session}
            busy={busy}
            saving={saving}
            onFinish={onFinish}
            onBack={() => setReviewing(false)}
          />
        </section>
      ) : (
        <div className="td-retired-actions">
          <button type="button" className={PRIMARY} disabled={busy} onClick={() => setReviewing(true)}>
            完成並復盤
          </button>
          <AbandonRun label="放棄這局" busy={busy} onConfirm={onAbandon} />
        </div>
      )}
      <RunRecords records={records} currentId={session.id} busy={busy} onOpen={onOpenRecord} />
    </div>
  );
}
