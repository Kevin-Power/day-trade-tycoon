import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Flame } from "lucide-react";
import { TapeChart } from "@/components/charts";
import { DisplayControls } from "@/components/display-controls";
import { DisciplineCelebration } from "@/components/discipline-celebration";
import { AccessCard } from "@/components/access-card";
import { useGuestBootstrap } from "@/components/use-guest-bootstrap";
import { useSay } from "@/components/use-speech";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { unlockChime } from "@/lib/celebration-sound";
import { useTerminalLayout } from "@/lib/use-terminal-layout";
import { describeAccessProblem, GUEST_TERMS_TEXT } from "@/lib/morning-access";
import { limitDown, stepTick } from "@/lib/market/ticks";
import { DAILY_REASONS } from "@/lib/daily/answer";
import { dataDateText, priceText, questionText, revealCopy, timeText } from "@/lib/daily/reveal";
import type { DailyChoice } from "@/lib/daily/types";
import type { Bar } from "@/lib/game/types";
import type { DailyQuestionView, DailyResponse } from "@/lib/daily-question.server";

type Problem = { status: number; message: string };
const CHOICES: { id: DailyChoice; label: string; hint: string }[] = [
  { id: "enter", label: "進場", hint: "站上去就買，先設好停損" },
  { id: "watch", label: "觀望", hint: "等它真的突破再說" },
  { id: "skip", label: "不追", hint: "這裡不做" },
];

async function readProblem(response: Response): Promise<Problem> {
  try {
    const body: unknown = await response.json();
    const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "";
    return { status: response.status, message };
  } catch {
    return { status: response.status, message: "" };
  }
}

/** The daily question: answer in one or two minutes, then see what happened and the class split. */
export function DailyQuestionPage({ teacher = false }: { teacher?: boolean }) {
  const { status, retry } = useGuestBootstrap();
  const mode = useDisplayPreferences((state) => state.mode);
  const layout = useTerminalLayout(mode === "senior");
  const [data, setData] = useState<DailyResponse | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/daily${teacher ? "?reveal=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return setProblem(await readProblem(response));
      setProblem(null);
      setData((await response.json()) as DailyResponse);
    } catch {
      setProblem({ status: 503, message: "暫時連不上教室，請稍後再試。" });
    } finally {
      setBusy(false);
    }
  }, [teacher]);

  useEffect(() => {
    if (status === "ready") void load();
  }, [status, load]);

  return (
    <div className="trading-desk td-daily" data-layout={layout} data-market-theme="dark">
      <header className="td-daily-head">
        <Link to="/" className="td-home" aria-label="返回教室大廳">
          <ArrowLeft aria-hidden />
          <span>大廳</span>
        </Link>
        <div className="td-daily-title">
          <h1>每日一題</h1>
          {data?.question && <p>取自 {dataDateText(data.question.dataDate)} 真實走勢</p>}
        </div>
        <DisplayControls compact className="td-size" />
      </header>
      <main className="td-daily-main">
        {status === "pending" && <p role="status" className="td-daily-card">正在準備題目…</p>}
        {status === "failed" && <AccessCard problem={describeAccessProblem(401, "")} busy={false} onRetry={retry} />}
        {status === "ready" && problem && (
          <AccessCard problem={describeAccessProblem(problem.status, problem.message)} busy={busy} onRetry={() => void load()} />
        )}
        {status === "ready" && !problem && !data && <p role="status" className="td-daily-card">正在讀取題目…</p>}
        {data && !problem && !data.question && (
          <section className="td-daily-card">
            <h2>今天還沒有題目</h2>
            <p>每個平日早上 6 點會出新的一題。</p>
            <Link to="/" className="td-button" data-variant="primary">回大廳</Link>
          </section>
        )}
        {data?.question && !problem && (
          <DailyBody
            key={data.question.dataDate}
            data={data}
            teacher={teacher}
            notice={notice}
            onAnswered={setData}
            onStale={async () => {
              setNotice("題目已更新，已換成最新的題目");
              await load();
            }}
          />
        )}
      </main>
    </div>
  );
}

function DailyChart({ question, bars, revealed }: { question: DailyQuestionView; bars: Bar[]; revealed: boolean }) {
  const mode = useDisplayPreferences((state) => state.mode);
  const layout = useTerminalLayout(mode === "senior");
  // Before answering on a phone or in 大字 the price area is small: the volume pane and its readout
  // give their room to the prices and the 前高 line the question is about.
  const volume = revealed || (layout !== "phone" && layout !== "senior");
  const last = bars.at(-1)!;
  const endT = revealed ? last.t + 60 : Math.max(question.questionT + 1800, 3600);
  return (
    <div className="td-daily-chart" data-revealed={revealed}>
      <TapeChart
        bars={bars}
        ticks={[]}
        prev={question.referencePrice}
        high={Math.max(...bars.map((bar) => bar.h))}
        low={Math.min(...bars.map((bar) => bar.l))}
        last={last.c}
        open={bars[0]?.o}
        startT={0}
        endT={endT}
        now={last.t + 60}
        swingHighs={question.kind === "intraday-high" && question.levelT !== null
          ? [{ t: question.levelT, p: question.level, confirmedAt: question.levelT + 180 }] : undefined}
        levels={question.kind === "previous-high" ? [{ price: question.level, label: "昨高" }] : undefined}
        markT={question.questionT}
        variant="candles"
        presentation="terminal"
        showVolume={volume}
        showAverage={false}
        showVolumeReadout={volume}
        appendCurrentQuote={false}
        completedBarSeconds={60}
        fitLabels
        ariaLabel={`${question.name} ${question.code} 一分鐘K線，${revealed ? "整天走勢" : `到 ${timeText(question.questionT)} 為止`}`}
      />
    </div>
  );
}

function DailyBody({
  data,
  teacher,
  notice,
  onAnswered,
  onStale,
}: {
  data: DailyResponse;
  teacher: boolean;
  notice: string;
  onAnswered: (next: DailyResponse) => void;
  onStale: () => Promise<void>;
}) {
  const question = data.question!;
  const say = useSay();
  const [choice, setChoice] = useState<DailyChoice | null>(null);
  const [stopKind, setStopKind] = useState<"pullback" | "belowLevel" | "custom" | null>(null);
  const questionClose = question.bars.find((bar) => bar.t === question.questionT)?.c ?? question.level;
  const highestStop = stepTick(questionClose, -1);
  const lowestStop = limitDown(question.referencePrice);
  const [customStop, setCustomStop] = useState(highestStop);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const choiceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reveal = data.reveal;
  const levelName = question.kind === "intraday-high" ? "前高" : "昨高";
  const stopPrice =
    stopKind === "pullback" ? question.stops.pullback : stopKind === "belowLevel" ? question.stops.belowLevel : stopKind === "custom" ? customStop : undefined;
  const canSend = choice !== null && (choice !== "enter" || stopPrice !== undefined) && !sending;
  const headline = reveal
    ? revealCopy({ kind: question.kind, level: question.level, outcome: reveal.outcome, choice: data.answer?.choice ?? "watch", entry: reveal.entry }).headline
    : "";
  const spoken = useRef("");
  useEffect(() => {
    if (headline && spoken.current !== headline && data.answer) {
      spoken.current = headline;
      say(headline);
    }
  }, [headline, data.answer, say]);

  function moveChoice(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + CHOICES.length) % CHOICES.length;
    setChoice(CHOICES[next]!.id);
    choiceRefs.current[next]?.focus();
  }

  async function send() {
    if (!canSend || choice === null) return;
    say("已送出");
    // Browsers start audio only inside a tap; the chime itself plays when the points come back.
    if (useDisplayPreferences.getState().sound) unlockChime();
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/daily", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.dataDate,
          choice,
          ...(choice === "enter" ? { stopPrice } : {}),
          ...(reason ? { reason } : {}),
          ...(data.needsTerms ? { guestTerms: true } : {}),
        }),
      });
      if (response.status === 409) return await onStale();
      if (!response.ok) return setError((await readProblem(response)).message || "這次沒有送出，請再試一次。");
      onAnswered((await response.json()) as DailyResponse);
    } catch {
      setError("暫時連不上教室，請再試一次。");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {notice && <p role="status" className="td-daily-notice">{notice}</p>}
      <section className="td-daily-question" aria-labelledby="daily-question-text">
        <h2 id="daily-question-text">{questionText(question)}</h2>
      </section>
      <DailyChart question={question} bars={reveal ? reveal.bars : question.bars} revealed={Boolean(reveal)} />
      {!reveal && (
        <section className="td-daily-answer" aria-label="作答">
          <div role="radiogroup" aria-label="你的選擇" className="td-daily-choices">
            {CHOICES.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  choiceRefs.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={choice === item.id}
                tabIndex={choice === item.id || (choice === null && index === 0) ? 0 : -1}
                data-choice={item.id}
                onClick={() => setChoice(item.id)}
                onKeyDown={(event) => moveChoice(event, index)}
                className="td-daily-choice"
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
          {choice === "enter" && (
            <div className="td-daily-stop">
              <div role="radiogroup" aria-label="停損" className="td-daily-stops">
                {(
                  [
                    ["pullback", `回檔低點 ${priceText(question.stops.pullback)}`],
                    // Two identical prices would be two identical buttons; keep one.
                    ...(question.stops.belowLevel !== question.stops.pullback
                      ? ([["belowLevel", `${levelName}下方 1%：${priceText(question.stops.belowLevel)}`]] as const)
                      : []),
                    ["custom", "自己設"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={stopKind === id} onClick={() => setStopKind(id)} className="td-daily-option">
                    {label}
                  </button>
                ))}
              </div>
              {stopKind === "custom" && (
                <div className="td-daily-stepper" role="group" aria-label="自己設停損">
                  <button type="button" aria-label="停損降低一檔" disabled={customStop <= lowestStop}
                    onClick={() => setCustomStop((value) => Math.max(lowestStop, stepTick(value, -1)))}>−</button>
                  <output aria-live="polite">{priceText(customStop)}</output>
                  <button type="button" aria-label="停損提高一檔" disabled={customStop >= highestStop}
                    onClick={() => setCustomStop((value) => Math.min(highestStop, stepTick(value, 1)))}>+</button>
                </div>
              )}
            </div>
          )}
          {choice && (
            <div className="td-daily-reasons" role="group" aria-label="理由（可選）">
              {DAILY_REASONS.map((item) => (
                <button key={item.id} type="button" aria-pressed={reason === item.id}
                  onClick={() => setReason((value) => (value === item.id ? null : item.id))} className="td-daily-chip">
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {choice === "enter" && stopPrice === undefined && <p className="td-daily-hint">先選一個停損</p>}
          {data.needsTerms && <p className="td-guest-terms">{GUEST_TERMS_TEXT}</p>}
          {error && <p role="alert" className="td-daily-error">{error}</p>}
          <button type="button" className="td-button td-daily-send" data-variant="primary" disabled={!canSend} onClick={() => void send()}>
            {sending ? "正在送出…" : "送出答案"}
          </button>
        </section>
      )}
      {reveal && (
        <DailyReveal data={data} teacher={teacher} headline={headline} />
      )}
    </>
  );
}

function DailyReveal({ data, teacher, headline }: { data: DailyResponse; teacher: boolean; headline: string }) {
  const question = data.question!;
  const reveal = data.reveal!;
  const copy = revealCopy({
    kind: question.kind, level: question.level, outcome: reveal.outcome, choice: data.answer?.choice ?? "watch", entry: reveal.entry,
  });
  const { counts } = reveal;
  const share = (value: number) => (counts.total ? `${(value / counts.total) * 100}%` : "0%");
  return (
    <section className="td-daily-reveal" aria-labelledby="daily-headline">
      <h2 id="daily-headline" aria-live="polite">{headline}</h2>
      <ul className="td-daily-facts">
        {copy.facts.map((fact) => <li key={fact}>{fact}</li>)}
      </ul>
      <div className="td-daily-lessons">
        <h3>這題要學的</h3>
        {copy.lessons.map((lesson) => <p key={lesson}>{lesson}</p>)}
      </div>
      <div className="td-daily-split">
        <p>已有 {counts.total} 人作答：進場 {counts.enter}、觀望 {counts.watch}、不追 {counts.skip}</p>
        <div className="td-daily-bar" aria-hidden>
          <span data-choice="enter" style={{ width: share(counts.enter) }} />
          <span data-choice="watch" style={{ width: share(counts.watch) }} />
          <span data-choice="skip" style={{ width: share(counts.skip) }} />
        </div>
      </div>
      {!teacher && (
        <p className="td-daily-progress">
          <Flame aria-hidden size={18} />
          連續 {data.progress.streak} 天 · 本週 {data.progress.week.done}／{data.progress.week.total} 天
        </p>
      )}
      {!teacher && data.celebration && <DisciplineCelebration celebration={data.celebration} />}
      <div className="td-daily-next">
        <Link to="/" className="td-button">回大廳</Link>
        <Link to="/morning" search={{ panel: "trade" }} className="td-button" data-variant="primary">去模擬練習</Link>
      </div>
    </section>
  );
}
