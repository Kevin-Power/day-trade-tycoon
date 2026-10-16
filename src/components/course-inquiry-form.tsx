import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, CheckCircle2, Send } from "lucide-react";
import { courseInquirySchema, type CourseInquiryInput } from "@/lib/course-inquiries";

const INPUT =
  "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-border-strong bg-bg px-3 py-3 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70";
const PRIMARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-base font-semibold text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-5 py-3 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
const EMPTY = {
  name: "",
  contactType: "email" as "email" | "phone",
  contact: "",
  device: "",
  support: "",
  question: "",
  consent: false,
  website: "",
};
type Fields = typeof EMPTY;

export function CourseInquiryForm() {
  if (import.meta.env.BASE_URL === "./") {
    return (
      <section id="course-inquiry" className="academy-card mt-5 scroll-mt-24 p-5 sm:p-6">
        <h3 className="text-xl font-semibold">課程與操作協助詢問</h3>
        <p className="mt-3 text-base leading-7 text-muted">
          這是離線教室，無法送出課程詢問。連上網路後，請到正式網站填寫詢問表單。
        </p>
        <a href="https://rich.yilutek.com/license#course-inquiry" className={`${PRIMARY} mt-4`}>
          前往正式網站詢問 <ArrowUpRight className="size-5 shrink-0" aria-hidden="true" />
        </a>
      </section>
    );
  }
  return <InquiryContents />;
}

function InquiryContents() {
  const uid = useId();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<CourseInquiryInput | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const hasDraft = !!(
    fields.name ||
    fields.contact ||
    fields.device ||
    fields.support ||
    fields.question ||
    fields.consent ||
    fields.contactType !== "email" ||
    saving ||
    retryPending
  );
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

  function change<K extends keyof Fields>(field: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setMessage("");
    setSuccess(false);
  }

  function focusMessage() {
    requestAnimationFrame(() => {
      if (mounted.current) messageRef.current?.focus();
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const parsed = courseInquirySchema.safeParse(
      pending.current ?? { ...fields, requestId: crypto.randomUUID() },
    );
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        if (!nextErrors[field]) nextErrors[field] = validationMessage(field, fields.contactType);
      }
      setErrors(nextErrors);
      setMessage("");
      const first = [
        "name",
        "contactType",
        "contact",
        "device",
        "support",
        "question",
        "consent",
      ].find((field) => nextErrors[field]);
      requestAnimationFrame(() => {
        if (mounted.current && first)
          formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      });
      return;
    }

    const wasPending = retryPending;
    pending.current = parsed.data;
    busy.current = true;
    setSaving(true);
    setErrors({});
    setSuccess(false);
    setMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/course-inquiries", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      const result: unknown = await response.json();
      if (!mounted.current) return;
      if (
        response.ok &&
        isRecord(result) &&
        result.ok === true &&
        typeof result.id === "string" &&
        result.id
      ) {
        pending.current = null;
        setRetryPending(false);
        setFields(EMPTY);
        setSuccess(true);
        setMessage(
          "已收到你的課程詢問，管理講師可在教室查看。這不等於完成報名或付款，也不會自動訂閱或寄出通知信。",
        );
      } else if (
        !wasPending &&
        isRecord(result) &&
        result.ok === false &&
        [400, 403, 409, 413, 415, 429].includes(response.status)
      ) {
        pending.current = null;
        setRetryPending(false);
        setMessage(
          response.status === 429
            ? "目前詢問較多，這次尚未送出。內容仍保留在本頁，請稍後再試。"
            : response.status === 400
              ? "這次尚未送出，請確認稱呼、聯絡方式與詢問內容後再試。內容仍保留在本頁。"
              : "這次尚未送出。內容仍保留在本頁，請確認正在使用正式教室網站後再試。",
        );
      } else {
        setRetryPending(true);
        setMessage(
          "還無法確認是否收到詢問。內容已保留並暫時鎖定，請按「重試確認這份詢問」，以同一份資料確認，避免重複送出。請先不要重新整理或關閉本頁。",
        );
      }
      focusMessage();
    } catch {
      if (!mounted.current) return;
      setRetryPending(true);
      setMessage(
        "連線中斷或等候逾時，還無法確認是否收到詢問。內容已保留並暫時鎖定；恢復連線後，請按「重試確認這份詢問」。請先不要重新整理或關閉本頁。",
      );
      focusMessage();
    } finally {
      clearTimeout(timeout);
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function description(field: keyof Fields, hint = false) {
    return (
      [hint ? `${uid}-${field}-hint` : "", errors[field] ? `${uid}-${field}-error` : ""]
        .filter(Boolean)
        .join(" ") || undefined
    );
  }

  return (
    <>
      <section
        id="course-inquiry"
        className="academy-card mt-5 scroll-mt-24 p-5 sm:p-7"
        aria-labelledby={`${uid}-title`}
      >
        <p className="text-base font-medium text-brand">有興趣，先問清楚</p>
        <h3 id={`${uid}-title`} className="mt-2 text-2xl font-semibold">
          課程與操作協助詢問
        </h3>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted">
          留下你想了解的課程或需要的操作協助，由管理講師處理這份詢問。填表不收費、不預留名額；課程日期與費用尚未確認，實際開班與堂數仍需另外確認。
        </p>
        <form
          ref={formRef}
          onSubmit={(event) => void submit(event)}
          noValidate
          className="mt-6 space-y-5"
        >
          <fieldset disabled={saving || retryPending} className="min-w-0 space-y-5">
            <legend className="mb-4 text-base text-muted">以下欄位皆必填；稱呼可用暱稱。</legend>
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field uid={uid} name="name" label="怎麼稱呼你" error={errors.name}>
                <input
                  id={`${uid}-name`}
                  name="name"
                  autoComplete="nickname"
                  maxLength={40}
                  value={fields.name}
                  onChange={(event) => change("name", event.target.value)}
                  className={INPUT}
                  required
                  aria-invalid={!!errors.name}
                  aria-describedby={description("name")}
                  placeholder="可填暱稱，最多 40 字"
                />
              </Field>
              <Field
                uid={uid}
                name="contactType"
                label="希望使用哪種聯絡方式"
                error={errors.contactType}
              >
                <select
                  id={`${uid}-contactType`}
                  name="contactType"
                  value={fields.contactType}
                  onChange={(event) =>
                    change("contactType", event.target.value as Fields["contactType"])
                  }
                  className={INPUT}
                  required
                  aria-invalid={!!errors.contactType}
                  aria-describedby={description("contactType")}
                >
                  <option value="email">電子信箱</option>
                  <option value="phone">電話</option>
                </select>
              </Field>
            </div>
            <Field
              uid={uid}
              name="contact"
              label={fields.contactType === "email" ? "電子信箱" : "聯絡電話"}
              error={errors.contact}
            >
              <input
                id={`${uid}-contact`}
                name="contact"
                type={fields.contactType === "email" ? "email" : "tel"}
                autoComplete={fields.contactType === "email" ? "email" : "tel"}
                inputMode={fields.contactType === "email" ? "email" : "tel"}
                maxLength={254}
                value={fields.contact}
                onChange={(event) => change("contact", event.target.value)}
                className={INPUT}
                required
                aria-invalid={!!errors.contact}
                aria-describedby={description("contact", true)}
                placeholder={
                  fields.contactType === "email" ? "例如：name@example.com" : "例如：0912 345 678"
                }
              />
              <p id={`${uid}-contact-hint`} className="mt-2 text-base leading-7 text-muted">
                只需留一種聯絡方式，請確認填寫正確。教室回覆方式以你留下的電子信箱或電話為準；本表單不會自動寄信或撥打電話。
              </p>
            </Field>
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field uid={uid} name="device" label="主要使用的裝置" error={errors.device}>
                <select
                  id={`${uid}-device`}
                  name="device"
                  value={fields.device}
                  onChange={(event) => change("device", event.target.value)}
                  className={INPUT}
                  required
                  aria-invalid={!!errors.device}
                  aria-describedby={description("device")}
                >
                  <option value="">請選擇裝置</option>
                  <option value="phone">手機</option>
                  <option value="tablet">iPad／平板</option>
                  <option value="desktop">桌機／筆電</option>
                </select>
              </Field>
              <Field uid={uid} name="support" label="你最需要的操作協助" error={errors.support}>
                <select
                  id={`${uid}-support`}
                  name="support"
                  value={fields.support}
                  onChange={(event) => change("support", event.target.value)}
                  className={INPUT}
                  required
                  aria-invalid={!!errors.support}
                  aria-describedby={description("support")}
                >
                  <option value="">請選擇需要的協助</option>
                  <option value="standard">一般操作說明</option>
                  <option value="large-text">大字模式</option>
                  <option value="step-by-step">慢速、一步一步示範</option>
                </select>
              </Field>
            </div>
            <Field uid={uid} name="question" label="想詢問什麼" error={errors.question}>
              <p id={`${uid}-question-hint`} className="mt-2 text-base leading-7 text-muted">
                例如：想知道上課方式，或體驗時哪一步需要協助。請勿填寫帳號密碼、身分證字號或金融帳戶資料。
              </p>
              <textarea
                id={`${uid}-question`}
                name="question"
                rows={5}
                maxLength={600}
                value={fields.question}
                onChange={(event) => change("question", event.target.value)}
                className={`${INPUT} resize-y leading-7`}
                required
                aria-invalid={!!errors.question}
                aria-describedby={`${description("question", true)} ${uid}-question-count`}
              />
              <p id={`${uid}-question-count`} className="mt-2 text-base text-muted">
                {fields.question.length} / 600 字
              </p>
            </Field>
            <div className="hidden" aria-hidden="true">
              <label htmlFor={`${uid}-website`}>網站</label>
              <input
                id={`${uid}-website`}
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={fields.website}
                onChange={(event) => change("website", event.target.value)}
              />
            </div>
            <div className="rounded-xl border border-border bg-bg p-4 sm:p-5">
              <p id={`${uid}-consent-hint`} className="text-base leading-7 text-muted">
                你填寫的稱呼、聯絡方式與詢問內容，會保存在教室主機與受保護的備份，由管理講師用於處理此詢問。不會自動訂閱或寄信；此表單不代表報名、付款或保留名額。
              </p>
              <label
                htmlFor={`${uid}-consent`}
                className="mt-3 flex min-h-12 cursor-pointer items-start gap-3 py-3 text-base font-medium leading-7"
              >
                <input
                  id={`${uid}-consent`}
                  name="consent"
                  type="checkbox"
                  checked={fields.consent}
                  onChange={(event) => change("consent", event.target.checked)}
                  className="mt-1 size-5 shrink-0 accent-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                  required
                  aria-invalid={!!errors.consent}
                  aria-describedby={description("consent", true)}
                />
                我已閱讀並同意上述資料保存與使用方式。
              </label>
              {errors.consent && (
                <p id={`${uid}-consent-error`} className="mt-2 text-base font-medium" role="alert">
                  {errors.consent}
                </p>
              )}
            </div>
          </fieldset>
          {message && (
            <div
              ref={messageRef}
              tabIndex={-1}
              role="status"
              className="rounded-xl border border-brand/25 bg-brand/5 p-4 text-base leading-7 outline-offset-4"
            >
              {success && <CheckCircle2 className="mb-2 size-6 text-brand" aria-hidden="true" />}
              {message}
            </div>
          )}
          <button
            ref={submitRef}
            type="submit"
            disabled={saving}
            className={`${PRIMARY} w-full sm:w-auto`}
          >
            <Send className="size-5 shrink-0" aria-hidden="true" />
            {saving ? "正在確認送出結果…" : retryPending ? "重試確認這份詢問" : "送出課程詢問"}
          </button>
          <p className="text-base leading-7 text-muted">
            草稿只保留在目前頁面。看到「已收到」後，才代表這份詢問已成功送達。
          </p>
        </form>
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
              submitRef.current?.focus();
            }}
          >
            <Dialog.Title className="text-xl font-semibold">詢問還沒確認送達</Dialog.Title>
            <Dialog.Description className="mt-3 text-base leading-7 text-muted">
              離開會失去本頁草稿。如果剛送出但還沒確認，建議留在這裡重試確認，避免重新填寫後重複送出。
            </Dialog.Description>
            <div className="mt-5 flex flex-col gap-3">
              <button
                ref={stayRef}
                type="button"
                className={PRIMARY}
                onClick={() => blocker.reset?.()}
              >
                留在這頁完成詢問
              </button>
              <button type="button" className={SECONDARY} onClick={() => blocker.proceed?.()}>
                離開這頁
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Field({
  uid,
  name,
  label,
  error,
  children,
}: {
  uid: string;
  name: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={`${uid}-${name}`} className="block text-base font-semibold">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${uid}-${name}-error`} className="mt-2 text-base font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function validationMessage(field: string, contactType: Fields["contactType"]) {
  const messages: Record<string, string> = {
    name: "請填寫稱呼或暱稱，最多 40 字。",
    contactType: "請選擇電子信箱或電話。",
    contact:
      contactType === "email"
        ? "請填寫有效的電子信箱，例如 name@example.com。"
        : "請填寫有效的電話，含 7 至 15 個數字；可加國碼、空格、括號或連字號。",
    device: "請選擇主要使用的裝置。",
    support: "請選擇你最需要的操作協助。",
    question: "請填寫想詢問的內容，最多 600 字。",
    consent: "請先閱讀並勾選同意資料保存與使用方式，才能送出。",
  };
  return messages[field] ?? "請確認填寫內容後再試。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
