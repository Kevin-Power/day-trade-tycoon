import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadReview, setProfileIdentity, type ReviewBundle } from "@/lib/game/persist";
import { loadSessionDetail, saveClassroomSession } from "@/lib/classroom-db";
import { SessionReport } from "@/components/session-report";

export const Route = createFileRoute("/session/$id/review")({ component: ReviewRoute });

function ReviewRoute() {
  const { id } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user && !user.isDevFallback ? user.id : null;
  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    setProfileIdentity(userId);
    const local = loadReview(id);
    setBundle(local);
    setSaved(false);
    setLoading(true);
    setMessage("");
    if (!userId) {
      setLoading(false);
      return;
    }
    void loadSessionDetail({ data: { id } })
      .then((remote) => {
        if (cancelled) return;
        setBundle(remote ?? local);
        setSaved(!!remote);
      })
      .catch(() => {
        if (!cancelled) setMessage("伺服器讀取暫時失敗；如有本機紀錄，將顯示本機版本。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId, isPending]);
  if (isPending || loading) return <main className="min-h-dvh bg-bg p-8 text-fg">載入復盤中…</main>;
  if (!bundle)
    return (
      <main className="min-h-dvh bg-bg p-8 text-fg">
        <h1 className="text-xl">找不到這份復盤</h1>
        <p className="mt-3 text-sm text-muted">
          這個編號沒有可讀取的紀錄。請用原本學員帳號登入，或回到儲存練習的裝置。
        </p>
        <Link to="/" className="mt-4 inline-block text-tape">
          回教室大廳
        </Link>
      </main>
    );
  return (
    <>
      <div className="border-b border-border bg-surface px-4 py-3 text-center text-xs text-muted">
        {saved ? "已儲存於教室主機" : "本機復盤紀錄"}
        {userId && !saved && (
          <button
            type="button"
            disabled={saving}
            className="ml-3 text-tape"
            onClick={() => {
              setSaving(true);
              setMessage("");
              void saveClassroomSession({ data: bundle })
                .then(() => setSaved(true))
                .catch((error) =>
                  setMessage(error instanceof Error ? error.message : "儲存失敗，請稍後重試"),
                )
                .finally(() => setSaving(false));
            }}
          >
            {saving ? "儲存中…" : "重新儲存到主機"}
          </button>
        )}
        {message && (
          <p role="status" className="mt-2">
            {message}
          </p>
        )}
      </div>
      <SessionReport key={id} bundle={bundle} />
    </>
  );
}
