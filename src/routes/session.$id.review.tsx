import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadReviewState, saveReview, setProfileIdentity, type ReviewBundle } from "@/lib/game/persist";
import { loadSessionDetail, saveClassroomSession } from "@/lib/classroom-db";
import { SessionReport } from "@/components/session-report";
import { SERVER_REVIEW_FILL_LIMIT } from "@/lib/game/review-schema";
import { reviewSaveMessage } from "@/lib/game/review-storage-status";

export const Route = createFileRoute("/session/$id/review")({ component: ReviewRoute });

function ReviewRoute() {
  const { id } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user && !user.isDevFallback ? user.id : null;
  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requestKey = `${userId ?? "guest"}:${id}`;
  const currentRequest = useRef(requestKey);
  currentRequest.current = requestKey;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    setProfileIdentity(userId);
    const local = loadReviewState(id);
    setBundle(local?.bundle ?? null);
    setLocalSaved(local?.localSaved ?? false);
    setLoadedKey(requestKey);
    setSaved(false);
    setLoading(true);
    setSaving(false);
    setMessage("");
    if (!userId) {
      setLoading(false);
      return;
    }
    void loadSessionDetail({ data: { id } })
      .then((remote) => {
        if (cancelled) return;
        setBundle(remote ?? local?.bundle ?? null);
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
  }, [id, userId, isPending, requestKey]);
  if (isPending || loading || loadedKey !== requestKey) return <main className="min-h-dvh bg-bg p-8 text-fg">載入復盤中…</main>;
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
  const tooLarge = bundle.fills.length > SERVER_REVIEW_FILL_LIMIT;
  const status = saved ? "saved" : saving ? "saving" : userId && tooLarge ? "too-large" : "local";
  return (
    <>
      <div className="border-b border-border bg-surface px-4 py-3 text-center text-base leading-7 text-muted">
        <p role="status">{reviewSaveMessage(status, localSaved)}</p>
        {!localSaved && (
          <button type="button" className="mt-2 min-h-12 px-3 text-base text-tape" onClick={() => {
            setProfileIdentity(userId);
            const stored = saveReview(bundle);
            setLocalSaved(stored);
            setMessage(stored ? "完整復盤已保存在這台裝置。" : reviewSaveMessage("local", false));
          }}>重試保存到此裝置</button>
        )}
        {userId && !saved && !tooLarge && (
          <button
            type="button"
            disabled={saving}
            className="mt-2 min-h-12 px-3 text-base text-tape"
            onClick={() => {
              setSaving(true);
              setMessage("");
              void saveClassroomSession({ data: bundle })
                .then(() => { if (currentRequest.current === requestKey) setSaved(true); })
                .catch(() => {
                  if (currentRequest.current === requestKey) setMessage(reviewSaveMessage("failed", localSaved));
                })
                .finally(() => { if (currentRequest.current === requestKey) setSaving(false); });
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
