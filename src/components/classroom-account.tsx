import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  GraduationCap,
  LoaderCircle,
  LogOut,
  UserRound,
} from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { authEnabled, signOut } from "@/lib/auth/client";
import { loadMyProfile, loadMyCareer } from "@/lib/classroom-db";
import { LESSONS } from "@/lib/game/curriculum";
import { formatSigned } from "@/lib/utils";

export function ClassroomAccount() {
  const { user, isPending } = useCurrentUserState();
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof loadMyProfile>>>(null);
  const [career, setCareer] = useState<Awaited<ReturnType<typeof loadMyCareer>> | null>(null);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const realUser = user && !user.isDevFallback ? user.id : null;
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setCareer(null);
    setError("");
    if (realUser)
      void Promise.all([loadMyProfile(), loadMyCareer()])
        .then(([nextProfile, nextCareer]) => {
          if (!cancelled) {
            setProfile(nextProfile);
            setCareer(nextCareer);
          }
        })
        .catch(() => {
          if (!cancelled) setError("目前無法載入學習紀錄，請稍後重新整理。");
        });
    return () => {
      cancelled = true;
    };
  }, [realUser]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError("");
    try {
      await signOut();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "登出失敗，請再試一次。");
      setSigningOut(false);
    }
  }

  if (!authEnabled || isPending) return null;
  const recordsLoading = Boolean(realUser && !career && !error);

  return (
    <section
      aria-label="學員帳號與學習紀錄"
      className="mb-6 rounded-2xl border border-border bg-surface px-4 py-3 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg text-muted">
            {profile?.role === "teacher" ? (
              <GraduationCap className="size-5" aria-hidden="true" />
            ) : (
              <UserRound className="size-[18px]" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="break-words text-sm font-semibold text-fg">
                {realUser
                  ? profile?.display_name || user?.displayName || "學員"
                  : "儲存你的學習進度"}
              </h2>
              {realUser ? (
                <span className="rounded-full bg-[var(--color-brand)]/8 px-2 py-0.5 text-[11px] text-[var(--color-brand)]">
                  {profile?.role === "teacher" ? "講師帳號" : "已登入"}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              {realUser
                ? recordsLoading
                  ? "正在讀取學習紀錄…"
                  : "回看已儲存的練習，接續自己的學習步調。"
                : "登入後可跨裝置查看紀錄，並與講師一起檢視進度。"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!realUser || (!profile && !recordsLoading) ? (
            <Link to="/login" className="academy-button-secondary !min-h-10 !px-3 !py-2 !text-xs">
              {realUser ? "完成班級資料" : "登入／建立帳號"}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
          {profile?.role === "teacher" ? (
            <Link to="/teacher" className="academy-button-secondary !min-h-10 !px-3 !py-2 !text-xs">
              <GraduationCap className="size-4" aria-hidden="true" />
              講師管理
            </Link>
          ) : null}
          {realUser ? (
            <button
              type="button"
              disabled={signingOut}
              className="academy-nav-link !text-xs disabled:opacity-50"
              onClick={() => void handleSignOut()}
            >
              {signingOut ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="size-3.5" aria-hidden="true" />
              )}
              {signingOut ? "登出中…" : "登出"}
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="status" className="mt-3 text-sm leading-6 text-up">
          {error}
        </p>
      ) : null}
      {career ? (
        <details className="group mt-3 border-t border-border pt-1">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 rounded-lg py-3 text-xs text-muted transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
            <span className="font-medium text-fg">我的練習紀錄</span>
            <span>
              已儲存 <span className="font-mono text-fg">{career.count}</span> 盤
            </span>
            <span>
              模擬累計損益{" "}
              <span
                className={`font-mono ${career.careerPnl > 0 ? "text-up" : career.careerPnl < 0 ? "text-down" : "text-fg"}`}
              >
                {formatSigned(career.careerPnl, 0)}
              </span>
            </span>
            <ChevronDown
              className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          {career.sessions.length ? (
            <div className="pb-2">
              <p className="mb-3 text-xs text-muted">最近 40 盤 · 選擇一盤查看復盤</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {career.sessions.map((session) => (
                  <Link
                    key={session.id}
                    to="/session/$id/review"
                    params={{ id: session.id }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-xs transition-colors hover:border-[var(--color-brand)]/40 hover:bg-bg"
                  >
                    <span className="text-fg">
                      {LESSONS.find((lesson) => lesson.id === session.lesson_id)?.no || "自由練習"}
                      <span className="ml-2 text-muted">{session.passed ? "通過" : "待練習"}</span>
                    </span>
                    <span className="font-mono text-muted">
                      {formatSigned(session.final_equity - session.initial_equity, 0)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="pb-3 text-sm leading-6 text-muted">尚無已儲存的練習，從第一課開始吧。</p>
          )}
        </details>
      ) : null}
    </section>
  );
}
