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
} from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { authEnabled, signOut } from "@/lib/auth/client";
import { loadMyProfile, loadMyCareer } from "@/lib/classroom-db";
import { COURSE_PATH } from "@/lib/game/learning-path";
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
      className="academy-card mb-8 scroll-mt-6 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand">MY LEARNING · 我的學習</p>
          <h2 id="my-learning-title" className="mt-2 break-words text-xl font-semibold">
            {userId ? `${profile?.display_name || name}，接著練好下一步` : "讓每次練習都有紀錄"}
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-7 text-muted">
            {userId
              ? "查看已存到主機的復盤、讀取講師回饋，再選一個動作繼續練習。"
              : "正式練習前先登入，結算後可儲存到教室主機，並跨裝置查看復盤與講師回饋。訪客紀錄只留在原瀏覽器，不會自動加入帳號。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!userId || (profileLoaded && !profile) ? (
            <Link to="/login" className="academy-button-secondary">
              {userId ? "完成班級資料" : "登入／建立帳號"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          {profile?.role === "teacher" && (
            <Link to="/teacher" className="academy-button-secondary">
              <GraduationCap className="size-4" aria-hidden="true" />
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
                  className={`size-4 ${loading ? "animate-spin" : ""}`}
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
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="size-4" aria-hidden="true" />
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
            <div className="rounded-xl bg-bg p-4">
              <p className="text-sm text-muted">已儲存的練習</p>
              <p className="mt-2 text-2xl font-semibold">
                {career.count} <span className="text-base font-normal text-muted">盤</span>
              </p>
            </div>
            <div className="rounded-xl bg-bg p-4">
              <p className="text-sm text-muted">最近 40 盤練過的課程</p>
              <p className="mt-2 text-2xl font-semibold">
                {practiced}{" "}
                <span className="text-base font-normal text-muted">/ {COURSE_PATH.length} 課</span>
              </p>
            </div>
            <div className="rounded-xl bg-bg p-4">
              <p className="text-sm text-muted">最近 40 盤中已有回饋</p>
              <p className="mt-2 text-2xl font-semibold">
                {feedbackSessions.length}{" "}
                <span className="text-base font-normal text-muted">份復盤</span>
              </p>
            </div>
          </div>
          {latest && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                to="/session/$id/review"
                params={{ id: latest.id }}
                className="academy-button-primary"
              >
                <BookOpen className="size-4" aria-hidden="true" />
                回看最近一次練習
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              {latestFeedback && (
                <Link
                  to="/session/$id/review"
                  params={{ id: latestFeedback.id }}
                  hash="instructor-feedback"
                  className="academy-button-secondary"
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
                  查看最近的講師回饋
                </Link>
              )}
            </div>
          )}
          {career.sessions.length ? (
            <>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <h3 className="text-base font-semibold">我的復盤</h3>
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
                主機最近 40 盤 ·
                時間以台北時間顯示。練過課程表示有儲存紀錄，熟練程度請與講師一起確認。
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.slice(0, visibleCount).map((session) => (
                  <Link
                    key={session.id}
                    to="/session/$id/review"
                    params={{ id: session.id }}
                    className="group min-w-0 rounded-xl border border-border p-4 transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
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
                        <ArrowRight className="size-4" aria-hidden="true" />
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
                <summary className="min-h-11 cursor-pointer py-2">查看模擬累計損益</summary>
                <p className="py-3 text-base">
                  {formatSigned(career.careerPnl, 0)} 元 ·
                  練習損益供復盤參考，不代表未來實際交易成果。
                </p>
              </details>
            </>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-border p-5">
              <h3 className="text-lg font-semibold">從第一份復盤開始</h3>
              <p className="mt-2 text-base leading-7 text-muted">
                在下方選擇「第一筆有計畫的操作」。先寫計畫，再觀察與操作；結束後核對保存狀態，這裡就能回看自己的練習。
              </p>
              <a href="#courses" className="academy-button-secondary mt-4">
                選擇練習課程
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}
