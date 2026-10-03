import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadTeacherRoster } from "@/lib/classroom-db";
import { TeacherWorkspaceView } from "@/components/teacher-workspace";
import { ArrowLeft, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/teacher")({ component: TeacherPage });
type Roster = Awaited<ReturnType<typeof loadTeacherRoster>> | { ok: false; reason: string };

function TeacherPage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id;
  const [revision, setRevision] = useState(0);
  const requestKey = `${userId ?? "guest"}:${revision}`;
  const [loaded, setLoaded] = useState<{ key: string; data: Roster } | null>(null);
  useEffect(() => {
    if (!userId || isPending) return;
    let cancelled = false;
    void loadTeacherRoster()
      .then((data) => {
        if (!cancelled) setLoaded({ key: requestKey, data });
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({
            key: requestKey,
            data: { ok: false, reason: "班級資料暫時未能載入，請確認連線後重試。" },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isPending, requestKey]);

  if (isPending) return <TeacherLoading message="確認講師帳號…" />;
  if (!user) return <RedirectToSignIn />;
  if (loaded?.key !== requestKey) return <TeacherLoading message="正在整理班級紀錄…" />;
  if (!loaded.data.ok)
    return (
      <main className="academy-page flex items-center justify-center px-4 py-16">
        <div className="academy-card w-full max-w-lg p-7 sm:p-9">
          <ShieldCheck aria-hidden="true" className="mb-5 size-9 text-brand" />
          <p className="academy-eyebrow">講師專區</p>
          <h1 className="mt-2 text-2xl font-semibold">目前無法開啟班級資料</h1>
          <p className="mt-4 text-base leading-7 text-muted">{loaded.data.reason}</p>
          <p className="mt-2 text-base leading-7 text-muted">
            講師權限由主機管理員指定，班級代碼不能用來取得講師權限。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="academy-button-secondary min-h-12"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              重新載入
            </button>
            <Link to="/" className="academy-button-secondary min-h-12">
              <ArrowLeft aria-hidden="true" className="size-4" />
              回教室大廳
            </Link>
          </div>
        </div>
      </main>
    );
  return (
    <TeacherWorkspaceView
      key={requestKey}
      data={loaded.data}
      onRefresh={() => setRevision((value) => value + 1)}
    />
  );
}

function TeacherLoading({ message }: { message: string }) {
  return (
    <main className="academy-page flex items-center justify-center px-4 py-20">
      <div role="status" className="academy-card flex items-center gap-3 p-6 text-base text-muted">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-brand" />
        {message}
      </div>
    </main>
  );
}
