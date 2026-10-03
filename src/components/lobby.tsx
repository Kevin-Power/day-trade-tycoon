import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  GraduationCap,
  HardDrive,
  LogOut,
  Play,
  ShieldCheck,
  Target,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SCENARIOS, type Scenario } from "@/lib/game/scenarios";
import { lessonById, PRINCIPLES } from "@/lib/game/curriculum";
import { COURSE_PATH, courseStepFor } from "@/lib/game/learning-path";
import {
  RECENT_LEARNING_REVIEW_LIMIT,
  summarizeLearningProgress,
  type LearningProgress,
  type LearningProgressSummary,
} from "@/lib/game/learning-progress";
import { getProfileIdentity, loadReview } from "@/lib/game/persist";
import { useGame } from "@/lib/game/store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { playOpen, unlockAudio } from "@/lib/game/audio";
import type { Profile, SessionRecord } from "@/lib/game/types";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { LiveTape } from "@/components/live-tape";
import { ProvenanceBadge, ProvenanceMicro, SimChip } from "@/components/provenance";
import { teachingUniverseLine } from "@/lib/market/universe";
import { WEEK_SESSIONS, formatIndex } from "@/lib/market/week";
import { useGate } from "@/lib/gate/context";
import { ClassroomAccount } from "@/components/classroom-account";
import { DisplayControls } from "@/components/display-controls";
import { PracticeGoalReminder } from "@/components/practice-goal";
import { classroomSampleMicro, officialIndexMicro, officialTurnoverMicro } from "@/lib/provenance";

const WEEK_ORDER = ["mon", "tue", "wed"] as const;
const CLASSROOM_OFFLINE = import.meta.env.BASE_URL === "./";

export function Lobby() {
  const profile = useGame((state) => state.profile);
  const start = useGame((state) => state.start);
  const openLearnerGuide = useGame((state) => state.openLearnerGuide);
  const hydrated = useGame((state) => state.hydrated);
  const { user, isPending } = useCurrentUserState();
  const userId = user && !user.isDevFallback ? user.id : null;
  const profileReady = hydrated && !isPending && getProfileIdentity() === userId;
  const [learning, setLearning] = useState<{
    identity: string | null;
    profile: Profile;
    summary: LearningProgressSummary;
  } | null>(null);
  const { lock } = useGate();
  const firstLesson = SCENARIOS[0];

  useEffect(() => {
    if (!profileReady || getProfileIdentity() !== userId || useGame.getState().profile !== profile)
      return;
    const reviews = profile.history.slice(0, RECENT_LEARNING_REVIEW_LIMIT).flatMap((record) => {
      const review = loadReview(record.id);
      return review?.rec.id === record.id && review.rec.scenarioId === record.scenarioId
        ? [review]
        : [];
    });
    setLearning({ identity: userId, profile, summary: summarizeLearningProgress(reviews) });
  }, [profile, profileReady, userId]);

  // Identity and profile must both match before any saved learning evidence is shown.
  const summary =
    profileReady && learning?.identity === userId && learning.profile === profile
      ? learning.summary
      : undefined;
  const recentReview = summary?.recent[0];
  const missingReviews = summary
    ? profile.history
        .slice(0, RECENT_LEARNING_REVIEW_LIMIT)
        .filter((record) => !summary.recent.some((progress) => progress.sessionId === record.id))
        .length
    : 0;

  function beginLesson(id: string) {
    unlockAudio();
    playOpen();
    start(id);
  }

  return (
    <div className="academy-page min-h-dvh bg-bg text-fg">
      <header className="academy-header border-b border-border">
        <div className="academy-container mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <a
            href="#classroom-top"
            className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg"
          >
            <span
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-border-strong bg-surface"
              aria-hidden="true"
            >
              <GraduationCap className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold tracking-wide">當沖大富翁</span>
              <span className="block text-[10px] tracking-[0.14em] text-muted">
                DAY TRADE TYCOON
              </span>
            </span>
          </a>
          <nav aria-label="教室導覽" className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
            <DisplayControls />
            {userId && (
              <a
                href="#my-learning"
                className="academy-nav-link inline-flex min-h-11 items-center rounded-lg px-2.5 text-sm"
              >
                我的學習
              </a>
            )}
            <Link
              to="/manual"
              className="academy-nav-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs sm:px-3 sm:text-sm"
            >
              <BookOpen className="hidden size-4 sm:block" aria-hidden="true" />
              教材
            </Link>
            <Link
              to="/license"
              className="academy-nav-link inline-flex min-h-11 items-center rounded-lg px-2.5 text-xs sm:px-3 sm:text-sm"
            >
              課程說明
            </Link>
            <button
              type="button"
              onClick={lock}
              className="academy-nav-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted sm:px-3 sm:text-sm"
              aria-label="離開教室"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              <span>離場</span>
            </button>
          </nav>
        </div>
      </header>

      <main
        id="classroom-top"
        className="academy-container mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-8"
      >
        <section
          aria-labelledby="classroom-title"
          className="grid gap-6 pb-7 pt-7 sm:py-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-center lg:gap-10"
        >
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className="academy-eyebrow text-xs font-medium tracking-[0.16em] text-muted">
                你的模擬交易教室
              </span>
              <SimChip />
              {CLASSROOM_OFFLINE && (
                <span className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted">
                  離線練習
                </span>
              )}
            </div>
            <h1
              id="classroom-title"
              className="academy-title text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
            >
              今天，練好一個動作
            </h1>
            <p className="academy-description mt-3 max-w-xl text-pretty text-sm leading-7 text-muted sm:text-base">
              先選一個操作目標，完成模擬練習，再回來核對紀錄。從會看委託與成交，到能說清楚自己的進場與離場條件，一步一步練習。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {recentReview ? (
                <Link
                  to="/session/$id/review"
                  params={{ id: recentReview.sessionId }}
                  className="academy-button-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold"
                >
                  <FileText className="size-5 shrink-0" aria-hidden="true" />
                  接續上次復盤
                  <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                </Link>
              ) : (
                firstLesson && (
                  <button
                    type="button"
                    disabled={!summary}
                    onClick={() => beginLesson(firstLesson.id)}
                    className="academy-button-primary inline-flex min-h-12 flex-wrap items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold disabled:opacity-50"
                  >
                    <Play className="size-4" aria-hidden="true" />
                    {!summary ? "載入教室…" : "開始第一課"}
                    <span className="border-l border-current/20 pl-2 text-sm font-normal">
                      {firstLesson.minutes} 分鐘教材
                    </span>
                  </button>
                )
              )}
              <a
                href="#courses"
                className="academy-nav-link inline-flex min-h-12 items-center gap-1.5 rounded-lg px-3 text-base"
              >
                選擇課程 <ArrowDown className="size-4" aria-hidden="true" />
              </a>
              {firstLesson ? (
                <button
                  type="button"
                  disabled={!profileReady}
                  onClick={() => {
                    beginLesson(firstLesson.id);
                    openLearnerGuide();
                  }}
                  className="min-h-12 rounded-lg px-3 text-base text-brand disabled:opacity-50"
                >
                  先看操作導覽
                </button>
              ) : null}
            </div>
            {recentReview && (
              <p className="mt-3 text-base leading-relaxed text-muted">
                {recentReview.achievedCount > 0
                  ? `上次留下 ${recentReview.achievedCount} 項操作足跡。`
                  : "上次的練習紀錄已可回看。"}
                回看一次，選好下一個練習重點。
              </p>
            )}
          </div>
          <div className="academy-card min-w-0 rounded-2xl border border-border bg-surface p-5">
            <p className="text-base font-medium text-muted">每次練習，完成三件事</p>
            <ol className="mt-4 space-y-4">
              {[
                ["01", "進場前有計畫", "在下單頁記下第一筆進場、離場條件與模擬虧損額度。"],
                ["02", "盤中依規則操作", "核對委託、成交與庫存。"],
                ["03", "結算後回來復盤", "記下一項下次要改進的事。"],
              ].map(([number, title, description]) => (
                <li key={number} className="flex items-start gap-3">
                  <span className="mt-0.5 font-mono text-xs text-subtle">{number}</span>
                  <div className="min-w-0">
                    <p className="text-base font-medium">{title}</p>
                    <p className="mt-0.5 text-sm leading-6 text-muted">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <PracticeGoalReminder />

        <ClassroomAccount />

        <LearningFootprints summary={summary} missingReviews={missingReviews} />

        <section id="courses" aria-labelledby="courses-title" className="scroll-mt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="courses-title" className="text-xl font-semibold">
                我的課程路線
              </h2>
              <p className="mt-1 text-base leading-relaxed text-muted">
                五堂實作與綜合練習。可以照順序，也可以回到想再練一次的課。
              </p>
            </div>
            <span className="text-xs leading-5 text-muted">分鐘數為模擬盤時間，可加速與暫停</span>
          </div>
          <ol aria-label="課程學習階段" className="mb-4 grid gap-2 sm:grid-cols-3">
            {[...new Set(COURSE_PATH.map((step) => step.stage))].map((stage, index) => (
              <li
                key={stage}
                className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-base"
              >
                <span className="font-mono text-muted">0{index + 1}</span>
                <span className="min-w-0 font-medium">{stage}</span>
              </li>
            ))}
          </ol>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {SCENARIOS.map((scenario, index) => (
              <CourseCard
                key={scenario.id}
                scenario={scenario}
                index={index}
                lastRecord={
                  profileReady
                    ? profile.history.find((record) => record.scenarioId === scenario.id)
                    : undefined
                }
                progress={summary?.recent.find(
                  (progress) =>
                    progress.sessionId ===
                    profile.history.find((record) => record.scenarioId === scenario.id)?.id,
                )}
                progressReady={Boolean(summary)}
                ready={profileReady}
                onStart={() => beginLesson(scenario.id)}
              />
            ))}
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            所有委託皆為教室模擬，不會送到券商。模擬成績不代表實際交易報酬。
          </p>
        </section>

        <section aria-labelledby="progress-title" className="mt-9 border-t border-border pt-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 id="progress-title" className="text-lg font-semibold">
              這台裝置的練習紀錄
            </h2>
            <span className="text-xs text-muted">
              本機統計 · <ProvenanceBadge kind="classroom" />
            </span>
          </div>
          <p className="mb-4 text-base leading-relaxed text-muted">
            本機只保留最近最多 30 份練習紀錄，以下先列出最近 8
            份。切換裝置或清除瀏覽器資料，顯示的紀錄可能不同。
          </p>
          <RecentPractice
            history={profile.history}
            summary={summary}
            onStart={() => firstLesson && beginLesson(firstLesson.id)}
          />
          <details className="academy-card mt-4 rounded-2xl border border-border bg-surface">
            <summary className="min-h-12 cursor-pointer px-4 py-4 text-base font-medium sm:px-5">
              模擬損益紀錄
            </summary>
            <div className="border-t border-border p-4 sm:p-5">
              <p className="mb-4 text-base leading-relaxed text-muted">
                這裡保留本機累計的模擬結果，供復盤參考。累計統計可能涵蓋更早的練習；操作足跡只使用目前可讀取的最近最多
                30 份完整紀錄。
              </p>
              <PracticeMetrics profile={profile} hydrated={profileReady} />
              {profileReady && profile.history.length > 0 && (
                <ul className="mt-4 divide-y divide-border">
                  {profile.history.slice(0, 8).map((record) => (
                    <li
                      key={record.id}
                      className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 text-base"
                    >
                      <span className="min-w-0 break-words text-muted">{record.scenarioName}</span>
                      <span className={cn("font-mono tabular", toneClass(record.pnl))}>
                        {formatSigned(record.pnl, 0)} · {formatPct(record.pnlPct)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </section>

        <section aria-labelledby="materials-title" className="mt-9">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <h2 id="materials-title" className="text-lg font-semibold">
              教材與練習工具
            </h2>
            <Link
              to="/manual"
              className="academy-nav-link inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs"
            >
              閱讀學員手冊 <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="space-y-3">
            <details className="academy-card group rounded-2xl border border-border bg-surface">
              <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-bg">
                  <FileText className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">教材行情與自由練習</span>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    教材週 2026/08/24–08/26 · 展開查看資料來源
                  </span>
                </span>
                <ChevronDown
                  className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="min-w-0 border-t border-border px-4 pb-2 pt-4 sm:px-5">
                <p className="mb-4 text-xs leading-6 text-muted">
                  加權指數依指定日期的官方資料重播；個股盤中路徑與五檔由教室生成，並非即時逐筆行情。
                  {teachingUniverseLine()}。
                </p>
                <div className="mb-6 grid gap-3 md:grid-cols-3">
                  {WEEK_ORDER.map((id) => (
                    <MarketSnapshot key={id} id={id} />
                  ))}
                </div>
                <LiveTape />
              </div>
            </details>
            <details className="academy-card group rounded-2xl border border-border bg-surface">
              <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-bg">
                  <Target className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">每一課都用得到的六個原則</span>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    成本、昨收、分價、停損、部位與平倉
                  </span>
                </span>
                <ChevronDown
                  className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="grid gap-5 border-t border-border p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
                {PRINCIPLES.map((principle) => (
                  <div key={principle.no} className="min-w-0">
                    <p className="text-sm font-medium">
                      <span className="mr-2 font-mono text-xs text-subtle">{principle.no}</span>
                      {principle.title}
                    </p>
                    <p className="mt-2 text-xs leading-6 text-muted">{principle.body}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="academy-card flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <BookOpen className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-medium">上課前，先熟悉教室</h3>
                <p className="mt-1 text-xs leading-6 text-muted">
                  手冊整理入場、模擬操作、提交復盤與常見問題。課程日期、費用及入班安排請向講師確認。
                </p>
                <Link
                  to="/license"
                  className="academy-nav-link mt-2 inline-flex min-h-10 items-center gap-1 rounded-lg text-xs"
                >
                  查看課程說明 <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
            <div className="academy-card flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <HardDrive className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-medium">把教材帶到離線教室</h3>
                <p className="mt-1 text-xs leading-6 text-muted">
                  使用固定教材週練習，紀錄保存在這台電腦的瀏覽器；離線紀錄不會自動同步到學員帳號。
                </p>
                {CLASSROOM_OFFLINE ? (
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
                    <Check className="size-3.5" aria-hidden="true" />
                    目前使用離線教室
                  </span>
                ) : (
                  <a
                    href="/api/download/offline"
                    download="當沖大富翁-地端教室.zip"
                    className="academy-nav-link mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg text-xs"
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    下載離線教材
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5 text-[11px] leading-5 text-subtle">
          <span>當沖大富翁 · 講師帶班與模擬練習</span>
          <span>先有計畫，再用紀錄檢查每一次操作。</span>
        </footer>
      </main>
    </div>
  );
}

function CourseCard({
  scenario,
  index,
  lastRecord,
  progress,
  progressReady,
  ready,
  onStart,
}: {
  scenario: Scenario;
  index: number;
  lastRecord?: SessionRecord;
  progress?: LearningProgress;
  progressReady: boolean;
  ready: boolean;
  onStart: () => void;
}) {
  const lesson = lessonById(scenario.id);
  const step = courseStepFor(scenario.id);
  const latestProgress = progress?.sessionId === lastRecord?.id ? progress : undefined;
  const first = index === 0;
  return (
    <article className="academy-card flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-medium text-muted">
          {lesson?.no || scenario.tag} · {step?.stage || "自主練習"}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-sm text-muted">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {scenario.minutes} 分 · {scenario.speed}×
        </span>
      </div>
      <h3 className="mt-2.5 text-lg font-semibold tracking-tight">
        {step?.title || lesson?.skill || scenario.name}
      </h3>
      <p className="mt-1 text-sm text-muted">{scenario.name}</p>
      <p className="mt-3 flex-1 text-base leading-relaxed text-muted">
        {step?.focus || "練習觀察盤面、核對操作，再用復盤紀錄找出下一次的重點。"}
      </p>
      {step && (
        <details className="my-3 rounded-xl border border-border bg-bg px-3">
          <summary className="min-h-12 cursor-pointer py-3 text-base font-medium">
            這一課怎麼練
          </summary>
          <ol className="list-decimal space-y-2 pb-3 pl-5 text-base leading-relaxed text-muted">
            {step.steps.map((action) => (
              <li key={action} className="pl-1">
                {action}
              </li>
            ))}
          </ol>
          <p className="border-t border-border py-3 text-base leading-relaxed">
            <span className="font-medium">復盤想一想：</span>
            {step.reflection}
          </p>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-sm leading-relaxed text-muted">
        <span>模擬本金 {formatMoney(scenario.capital)}</span>
        <span>
          {scenario.leverage}× 額度 · {scenario.allowShort ? "可先賣" : "僅先買"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 text-base leading-relaxed text-muted">
          {!progressReady
            ? "正在讀取操作紀錄…"
            : lastRecord
              ? latestProgress
                ? latestProgress.achievedCount > 0
                  ? `最近一次：已留下 ${latestProgress.achievedCount} 項操作足跡`
                  : "最近一次：練習紀錄已可回看"
                : "最近一次：未找到完整紀錄"
              : first
                ? "建議從這裡開始"
                : "依自己的進度練習"}
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={onStart}
          aria-label={`進入${lesson?.no || scenario.name}：${step?.title || lesson?.skill || scenario.name}`}
          className={cn(
            "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-medium disabled:opacity-50",
            first ? "academy-button-primary" : "academy-button-secondary",
          )}
        >
          進入課程 <ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function LearningFootprints({
  summary,
  missingReviews,
}: {
  summary?: LearningProgressSummary;
  missingReviews: number;
}) {
  return (
    <section aria-labelledby="learning-footprints-title" className="my-7 min-w-0">
      <h2 id="learning-footprints-title" className="text-xl font-semibold">
        看見自己的操作足跡
      </h2>
      <p className="mt-2 text-base leading-relaxed text-muted">
        把做過的動作看清楚，再決定下次練什麼。每次練習不必集滿四項；等待條件出現，也可以是這次的選擇。
      </p>
      {!summary ? (
        <p role="status" className="mt-4 text-base text-muted">
          正在讀取這個帳戶的本機紀錄…
        </p>
      ) : summary.reviewCount === 0 ? (
        <div className="academy-card mt-4 rounded-2xl border border-border bg-surface p-5">
          <p className="text-lg font-medium">從一份能回看的練習開始</p>
          <p className="mt-2 text-base leading-relaxed text-muted">
            選一課，寫下想練的動作。結算後，這裡會依保存的計畫、成交與庫存紀錄呈現操作足跡。
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.milestones.map((milestone) => (
            <li
              key={milestone.id}
              className="academy-card min-w-0 rounded-2xl border border-border bg-surface p-4"
            >
              <p className="flex items-start gap-2 text-base font-medium">
                {milestone.achievedSessions > 0 && (
                  <Check className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                )}
                {milestone.title}
              </p>
              <p className="mt-3 text-xl font-semibold">
                {milestone.achievedSessions > 0
                  ? `${milestone.achievedSessions} 份留下足跡`
                  : milestone.knownSessions === 0
                    ? "資料不足，未判定"
                    : "尚無這項足跡"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {milestone.knownSessions} 份有可核對欄位
                {milestone.unknownSessions > 0 &&
                  ` · ${milestone.unknownSessions} 份資料不足，未判定`}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm leading-relaxed text-muted">
        只依這個帳戶在目前瀏覽器最近最多 30 份練習計算
        {summary ? `，已讀取 ${summary.reviewCount} 份完整紀錄` : ""}。
        {missingReviews > 0 && `另有 ${missingReviews} 份練習摘要未找到完整紀錄，未計入足跡。`}
        操作足跡呈現紀錄中發生的事，不代表已掌握技能；平倉可能包含部分減碼或系統平倉。
      </p>
    </section>
  );
}

function PracticeMetrics({ profile, hydrated }: { profile: Profile; hydrated: boolean }) {
  const hasSessions = hydrated && profile.sessions > 0;
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
      <PracticeMetric
        label="模擬累積淨損益"
        value={hasSessions ? formatSigned(profile.careerPnl, 0) : "—"}
        tone={hasSessions ? profile.careerPnl : undefined}
        note={hasSessions ? "僅計本機已結算練習" : "完成第一盤後顯示"}
      />
      <PracticeMetric
        label="累計結算盤數"
        value={hydrated ? `${profile.sessions} 盤` : "—"}
        note="未結算的練習不計入"
      />
      <PracticeMetric
        label="獲利盤占比"
        value={hasSessions ? `${((profile.wins / profile.sessions) * 100).toFixed(0)}%` : "—"}
        note={hasSessions ? classroomSampleMicro(profile.sessions) : "尚無教室樣本"}
      />
    </div>
  );
}

function PracticeMetric({
  label,
  value,
  note,
  tone,
  className,
}: {
  label: string;
  value: string;
  note: string;
  tone?: number;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-bg p-4", className)}>
      <p className="text-base text-muted">{label}</p>
      <p
        className={cn(
          "mt-2 break-words font-mono text-xl font-medium tabular",
          tone !== undefined ? toneClass(tone) : "text-fg",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{note}</p>
    </div>
  );
}

function RecentPractice({
  history,
  summary,
  onStart,
}: {
  history: SessionRecord[];
  summary?: LearningProgressSummary;
  onStart: () => void;
}) {
  return (
    <div className="academy-card overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4 sm:px-5">
        <h3 className="text-base font-semibold">回看最近的練習</h3>
        <span className="text-sm text-muted">最近 8 份 · 點選查看本人復盤</span>
      </div>
      {!summary ? (
        <p role="status" className="px-5 py-8 text-base text-muted">
          正在載入這台裝置的練習紀錄…
        </p>
      ) : history.length === 0 ? (
        <div className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-medium">這台裝置尚無本機復盤</p>
            <p className="mt-1 text-base leading-relaxed text-muted">
              在這台裝置完成練習與結算後，這裡會留下紀錄。已存到主機的復盤，可在「我的學習」查看。
            </p>
          </div>
          <button
            type="button"
            onClick={onStart}
            className="academy-button-secondary inline-flex min-h-12 items-center gap-2 rounded-xl px-4 py-3 text-base"
          >
            開始練習 <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {history.slice(0, 8).map((record) => {
            const progress = summary.recent.find((item) => item.sessionId === record.id);
            return (
              <li key={record.id}>
                <Link
                  to="/session/$id/review"
                  params={{ id: record.id }}
                  className="group flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand sm:px-5"
                >
                  <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-muted sm:flex">
                    <FileText className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-base font-medium">{record.scenarioName}</p>
                    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-sm leading-relaxed text-muted">
                      <span>{lessonById(record.scenarioId)?.no || "自由練習"}</span>
                      <span>{new Date(record.endedAt).toLocaleDateString("zh-TW")}</span>
                      <span>{record.trades} 次平倉</span>
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-muted">
                      {progress
                        ? progress.achievedCount > 0
                          ? `已留下 ${progress.achievedCount} 項操作足跡`
                          : "練習紀錄已可回看"
                        : "未找到完整紀錄"}
                      {progress?.noRecordedFills && " · 本盤未記錄成交"}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MarketSnapshot({ id }: { id: (typeof WEEK_ORDER)[number] }) {
  const session = WEEK_SESSIONS[id]!;
  const change = session.close - session.prevClose;
  const percent = (change / session.prevClose) * 100;
  return (
    <div className="min-w-0 rounded-xl border border-border bg-bg p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{session.label} 加權</span>
        <ProvenanceBadge kind="official" />
      </div>
      <p className={cn("mt-3 font-mono text-xl tabular", toneClass(change))}>
        {formatIndex(session.close)}
      </p>
      <p className={cn("mt-1 font-mono text-xs tabular", toneClass(change))}>
        {formatSigned(change)} · {formatPct(percent)}
      </p>
      <p className="mt-2 text-[11px] leading-5 text-muted">
        開 {formatIndex(session.open)} · 高 {formatIndex(session.high)} · 低{" "}
        {formatIndex(session.low)}
      </p>
      <ProvenanceMicro
        className="mt-3 break-words border-0 bg-transparent px-0 text-[10px]"
        text={`${officialIndexMicro(session.date)} · ${officialTurnoverMicro(session.date)}`}
      />
    </div>
  );
}
