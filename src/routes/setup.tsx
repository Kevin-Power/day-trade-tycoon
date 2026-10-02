import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { AuthPasswordInput, ClassroomAuthLayout } from "@/components/classroom-auth-layout";

export const Route = createFileRoute("/setup")({ component: AdminSetup });
type SetupStatus = { configured: boolean; available: boolean; email?: string };

const FEATURES = [
  { title: "設定專屬講師帳號", description: "使用指定信箱與你親自設定的密碼，完成首次啟用。" },
  { title: "安排班級模擬練習", description: "帶領學員依照課程目標，練習觀察、決策與風險管理。" },
  { title: "從紀錄了解學習進度", description: "回看本班練習結果，讓課後討論有具體依據。" },
] as const;

function AdminSetup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [name, setName] = useState("講師");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [token, setToken] = useState("");
  const [fromLink, setFromLink] = useState(false);
  const [tos, setTos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (incoming) {
      setToken(incoming);
      setFromLink(true);
    }
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    void fetch("/api/admin/setup", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("初始化入口暫時無法讀取");
        setStatus(await response.json());
      })
      .catch(() => setError("初始化入口暫時無法讀取，請重新整理"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirmation) {
      setError("兩次密碼不一致");
      return;
    }
    setBusy(true);
    try {
      const result = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: status?.email, name, password, token, acceptTos: tos }),
      });
      const payload = await result.json();
      if (!result.ok || !payload.ok) throw new Error(payload.message || "初始化失敗");
      setToken("");
      setPassword("");
      setConfirmation("");
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "初始化失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClassroomAuthLayout
      heroTitle={
        <>
          你的教室，
          <br />
          從這裡開始。
        </>
      }
      heroDescription="完成一次講師設定，就能開始準備帶班。讓模擬練習與課後討論，成為學員學習的日常。"
      features={FEATURES}
      footer={
        !done ? (
          <Link to="/login" className="academy-nav-link inline-flex items-center gap-2">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            已有帳號？回到登入
          </Link>
        ) : undefined
      }
    >
      <p className="academy-eyebrow flex items-center gap-2">
        <KeyRound className="size-3.5" aria-hidden="true" />
        講師專用 / 首次設定
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">
        {done ? "教室已準備就緒" : "建立講師帳號"}
      </h1>
      {done ? (
        <div className="mt-6">
          <div className="rounded-xl border border-[var(--color-brand)]/20 bg-[var(--color-brand)]/5 p-5">
            <CircleCheck className="size-8 text-[var(--color-brand)]" aria-hidden="true" />
            <p className="mt-3 text-base font-medium text-fg" role="status">
              講師帳號已建立
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">
              請使用指定信箱與你剛設定的密碼登入，開始安排教室練習。
            </p>
          </div>
          <Link to="/login" className="academy-button-primary mt-6 w-full">
            前往登入
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : status && !status.available ? (
        <div className="mt-6 rounded-xl border border-border bg-bg p-5">
          <LockKeyhole className="size-6 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-fg">目前無法進行首次設定</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            初始化入口已關閉或尚未設定。既有講師請直接登入。
          </p>
        </div>
      ) : !status ? (
        <div
          className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-bg p-5 text-sm text-muted"
          role="status"
        >
          {!error ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : null}
          {error ? "尚未取得帳號設定" : "正在讀取帳號設定…"}
        </div>
      ) : (
        <form className="mt-5 space-y-5" onSubmit={submit} aria-busy={busy}>
          <p className="text-sm leading-6 text-muted">
            此入口僅建立本教室的第一個講師帳號，設定完成後會關閉。
          </p>
          <div className="rounded-xl border border-border bg-bg/50 p-4">
            <p className="text-xs text-muted">指定講師信箱</p>
            <p className="mt-1.5 break-all text-sm font-medium text-fg">{status.email}</p>
            {fromLink ? (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--color-brand)]">
                <Check className="size-3.5" aria-hidden="true" />
                已從專屬連結帶入初始化憑證
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="instructor-name" className="block text-sm font-medium text-fg">
              講師顯示名稱
            </label>
            <input
              id="instructor-name"
              name="name"
              required
              maxLength={40}
              autoComplete="name"
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="academy-input mt-2 w-full"
            />
          </div>
          <AuthPasswordInput
            id="instructor-password"
            name="password"
            label="設定帳號密碼"
            required
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint="請自行設定至少 10 個字元的密碼。"
          />
          <AuthPasswordInput
            id="instructor-confirmation"
            name="confirmation"
            label="再次輸入密碼"
            required
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            disabled={busy}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {!fromLink ? (
            <AuthPasswordInput
              id="instructor-token"
              name="token"
              label="一次性初始化憑證"
              required
              autoComplete="off"
              disabled={busy}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              hint="請使用教室管理者提供的初始化憑證。"
            />
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg/50 p-4 text-xs leading-6 text-muted">
            <input
              type="checkbox"
              required
              checked={tos}
              disabled={busy}
              onChange={(event) => setTos(event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
            />
            <span>我了解教室僅供模擬練習；模擬結果不代表實盤績效。</span>
          </label>
          <button
            type="submit"
            className="academy-button-primary w-full"
            disabled={busy || !tos || !status.available}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "正在建立帳號…" : "建立講師帳號"}
            {!busy ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-up/5 px-3 py-2 text-sm leading-6 text-up">
          {error}
        </p>
      ) : null}
    </ClassroomAuthLayout>
  );
}
