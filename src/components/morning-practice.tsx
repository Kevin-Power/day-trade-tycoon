import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CandlestickChart,
  Check,
  ChartCandlestick,
  ListOrdered,
  RotateCcw,
  Star,
  Wallet,
} from "lucide-react";
import { TapeChart } from "@/components/charts";
import { DeskBar, HintBar, StatusBar } from "@/components/morning-desk-bar";
import { REPLAY_DELAY, type ReplaySpeed } from "@/lib/replay-speed";
import {
  AccountSummary,
  PaperOrder,
  Ledger,
  type MorningOrderOptions,
} from "@/components/morning-trading";
import { MorningSparkline } from "@/components/morning-quotes";
import { ChartToolbar, QuoteHero, QuoteLine } from "@/components/quote-hero";
import { useGuestBootstrap } from "@/components/use-guest-bootstrap";
import { AccessCard } from "@/components/access-card";
import { GuestBanner, GuestSaveCard, LinkNoticeBanner } from "@/components/guest-prompts";
import { clearLinkNoticeCookie, readLinkNotice, type LinkNotice } from "@/lib/guest-link";
import { describeAccessProblem } from "@/lib/morning-access";
import { PlanForm } from "@/components/morning-plan-form";
import { CARD, INPUT, PRIMARY, SECONDARY } from "@/components/morning-styles";
import { CoachMarks } from "@/components/coach-marks";
import { readCoachSeen, writeCoachSeen } from "@/lib/coach-steps";
import { browserStorage } from "@/lib/device-storage";
import { useSay } from "@/components/use-speech";
import { fillAnnouncement, SPEECH_TEXT } from "@/lib/speech";
import { openingRevealDelay } from "@/lib/opening-reveal";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useLedgerPreferences } from "@/lib/ledger-preferences";
import { useTerminalLayout, type TerminalLayout } from "@/lib/use-terminal-layout";
import { deriveMorningAlerts } from "@/lib/morning-alerts";
import type {
  MorningAction,
  MorningCatalog,
  MorningPlan,
  MorningResponse,
  MorningState,
} from "@/lib/morning";
import { cn, formatTime } from "@/lib/utils";
import { formatPrice } from "@/lib/market/ticks";
import { candleWindow, showVolumeAndAverage } from "@/lib/market/chart-data";
import { quoteSummary } from "@/lib/morning-quote";
import { deriveSwingHighs } from "@/lib/market/swing-highs";
import {
  MORNING_EXERCISES,
  getMorningExercise,
  type MorningExercise,
} from "@/lib/morning-exercises";

/** Phone and large-text tabs; the chart mode (分時／K線) is separate and shared by every layout. */
type MorningPane = "market" | "watch" | "trade" | "positions";
type ChartMode = "quote" | "chart";

function readResponse(value: unknown): MorningResponse {
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

function useMorningData(lessonId: string) {
  const [data, setData] = useState<MorningResponse | null>(null);
  const [busy, setBusy] = useState<MorningAction["action"] | "load" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [access, setAccess] = useState<{ status: 401 | 403; message: string } | null>(null);
  const locked = useRef(false);
  const serial = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryAction = useRef<MorningAction | undefined>(undefined);
  const endpoint = lessonId
    ? `/api/morning?lesson=${encodeURIComponent(lessonId)}`
    : "/api/morning";

  const request = useCallback(
    async (action?: MorningAction): Promise<MorningResponse | null> => {
      if (locked.current) return null;
      locked.current = true;
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
        if (!current()) return null;
        if (response.status === 401 || response.status === 403) {
          setAccess(await readAccessProblem(response));
          setData(null);
          retryAction.current = undefined;
          return null;
        }
        if (response.status === 409) {
          retryAction.current = undefined;
          const latest = await fetch(endpoint, {
            credentials: "same-origin",
            cache: "no-store",
            signal: abort.signal,
          });
          if (!current()) return null;
          if (latest.status === 401 || latest.status === 403) {
            setAccess(await readAccessProblem(latest));
            setData(null);
            return null;
          }
          if (!latest.ok) throw new Error("進度已在另一個分頁更新，請重新載入最新進度。");
          const fresh = readResponse(await readJsonResponse(latest));
          if (!current()) return null;
          setData(fresh);
          setNotice(
            "進度已更新，可能有另一個分頁正在操作。已同步最新紀錄並停止自動播放；請核對後再繼續。",
          );
          return null;
        }
        const payload = await readJsonResponse(response);
        if (!current()) return null;
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
        const next = readResponse(payload);
        setData(next);
        setAccess(null);
        retryAction.current = undefined;
        return next;
      } catch (failure) {
        if (current())
          setError(
            timedOut
              ? "教室回應超過 20 秒，已停止等待。請核對進度，或重試同一筆操作。"
              : failure instanceof TypeError
                ? "暫時連不上教室，請重試同一筆操作或重新載入進度。"
                : failure instanceof Error
                  ? failure.message
                  : "暫時連不上教室，請重試。",
          );
        return null;
      } finally {
        window.clearTimeout(deadline);
        if (current()) {
          locked.current = false;
          setBusy(null);
        }
      }
    },
    [endpoint],
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
    busy,
    error,
    notice,
    access,
    request,
    retry: () => request(retryAction.current),
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
      fresh={fresh}
      lessonId={lessonId}
      initialPane={initialPane}
      exerciseId={selectedExercise}
      onLessonChange={onLessonChange}
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
  onLessonChange,
  onExerciseChange,
}: {
  guest: boolean;
  coach: boolean;
  fresh: boolean;
  lessonId: string;
  exerciseId: string;
  initialPane?: "trade";
  onLessonChange: (lessonId: string) => void;
  onExerciseChange: (exerciseId: string) => void;
}) {
  const { data, busy, error, notice, access, request, retry } = useMorningData(lessonId);
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
  const [chartMode, setChartMode] = useState<ChartMode>("chart");
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
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourcesHeading = useRef<HTMLHeadingElement>(null);
  const [clock, setClock] = useState(() => Date.now());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const practiceHeading = useRef<HTMLHeadingElement>(null);
  const catalog = data?.catalog;
  const session = data?.state;
  const sessionId = session?.id;
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
  const code = catalog?.symbols.some((symbol) => symbol.code === selected)
    ? selected
    : (session?.plan.focusCode ?? catalog?.symbols[0]?.code ?? "");
  const singlePane = layout === "phone" || layout === "senior";
  const ledgerOpen = useLedgerPreferences((value) => value.open);
  const setLedgerOpen = useLedgerPreferences((value) => value.setOpen);

  useEffect(() => {
    useLedgerPreferences.getState().hydrate();
  }, []);

  useEffect(() => {
    setAuto(false);
    setNewPlan(false);
    setPlanOpen(false);
    setExtended(false);
    setReviewOpen(false);
    setFeedback("");
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
        void request({
          action: "advance",
          requestId: crypto.randomUUID(),
          id: session.id,
          expectedRevision: session.revision,
        }).then((result) => {
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
    else if (fresh && data.state.completed) {
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
    const next = await request({
      action: "advance",
      requestId: crypto.randomUUID(),
      id: session.id,
      expectedRevision: session.revision,
    });
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
    setAuto(false);
    // Said inside the tap: iPhone only allows speech that starts from one.
    say(SPEECH_TEXT.start);
    const next = await request({
      action: "start",
      requestId: crypto.randomUUID(),
      plan,
      ...(guest ? { guestTerms: true as const } : {}),
    });
    const receivedAt = Date.now();
    if (next?.state) {
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
        await request({
          action: "advance",
          requestId: crypto.randomUUID(),
          id: opening.id,
          expectedRevision: opening.revision,
        });
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
    const next = await request({
      action: "order",
      requestId: crypto.randomUUID(),
      id: session.id,
      expectedRevision: session.revision,
      code,
      side,
      lots,
      ...options,
    });
    if (next?.state)
      setFeedback("紙上委託已記錄，尚未代表成交。前進一分鐘後，請核對委託與成交紀錄。");
    return Boolean(next?.state);
  }

  async function cancel(orderId: string) {
    if (!session) return;
    setAuto(false);
    const next = await request({
      action: "cancel",
      requestId: crypto.randomUUID(),
      id: session.id,
      expectedRevision: session.revision,
      orderId,
    });
    if (next?.state) setFeedback("已更新撤單結果，請核對委託狀態。");
  }

  async function finish(reflection: string) {
    if (!session) return;
    setAuto(false);
    const next = await request({
      action: "finish",
      requestId: crypto.randomUUID(),
      id: session.id,
      expectedRevision: session.revision,
      reflection,
    });
    if (next?.state?.completed) {
      say(SPEECH_TEXT.finish);
      setReviewOpen(false);
      setFeedback("這一輪的計畫、操作與復盤已保存。");
      window.requestAnimationFrame(() => practiceHeading.current?.focus({ preventScroll: true }));
    }
  }

  const showPlan = !session || newPlan;
  const marketSession = newPlan ? null : session;
  const orderTicket = catalog ? (
    <PaperOrder
      key={`${marketSession?.id ?? "preview"}:${code}`}
      catalog={catalog}
      session={marketSession ?? null}
      code={code}
      busy={Boolean(busy || error || notice)}
      atEnd={atEnd && !showPlan}
      canAdvance={canAdvance && !showPlan && !error && !notice}
      onSelect={setSelected}
      onPrepare={() => setPlanOpen(true)}
      onReview={() => setAuto(false)}
      onAdvance={advance}
      onOrder={order}
      onCancel={cancel}
    />
  ) : null;
  const chartBar = catalog ? (
    <ChartToolbar
      catalog={catalog}
      code={code}
      mode={chartMode}
      onMode={setChartMode}
      onSelect={setSelected}
    />
  ) : null;
  const alerts = catalog && marketSession ? deriveMorningAlerts(catalog, marketSession) : [];
  const latestAlert = alerts.at(-1);
  const latestFill = [...alerts].reverse().find((alert) => alert.kind === "fill");

  return (
    <PageFrame
      layout={layout}
      bar={
        data && catalog ? (
          <StatusBar
            lessons={data.lessons ?? [catalog]}
            lessonId={catalog.lessonId}
            exercise={exercise}
            session={marketSession ?? null}
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
              onLessonChange(next);
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
            tip={exercise?.principle}
            alert={latestAlert}
            announcement={latestFill?.text}
            feedback={showPlan ? "" : feedback}
          >
            {linkNotice && (
              <LinkNoticeBanner notice={linkNotice} onDismiss={() => setLinkNotice(null)} />
            )}
            {guest && <GuestBanner />}
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
      {access ? (
        <AccessCard
          problem={describeAccessProblem(access.status, access.message)}
          busy={Boolean(busy)}
          onRetry={() => void request()}
        />
      ) : (
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
                  <aside className="td-watch">
                    <MorningWatchlist
                      catalog={catalog}
                      session={marketSession ?? null}
                      code={code}
                      compact={layout === "tablet"}
                      onSelect={setSelected}
                    />
                    {layout === "desktop" && marketSession && (
                      <div className="td-plan-note">
                        <span className="terminal-eyebrow">TRADING PLAN</span>
                        <h3>
                          <BookOpen size={14} aria-hidden /> 本輪作戰計畫
                        </h3>
                        <span className="terminal-plan-code">
                          {marketSession.plan.focusCode} ·{" "}
                          {marketSession.plan.bias === "bullish"
                            ? "偏多觀察"
                            : marketSession.plan.bias === "bearish"
                              ? "偏空觀察"
                              : "等待條件"}
                        </span>
                        <p>{marketSession.plan.entry}</p>
                      </div>
                    )}
                  </aside>
                )}
                <div className="td-center">
                  {singlePane && activePane !== "market" && (
                    <h1 className="sr-only" ref={practiceHeading} tabIndex={-1}>
                      真實歷史行情・模擬交易工作台
                    </h1>
                  )}
                  {(!singlePane || activePane === "market") && (
                    <>
                      <QuoteHero
                        catalog={catalog}
                        session={marketSession ?? null}
                        code={code}
                        titleRef={practiceHeading}
                      />
                      {chartBar}
                    </>
                  )}
                  <div className="td-pane">
                    {(!singlePane || activePane === "market") && (
                      <MorningChart
                        catalog={catalog}
                        session={marketSession ?? null}
                        code={code}
                        candles={chartMode === "chart"}
                      />
                    )}
                    {singlePane && activePane === "watch" && (
                      <MorningWatchlist
                        catalog={catalog}
                        session={marketSession ?? null}
                        code={code}
                        onSelect={(next) => {
                          setSelected(next);
                          setActivePane("market");
                        }}
                      />
                    )}
                    {singlePane && activePane === "trade" && (
                      <div className="td-mobile-ticket">
                        <QuoteLine catalog={catalog} session={marketSession ?? null} code={code} />
                        {orderTicket}
                      </div>
                    )}
                    {singlePane &&
                      activePane === "positions" &&
                      (marketSession && !showPlan ? (
                        <div className="td-mobile-ticket">
                          <AccountSummary session={marketSession} />
                          <Ledger
                            catalog={catalog}
                            session={marketSession}
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
                {!singlePane && (
                  <aside className="td-trade" data-coach="ticket">
                    {orderTicket}
                  </aside>
                )}
                {showPlan && planOpen && (
                  <div className="td-plan" ref={planRegion}>
                    <button
                      type="button"
                      className="td-plan-close td-button"
                      onClick={() => setPlanOpen(false)}
                    >
                      收起計畫
                    </button>
                    <PlanForm
                      key={
                        catalog.lessonId + ":" + (session?.id ?? "first") + ":" + selectedExercise
                      }
                      catalog={catalog}
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
                    />
                  </div>
                )}
                {!singlePane && session && !newPlan && (
                  <div className="td-ledger" data-open={ledgerOpen} data-coach="ledger">
                    <Ledger
                      catalog={catalog}
                      session={session}
                      busy={Boolean(busy)}
                      onCancel={cancel}
                      collapsible={{ open: ledgerOpen, onOpenChange: setLedgerOpen }}
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
                    onFinish={finish}
                    onBack={() => setReviewOpen(false)}
                  />
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
                        onLessonChange(event.target.value);
                      }}
                    >
                      {(data.lessons ?? [catalog]).map((lesson) => (
                        <option key={lesson.lessonId} value={lesson.lessonId}>
                          {lesson.date} · {lesson.symbols.length} 檔
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
                  <details className="td-section">
                    <summary>本輪作戰計畫</summary>
                    <SavedPlan plan={session.plan} catalog={catalog} />
                  </details>
                )}
                <MorningDataDetails catalog={catalog} session={marketSession ?? null} code={code} />
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

function MorningWatchlist({
  catalog,
  session,
  code,
  onSelect,
  compact = false,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  onSelect: (code: string) => void;
  compact?: boolean;
}) {
  return (
    <section className="td-watchlist" data-compact={compact} aria-label="自選行情">
      <div className="td-titlebar td-watch-head">
        <span>
          <CandlestickChart size={15} aria-hidden /> 自選報價
        </span>
        <span className="td-num">{catalog.symbols.length}</span>
      </div>
      <div className="td-watch-list" role="group" aria-label="選擇重播商品">
        {catalog.symbols.map((symbol) => {
          const quote = quoteSummary(session?.bars[symbol.code] ?? [], symbol.previousClose);
          return (
            <button
              type="button"
              key={symbol.code}
              className="td-watch-item"
              data-tone={quote.tone}
              aria-pressed={code === symbol.code}
              onClick={() => onSelect(symbol.code)}
            >
              <span className="td-watch-name">
                <span>{symbol.name}</span>
                <small>{symbol.code}</small>
              </span>
              <strong className="td-watch-price">
                {quote.last === null ? "—" : formatPrice(quote.last)}
              </strong>
              <span className="td-watch-change">
                {quote.last === null ? (
                  "尚未揭露"
                ) : (
                  <>
                    <span>
                      {quote.tone === "up" ? "▲" : quote.tone === "down" ? "▼" : "—"}
                      {quote.changeText}
                    </span>
                    <span>{quote.percentText}</span>
                  </>
                )}
              </span>
              {!compact && (
                <MorningSparkline
                  bars={session?.bars[symbol.code] ?? []}
                  previous={symbol.previousClose}
                  endT={catalog.maxCursor * 60}
                />
              )}
            </button>
          );
        })}
      </div>
      {!compact && <p className="td-watch-foot">已揭露分鐘收價 · 虛線為昨收</p>}
    </section>
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
          <BookOpen className="size-5 shrink-0 text-brand" aria-hidden />
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
              本課尚未提供當日盤前影音，先使用以上文字教材。EMA11
              僅作教材說明，尚未計算指標或自動判斷 N 字條件。
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
  session: MorningState | null;
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
  const swingHighs = deriveSwingHighs(bars, now, 0, catalog.maxCursor * 60).confirmed;
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
            interactive
            ariaLabel={`${catalog.date} ${code} ${symbol.name}歷史${candles ? "一分鐘K線" : "分鐘收價連線"}，只包含目前已完成分鐘，${sourceBacked ? "含均價與成交量（張）" : "不顯示成交量或均價"}。最新完整分鐘 ${formatTime(last.t).slice(0, 5)} 開 ${formatPrice(last.o)} 高 ${formatPrice(last.h)} 低 ${formatPrice(last.l)} 收 ${formatPrice(last.c)}。`}
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
            value={symbol.previous5CloseMean.toLocaleString("zh-TW", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
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
          K
          線直接使用來源開高低收，該分鐘完成後才揭露整根。分時只連接各分鐘收價，點位標在分鐘結束時間，不代表分鐘內逐筆路徑；缺漏區間保留斷線。點按圖表或用左右方向鍵查看資料。
        </p>
        <p>
          來源：Yahoo Finance 歷史 1 分鐘 OHLC。這是真實歷史分鐘 K，尚非富邦即時或逐筆江波行情。
        </p>
        <p>
          分鐘量尚未核對，不顯示量柱、均價或量能訊號；沒有真實五檔。資料缺漏不會以生成價格補齊。
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
  onFinish,
  onBack,
}: {
  session: MorningState;
  busy: boolean;
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
          {busy ? "正在保存…" : "保存復盤，完成這一輪"}
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
  busy,
  onRestart,
}: {
  session: MorningState;
  busy: boolean;
  onRestart: () => void;
}) {
  const exercise = getMorningExercise(session.plan.exerciseId);
  const waited =
    session.cursor > 0 &&
    (session.orders.length === 0 ||
      Math.min(...session.orders.map((item) => item.submittedCursor)) > 0);
  const achievements = [
    "寫下自己的計畫",
    ...(waited ? ["先觀察，再決定是否操作"] : []),
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
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {achievements.map((item) => (
          <li
            key={item}
            className="flex min-w-0 items-start gap-2 rounded-xl border border-brand/15 bg-surface p-3 text-base"
          >
            <Check className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        本輪記錄至 {formatTime(session.cursor * 60).slice(0, 5)}
        ；沒有強制平倉，剩餘庫存保留在紀錄中。重練已看過的行情不代表首次未知行情的表現。
      </p>
      <h3 className="mt-5 text-lg font-semibold">你留下的復盤</h3>
      <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{session.reflection}</p>
      <button type="button" disabled={busy} onClick={onRestart} className={cn(SECONDARY, "mt-5")}>
        <RotateCcw className="size-5 shrink-0" aria-hidden />
        寫新計畫，再練一輪
      </button>
    </section>
  );
}
