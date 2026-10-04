import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw } from "lucide-react";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  COURSE_INQUIRY_PAGE_SIZE,
  type CourseInquiryItem,
  type CourseInquiryPage,
  type CourseInquiryStatus,
} from "@/lib/course-inquiries";

const BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-4 py-3 text-base font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50";
const DEVICE = { phone: "手機", tablet: "iPad／平板", desktop: "桌機／筆電" };
const SUPPORT = {
  standard: "一般操作說明",
  "large-text": "大字與長輩模式",
  "step-by-step": "慢速、一步一步示範",
};
type Filter = "all" | CourseInquiryStatus;
type Update = { id: string; status: CourseInquiryStatus };
type Loaded = { key: string; page?: CourseInquiryPage; error?: string };

export function CourseInquiryInbox() {
  const { user, isPending } = useCurrentUserState();
  if (!authEnabled || isPending || !user || user.isDevFallback) return null;
  return <InboxContents key={user.id} />;
}

function InboxContents() {
  const uid = useId();
  const [filter, setFilter] = useState<Filter>("new");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [notice, setNotice] = useState("");
  const key = `${filter}:${offset}:${revision}`;
  const page = loaded?.key === key ? loaded.page : undefined;
  const error = loaded?.key === key ? loaded.error : undefined;
  const loading = loaded?.key !== key;
  const mounted = useRef(false);
  const busy = useRef(false);
  const patchController = useRef<AbortController | null>(null);
  const focusAfterLoad = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      patchController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (forbidden) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void fetch(`/api/course-inquiries?status=${filter}&offset=${offset}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 403) {
          setLoaded(null);
          setForbidden(true);
          return;
        }
        const result: unknown = await response.json();
        if (cancelled) return;
        if (!response.ok || !isInquiryPage(result)) throw new Error("inquiry-list-unavailable");
        if (!result.items.length && offset > 0) {
          setOffset(
            Math.max(
              0,
              Math.ceil(result.total / COURSE_INQUIRY_PAGE_SIZE - 1) * COURSE_INQUIRY_PAGE_SIZE,
            ),
          );
          return;
        }
        setLoaded({ key, page: result });
        if (focusAfterLoad.current) {
          focusAfterLoad.current = false;
          requestAnimationFrame(() => {
            if (!cancelled) headingRef.current?.focus();
          });
        }
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({ key, error: "暫時無法讀取課程詢問，請確認連線與登入狀態後重試。" });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [filter, offset, revision, key, forbidden]);

  function refresh() {
    if (busy.current || pendingUpdate) return;
    setNotice("");
    focusAfterLoad.current = true;
    setRevision((value) => value + 1);
  }

  async function updateStatus(update: Update) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setNotice("");
    const controller = new AbortController();
    patchController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/course-inquiries", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
        signal: controller.signal,
      });
      if (!mounted.current) return;
      if (response.status === 403) {
        setLoaded(null);
        setForbidden(true);
        setPendingUpdate(null);
        return;
      }
      const result: unknown = await response.json();
      if (!mounted.current) return;
      if (
        response.ok &&
        isRecord(result) &&
        result.ok === true &&
        result.id === update.id &&
        result.status === update.status
      ) {
        setPendingUpdate(null);
        setNotice(
          update.status === "handled"
            ? "已標記為已處理。這只表示管理進度，不代表已聯絡、已報名或已付款。"
            : "已重新開啟，列回新的詢問。這不會寄信或撥打電話。",
        );
        if (filter !== "all" && page?.items.length === 1 && offset > 0)
          setOffset(Math.max(0, offset - COURSE_INQUIRY_PAGE_SIZE));
        setRevision((value) => value + 1);
      } else if (
        isRecord(result) &&
        result.ok === false &&
        [400, 404, 413, 415].includes(response.status)
      ) {
        setPendingUpdate(null);
        setNotice("這次狀態更新未成功，請重新讀取詢問後再試。");
      } else {
        setPendingUpdate(update);
        setNotice("還無法確認處理狀態是否更新。請重試確認同一筆狀態；不會傳送任何聯絡訊息。");
      }
      requestAnimationFrame(() => {
        if (mounted.current) noticeRef.current?.focus();
      });
    } catch {
      if (!mounted.current) return;
      setPendingUpdate(update);
      setNotice("連線中斷或等候逾時，還無法確認處理狀態是否更新。請恢復連線後重試確認同一筆狀態。");
      requestAnimationFrame(() => {
        if (mounted.current) noticeRef.current?.focus();
      });
    } finally {
      clearTimeout(timeout);
      busy.current = false;
      patchController.current = null;
      if (mounted.current) setSaving(false);
    }
  }

  // Only the owning instructor can see this section. A normal teacher's 403 stays silent.
  if (forbidden || !loaded) return null;
  const controlsDisabled = saving || !!pendingUpdate;
  return (
    <section
      className="academy-card mt-8 min-w-0 p-5 sm:p-6 [overflow-wrap:anywhere]"
      aria-labelledby={`${uid}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            id={`${uid}-title`}
            className="flex items-center gap-2 text-xl font-semibold outline-offset-4"
          >
            <Inbox className="size-5 shrink-0 text-brand" aria-hidden="true" />
            課程詢問
          </h2>
          <p className="mt-3 text-base leading-7 text-muted">
            只有管理講師可查看。請使用對方留下的聯絡方式自行處理；本區不會自動寄信或撥打電話。
          </p>
        </div>
        <button
          type="button"
          className={BUTTON}
          disabled={loading || controlsDisabled}
          onClick={refresh}
        >
          <RefreshCw className="size-5 shrink-0" aria-hidden="true" />
          更新詢問
        </button>
      </div>
      <div className="mt-5 rounded-xl bg-bg p-4 text-base leading-7 text-muted">
        「已處理」只記錄管理進度，不表示已聯絡、已報名或已付款。詢問資料不包含在班級練習 CSV 中。
      </div>
      <label htmlFor={`${uid}-filter`} className="mt-5 block text-base font-semibold">
        查看哪些詢問
      </label>
      <select
        id={`${uid}-filter`}
        value={filter}
        disabled={controlsDisabled}
        onChange={(event) => {
          setFilter(event.target.value as Filter);
          setOffset(0);
          setNotice("");
          focusAfterLoad.current = true;
        }}
        className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-border-strong bg-surface px-3 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 sm:max-w-sm"
      >
        <option value="new">新的詢問</option>
        <option value="handled">已處理</option>
        <option value="all">全部詢問</option>
      </select>
      {notice && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          className="mt-5 rounded-xl border border-brand/25 bg-brand/5 p-4 text-base leading-7 outline-offset-4"
        >
          <p>{notice}</p>
          {pendingUpdate && (
            <button
              type="button"
              className={`${BUTTON} mt-3`}
              disabled={saving}
              onClick={() => void updateStatus(pendingUpdate)}
            >
              {saving ? "正在確認…" : "重試確認這筆狀態"}
            </button>
          )}
        </div>
      )}
      {loading && (
        <p role="status" className="mt-5 text-base leading-7">
          正在讀取詢問…
        </p>
      )}
      {error && (
        <div className="mt-5 text-base leading-7">
          <p role="alert">{error}</p>
          <button
            type="button"
            className={`${BUTTON} mt-3`}
            disabled={controlsDisabled}
            onClick={refresh}
          >
            重試讀取詢問
          </button>
        </div>
      )}
      {page && (
        <>
          <p role="status" className="mt-5 text-base text-muted">
            {page.total
              ? `符合篩選共 ${page.total} 筆，顯示第 ${offset + 1} 至 ${offset + page.items.length} 筆。`
              : "目前沒有符合篩選的詢問。"}
          </p>
          <ul className="mt-4 space-y-4" aria-label="課程詢問清單">
            {page.items.map((item) => (
              <li
                key={item.id}
                className="min-w-0 rounded-xl border border-border bg-bg p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">{item.name}</h3>
                    <p className="mt-1 text-base leading-7 text-muted">
                      收到時間：
                      <time dateTime={item.createdAt}>{formatReceivedAt(item.createdAt)}</time>
                      （台灣時間）
                    </p>
                  </div>
                  <span className="rounded-lg border border-border bg-surface px-3 py-2 text-base font-medium">
                    {item.status === "new" ? "新的詢問" : "已處理"}
                  </span>
                </div>
                <dl className="mt-4 grid min-w-0 gap-3 text-base leading-7 sm:grid-cols-2">
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-muted">
                      {item.contactType === "email" ? "電子信箱" : "聯絡電話"}
                    </dt>
                    <dd className="mt-1 select-text break-all font-medium">{item.contact}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">使用裝置</dt>
                    <dd className="mt-1">{DEVICE[item.device]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">操作協助</dt>
                    <dd className="mt-1">{SUPPORT[item.support]}</dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-muted">詢問內容</dt>
                    <dd className="mt-1 whitespace-pre-wrap">{item.question}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className={`${BUTTON} mt-5 w-full sm:w-auto`}
                  disabled={controlsDisabled}
                  aria-label={`${item.status === "new" ? "標記已處理" : "重新開啟"}：${item.name}的詢問`}
                  onClick={() =>
                    void updateStatus({
                      id: item.id,
                      status: item.status === "new" ? "handled" : "new",
                    })
                  }
                >
                  {item.status === "new" ? (
                    <Check className="size-5 shrink-0" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="size-5 shrink-0" aria-hidden="true" />
                  )}
                  {saving
                    ? "正在更新狀態…"
                    : item.status === "new"
                      ? "標記為已處理"
                      : "重新開啟詢問"}
                </button>
              </li>
            ))}
          </ul>
          {(offset > 0 || page.hasMore) && (
            <nav aria-label="課程詢問分頁" className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={BUTTON}
                disabled={offset === 0 || controlsDisabled}
                onClick={() => {
                  setOffset(Math.max(0, offset - COURSE_INQUIRY_PAGE_SIZE));
                  focusAfterLoad.current = true;
                  setNotice("");
                }}
              >
                <ChevronLeft className="size-5 shrink-0" aria-hidden="true" />
                上一頁
              </button>
              <span className="text-base text-muted">
                第 {Math.floor(offset / COURSE_INQUIRY_PAGE_SIZE) + 1} 頁
              </span>
              <button
                type="button"
                className={BUTTON}
                disabled={!page.hasMore || controlsDisabled}
                onClick={() => {
                  setOffset(offset + COURSE_INQUIRY_PAGE_SIZE);
                  focusAfterLoad.current = true;
                  setNotice("");
                }}
              >
                下一頁
                <ChevronRight className="size-5 shrink-0" aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function formatReceivedAt(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInquiryPage(value: unknown): value is CourseInquiryPage {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    !Array.isArray(value.items) ||
    value.items.length > COURSE_INQUIRY_PAGE_SIZE ||
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < 0 ||
    typeof value.hasMore !== "boolean"
  )
    return false;
  return value.items.every(
    (item: unknown): item is CourseInquiryItem =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.contact === "string" &&
      typeof item.question === "string" &&
      typeof item.createdAt === "string" &&
      Number.isFinite(Date.parse(item.createdAt)) &&
      (item.contactType === "email" || item.contactType === "phone") &&
      (item.device === "phone" || item.device === "tablet" || item.device === "desktop") &&
      (item.support === "standard" ||
        item.support === "large-text" ||
        item.support === "step-by-step") &&
      (item.status === "new" || item.status === "handled"),
  );
}
