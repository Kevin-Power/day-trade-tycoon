import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CirclePause,
  Clock3,
  Play,
  RotateCcw,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
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

const ACTION =
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 whitespace-normal rounded-xl px-4 py-3 text-base font-semibold leading-relaxed disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY = `${ACTION} bg-brand text-brand-fg hover:brightness-95`;
const SECONDARY = `${ACTION} border border-border-strong bg-surface text-fg hover:bg-elevated`;
const INPUT =
  "block min-h-12 w-full min-w-0 rounded-xl border border-border-strong bg-surface px-3 py-3 text-base leading-relaxed text-fg";
const CARD = "min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-6";
const DARK_CHART = {
  "--color-bg": "#101b2c",
  "--color-fg": "#edf3fc",
  "--color-muted": "#b5c4d8",
  "--color-border": "#314257",
  "--color-up": "#ff8a99",
  "--color-down": "#74dbb5",
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

function useMorningData() {
  const [data, setData] = useState<MorningResponse | null>(null);
  const [busy, setBusy] = useState<MorningAction["action"] | "load" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const locked = useRef(false);
  const serial = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryAction = useRef<MorningAction | undefined>(undefined);

  const request = useCallback(async (action?: MorningAction): Promise<MorningResponse | null> => {
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
      const response = await fetch("/api/morning", {
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
        const latest = await fetch("/api/morning", {
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
  }, []);

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

export function MorningPractice() {
  const { user, isPending } = useCurrentUserState();
  if (isPending)
    return (
      <PageFrame>
        <p role="status" className={CARD}>
          正在確認登入狀態…
        </p>
      </PageFrame>
    );
  return <MorningLesson key={user?.id ?? "guest"} />;
}

function MorningLesson() {
  const { data, busy, error, notice, needsLogin, request, retry } = useMorningData();
  const mode = useDisplayPreferences((value) => value.mode);
  const layout = useTerminalLayout(mode === "senior");
  const [selected, setSelected] = useState("");
  const [auto, setAuto] = useState(false);
  const [extended, setExtended] = useState(false);
  const [newPlan, setNewPlan] = useState(false);
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
  const atCheckpoint = cursor === 60 && !extended && !completed;
  const atEnd = Boolean(catalog && cursor >= catalog.maxCursor);
  const nextAdvanceAt = session?.nextAdvanceAt ?? 0;
  const canAdvance = Boolean(
    session && !completed && !atCheckpoint && !atEnd && !busy && clock >= nextAdvanceAt,
  );
  const code = catalog?.symbols.some((symbol) => symbol.code === selected)
    ? selected
    : (session?.plan.focusCode ?? catalog?.symbols[0]?.code ?? "");

  useEffect(() => {
    setAuto(false);
    setNewPlan(false);
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
      window.requestAnimationFrame(() => {
        practiceHeading.current?.focus({ preventScroll: true });
        practiceHeading.current?.scrollIntoView({ block: "start" });
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

  return (
    <PageFrame>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <p className="text-base font-semibold text-brand">真實早盤練習 · 單日資料試行</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            先有自己的計畫，
            <br />
            再看下一分鐘。
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            歷史分鐘行情，搭配紙上委託與復盤。慢慢看、自己決定何時前進；這裡不會送出真實委託。
          </p>
        </div>
        {catalog && (
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-sm text-muted">教材交易日</p>
            <p className="mt-1 font-mono text-xl font-semibold">{catalog.date}</p>
            <p className="mt-1 text-sm text-muted">
              {catalog.start}–{catalog.end} · Asia/Taipei
            </p>
          </div>
        )}
      </div>

      {needsLogin ? (
        <section className={CARD} aria-labelledby="morning-login-title">
          <h2 id="morning-login-title" className="text-xl font-semibold">
            先登入，才能保存這一輪練習
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted">
            請回大廳登入學員帳號，再進入真實早盤練習。若已登入，可重新檢查。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
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
            <div
              role="alert"
              className="mb-5 rounded-2xl border border-warn/40 bg-warn/5 p-4 text-base leading-relaxed"
            >
              <p>{error}</p>
              <p className="mt-2 text-sm text-muted">
                無法確認的操作不會自動重送。請重試同一筆，或重新載入後核對紀錄。
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
            <p
              role="status"
              className="mb-5 rounded-xl border border-border bg-elevated p-4 text-base leading-relaxed"
            >
              {notice}
            </p>
          )}
          {!data && busy && (
            <p role="status" className={CARD}>
              正在載入本課教材與已保存的進度…
            </p>
          )}
          {data && catalog && (
            <>
              <ol aria-label="練習流程" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {["看背景與規則", "寫自己的計畫", "逐分鐘練習", "保存復盤"].map((label, index) => (
                  <li
                    key={label}
                    aria-current={
                      (
                        completed && !newPlan
                          ? index === 3
                          : session && !newPlan
                            ? index === 2
                            : index === 0
                      )
                        ? "step"
                        : undefined
                    }
                    className="min-w-0 rounded-xl border border-border bg-surface px-3 py-3 text-base leading-relaxed aria-[current=step]:border-brand aria-[current=step]:bg-brand/10"
                  >
                    <span className="mr-2 font-mono text-brand">0{index + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
              {!session || newPlan ? (
                <div
                  className={cn(
                    "grid items-start gap-6",
                    layout === "desktop" && "grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
                  )}
                >
                  <Background catalog={catalog} expanded={layout === "desktop"} />
                  <PlanForm
                    key={`${catalog.lessonId}:${session?.id ?? "first"}`}
                    catalog={catalog}
                    busy={Boolean(busy)}
                    onStart={start}
                    onCancel={session ? () => setNewPlan(false) : undefined}
                  />
                </div>
              ) : (
                <>
                  <section className="mb-6" aria-labelledby="morning-practice-title">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-muted">{catalog.title}</p>
                        <h2
                          ref={practiceHeading}
                          tabIndex={-1}
                          id="morning-practice-title"
                          className="mt-1 scroll-mt-4 text-2xl font-semibold outline-none"
                        >
                          {completed ? "這一輪，已留下你的練習紀錄" : "依照自己的步調，看下一分鐘"}
                        </h2>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-base">
                        <Clock3 className="size-5 shrink-0" aria-hidden />
                        <strong className="font-mono text-xl">
                          {formatTime(cursor * 60).slice(0, 5)}
                        </strong>
                        <span>{completed ? "已完成" : auto ? "重播中" : "已暫停"}</span>
                      </span>
                    </div>
                    {!completed && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          disabled={
                            Boolean(busy) || atCheckpoint || atEnd || Boolean(error || notice)
                          }
                          onClick={() => { setFeedback(""); setAuto((value) => !value); }}
                          className={PRIMARY}
                        >
                          {auto ? (
                            <CirclePause className="size-5 shrink-0" aria-hidden />
                          ) : (
                            <Play className="size-5 shrink-0" aria-hidden />
                          )}
                          {auto ? "暫停重播" : "自動播放 · 每 2 秒 1 分鐘"}
                        </button>
                        <button
                          type="button"
                          disabled={!canAdvance || Boolean(error || notice)}
                          onClick={() => void advance()}
                          className={SECONDARY}
                        >
                          前進 1 分鐘
                          <ArrowRight className="size-5 shrink-0" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={openReview}
                          className={SECONDARY}
                        >
                          <BookOpen className="size-5 shrink-0" aria-hidden />
                          前往復盤
                        </button>
                      </div>
                    )}
                    {notice && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void request()}
                        className={cn(SECONDARY, "mt-3")}
                      >
                        已核對，載入目前進度
                      </button>
                    )}
                    {!completed && (
                      <p className="mt-3 text-sm leading-relaxed text-muted">
                        每次只揭露已完成的一分鐘。切換商品共用相同時間，離開分頁會停止自動播放。重新進入時保持暫停。
                      </p>
                    )}
                    {atCheckpoint && (
                      <div
                        role="status"
                        className="mt-4 rounded-2xl border border-brand/30 bg-brand/5 p-5"
                      >
                        <h3 className="text-xl font-semibold">10:00，先停一下，回看自己的計畫</h3>
                        <p className="mt-2 text-base leading-relaxed">
                          主要練習時段已結束。可以直接寫復盤，或明確選擇延伸至
                          10:30；系統不會自動平倉。
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
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
                    {atEnd && !completed && (
                      <p
                        role="status"
                        className="mt-4 rounded-xl border border-border bg-surface p-4 text-base leading-relaxed"
                      >
                        已到 {catalog.end}
                        ，本課沒有下一分鐘可前進。請核對委託與剩餘庫存，再保存復盤；系統不會自動平倉。
                      </p>
                    )}
                    {feedback && (
                      <p role="status" className="mt-3 text-base leading-relaxed text-brand">
                        {feedback}
                      </p>
                    )}
                  </section>

                  {completed && (
                    <Completion
                      session={session}
                      busy={Boolean(busy)}
                      onRestart={() => {
                        setAuto(false);
                        setNewPlan(true);
                        window.scrollTo({ top: 0, behavior: "auto" });
                      }}
                    />
                  )}

                  <div
                    className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5"
                    role="group"
                    aria-label="選擇重播商品"
                  >
                    {catalog.symbols.map((symbol) => (
                      <button
                        type="button"
                        key={symbol.code}
                        aria-pressed={code === symbol.code}
                        onClick={() => setSelected(symbol.code)}
                        className={cn(
                          "min-h-14 min-w-0 rounded-xl border px-3 py-3 text-left text-base leading-relaxed",
                          code === symbol.code
                            ? "border-brand bg-brand/10"
                            : "border-border bg-surface hover:bg-elevated",
                        )}
                      >
                        <span className="block font-semibold">{symbol.name}</span>
                        <span className="font-mono text-sm text-muted">{symbol.code}</span>
                      </button>
                    ))}
                  </div>

                  <div
                    className={cn(
                      "grid items-start gap-5",
                      layout === "desktop" && "grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]",
                    )}
                  >
                    <MorningChart catalog={catalog} session={session} code={code} />
                    <div className="min-w-0 space-y-5">
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
                    </div>
                  </div>

                  {reviewOpen && !completed && (
                    <section className={cn(CARD, "my-6")} aria-labelledby="morning-review-title">
                      <h2
                        ref={reviewHeading}
                        id="morning-review-title"
                        tabIndex={-1}
                        className="scroll-mt-4 text-2xl font-semibold outline-none"
                      >
                        先寫下這一輪看到的事
                      </h2>
                      <p className="mt-3 text-base leading-relaxed text-muted">
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

                  <div
                    className={cn(
                      "my-6 grid items-start gap-5",
                      layout !== "phone" && layout !== "senior" && "grid-cols-2",
                    )}
                  >
                    <SavedPlan plan={session.plan} catalog={catalog} />
                    <Ledger
                      catalog={catalog}
                      session={session}
                      busy={Boolean(busy)}
                      onCancel={cancel}
                    />
                  </div>
                  <Background catalog={catalog} />
                </>
              )}
              <details className={cn(CARD, "mt-6")}>
                <summary className="flex min-h-12 cursor-pointer items-center text-base font-semibold">
                  資料來源與本課使用說明
                </summary>
                <ul className="mt-3 list-disc space-y-3 pl-5 text-base leading-relaxed text-muted">
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
    <div className="academy-page min-h-dvh min-w-0 bg-bg text-base text-fg [overflow-wrap:anywhere]">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex min-h-12 min-w-0 items-center gap-3 text-base font-semibold">
            <BrandMark className="size-10 shrink-0" />
            當沖大富翁
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <DisplayControls />
            <Link
              to="/"
              className="inline-flex min-h-12 items-center gap-2 px-2 text-base text-brand"
            >
              <ArrowLeft className="size-5 shrink-0" aria-hidden />
              回大廳
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-10">{children}</main>
      <footer className="mx-auto max-w-7xl border-t border-border px-4 py-6 text-sm leading-relaxed text-muted sm:px-6">
        歷史資料教學試行 · 所有委託均為紙上模擬 · 沒有連接券商真實交易帳戶。
      </footer>
    </div>
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
  busy,
  onStart,
  onCancel,
}: {
  catalog: MorningCatalog;
  busy: boolean;
  onStart: (plan: MorningPlan) => Promise<void>;
  onCancel?: () => void;
}) {
  const [plan, setPlan] = useState<MorningPlan>({
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
      <p className="text-sm font-semibold text-brand">開始之前 · 保存這一刻的想法</p>
      <h2 id="morning-plan-title" className="mt-2 text-2xl font-semibold">
        先寫自己的作戰藍圖
      </h2>
      <p className="mt-3 text-base leading-relaxed text-muted">
        不需要先猜對漲跌。計畫會隨新的一輪保存，重播期間保留原文供復盤核對。
      </p>
      <form className="mt-5 space-y-5" onSubmit={submit}>
        <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-60">
          <legend className="sr-only">本輪觀察計畫</legend>
          <label className="block text-base font-medium">
            先關注哪一檔
            <select
              value={plan.focusCode}
              onChange={(event) => setPlan({ ...plan, focusCode: event.target.value })}
              className={cn(INPUT, "mt-2")}
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
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  { value: "observe", label: "先觀察／不確定" },
                  { value: "bullish", label: "觀察偏多條件" },
                  { value: "bearish", label: "觀察偏空條件" },
                ] as const
              ).map((item) => (
                <label
                  key={item.value}
                  className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-3 text-base"
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
              <span className="mt-1 block text-sm font-normal leading-relaxed text-muted">
                {field.hint}
              </span>
              <textarea
                required
                maxLength={600}
                rows={3}
                value={plan[field.key]}
                onChange={(event) => setPlan({ ...plan, [field.key]: event.target.value })}
                className={cn(INPUT, "mt-2 resize-y font-normal")}
              />
            </label>
          ))}
        </fieldset>
        {invalid && (
          <p role="alert" className="text-base text-warn">
            {invalid}
          </p>
        )}
        <div className="rounded-xl bg-bg p-3 text-base leading-relaxed text-muted">
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
}: {
  catalog: MorningCatalog;
  session: MorningState;
  code: string;
}) {
  const [candles, setCandles] = useState(true);
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const bars = session.bars[code] ?? [];
  const last = bars.at(-1);
  const lastPrice = last?.c ?? symbol.previousClose;
  return (
    <section
      className="min-w-0 overflow-hidden rounded-3xl border border-slate-700 bg-[#101b2c] text-slate-100"
      style={DARK_CHART}
      aria-label={`${symbol.name}歷史分鐘行情`}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 px-4 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-sm text-slate-300">歷史分鐘行情 · 已完成 K 線</p>
          <h3 className="mt-2 flex flex-wrap items-baseline gap-2 text-2xl font-semibold">
            {symbol.name}
            <span className="font-mono text-base font-normal text-slate-300">{code}</span>
          </h3>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-slate-300">
            {last ? "最新已揭露分鐘收價" : "尚未揭露第一分鐘"}
          </p>
          <p className="mt-1 break-all font-mono text-3xl font-semibold">
            {last ? formatPrice(lastPrice) : "—"}
          </p>
          {last && (
            <p className="mt-1 text-sm text-slate-300">{formatTime(last.t).slice(0, 5)} 分鐘</p>
          )}
        </div>
      </header>
      <div
        className="mx-4 grid grid-cols-2 gap-2 sm:mx-6"
        role="group"
        aria-label="分鐘行情圖表類型"
      >
        <button
          type="button"
          aria-pressed={candles}
          onClick={() => setCandles(true)}
          className={cn(
            ACTION,
            "border border-slate-500",
            candles ? "bg-slate-100 text-slate-900" : "text-slate-100",
          )}
        >
          1 分鐘 K 線
        </button>
        <button
          type="button"
          aria-pressed={!candles}
          onClick={() => setCandles(false)}
          className={cn(
            ACTION,
            "border border-slate-500",
            !candles ? "bg-slate-100 text-slate-900" : "text-slate-100",
          )}
        >
          分鐘收價連線
        </button>
      </div>
      <div className="mt-4 h-[clamp(18rem,44dvh,30rem)] min-w-0 px-2">
        {last ? (
          <TapeChart
            bars={bars}
            ticks={[]}
            prev={symbol.previousClose}
            high={Math.max(...bars.map((bar) => bar.h))}
            low={Math.min(...bars.map((bar) => bar.l))}
            last={lastPrice}
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
            interactive
            ariaLabel={`${catalog.date} ${code} ${symbol.name}歷史${candles ? "一分鐘K線" : "分鐘收價連線"}，只包含目前已完成分鐘，不顯示成交量或均價。`}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-base leading-relaxed text-slate-300">
            現在是 09:00。
            <br />
            前進一分鐘後，才揭露第一根完整 K 線。
          </div>
        )}
      </div>
      <div className="grid gap-3 border-t border-slate-700 px-4 py-4 text-base sm:grid-cols-2 sm:px-6">
        <dl>
          <dt className="text-sm text-slate-300">前一交易日收盤</dt>
          <dd className="mt-1 font-mono text-lg">{formatPrice(symbol.previousClose)}</dd>
        </dl>
        <dl>
          <dt className="text-sm text-slate-300">前 5 個完整交易日收盤均值</dt>
          <dd className="mt-1 font-mono text-lg">
            {symbol.previous5CloseMean.toLocaleString("zh-TW", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </dd>
        </dl>
      </div>
      <div className="space-y-2 px-4 pb-5 text-sm leading-relaxed text-slate-300 sm:px-6">
        <p>以上均值不含本日，僅供歷史參考；當日 SMA5 的計算定義尚未確認。</p>
        <p>
          {candles
            ? "每根 K 線是該分鐘完成後才可見的開高低收。"
            : "連線只連接各分鐘收價，不代表分鐘內逐筆路徑；跨缺漏區間的連線也不是補回的行情。"}
          點按圖表或用左右方向鍵查看資料。
        </p>
        <p>
          分鐘量尚未核對，不顯示量柱、均價或量能訊號；沒有真實五檔。資料缺漏不會以生成價格補齊。
        </p>
      </div>
    </section>
  );
}

function AccountSummary({ session }: { session: MorningState }) {
  return (
    <section className={CARD} aria-label="紙上帳戶">
      <h3 className="text-xl font-semibold">紙上帳戶</h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Metric label="可用紙上現金" value={formatMoney(session.cash, 0)} />
        <Metric label="依已知價格的帳戶估值" value={formatMoney(session.equity, 0)} />
        <Metric label="起始紙上資金" value={formatMoney(session.startingCash, 0)} />
        <Metric label="持有商品" value={`${session.positions.length} 檔`} />
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        估值只使用目前已揭露的價格；尚未賣出的部位不是已實現結果。
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm leading-relaxed text-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-lg font-semibold">{value}</dd>
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
    <section className={CARD} aria-labelledby="morning-order-title">
      <h3 id="morning-order-title" className="text-xl font-semibold">
        紙上委託 · {symbol?.name ?? code}
      </h3>
      <p className="mt-3 text-base leading-relaxed text-muted">
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
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !pending && !atEnd && session.cursor >= 1 && !invalidSell)
            void onOrder(side, lots);
        }}
      >
        <fieldset
          disabled={busy || Boolean(pending) || atEnd || session.cursor < 1}
          className="min-w-0 space-y-4 disabled:opacity-55"
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
          <p className="rounded-xl bg-bg p-3 text-base leading-relaxed">
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
      <p className="mt-4 text-sm leading-relaxed text-muted">
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
