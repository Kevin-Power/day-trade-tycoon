import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadTeacherSessionDetail } from "@/lib/classroom-db";
import { SessionReport } from "@/components/session-report";
import { SessionFeedbackPanel } from "@/components/session-feedback";
import { RedirectToSignIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/teacher-review/$id")({ component: TeacherReviewRoute });

type Detail = Awaited<ReturnType<typeof loadTeacherSessionDetail>>;

function TeacherReviewRoute() {
  const { id } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id;
  const requestKey = `${userId ?? "guest"}:${id}`;
  const [loaded, setLoaded] = useState<{ key: string; detail: Detail } | null>(null);
  useEffect(() => {
    if (isPending || !userId) return;
    let cancelled = false;
    void loadTeacherSessionDetail({ data: { id } })
      .then((detail) => {
        if (!cancelled) setLoaded({ key: requestKey, detail });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: requestKey, detail: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId, isPending, requestKey]);

  if (isPending)
    return (
      <main className="academy-page p-8 text-base" role="status">
        確認講師帳號…
      </main>
    );
  if (!user) return <RedirectToSignIn />;
  if (loaded?.key !== requestKey)
    return (
      <main className="academy-page p-8 text-base" role="status">
        載入班級復盤中…
      </main>
    );
  if (!loaded.detail)
    return (
      <main className="academy-page px-4 py-12">
        <div className="academy-card mx-auto max-w-xl p-6">
          <h1 className="text-2xl font-semibold">目前無法開啟這份復盤</h1>
          <p className="mt-4 text-base leading-7 text-muted">
            請確認使用已驗證的講師帳號，且講師與學員都已完成同班資料。若紀錄已保存，可稍後再試。
          </p>
          <Link to="/teacher" className="academy-button-secondary mt-6 min-h-12 text-base">
            回講師工作區
          </Link>
        </div>
      </main>
    );
  return (
    <SessionReport
      key={requestKey}
      bundle={loaded.detail.bundle}
      viewer={{ kind: "teacher", studentName: loaded.detail.studentName }}
      feedback={<SessionFeedbackPanel userId={user.id} sessionId={id} canWrite />}
    />
  );
}
