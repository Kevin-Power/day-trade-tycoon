import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { authClient, authEnabled } from "@/lib/auth/client";
import { loadMyProfile, loadMyCareer } from "@/lib/classroom-db";
import { LESSONS } from "@/lib/game/curriculum";
import { formatSigned } from "@/lib/utils";

export function ClassroomAccount() {
  const { user, isPending } = useCurrentUserState();
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof loadMyProfile>>>(null);
  const [career, setCareer] = useState<Awaited<ReturnType<typeof loadMyCareer>> | null>(null);
  const [error, setError] = useState("");
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
          if (!cancelled) setError("目前無法載入伺服器紀錄，請稍後重新整理。");
        });
    return () => {
      cancelled = true;
    };
  }, [realUser]);
  if (!authEnabled || isPending) return null;
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">
            {realUser
              ? `${profile?.display_name || user?.displayName || "學員"} · 學習紀錄`
              : "學員帳號"}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {realUser
              ? "下方列出已成功儲存到本機主機的紀錄。"
              : "登入後可跨裝置查看已儲存紀錄，講師可查看本班進度。"}
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          {!realUser || !profile ? (
            <Link to="/login" className="text-tape">
              {realUser ? "完成班級資料" : "登入／註冊"}
            </Link>
          ) : null}
          {profile?.role === "teacher" && (
            <Link to="/teacher" className="text-tape">
              講師後台
            </Link>
          )}
          {realUser && (
            <button
              type="button"
              className="text-muted"
              onClick={() => void authClient.signOut().then(() => window.location.assign("/"))}
            >
              登出帳號
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="status" className="mt-3 text-sm text-up">
          {error}
        </p>
      )}
      {career && (
        <>
          <p className="mt-3 text-xs text-muted">
            已儲存 {career.count} 盤 · 模擬累計損益 {formatSigned(career.careerPnl, 0)} · 最近 40 盤
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {career.sessions.map((session) => (
              <Link
                key={session.id}
                to="/session/$id/review"
                params={{ id: session.id }}
                className="rounded border border-border px-3 py-2 text-xs hover:bg-elevated"
              >
                {LESSONS.find((lesson) => lesson.id === session.lesson_id)?.no || "自由練習"} ·{" "}
                {session.passed ? "通過" : "待練習"} ·{" "}
                {formatSigned(session.final_equity - session.initial_equity, 0)}
              </Link>
            ))}
          </div>
          {!career.sessions.length && (
            <p className="mt-2 text-sm text-muted">尚無已儲存練習，從第一課開始。</p>
          )}
        </>
      )}
    </section>
  );
}
