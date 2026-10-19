import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  LoaderCircle,
  LogOut,
  MessageSquare,
  RefreshCw,
} from "@/lib/icons";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { authEnabled, signOut } from "@/lib/auth/client";
import { loadMyProfile, loadMyCareer } from "@/lib/classroom-db";
import { COURSE_PATH } from "@/lib/game/learning-path";
import { RealCandlesLink } from "@/components/real-candles-entry";
import { formatSigned } from "@/lib/utils";

type Career = Awaited<ReturnType<typeof loadMyCareer>>;
type Profile = Awaited<ReturnType<typeof loadMyProfile>>;

export function ClassroomAccount() {
  const { user, isPending } = useCurrentUserState();
  if (!authEnabled || isPending) return null;
  const userId = user && !user.isDevFallback ? user.id : null;
  // A new identity gets fresh request state; late responses cannot reveal the old account.
  return (
    <AccountContents key={userId ?? "guest"} userId={userId} name={user?.displayName || "學員"} />
  );
}

function AccountContents({ userId, name }: { userId: string | null; name: string }) {
  const [profile, setProfile] = useState<Profile>(null);
  const [career, setCareer] = useState<Career | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(!!userId);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [filter, setFilter] = useState<"all" | "feedback">("all");
  const [visibleCount, setVisibleCount] = useState(6);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.allSettled([loadMyProfile(), loadMyCareer()]).then(([nextProfile, nextCareer]) => {
      if (cancelled) return;
      if (nextProfile.status === "fulfilled") {
        setProfile(nextProfile.value);
        setProfileLoaded(true);
      }
      if (nextCareer.status === "fulfilled") setCareer(nextCareer.value);
      if (nextProfile.status === "rejected" || nextCareer.status === "rejected")
        setError("部分學習資料暫時無法更新；已顯示的資料仍保留。請確認連線後按「更新紀錄」。");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, reload]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      setError("登出未完成，請確認連線後再試一次。");
      setSigningOut(false);
    }
  }

  const feedbackSessions = career?.sessions.filter((session) => session.feedback_count > 0) ?? [];
  const practiced = new Set(
    career?.sessions
      .filter((session) => COURSE_PATH.some((course) => course.id === session.lesson_id))
      .map((session) => session.lesson_id),
  ).size;
  const filtered = filter === "feedback" ? feedbackSessions : (career?.sessions ?? []);
  const latestFeedback = [...feedbackSessions].sort((a, b) =>
    (b.last_feedback_at ?? "").localeCompare(a.last_feedback_at ?? ""),
  )[0];
  const latest = career?.sessions[0];

  return (
    <section
      id="my-learning"
      aria-labelledby="my-learning-title"
      className="academy-card premium-learning-center mb-8 scroll-mt-6 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand">MY LEARNING · 我的學習</p>
          <h2 id="my-learning-title" className="mt-2 break-words text-xl font-semibold">
            {userId ? `${profile?.display_name || name}，接著練好下一步` : "讓每次練習都有紀錄"}
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-7 text-muted">
            {userId
              ? "這裡保留已存到主機的舊版課程復盤與講師回饋。新的真實 K 練習進度與復盤，請在真實早盤頁查看。"
              : "可以先以訪客練習真實 K 線；建立個人帳號後，訪客的練習會搬進帳號，進度與復盤保存在教室主機。這裡另保留舊版課程紀錄。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!userId || (profileLoaded && !profile) ? (
            <Link to="/login" className="academy-button-secondary">
              {userId ? "完成班級資料" : "登入／建立帳號"}
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : null}
          {profile?.role === "teacher" && (
            <Link to="/teacher" className="academy-button-secondary">
              <GraduationCap aria-hidden="true" />
              講師工作台
            </Link>
          )}
          {userId && (
            <>
              <button
                type="button"
                disabled={loading}
                onClick={() => setReload((value) => value + 1)}
                className="academy-button-secondary disabled:opacity-50"
              >
                <RefreshCw
                  className={loading ? "animate-spin" : undefined}
                  aria-hidden="true"
                />
                {loading ? "更新中…" : "更新紀錄"}
              </button>
              <button
                type="button"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
                className="academy-nav-link min-h-12 disabled:opacity-50"
              >
                {signingOut ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut aria-hidden="true" />
                )}
                {signingOut ? "登出中…" : "登出"}
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-border bg-bg p-4 text-base leading-7"
        >
          {error}
        </p>
      )}
      {loading && !career && (
        <p role="status" className="mt-4 text-base text-muted">
          正在讀取學習紀錄…
        </p>
      )}
      {career && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="premium-learning-stat rounded-xl p-4">
              <p className="text-sm text-muted">已儲存的舊版練習</p>
              <p className="mt-2 text-2xl font-semibold">
                {career.count} <span className="text-base font-normal text-muted">盤</span>
              </p>
            </div>
            <div className="premium-learning-stat rounded-xl p-4">
              <p className="text-sm text-muted">最近 40 盤涵蓋的舊課</p>
              <p className="mt-2 text-2xl font-semibold">
                {practiced}{" "}
                <span className="text-base font-normal text-muted">/ {COURSE_PATH.length} 課</span>
              </p>
            </div>
            <div className="premium-learning-stat rounded-xl p-4">
              <p className="text-sm text-muted">最近 40 盤舊紀錄中已有回饋</p>
              <p className="mt-2 text-2xl font-semibold">
                {feedbackSessions.length}{" "}
                <span className="text-base font-normal text-muted">份復盤</span>
              </p>
            </div>
          </div>
          <p className="mt-3 text-base leading-7 text-muted">
            以上只計舊版課程紀錄，不包含真實 K
            練習。新版六個主題請由大廳進入，依交易日查看真實回放進度；舊生成情境不再啟動。
          </p>
          {latest && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                to="/session/$id/review"
                params={{ id: latest.id }}
                className="academy-button-primary"
              >
                <BookOpen aria-hidden="true" />
                回看最近一次舊版練習
                <ArrowRight aria-hidden="true" />
              </Link>
              {latestFeedback && (
                <Link
                  to="/session/$id/review"
                  params={{ id: latestFeedback.id }}
                  hash="instructor-feedback"
                  className="academy-button-secondary"
                >
                  <MessageSquare aria-hidden="true" />
                  查看最近的講師回饋
                </Link>
              )}
            </div>
          )}
          {career.sessions.length ? (
            <>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <h3 className="text-base font-semibold">我的舊版課程復盤</h3>
                <div className="flex flex-wrap gap-2" aria-label="篩選我的復盤">
                  {(
                    [
                      ["all", "全部紀錄"],
                      ["feedback", "已有回饋"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => {
                        setFilter(value);
                        setVisibleCount(6);
                      }}
                      className={`min-h-12 rounded-xl border px-4 text-base ${filter === value ? "border-brand bg-brand/10 font-semibold text-brand" : "border-border text-muted"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">
                主機最近 40 盤舊版紀錄 ·
                時間以台北時間顯示。練過課程表示有儲存紀錄，熟練程度請與講師一起確認。
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.slice(0, visibleCount).map((session) => (
                  <Link
                    key={session.id}
                    to="/session/$id/review"
                    params={{ id: session.id }}
                    className="premium-review-link group min-w-0 border border-border p-4 hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <p className="text-sm text-muted">
                      {session.ended_at?.slice(0, 16) || "未提供結束時間"}
                    </p>
                    <h4 className="mt-2 break-words text-base font-semibold">
                      {COURSE_PATH.find((course) => course.id === session.lesson_id)?.title ||
                        "模擬練習"}
                    </h4>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span
                        className={`rounded-full px-3 py-1.5 ${session.feedback_count > 0 ? "bg-brand/10 text-brand" : "bg-bg text-muted"}`}
                      >
                        {session.feedback_count > 0
                          ? `講師回饋 ${session.feedback_count} 則`
                          : session.feedback_count === 0
                            ? "尚無講師回饋"
                            : "回饋狀態待更新"}
                      </span>
                      <span className="flex items-center gap-1 text-brand">
                        查看復盤
                        <ArrowRight aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              {!filtered.length && (
                <p role="status" className="mt-4 rounded-xl bg-bg p-4 text-base leading-7">
                  目前這些紀錄尚無講師回饋。可以先回看自己的計畫與成交，再帶著一個問題參與課堂討論。
                </p>
              )}
              {filtered.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((value) => value + 6)}
                  className="academy-button-secondary mt-4"
                >
                  查看更多復盤（還有 {filtered.length - visibleCount} 份）
                </button>
              )}
              <details className="mt-5 border-t border-border pt-4 text-sm text-muted">
                <summary className="min-h-11 cursor-pointer py-2">查看舊版模擬累計損益</summary>
                <p className="py-3 text-base">
                  {formatSigned(career.careerPnl, 0)} 元 ·
                  練習損益供復盤參考，不代表未來實際交易成果。
                </p>
              </details>
            </>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-border p-5">
              <h3 className="text-lg font-semibold">目前沒有舊版課程復盤</h3>
              <p className="mt-2 text-base leading-7 text-muted">
                請從真實 K
                線練習開始：先寫計畫，再逐分鐘觀察與操作，最後保存復盤。新進度與紀錄會在真實早盤頁查看，不計入這裡的舊課統計。
              </p>
              <RealCandlesLink className="mt-4">開始真實 K 線練習</RealCandlesLink>
            </div>
          )}
        </>
      )}
    </section>
  );
}
