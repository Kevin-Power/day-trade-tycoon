import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, UserRound } from "@/lib/icons";
import { authClient, authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadMyProfile, upsertMyProfile } from "@/lib/classroom-db";
import { AuthPasswordInput, ClassroomAuthLayout } from "@/components/classroom-auth-layout";
import { safeNextPath } from "@/lib/safe-next";

export const Route = createFileRoute("/login")({
  // `next` returns the learner to the practice screen; `mode=up` opens on sign-up.
  validateSearch: (search: Record<string, unknown>): { next?: string; mode?: "up" } => {
    const next = safeNextPath(search.next);
    return { next: next === "/" ? undefined : next, mode: search.mode === "up" ? "up" : undefined };
  },
  component: Login,
});

const FEATURES = [
  { title: "找到自己的學習起點", description: "依照課程安排，從基礎觀察逐步練習到完整操作。" },
  { title: "保留每次練習的收穫", description: "登入帳號後，可跨裝置回看已儲存的練習紀錄。" },
  {
    title: "與講師一起檢視進度",
    description: "讓本班講師了解學習情況，協助你找到下一個練習重點。",
  },
] as const;

type VerifiedAccount = { id: string; name: string; email: string };

function Login() {
  const { next, mode } = Route.useSearch();
  const { user, isPending } = useCurrentUserState();
  // Keep the same account-keyed profile form while the session hook catches up.
  const [justAuthenticated, setJustAuthenticated] = useState<VerifiedAccount | null>(null);
  const userId = user && !user.isDevFallback ? user.id : null;
  useEffect(() => {
    if (userId) setJustAuthenticated(null);
  }, [userId]);
  const account =
    userId && user
      ? { id: userId, name: user.displayName ?? "", email: user.primaryEmail ?? "" }
      : justAuthenticated;
  return (
    <LoginLayout>
      {isPending && !justAuthenticated ? (
        <p role="status" className="flex items-center gap-3 py-8 text-base leading-7">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          正在確認登入狀態…
        </p>
      ) : account ? (
        <ProfileCompletion key={account.id} account={account} next={next ?? "/"} />
      ) : (
        <AccountCredentials initialMode={mode === "up" ? "up" : "in"} onAuthenticated={setJustAuthenticated} />
      )}
    </LoginLayout>
  );
}

function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <ClassroomAuthLayout
      heroTitle={
        <>
          讓每一次練習，
          <br />
          都有跡可循。
        </>
      }
      heroDescription="用個人帳號整理學習進度，隨時回看你的模擬操作。練習不只看結果，也看每一步如何決定。"
      features={FEATURES}
      footer={
        <Link to="/" className="academy-nav-link inline-flex min-h-12 items-center gap-2">
          <ArrowLeft aria-hidden="true" />
          回教室大廳
        </Link>
      }
    >
      {children}
      <p className="mt-5 text-sm leading-7 text-muted">
        帳號註冊不代表完成繳費或取得課程資格，請依講師的入班安排使用。
      </p>
    </ClassroomAuthLayout>
  );
}

function AccountCredentials({
  initialMode,
  onAuthenticated,
}: {
  initialMode: "in" | "up";
  onAuthenticated: (account: VerifiedAccount) => void;
}) {
  const [mode, setMode] = useState<"in" | "up">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !authEnabled) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const credentials = { email: email.trim(), password };
      const result =
        mode === "up"
          ? await authClient.signUp.email({ ...credentials, name: name.trim() })
          : await authClient.signIn.email(credentials);
      if (result.error) throw new Error(result.error.message || "登入失敗");
      const verified = result.data?.user;
      if (!verified?.id) throw new Error("尚未確認登入成功，請稍後重試。");
      setPassword("");
      onAuthenticated({ id: verified.id, name: verified.name ?? "", email: verified.email });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "登入失敗，請稍後重試");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <p className="academy-eyebrow flex items-center gap-2">
        <UserRound aria-hidden="true" />1 / 2 · 個人學習帳號
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">
        {mode === "up" ? "建立學員帳號" : "歡迎回到教室"}
      </h1>
      <p className="mt-2 text-base leading-7 text-muted">
        先確認帳號，下一步填寫班級資料與教學聲明。
      </p>
      <div
        className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-bg p-1"
        role="group"
        aria-label="帳號操作"
      >
        {(["in", "up"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            disabled={busy}
            onClick={() => {
              setMode(option);
              setError("");
            }}
            className={`min-h-12 rounded-lg px-3 py-3 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50 ${mode === option ? "bg-surface text-[var(--color-brand)] shadow-sm" : "text-muted hover:text-fg"}`}
          >
            {option === "in" ? "登入帳號" : "首次註冊"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-6 space-y-5" aria-busy={busy}>
        {mode === "up" && (
          <div>
            <label htmlFor="learner-name" className="block text-base font-medium text-fg">
              學員名稱
            </label>
            <input
              id="learner-name"
              name="name"
              required
              maxLength={40}
              autoComplete="name"
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="講師與同學看見的名稱"
              className="academy-input mt-2 w-full"
            />
          </div>
        )}
        <div>
          <label htmlFor="learner-email" className="block text-base font-medium text-fg">
            電子信箱
          </label>
          <input
            id="learner-email"
            name="email"
            required
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="academy-input mt-2 w-full"
          />
        </div>
        <AuthPasswordInput
          id="learner-password"
          label="帳號密碼"
          name="password"
          required
          minLength={10}
          maxLength={128}
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          disabled={busy}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={
            mode === "up"
              ? "請設定至少 10 個字元的密碼。"
              : "請輸入你的個人密碼，與教室入場碼不同。"
          }
        />
        {error && (
          <p role="alert" className="rounded-lg bg-up/5 px-3 py-3 text-base leading-7 text-up">
            {error}
          </p>
        )}
        {!authEnabled && (
          <p role="status" className="text-base leading-7 text-muted">
            此服務尚未啟用學員帳號，請聯絡講師。
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !authEnabled}
          className="academy-button-primary min-h-12 w-full whitespace-normal text-base"
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight aria-hidden="true" />
          )}
          {busy ? "確認帳號中…" : mode === "up" ? "建立帳號，繼續下一步" : "登入，繼續下一步"}
        </button>
      </form>
    </>
  );
}

function ProfileCompletion({ account, next }: { account: VerifiedAccount; next: string }) {
  const navigate = useNavigate();
  const [profileReady, setProfileReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [name, setName] = useState(account.name || account.email.split("@")[0]);
  const [classCode, setClassCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setCheckError("");
    void loadMyProfile()
      .then(async (profile) => {
        if (cancelled) return;
        if (profile && profile.user_id !== account.id)
          throw new Error("登入帳號已變更，請重新確認。");
        if (profile?.tos_accepted_at) {
          await navigate({ href: next });
          return;
        }
        if (profile?.display_name) setName(profile.display_name);
        setProfileReady(true);
      })
      .catch(() => {
        if (!cancelled) setCheckError("暫時無法確認班級資料。帳號已登入，請重試讀取。");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account.id, checkAttempt, navigate, next]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profileReady || !accepted || inFlight.current || !authEnabled) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await upsertMyProfile({
        data: {
          displayName: name.trim(),
          classCode: classCode.trim() || undefined,
          acceptTos: true,
        },
      });
      if (mounted.current) await navigate({ href: next });
    } catch (problem) {
      if (mounted.current)
        setError(problem instanceof Error ? problem.message : "班級資料尚未儲存，請重試。");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function switchAccount() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSwitching(true);
    setError("");
    try {
      await signOut("/login");
    } catch (problem) {
      inFlight.current = false;
      if (mounted.current) {
        setSwitching(false);
        setError(problem instanceof Error ? problem.message : "登出失敗，請再試一次。");
      }
    }
  }
  if (!profileReady)
    return (
      <section aria-label="確認班級資料">
        <h1 className="text-2xl font-semibold">帳號已登入</h1>
        <p className="mt-3 break-all text-base leading-7">{account.email || account.name}</p>
        <p role="status" className="mt-4 text-base leading-7 text-muted">
          {checking ? "正在確認班級資料…" : checkError || "資料已確認，正在進入教室…"}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-base leading-7 text-up">
            {error}
          </p>
        )}
        {checkError && (
          <button
            type="button"
            className="academy-button-primary mt-4 min-h-12 w-full text-base"
            disabled={checking || switching}
            onClick={() => setCheckAttempt((attempt) => attempt + 1)}
          >
            重試讀取班級資料
          </button>
        )}
        <button
          type="button"
          className="academy-nav-link mt-3 min-h-12 text-base"
          disabled={switching}
          onClick={() => void switchAccount()}
        >
          {switching ? "登出中…" : "使用另一個帳號"}
        </button>
      </section>
    );
  return (
    <>
      <p className="academy-eyebrow flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" />2 / 2 · 完成班級資料
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">
        帳號已登入，再完成這一步
      </h1>
      <p className="mt-2 text-base leading-7 text-muted">
        確認學員名稱、班級與教學聲明後，就能將練習儲存到教室主機。
      </p>
      <div className="mt-5 rounded-xl border border-border bg-bg/50 p-4">
        <p className="text-sm text-muted">目前使用的帳號</p>
        <p className="mt-1 break-all text-base font-medium">{account.email || account.name}</p>
        <button
          type="button"
          disabled={busy || switching}
          className="academy-nav-link mt-2 min-h-12 whitespace-normal text-base"
          onClick={() => void switchAccount()}
        >
          {switching ? "登出中…" : "使用另一個帳號"}
        </button>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-5" aria-busy={busy || switching}>
        <div>
          <label htmlFor="profile-name" className="block text-base font-medium text-fg">
            學員名稱
          </label>
          <input
            id="profile-name"
            name="name"
            required
            maxLength={40}
            autoComplete="name"
            disabled={busy || switching}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="講師與同學看見的名稱"
            className="academy-input mt-2 w-full"
          />
        </div>
        <div>
          <label htmlFor="learner-class" className="block text-base font-medium text-fg">
            班級代碼 <span className="ml-1 text-sm font-normal text-muted">選填</span>
          </label>
          <input
            id="learner-class"
            name="classCode"
            maxLength={24}
            disabled={busy || switching}
            value={classCode}
            onChange={(event) => setClassCode(event.target.value)}
            aria-describedby="learner-class-hint"
            placeholder="講師提供的班級代碼"
            className="academy-input mt-2 w-full"
          />
          <p id="learner-class-hint" className="mt-2 text-sm leading-7 text-muted">
            講師未指定時，留空即可。
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg/50 p-4 text-base leading-7 text-muted">
          <input
            required
            type="checkbox"
            checked={accepted}
            disabled={busy || switching}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"
          />
          <span>
            我了解真實早盤使用歷史 K 線，委託與成交仍為紙上模擬，結果不代表實際獲利。舊版合成行情紀錄僅供歷史復盤；舊課程提交的紀錄可供本班講師查看，顯示名稱與成績可出現在本班排行。真實早盤的進度與復盤目前在該練習頁查看。
          </span>
        </label>
        {error && (
          <div role="alert" className="rounded-lg bg-up/5 px-4 py-3 text-base leading-7 text-up">
            <p>{error}</p>
            <p className="mt-2">帳號已登入，請確認資料後重試，不需要重新註冊或輸入密碼。</p>
          </div>
        )}
        <button
          type="submit"
          disabled={busy || switching || !accepted || !authEnabled}
          className="academy-button-primary min-h-12 w-full whitespace-normal text-base"
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight aria-hidden="true" />
          )}
          {busy ? "儲存班級資料中…" : "儲存資料，進入教室"}
        </button>
      </form>
    </>
  );
}
