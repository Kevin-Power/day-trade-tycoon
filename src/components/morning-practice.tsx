import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CirclePause,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Play,
  RotateCcw,
} from "lucide-react";
import { DisplayControls } from "@/components/display-controls";
import { TapeChart } from "@/components/charts";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useTerminalLayout } from "@/lib/use-terminal-layout";
import type {
  MorningAction,
  MorningCatalog,
  MorningPlan,
  MorningResponse,
  MorningState,
} from "@/lib/morning";
import { cn, formatMoney, formatTime } from "@/lib/utils";
import { formatPrice } from "@/lib/market/ticks";
import {
  MORNING_EXERCISES,
  getMorningExercise,
  type MorningExercise,
} from "@/lib/morning-exercises";

type MorningPane = "quote" | "chart" | "watch" | "trade" | "positions";

const ACTION =
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 whitespace-normal rounded-xl px-4 py-3 text-base font-semibold leading-relaxed disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY = `${ACTION} bg-brand text-brand-fg hover:brightness-95`;
const SECONDARY = `${ACTION} border border-border-strong bg-surface text-fg hover:bg-elevated`;
const INPUT =
  "block min-h-12 w-full min-w-0 rounded-xl border border-border-strong bg-surface px-3 py-3 text-base leading-relaxed text-fg";
const CARD = "min-w-0 rounded-md border border-border bg-surface p-3 sm:p-4";
const DARK_CHART = {
  "--color-bg": "#000000",
  "--color-fg": "#edf3fc",
  "--color-muted": "#b5c4d8",
  "--color-border": "#26282b",
  "--color-up": "#ff4866",
  "--color-down": "#16c57d",
  "--color-tape": "#efd584",
  "--color-vol": "#c4a7ef",
  "--color-vwap": "#bed4ee",
} as CSSProperties;

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

function useMorningData(lessonId: string) {
  const [data, setData] = useState<MorningResponse | null>(null);
  const [busy, setBusy] = useState<MorningAction["action"] | "load" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
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
          setNeedsLogin(true);
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
            setNeedsLogin(true);
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
        setNeedsLogin(false);
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
    needsLogin,
    request,
    retry: () => request(retryAction.current),
  };
}

export function MorningPractice({
  exerciseId,
  lessonId,
  onLessonChange,
}: {
  exerciseId?: string;
  lessonId: string;
  onLessonChange: (lessonId: string) => void;
}) {
  const { user, isPending } = useCurrentUserState();
  const [selectedExercise, setSelectedExercise] = useState(
    () => getMorningExercise(exerciseId)?.id ?? MORNING_EXERCISES[0].id,
  );
  if (isPending)
    return (
      <PageFrame>
        <p role="status" className={CARD}>
          正在確認登入狀態…
        </p>
      </PageFrame>
    );
  return (
    <MorningLesson
      key={`${user?.id ?? "guest"}:${lessonId}`}
      lessonId={lessonId}
      exerciseId={selectedExercise}
      onLessonChange={onLessonChange}
      onExerciseChange={setSelectedExercise}
    />
  );
}

function MorningLesson({
  lessonId,
  exerciseId,
  onLessonChange,
  onExerciseChange,
}: {
  lessonId: string;
  exerciseId: string;
  onLessonChange: (lessonId: string) => void;
  onExerciseChange: (exerciseId: string) => void;
}) {
  const { data, busy, error, notice, needsLogin, request, retry } = useMorningData(lessonId);
  const selectedExercise = exerciseId;
  const mode = useDisplayPreferences((value) => value.mode);
  const layout = useTerminalLayout(mode === "senior");
  const [selected, setSelected] = useState("");
  const [activePane, setActivePane] = useState<MorningPane>("quote");
  const [auto, setAuto] = useState(false);
  const [extended, setExtended] = useState(false);
  const [newPlan, setNewPlan] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const planRegion = useRef<HTMLDivElement>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
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
      Math.max(2000, nextAdvanceAt - Date.now() + 30),
    );
    return () => window.clearTimeout(timer);
  }, [auto, session, busy, atCheckpoint, atEnd, error, notice, nextAdvanceAt, request]);

  useEffect(() => {
    if (planOpen) planRegion.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [planOpen]);

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
    const next = await request({ action: "start", requestId: crypto.randomUUID(), plan });
    if (next?.state) {
      setNewPlan(false);
      setSelected(plan.focusCode);
      setPlanOpen(false);
      setActivePane("quote");
      window.requestAnimationFrame(() => {
        practiceHeading.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "auto" });
      });
    }
  }

  async function order(side: "buy" | "sell", lots: number) {
    if (!session) return;
    setAuto(false);
    const next = await request({
      action: "order",
      requestId: crypto.randomUUID(),
      id: session.id,
      expectedRevision: session.revision,
      code,
      side,
      lots,
    });
    if (next?.state)
      setFeedback("紙上委託已記錄，尚未代表成交。前進一分鐘後，請核對委託與成交紀錄。");
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
      setReviewOpen(false);
      setFeedback("這一輪的計畫、操作與復盤已保存。");
      window.requestAnimationFrame(() => practiceHeading.current?.focus({ preventScroll: true }));
    }
  }

  const showPlan = !session || newPlan;
  const marketSession = newPlan ? null : session;

  return (
    <PageFrame>
      {needsLogin ? (
        <section className={CARD} aria-labelledby="morning-login-title">
          <h1 id="morning-login-title" className="text-xl font-semibold">
            先登入，才能保存這一輪練習
          </h1>
          <p className="mt-3 text-muted">請回大廳登入學員帳號，再進入真實早盤練習。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/" className={PRIMARY}>
              回大廳登入
            </Link>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void request()}
              className={SECONDARY}
            >
              重新檢查
            </button>
          </div>
        </section>
      ) : (
        <>
          {error && (
            <div role="alert" className="quote-alert">
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
            <div role="status" className="quote-alert">
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
            <p role="status" className="quote-loading">
              正在載入歷史行情與已保存的進度…
            </p>
          )}
          {data && catalog && (
            <>
              <section
                className="quote-workbench"
                data-layout={layout}
                aria-label={showPlan ? "當沖大富翁交易盤預覽" : "真實 K 線模擬交易盤"}
              >
                {!singlePane && (
                  <aside className="quote-watch-panel">
                    <MorningWatchlist
                      catalog={catalog}
                      session={marketSession ?? null}
                      code={code}
                      compact={layout === "tablet"}
                      onSelect={(next) => {
                        setSelected(next);
                        setActivePane("quote");
                      }}
                    />
                  </aside>
                )}
                <div className="quote-market-panel">
                  <MorningQuote
                    catalog={catalog}
                    session={marketSession ?? null}
                    code={code}
                    onSelect={setSelected}
                    titleRef={practiceHeading}
                  />
                  <MorningTerminalNav
                    active={singlePane || activePane === "chart" ? activePane : "quote"}
                    onSelect={setActivePane}
                    singlePane={singlePane}
                  />
                  <div className="quote-active-pane">
                    {(!singlePane || activePane === "quote" || activePane === "chart") && (
                      <MorningChart
                        catalog={catalog}
                        session={marketSession ?? null}
                        code={code}
                        candles={activePane === "chart"}
                      />
                    )}
                    {singlePane && activePane === "watch" && (
                      <MorningWatchlist
                        catalog={catalog}
                        session={marketSession ?? null}
                        code={code}
                        onSelect={(next) => {
                          setSelected(next);
                          setActivePane("quote");
                        }}
                      />
                    )}
                    {singlePane &&
                      activePane === "trade" &&
                      (marketSession && !showPlan ? (
                        <div className="quote-mobile-ticket">
                          <AccountSummary session={marketSession} />
                          {!completed && (
                            <PaperOrder
                              key={code}
                              catalog={catalog}
                              session={marketSession}
                              code={code}
                              busy={Boolean(busy || error || notice)}
                              atEnd={atEnd}
                              onOrder={order}
                              onCancel={cancel}
                            />
                          )}
                        </div>
                      ) : (
                        <p className="quote-empty-pane">
                          先保存作戰計畫，前進一分鐘後即可練習紙上委託。
                        </p>
                      ))}
                    {singlePane &&
                      activePane === "positions" &&
                      (marketSession && !showPlan ? (
                        <div className="quote-mobile-ticket">
                          <AccountSummary session={marketSession} />
                          <Ledger
                            catalog={catalog}
                            session={marketSession}
                            busy={Boolean(busy)}
                            onCancel={cancel}
                          />
                        </div>
                      ) : (
                        <p className="quote-empty-pane">
                          練習開始後，庫存、委託與成交會記錄在這裡。
                        </p>
                      ))}
                  </div>
                  <section className="quote-replay-bar" aria-label="歷史行情重播控制">
                    {showPlan ? (
                      <>
                        <span className="quote-replay-time">
                          <Clock3 aria-hidden />
                          <strong>09:00</strong>
                          <small>待開始</small>
                        </span>
                        <button
                          type="button"
                          className="quote-replay-start"
                          onClick={() => setPlanOpen(true)}
                        >
                          <Play aria-hidden />
                          開始練習
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          title="每 2 秒前進 1 分鐘"
                          disabled={
                            Boolean(busy) ||
                            atCheckpoint ||
                            atEnd ||
                            completed ||
                            Boolean(error || notice)
                          }
                          onClick={() => {
                            setFeedback("");
                            setAuto((value) => !value);
                          }}
                          className="quote-replay-button quote-replay-play"
                          aria-label={auto ? "暫停重播" : "自動重播"}
                        >
                          {auto ? <CirclePause aria-hidden /> : <Play aria-hidden />}
                          <span>{auto ? "暫停" : "播放"}</span>
                        </button>
                        <span className="quote-replay-time">
                          <strong>{formatTime(cursor * 60).slice(0, 5)}</strong>
                          <small>{completed ? "已完成" : auto ? "重播中" : "已暫停"}</small>
                        </span>
                        <button
                          type="button"
                          aria-label="前進 1 分鐘"
                          disabled={!canAdvance || Boolean(error || notice)}
                          onClick={() => void advance()}
                          className="quote-replay-button"
                        >
                          +1 分
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy) || completed}
                          onClick={openReview}
                          className="quote-replay-button"
                        >
                          <BookOpen aria-hidden />
                          <span>復盤</span>
                        </button>
                      </>
                    )}
                  </section>
                  {feedback && !showPlan && (
                    <p role="status" className="quote-feedback">
                      {feedback}
                    </p>
                  )}
                  {atCheckpoint && !showPlan && (
                    <div role="status" className="quote-alert">
                      <h2 className="text-lg font-semibold">10:00，回看自己的計畫</h2>
                      <p className="mt-2 text-sm">
                        主要練習時段已結束。可以寫復盤，或選擇延伸至 10:30；系統不會自動平倉。
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={openReview} className={PRIMARY}>
                          現在寫復盤
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtended(true)}
                          className={SECONDARY}
                        >
                          延伸觀察至 10:30
                        </button>
                      </div>
                    </div>
                  )}
                  {atEnd && !completed && !showPlan && (
                    <p role="status" className="quote-alert">
                      已到 {catalog.end}
                      ，本課沒有下一分鐘。請核對委託與剩餘庫存，再保存復盤；系統不會自動平倉。
                    </p>
                  )}
                </div>
                {!singlePane && (
                  <aside className="quote-trade-panel" ref={planRegion}>
                    {showPlan ? (
                      <PlanForm
                        key={
                          catalog.lessonId + ":" + (session?.id ?? "first") + ":" + selectedExercise
                        }
                        catalog={catalog}
                        exerciseId={selectedExercise}
                        busy={Boolean(busy)}
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
                    ) : (
                      <>
                        <AccountSummary session={session} />
                        {!completed && (
                          <PaperOrder
                            key={code}
                            catalog={catalog}
                            session={session}
                            code={code}
                            busy={Boolean(busy || error || notice)}
                            atEnd={atEnd}
                            onOrder={order}
                            onCancel={cancel}
                          />
                        )}
                      </>
                    )}
                  </aside>
                )}
                {singlePane && showPlan && planOpen && (
                  <div className="quote-plan-panel" ref={planRegion}>
                    <button
                      type="button"
                      className="quote-plan-close"
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
                  <div className="quote-ledger-panel">
                    <Ledger
                      catalog={catalog}
                      session={session}
                      busy={Boolean(busy)}
                      onCancel={cancel}
                    />
                  </div>
                )}
              </section>
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
              <details className="quote-settings">
                <summary id="morning-lesson-picker">
                  教材與練習 · {catalog.date} · {exercise?.no ?? "自由練習"}
                </summary>
                <div className="quote-settings-fields">
                  <label>
                    教材交易日
                    <select
                      className={cn(INPUT, "mt-1")}
                      value={catalog.lessonId}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        setAuto(false);
                        onLessonChange(event.target.value);
                      }}
                    >
                      {(data.lessons ?? [catalog]).map((lesson) => (
                        <option key={lesson.lessonId} value={lesson.lessonId}>
                          {lesson.date} · {lesson.symbols.length} 檔 · {lesson.start}–{lesson.end}
                        </option>
                      ))}
                    </select>
                  </label>
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
                {session && !completed && exerciseId && exerciseId !== session.plan.exerciseId && (
                  <p role="status" className="quote-alert">
                    已恢復這個交易日尚未完成的練習。先保存本輪復盤，再切換主題。
                  </p>
                )}
                <Background catalog={catalog} />
                {exercise && (
                  <ExerciseGuide exercise={exercise} compact={Boolean(session && !newPlan)} />
                )}
              </details>
              {session && !newPlan && (
                <details className="quote-settings">
                  <summary>本輪作戰計畫</summary>
                  <SavedPlan plan={session.plan} catalog={catalog} />
                </details>
              )}
              <details className="quote-settings">
                <summary>資料來源與本課使用說明</summary>
                <ul className="list-disc space-y-2 px-6 pb-4 text-sm text-muted">
                  {catalog.notices.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </>
      )}
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div data-market-theme="dark" className="terminal-shell morning-workspace">
      <header className="quote-app-header">
        <Link to="/" aria-label="返回教室大廳" className="quote-home-link">
          <ArrowLeft aria-hidden />
          <span>教室</span>
        </Link>
        <span className="quote-app-name">
          當沖大富翁 <small>模擬看盤</small>
        </span>
        <DisplayControls compact className="quote-reading-control" />
      </header>
      <main className="quote-app-main">{children}</main>
      <footer className="quote-app-footer">真實歷史 K · 紙上模擬成交 · 未連接券商真實帳戶</footer>
    </div>
  );
}

function MorningQuote({
  catalog,
  session,
  code,
  onSelect,
  titleRef,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  onSelect: (code: string) => void;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const index = catalog.symbols.findIndex((item) => item.code === symbol.code);
  const last = session?.bars[symbol.code]?.at(-1);
  const change = last ? last.c - symbol.previousClose : null;
  const tone = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";
  const move = (step: number) =>
    onSelect(
      catalog.symbols[(index + step + catalog.symbols.length) % catalog.symbols.length].code,
    );
  return (
    <div className="quote-overview">
      <div className="quote-stock-title">
        <button type="button" onClick={() => move(-1)} aria-label="上一檔股票">
          <ChevronLeft aria-hidden />
        </button>
        <div>
          <h1 ref={titleRef} tabIndex={-1} id="morning-practice-title">
            {symbol.name}
          </h1>
          <select
            aria-label="選擇股票"
            value={symbol.code}
            onChange={(event) => onSelect(event.target.value)}
          >
            {catalog.symbols.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => move(1)} aria-label="下一檔股票">
          <ChevronRight aria-hidden />
        </button>
      </div>
      <div className="quote-price-row">
        <div className="quote-main-price" data-tone={tone}>
          <p className="quote-last-price">{last ? formatPrice(last.c) : "—"}</p>
          <p className="quote-change">
            {change !== null ? (
              <>
                <span>
                  {change > 0 ? "▲" : change < 0 ? "▼" : ""}
                  {Math.abs(change).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}
                </span>
                <span>
                  {change > 0 ? "+" : ""}
                  {((change / symbol.previousClose) * 100).toFixed(2)}%
                </span>
              </>
            ) : (
              <span>09:00 待開始</span>
            )}
          </p>
          <p className="quote-price-caption">
            {last ? "最新完整分鐘收價" : "尚未揭露第一分鐘"}{" "}
            <span>昨收 {formatPrice(symbol.previousClose)}</span>
          </p>
        </div>
        <div className="quote-bid-ask" aria-label="買賣報價資料狀態">
          <dl>
            <dt>買價</dt>
            <dd>—</dd>
          </dl>
          <dl>
            <dt>賣價</dt>
            <dd>—</dd>
          </dl>
          <p>五檔報價尚未接入</p>
        </div>
      </div>
    </div>
  );
}

function MorningTerminalNav({
  active,
  onSelect,
  singlePane,
}: {
  active: MorningPane;
  onSelect: (pane: MorningPane) => void;
  singlePane: boolean;
}) {
  const items: [MorningPane, string][] = singlePane
    ? [
        ["quote", "行情"],
        ["chart", "K線"],
        ["watch", "自選"],
        ["trade", "下單"],
        ["positions", "庫存"],
      ]
    : [
        ["quote", "行情"],
        ["chart", "K線"],
      ];
  return (
    <nav aria-label="看盤分頁" className="quote-tabs">
      {items.map(([pane, label]) => (
        <button
          key={pane}
          type="button"
          aria-pressed={active === pane}
          onClick={() => onSelect(pane)}
        >
          {label}
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
    <section className="quote-watchlist min-w-0 bg-surface" aria-label="自選行情">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-elevated px-3 py-2 text-xs font-semibold">
        <span>自選行情</span>
        <span className="font-normal text-muted">5 檔</span>
      </div>
      <div className={cn(compact && "flex overflow-x-auto")} role="group" aria-label="選擇重播商品">
        {catalog.symbols.map((symbol) => {
          const last = session?.bars[symbol.code]?.at(-1);
          const change = last ? last.c - symbol.previousClose : null;
          const changeClass =
            change === null
              ? "text-muted"
              : change > 0
                ? "text-up"
                : change < 0
                  ? "text-down"
                  : "text-fg";
          return (
            <button
              type="button"
              key={symbol.code}
              aria-pressed={code === symbol.code}
              onClick={() => onSelect(symbol.code)}
              className={cn(
                "block min-h-16 min-w-0 border-b border-border px-3 py-2 text-left text-sm leading-relaxed hover:bg-elevated",
                code === symbol.code && "bg-brand/10 text-brand",
                compact ? "min-w-32 flex-1 shrink-0 border-b-0 border-r bg-surface px-2" : "w-full",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{symbol.name}</span>
                <span className="font-mono text-xs text-muted">{symbol.code}</span>
              </span>
              <span
                className={cn(
                  "mt-1 flex items-baseline justify-between gap-2 font-mono",
                  changeClass,
                )}
              >
                <strong className="text-base">{last ? formatPrice(last.c) : "—"}</strong>
                {change !== null && (
                  <span className="text-xs">
                    {change > 0 ? "+" : ""}
                    {formatPrice(change)}{" "}
                    <span className="hidden sm:inline">
                      ({change > 0 ? "+" : ""}
                      {((change / symbol.previousClose) * 100).toFixed(2)}%)
                    </span>
                  </span>
                )}
              </span>
              {!compact && (
                <span className="block text-xs text-muted">
                  昨收 {formatPrice(symbol.previousClose)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="px-3 py-2 text-xs leading-relaxed text-muted">
          未完成分鐘不顯示價格 · 尚無真實五檔
        </p>
      )}
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

function PlanForm({
  catalog,
  exerciseId,
  busy,
  onStart,
  onCancel,
}: {
  catalog: MorningCatalog;
  exerciseId: string;
  busy: boolean;
  onStart: (plan: MorningPlan) => Promise<void>;
  onCancel?: () => void;
}) {
  const [plan, setPlan] = useState<MorningPlan>({
    exerciseId,
    bias: "observe",
    focusCode: catalog.symbols[0]?.code ?? "",
    reason: "",
    entry: "",
    stop: "",
  });
  const [invalid, setInvalid] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      ...plan,
      reason: plan.reason.trim(),
      entry: plan.entry.trim(),
      stop: plan.stop.trim(),
    };
    if (!next.reason || !next.entry || !next.stop) {
      setInvalid("每一欄都寫下自己的想法；尚不確定也可以說明正在等待什麼。");
      return;
    }
    setInvalid("");
    void onStart(next);
  }
  return (
    <section className={CARD} aria-labelledby="morning-plan-title">
      <p className="text-xs font-semibold text-brand">09:00 開始前 · 交易計畫</p>
      <h2 id="morning-plan-title" className="mt-1 text-lg font-semibold">
        寫下今天的作戰藍圖
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        不需要先猜對漲跌。計畫會隨新的一輪保存，重播期間保留原文供復盤核對。
      </p>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <fieldset disabled={busy} className="min-w-0 space-y-3 disabled:opacity-60">
          <legend className="sr-only">本輪觀察計畫</legend>
          <label className="block text-base font-medium">
            先關注哪一檔
            <select
              value={plan.focusCode}
              onChange={(event) => setPlan({ ...plan, focusCode: event.target.value })}
              className={cn(INPUT, "mt-1")}
            >
              {catalog.symbols.map((symbol) => (
                <option key={symbol.code} value={symbol.code}>
                  {symbol.code} {symbol.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-base font-medium">目前的觀察方向</legend>
            <div className="grid gap-1.5">
              {(
                [
                  { value: "observe", label: "先觀察／不確定" },
                  { value: "bullish", label: "觀察偏多條件" },
                  { value: "bearish", label: "觀察偏空條件" },
                ] as const
              ).map((item) => (
                <label
                  key={item.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="morning-bias"
                    value={item.value}
                    checked={plan.bias === item.value}
                    onChange={() => setPlan({ ...plan, bias: item.value })}
                    className="size-5 shrink-0"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {(
            [
              {
                key: "reason",
                label: "我觀察的理由",
                hint: "先描述背景或價格條件，不必寫成買賣答案。",
              },
              {
                key: "entry",
                label: "什麼條件出現，我才考慮操作",
                hint: "沒有符合條件，也可以選擇繼續等待。",
              },
              {
                key: "stop",
                label: "什麼情況代表計畫失效，需要停止或重新核對",
                hint: "寫下自己能核對的條件。",
              },
            ] as const
          ).map((field) => (
            <label key={field.key} className="block text-base font-medium">
              {field.label}
              <span className="mt-1 block text-xs font-normal leading-relaxed text-muted">
                {field.hint}
              </span>
              <textarea
                required
                maxLength={600}
                rows={2}
                value={plan[field.key]}
                onChange={(event) => setPlan({ ...plan, [field.key]: event.target.value })}
                className={cn(INPUT, "mt-1 resize-y font-normal")}
              />
            </label>
          ))}
        </fieldset>
        {invalid && (
          <p role="alert" className="text-base text-warn">
            {invalid}
          </p>
        )}
        <div className="border border-border bg-bg p-2 text-xs leading-relaxed text-muted">
          本課紙上資金為新臺幣 1,000 萬元，每筆 1–3 張。價格來自歷史分鐘
          K；學員成交依教材模型估算，不是真實成交回放。
        </div>
        <button type="submit" disabled={busy} className={cn(PRIMARY, "w-full")}>
          {busy ? "正在保存…" : "保存計畫，進入 09:00 練習"}
          <ArrowRight className="size-5 shrink-0" aria-hidden />
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={cn(SECONDARY, "w-full")}
          >
            回看上一輪紀錄
          </button>
        )}
      </form>
    </section>
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
  return (
    <section
      className="quote-chart-panel"
      style={DARK_CHART}
      aria-label={symbol.name + "歷史分鐘行情"}
    >
      <div className="quote-chart-heading">
        <span className="quote-data-chip">{candles ? "真實 1 分 K" : "分鐘收價"}</span>
        <span>
          {catalog.date} {formatTime((session?.cursor ?? 0) * 60).slice(0, 5)}{" "}
          <small>台北時間</small>
        </span>
      </div>
      <div className="quote-chart-canvas">
        {last && session ? (
          <TapeChart
            bars={bars}
            ticks={[]}
            prev={symbol.previousClose}
            high={Math.max(...bars.map((bar) => bar.h))}
            low={Math.min(...bars.map((bar) => bar.l))}
            last={last.c}
            open={bars[0]?.o}
            startT={0}
            endT={catalog.maxCursor * 60}
            now={session.cursor * 60}
            range={{ start: 0, end: session.cursor * 60 }}
            variant={candles ? "candles" : "stock"}
            showVolume={false}
            showAverage={false}
            showVolumeReadout={false}
            appendCurrentQuote={false}
            completedBarSeconds={60}
            interactive
            ariaLabel={
              catalog.date +
              " " +
              code +
              " " +
              symbol.name +
              "歷史" +
              (candles ? "一分鐘K線" : "分鐘收價連線") +
              "，只包含目前已完成分鐘，不顯示成交量或均價。"
            }
          />
        ) : (
          <div className="quote-chart-waiting">
            <strong>09:00</strong>
            <span>等待第一根完整 K 棒</span>
            <small>
              {session ? "前進一分鐘後揭露真實行情" : "先保存作戰計畫，開始當日歷史回放"}
            </small>
          </div>
        )}
      </div>
      <div className="quote-period-strip">
        <span className="quote-period-active">當日</span>
        <span>09:00–{catalog.end}</span>
        <span>{candles ? "開高低收" : "分鐘收價連線"}</span>
      </div>
      {last && (
        <dl className="quote-ohlc" aria-label="最新真實 K 棒開高低收">
          {(
            [
              ["開", last.o],
              ["高", last.h],
              ["低", last.l],
              ["收", last.c],
            ] as const
          ).map(([label, price]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatPrice(price)}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="quote-data-details">
        <summary>報價彙總與 K 棒明細{last ? " · " + bars.length + " 根" : ""}</summary>
        <div className="quote-data-details-body">
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
              className="quote-candle-table"
              tabIndex={0}
              role="region"
              aria-label="已完成分鐘 K 線明細，可捲動查看"
            >
              <table>
                <caption>
                  {catalog.date} · {symbol.name} {code} · Yahoo Finance 原始
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
            {candles
              ? "每根 K 線直接使用來源開高低收，該分鐘完成後才揭露整根。"
              : "連線只連接各分鐘收價，點位標在分鐘結束時間，不代表分鐘內逐筆路徑；缺漏區間保留斷線。"}{" "}
            點按圖表或用左右方向鍵查看資料。
          </p>
          <p>
            來源：Yahoo Finance 歷史 1 分鐘 OHLC。這是真實歷史分鐘 K，尚非富邦即時或逐筆江波行情。
          </p>
          <p>
            分鐘量尚未核對，不顯示量柱、均價或量能訊號；沒有真實五檔。資料缺漏不會以生成價格補齊。
          </p>
        </div>
      </details>
    </section>
  );
}

function AccountSummary({ session }: { session: MorningState }) {
  return (
    <section className="min-w-0 border border-border bg-surface p-3" aria-label="紙上帳戶">
      <h3 className="border-b border-border pb-2 text-sm font-semibold">
        紙上帳戶 <span className="ml-1 font-normal text-muted">／模擬</span>
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        <Metric label="可用紙上現金" value={formatMoney(session.cash, 0)} />
        <Metric label="依已知價格的帳戶估值" value={formatMoney(session.equity, 0)} />
        <Metric label="起始紙上資金" value={formatMoney(session.startingCash, 0)} />
        <Metric label="持有商品" value={`${session.positions.length} 檔`} />
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        估值只使用目前已揭露的價格；尚未賣出的部位不是已實現結果。
      </p>
    </section>
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

function PaperOrder({
  catalog,
  session,
  code,
  busy,
  atEnd,
  onOrder,
  onCancel,
}: {
  catalog: MorningCatalog;
  session: MorningState;
  code: string;
  busy: boolean;
  atEnd: boolean;
  onOrder: (side: "buy" | "sell", lots: number) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [lots, setLots] = useState(1);
  const position = session.positions.find((item) => item.code === code);
  const pending = session.orders.find((item) => item.status === "pending");
  const symbol = catalog.symbols.find((item) => item.code === code);
  const invalidSell = side === "sell" && (!position || lots * 1000 > position.shares);
  return (
    <section
      className="min-w-0 border border-border bg-surface p-3"
      aria-labelledby="morning-order-title"
    >
      <h3 id="morning-order-title" className="border-b border-border pb-2 text-base font-semibold">
        紙上委託 · {symbol?.name ?? code}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        每筆 1–3 張，1 張為 1,000 股。下一分鐘開盤資料到達後才處理，送出當下不代表成交。
      </p>
      {session.cursor < 1 && (
        <p className="mt-3 rounded-xl bg-bg p-3 text-base leading-relaxed">
          請先前進 1 分鐘，看完第一根完整 K 線後，再考慮是否送出紙上委託。
        </p>
      )}
      {pending ? (
        <div role="status" className="mt-4 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <p className="text-base font-medium">有一筆委託等待下一分鐘</p>
          <p className="mt-2 text-base">
            {pending.code} · {pending.side === "buy" ? "買進" : "賣出"} {pending.shares / 1000} 張
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onCancel(pending.id)}
            className={cn(SECONDARY, "mt-3 w-full")}
          >
            撤回這筆待處理委託
          </button>
        </div>
      ) : null}
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !pending && !atEnd && session.cursor >= 1 && !invalidSell)
            void onOrder(side, lots);
        }}
      >
        <fieldset
          disabled={busy || Boolean(pending) || atEnd || session.cursor < 1}
          className="min-w-0 space-y-3 disabled:opacity-55"
        >
          <legend className="sr-only">紙上委託方向與張數</legend>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="紙上買賣方向">
            <button
              type="button"
              aria-pressed={side === "buy"}
              onClick={() => setSide("buy")}
              className={cn(SECONDARY, side === "buy" && "border-brand bg-brand/10")}
            >
              買進
            </button>
            <button
              type="button"
              disabled={!position?.shares}
              aria-pressed={side === "sell"}
              onClick={() => setSide("sell")}
              className={cn(SECONDARY, side === "sell" && "border-brand bg-brand/10")}
            >
              賣出持倉
            </button>
          </div>
          <p className="text-sm text-muted">
            目前持有 {position ? position.shares / 1000 : 0} 張；先有做多持倉，才能賣出。
          </p>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-base font-medium">委託張數</legend>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={lots === value}
                  disabled={side === "sell" && value * 1000 > (position?.shares ?? 0)}
                  onClick={() => setLots(value)}
                  className={cn(SECONDARY, lots === value && "border-brand bg-brand/10")}
                >
                  {value} 張
                </button>
              ))}
            </div>
          </fieldset>
          <p className="border border-border bg-bg p-2 text-sm leading-relaxed">
            {side === "buy" ? "買進" : "賣出"} {code} · {lots} 張（
            {(lots * 1000).toLocaleString("zh-TW")}{" "}
            股）。價格採下一分鐘開盤價，仍須通過紙上資金與庫存檢核。
          </p>
          {invalidSell && (
            <p className="text-base text-warn">賣出張數超過目前持倉，請重新選擇張數。</p>
          )}
          <button type="submit" disabled={invalidSell} className={cn(PRIMARY, "w-full")}>
            送出紙上{side === "buy" ? "買進" : "賣出"}委託
          </button>
        </fieldset>
      </form>
      <p className="mt-3 border-t border-border pt-2 text-xs leading-relaxed text-muted">
        教材手續費為買賣各 0.0855%（每筆最低 20 元），賣出另估 0.15% 稅費，逐筆四捨五入。
        沒有真實排隊、滑價或委託簿深度；這些固定練習參數與券商實際帳單可能不同。
      </p>
    </section>
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

function Ledger({
  catalog,
  session,
  busy,
  onCancel,
}: {
  catalog: MorningCatalog;
  session: MorningState;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
}) {
  const name = (code: string) => catalog.symbols.find((item) => item.code === code)?.name ?? code;
  const status = {
    pending: "待下一分鐘處理",
    filled: "已成交",
    cancelled: "已撤回",
    rejected: "未接受",
  };
  return (
    <section className={CARD} aria-labelledby="morning-records-title">
      <h3 id="morning-records-title" className="text-xl font-semibold">
        逐筆核對你的紀錄
      </h3>
      <h4 className="mt-5 text-base font-semibold">剩餘庫存</h4>
      {session.positions.length ? (
        <ul className="mt-2 space-y-2">
          {session.positions.map((item) => (
            <li key={item.code} className="rounded-xl bg-bg p-3 text-base leading-relaxed">
              <strong>
                {name(item.code)} {item.code}
              </strong>
              <p>
                {item.shares / 1000} 張 · 平均成本（未含費）
                {item.averageCost.toLocaleString("zh-TW", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-base text-muted">目前沒有庫存。</p>
      )}
      <details className="mt-5" open>
        <summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">
          委託紀錄（{session.orders.length}）
        </summary>
        {session.orders.length ? (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {session.orders
              .slice()
              .reverse()
              .map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-border p-3 text-base leading-relaxed"
                >
                  <p className="flex flex-wrap justify-between gap-2">
                    <strong>
                      {name(item.code)} · {item.side === "buy" ? "買進" : "賣出"}{" "}
                      {item.shares / 1000} 張
                    </strong>
                    <span>{status[item.status]}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formatTime(item.submittedCursor * 60).slice(0, 5)} 送出
                    {item.price !== undefined ? ` · 處理價格 ${formatPrice(item.price)}` : ""}
                  </p>
                  {item.reason && <p className="mt-2 text-base text-warn">{item.reason}</p>}
                  {item.status === "pending" && !session.completed && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onCancel(item.id)}
                      className={cn(SECONDARY, "mt-2 w-full")}
                    >
                      撤回這筆待處理委託
                    </button>
                  )}
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-base text-muted">目前沒有送出委託，保持觀察也可以。</p>
        )}
      </details>
      <details className="mt-3" open>
        <summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">
          紙上成交（{session.fills.length}）
        </summary>
        {session.fills.length ? (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {session.fills
              .slice()
              .reverse()
              .map((fill) => (
                <li
                  key={fill.id}
                  className="rounded-xl border border-border p-3 text-base leading-relaxed"
                >
                  <strong>
                    {name(fill.code)} · {fill.side === "buy" ? "買進" : "賣出"} {fill.shares / 1000}{" "}
                    張
                  </strong>
                  <p className="mt-1 font-mono">
                    {formatTime(fill.t).slice(0, 5)} · {formatPrice(fill.price)}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    教材手續費 {formatMoney(fill.fee)} · 交易稅 {formatMoney(fill.tax)}
                  </p>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-base text-muted">尚無紙上成交。送出委託不等於已成交。</p>
        )}
      </details>
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
