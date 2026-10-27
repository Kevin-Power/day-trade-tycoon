import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, CandlestickChart, CirclePause, Play } from "@/lib/icons";
import { DisplayControls } from "@/components/display-controls";
import { FubonEntry } from "@/components/fubon-entry";
import type { MorningAlert } from "@/lib/morning-alerts";
import type { MorningLessonSummary, MorningState } from "@/lib/morning";
import { replayClock } from "@/lib/morning-live";
import type { MorningExercise } from "@/lib/morning-exercises";
import { formatMoney, formatTime } from "@/lib/utils";
import { REPLAY_DELAY, type ReplaySpeed } from "@/lib/replay-speed";

export function DeskBar({ children }: { children?: ReactNode }) {
  return (
    <header className="td-bar" aria-label="交易工作台">
      <Link to="/" aria-label="返回教室大廳" className="td-home">
        <ArrowLeft aria-hidden />
        <span>大廳</span>
      </Link>
      <span className="td-brand">
        <CandlestickChart aria-hidden />
        <span>當沖大富翁</span>
      </span>
      {children}
      <FubonEntry />
      <DisplayControls compact className="td-size" />
    </header>
  );
}

export function StatusBar({
  lessons,
  lessonId,
  exercise,
  session,
  showPlan,
  cursor,
  completed,
  auto,
  speed,
  busy,
  playDisabled,
  canAdvance,
  reviewDisabled,
  resourcesOpen,
  onLessonChange,
  onStartPlan,
  onTogglePlay,
  onSpeed,
  onAdvance,
  onReview,
  onResources,
}: {
  lessons: MorningLessonSummary[];
  lessonId: string;
  exercise?: MorningExercise;
  session: MorningState | null;
  showPlan: boolean;
  cursor: number;
  completed: boolean;
  auto: boolean;
  speed: ReplaySpeed;
  busy: boolean;
  playDisabled: boolean;
  canAdvance: boolean;
  reviewDisabled: boolean;
  resourcesOpen: boolean;
  onLessonChange: (lessonId: string) => void;
  onStartPlan: () => void;
  onTogglePlay: () => void;
  onSpeed: (speed: ReplaySpeed) => void;
  onAdvance: () => void;
  onReview: () => void;
  onResources: () => void;
}) {
  const profit = session ? session.equity - session.startingCash : 0;
  const state = showPlan ? "idle" : completed ? "done" : auto ? "running" : "paused";
  return (
    <DeskBar>
      <label className="td-lesson">
        <span className="sr-only">教材交易日</span>
        <select
          aria-label="教材交易日"
          value={lessonId}
          disabled={busy}
          onChange={(event) => onLessonChange(event.target.value)}
        >
          {lessons.map((lesson) => (
            <option key={lesson.lessonId} value={lesson.lessonId}>
              {lesson.date} · {lesson.symbols.length} 檔
            </option>
          ))}
        </select>
      </label>
      <span className="td-subject">
        <span>{exercise?.no ?? "自由練習"}</span>
        <strong>{exercise?.title ?? "真實歷史行情練習"}</strong>
      </span>
      <span className="td-clock" data-state={state}>
        <i aria-hidden />
        <strong>{showPlan ? "09:00:00" : formatTime(session ? replayClock(session) : cursor * 60)}</strong>
        <small>
          {showPlan ? "待開始" : completed ? "已完成" : auto ? "重播中" : "已暫停"}
        </small>
      </span>
      {session && !showPlan && (
        <dl className="td-account" aria-label="模擬帳戶">
          <div>
            <dt>本輪損益</dt>
            <dd data-tone={profit > 0 ? "up" : profit < 0 ? "down" : "flat"}>
              {profit > 0 ? "+" : ""}
              {formatMoney(profit, 0)}
            </dd>
          </div>
          <div>
            <dt>可用資金</dt>
            <dd>{formatMoney(session.cash, 0)}</dd>
          </div>
        </dl>
      )}
      <div className="td-replay" role="group" aria-label="歷史行情重播控制">
        {showPlan ? (
          <button type="button" className="td-start" onClick={onStartPlan}>
            <Play aria-hidden />
            開始練習
          </button>
        ) : (
          <>
            <button
              type="button"
              className="td-play"
              data-coach="play"
              data-running={auto}
              title={`每 ${REPLAY_DELAY[speed] / 1000} 秒前進 1 分鐘`}
              disabled={playDisabled}
              onClick={onTogglePlay}
              aria-label={auto ? "暫停重播" : "自動重播"}
            >
              {auto ? <CirclePause aria-hidden /> : <Play aria-hidden />}
              <span>{auto ? "暫停" : "播放"}</span>
            </button>
            <span className="td-speed" role="group" aria-label="重播速度">
              {([1, 2] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={speed === value}
                  onClick={() => onSpeed(value)}
                >
                  {value}x
                </button>
              ))}
            </span>
            <button
              type="button"
              aria-label="前進 1 分鐘"
              disabled={!canAdvance}
              onClick={onAdvance}
            >
              +1 分
            </button>
            <button type="button" disabled={reviewDisabled} onClick={onReview}>
              <BookOpen aria-hidden />
              <span>復盤</span>
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        className="td-tool"
        aria-label="教材"
        aria-expanded={resourcesOpen}
        aria-controls="td-resources"
        onClick={onResources}
      >
        <BookOpen aria-hidden />
        <span>教材</span>
      </button>
    </DeskBar>
  );
}

export function HintBar({
  plan,
  tip,
  alert,
  feedback,
  announcement,
  children,
}: {
  /** The round's plan in one chip (stock and stance); opens the full plan in 教材. */
  plan?: { code: string; label: string; onOpen: () => void };
  tip?: string;
  alert?: MorningAlert;
  feedback?: string;
  /** Text of the learner's latest fill; read out politely whenever it changes. */
  announcement?: string;
  children?: ReactNode;
}) {
  return (
    <section className="td-hints" aria-label="教學提示與快訊">
      {plan && (
        <button type="button" className="td-plan-chip" onClick={plan.onOpen}>
          <span>本輪計畫：</span>
          {plan.code} {plan.label}
        </button>
      )}
      {tip && (
        <p className="td-tip" title={tip}>
          <span>教學</span>
          <span className="td-tip-text">{tip}</span>
        </p>
      )}
      {feedback && (
        <p role="status" className="td-feedback" title={feedback}>
          {feedback}
        </p>
      )}
      {alert && (
        <p className="td-alert" data-kind={alert.kind}>
          <span>快訊</span>
          <time>{formatTime(alert.t).slice(0, 5)}</time>
          {alert.text}
        </p>
      )}
      {/* Always mounted, so a new fill is announced; market events are not read out. */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {children}
    </section>
  );
}
