import { useEffect, useId, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { addSessionFeedback, loadSessionFeedback } from "@/lib/classroom-db";
import {
  addSessionFeedbackSchema,
  type SessionFeedbackPage,
  type AddSessionFeedbackInput,
} from "@/lib/classroom-feedback";

type Props = { userId: string; sessionId: string; canWrite?: boolean };

// Remount the entire panel when identity changes; drafts and requests belong to one account.
export function SessionFeedbackPanel(props: Props) {
  return (
    <FeedbackContents key={`${props.userId}:${props.sessionId}:${!!props.canWrite}`} {...props} />
  );
}

function FeedbackContents({ sessionId, canWrite = false }: Props) {
  const uid = useId();
  const [page, setPage] = useState<SessionFeedbackPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [observation, setObservation] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const busy = useRef(false);
  const pending = useRef<AddSessionFeedbackInput | null>(null);
  const observationRef = useRef<HTMLTextAreaElement>(null);
  const nextStepRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const hasDraft = canWrite && (!!observation || !!nextStep || saving || retryPending);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => hasDraft && current.pathname !== next.pathname,
    enableBeforeUnload: hasDraft,
    withResolver: true,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void loadSessionFeedback({ data: { sessionId } })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError("暫時無法讀取回饋，請確認登入狀態後重試。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, reload]);

  async function loadMore() {
    if (!page?.nextCursor || loading || busy.current) return;
    setLoading(true);
    setLoadError("");
    try {
      const result = await loadSessionFeedback({ data: { sessionId, before: page.nextCursor } });
      if (!mounted.current) return;
      setPage((current) =>
        current
          ? {
              items: [
                ...current.items,
                ...result.items.filter((item) => !current.items.some((old) => old.id === item.id)),
              ],
              nextCursor: result.nextCursor,
            }
          : result,
      );
    } catch {
      if (mounted.current) setLoadError("較早的回饋讀取失敗，已顯示的內容仍保留。請重試。");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || loading || !page) return;
    const parsed = addSessionFeedbackSchema.safeParse(
      pending.current ?? {
        sessionId,
        requestId: crypto.randomUUID(),
        observation,
        nextStep,
      },
    );
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
      setFieldErrors(errors);
      if (errors.observation) observationRef.current?.focus();
      else nextStepRef.current?.focus();
      return;
    }
    setFieldErrors({});
    pending.current = parsed.data;
    busy.current = true;
    setSaving(true);
    setMessage("");
    try {
      const item = await addSessionFeedback({ data: parsed.data });
      if (!mounted.current) return;
      setPage((current) =>
        current
          ? { ...current, items: [item, ...current.items.filter((old) => old.id !== item.id)] }
          : { items: [item], nextCursor: null },
      );
      pending.current = null;
      setRetryPending(false);
      setObservation("");
      setNextStep("");
      setMessage("回饋已儲存，學員可在這份復盤查看。");
      requestAnimationFrame(() => savedRef.current?.focus());
    } catch {
      if (!mounted.current) return;
      setRetryPending(true);
      setMessage(
        "尚未確認儲存成功，原內容保留在本頁。請用下方按鈕重試確認，避免重複新增；確認後即可寫下一則。",
      );
      requestAnimationFrame(() => savedRef.current?.focus());
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <>
      <section
        id="instructor-feedback"
        className="academy-card mt-6 scroll-mt-6 p-5 sm:p-6"
        aria-labelledby={`${uid}-title`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${uid}-title`} className="text-xl font-semibold">
            講師回饋
          </h2>
          <button
            type="button"
            className="academy-button-secondary min-h-12"
            disabled={loading || saving || retryPending}
            onClick={() => setReload((value) => value + 1)}
          >
            {loading ? "更新中…" : "更新回饋"}
          </button>
        </div>
        <p className="mt-3 text-base leading-7 text-muted">
          每次選一個動作練習，再回來對照。回饋按新增時間排列，最新在上方。
        </p>
        {loading && (
          <p role="status" className="mt-4 text-base">
            讀取回饋中…
          </p>
        )}
        {loadError && (
          <div className="mt-4 text-base leading-7">
            <p role="alert">{loadError}</p>
            <button
              type="button"
              className="academy-button-secondary mt-3 min-h-12 text-base"
              disabled={loading || saving}
              onClick={() => (page?.nextCursor ? void loadMore() : setReload((value) => value + 1))}
            >
              重試讀取回饋
            </button>
          </div>
        )}
        {page && !page.items.length && !loading && !loadError && !saving && !retryPending && (
          <p className="mt-4 rounded-xl bg-bg p-4 text-base leading-7">這份復盤還沒有講師回饋。</p>
        )}
        {!!page?.items.length && (
          <ol className="mt-5 space-y-4" aria-label="已儲存的講師回饋">
            {page.items.map((item) => (
              <li
                key={item.id}
                className="min-w-0 rounded-xl border border-border bg-bg p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base leading-7">
                  <span className="break-all font-semibold">{item.authorName || "講師"}</span>
                  <time className="text-muted" dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString("zh-TW", {
                      timeZone: "Asia/Taipei",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    （台北時間）
                  </time>
                </div>
                <h3 className="mt-4 text-base font-semibold">這次觀察</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-base leading-8">
                  {item.observation}
                </p>
                <h3 className="mt-4 text-base font-semibold text-brand">下次練習</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-base leading-8">
                  {item.nextStep}
                </p>
              </li>
            ))}
          </ol>
        )}
        {page?.nextCursor && !loadError && (
          <button
            type="button"
            className="academy-button-secondary mt-4 min-h-12 text-base"
            disabled={loading || saving}
            onClick={() => void loadMore()}
          >
            查看較早回饋
          </button>
        )}
        {canWrite && (
          <form
            className="mt-6 space-y-5 border-t border-border pt-6"
            onSubmit={(event) => void submit(event)}
            noValidate
          >
            <div>
              <h3 className="text-lg font-semibold">新增一則回饋</h3>
              <p className="mt-2 text-base leading-7 text-muted">
                請引用本次操作，給學員一個可執行的練習。送出後保留原文；需要補充時，再新增一則。
              </p>
            </div>
            <div>
              <label htmlFor={`${uid}-observation`} className="block text-base font-semibold">
                這次觀察（必填）
              </label>
              <p id={`${uid}-observation-hint`} className="mt-2 text-base leading-7 text-muted">
                例如：你有先寫停損條件，但到價後又等待了兩次。
              </p>
              <textarea
                ref={observationRef}
                id={`${uid}-observation`}
                className="academy-input mt-3 min-h-36 resize-y leading-8"
                rows={4}
                maxLength={600}
                value={observation}
                disabled={saving}
                readOnly={retryPending}
                onChange={(event) => setObservation(event.target.value)}
                aria-invalid={!!fieldErrors.observation}
                aria-describedby={`${uid}-observation-hint ${uid}-observation-count${fieldErrors.observation ? ` ${uid}-observation-error` : ""}`}
              />
              <p id={`${uid}-observation-count`} className="mt-2 text-base text-muted">
                {observation.length}/600 字
              </p>
              {fieldErrors.observation && (
                <p id={`${uid}-observation-error`} className="mt-2 text-base" role="alert">
                  請填寫這次觀察，最多 600 字。
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`${uid}-next`} className="block text-base font-semibold">
                下次練習（必填）
              </label>
              <p id={`${uid}-next-hint`} className="mt-2 text-base leading-7 text-muted">
                例如：重練同一課，到達自己寫的停損條件就平倉，再記下是否做到。
              </p>
              <textarea
                ref={nextStepRef}
                id={`${uid}-next`}
                className="academy-input mt-3 min-h-32 resize-y leading-8"
                rows={3}
                maxLength={300}
                value={nextStep}
                disabled={saving}
                readOnly={retryPending}
                onChange={(event) => setNextStep(event.target.value)}
                aria-invalid={!!fieldErrors.nextStep}
                aria-describedby={`${uid}-next-hint ${uid}-next-count${fieldErrors.nextStep ? ` ${uid}-next-error` : ""}`}
              />
              <p id={`${uid}-next-count`} className="mt-2 text-base text-muted">
                {nextStep.length}/300 字
              </p>
              {fieldErrors.nextStep && (
                <p id={`${uid}-next-error`} className="mt-2 text-base" role="alert">
                  請填寫下次練習，最多 300 字。
                </p>
              )}
            </div>
            {message && (
              <p
                ref={savedRef}
                tabIndex={-1}
                role="status"
                className="rounded-xl bg-brand/5 p-4 text-base leading-7"
              >
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={saving || loading || !page}
              className="academy-button-primary min-h-12 w-full whitespace-normal text-base sm:w-auto"
            >
              {saving ? "儲存中…" : retryPending ? "重試確認這則回饋" : "儲存回饋給學員"}
            </button>
          </form>
        )}
      </section>
      <Dialog.Root
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[61] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-panel)]"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              stayRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              observationRef.current?.focus();
            }}
          >
            <Dialog.Title className="text-xl font-semibold">回饋還沒確認完成</Dialog.Title>
            <Dialog.Description className="mt-3 text-base leading-7 text-muted">
              離開會失去本頁草稿。若剛送出但尚未確認成功，回來時請先查看已儲存的回饋，避免重複新增。
            </Dialog.Description>
            <div className="mt-5 flex flex-col gap-3">
              <button
                ref={stayRef}
                type="button"
                className="academy-button-primary min-h-12 whitespace-normal text-base"
                onClick={() => blocker.reset?.()}
              >
                留在這頁完成回饋
              </button>
              <button
                type="button"
                className="academy-button-secondary min-h-12 whitespace-normal text-base"
                onClick={() => blocker.proceed?.()}
              >
                離開這頁
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
