import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, UserRound } from "lucide-react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { upsertMyProfile } from "@/lib/classroom-db";
import { AuthPasswordInput, ClassroomAuthLayout } from "@/components/classroom-auth-layout";

export const Route = createFileRoute("/login")({ component: Login });

const FEATURES = [
  { title: "找到自己的學習起點", description: "依照課程安排，從基礎觀察逐步練習到完整操作。" },
  { title: "保留每次練習的收穫", description: "登入帳號後，可跨裝置回看已儲存的練習紀錄。" },
  {
    title: "與講師一起檢視進度",
    description: "讓本班講師了解學習情況，協助你找到下一個練習重點。",
  },
] as const;

function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [classCode, setClassCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || busy) return;
    setBusy(true);
    setError("");
    try {
      const credentials = { email: email.trim(), password };
      const result =
        mode === "up"
          ? await authClient.signUp.email({
              ...credentials,
              name: name.trim() || email.split("@")[0],
            })
          : await authClient.signIn.email(credentials);
      if (result.error) throw new Error(result.error.message || "登入失敗");
      await upsertMyProfile({
        data: {
          displayName: name.trim() || result.data?.user.name || email.split("@")[0],
          classCode: classCode.trim() || undefined,
          acceptTos: true,
        },
      });
      await navigate({ to: "/" });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "登入失敗，請稍後重試");
    } finally {
      setBusy(false);
    }
  }

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
        <Link to="/" className="academy-nav-link inline-flex items-center gap-2">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          回教室大廳
        </Link>
      }
    >
      <p className="academy-eyebrow flex items-center gap-2">
        <UserRound className="size-3.5" aria-hidden="true" />
        02 / 個人學習帳號
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">
        {mode === "up" ? "建立學員帳號" : "歡迎回到教室"}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        {mode === "up" ? "填寫基本資料，讓練習紀錄跟著你。" : "登入你的帳號，接續今天的學習。"}
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
            className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50 ${mode === option ? "bg-surface text-[var(--color-brand)] shadow-sm" : "text-muted hover:text-fg"}`}
          >
            {option === "in" ? "登入帳號" : "首次註冊"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5" aria-busy={busy}>
        {mode === "up" ? (
          <div>
            <label htmlFor="learner-name" className="block text-sm font-medium text-fg">
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
        ) : null}
        <div>
          <label htmlFor="learner-email" className="block text-sm font-medium text-fg">
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
        <div>
          <label htmlFor="learner-class" className="block text-sm font-medium text-fg">
            班級代碼 <span className="ml-1 text-xs font-normal text-muted">選填</span>
          </label>
          <input
            id="learner-class"
            name="classCode"
            maxLength={24}
            disabled={busy}
            value={classCode}
            onChange={(event) => setClassCode(event.target.value)}
            aria-describedby="learner-class-hint"
            placeholder="講師提供的班級代碼"
            className="academy-input mt-2 w-full"
          />
          <p id="learner-class-hint" className="mt-2 text-xs leading-5 text-muted">
            講師未指定時，留空即可。
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg/50 p-4 text-xs leading-6 text-muted">
          <input
            required
            type="checkbox"
            checked={accepted}
            disabled={busy}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
          />
          <span>
            我了解此為模擬教學，行情包含歷史及教室生成資料，模擬結果不代表實際獲利。我的學習紀錄供本班講師查看，顯示名稱與練習成績可出現在本班排行。
          </span>
        </label>
        {error ? (
          <p role="alert" className="rounded-lg bg-up/5 px-3 py-2 text-sm leading-6 text-up">
            {error}
          </p>
        ) : null}
        {!authEnabled ? (
          <p role="status" className="text-sm text-muted">
            此服務尚未啟用學員帳號，請聯絡講師。
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !accepted || !authEnabled}
          className="academy-button-primary w-full"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "處理中…" : mode === "up" ? "註冊並進入教室" : "登入教室"}
          {!busy ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
        </button>
      </form>
      <p className="mt-4 text-xs leading-6 text-muted">
        帳號註冊不代表完成繳費或取得課程資格，請依講師的入班安排使用。
      </p>
    </ClassroomAuthLayout>
  );
}
