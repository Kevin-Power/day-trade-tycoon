import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { upsertMyProfile } from "@/lib/classroom-db";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

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

  async function submit(event: React.FormEvent) {
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
    <main className="grid min-h-dvh place-items-center bg-bg p-5 text-fg">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
        <p className="text-xs tracking-[0.2em] text-muted">DAY TRADE TYCOON</p>
        <h1 className="mt-2 text-2xl">{mode === "up" ? "建立學員帳號" : "登入學員帳號"}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          登入後，已成功儲存的練習紀錄可跨裝置查看。帳號註冊不代表完成繳費或取得課程資格，請依講師的入班安排使用。
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "up" && (
            <label className="block text-sm">
              學員名稱
              <input
                required
                maxLength={40}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-10 w-full rounded border border-border-strong bg-bg px-3"
              />
            </label>
          )}
          <label className="block text-sm">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-10 w-full rounded border border-border-strong bg-bg px-3"
            />
          </label>
          <label className="block text-sm">
            密碼
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-10 w-full rounded border border-border-strong bg-bg px-3"
            />
          </label>
          <label className="block text-sm">
            班級代碼（講師未指定時可留空）
            <input
              maxLength={24}
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
              className="mt-1 h-10 w-full rounded border border-border-strong bg-bg px-3"
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <input
              required
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1"
            />
            <span>
              我了解此為模擬教學，行情包含歷史及教室生成資料，模擬結果不代表實際獲利。我的學習紀錄供本班講師查看，顯示名稱與練習成績可出現在本班排行。
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-up">
              {error}
            </p>
          )}
          {!authEnabled && (
            <p role="status" className="text-sm text-muted">
              此服務尚未啟用學員帳號，請聯絡講師。
            </p>
          )}
          <Button disabled={busy || !accepted || !authEnabled} className="w-full">
            {busy ? "處理中…" : mode === "up" ? "註冊並進入教室" : "登入教室"}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "up" ? "in" : "up");
            setError("");
          }}
          className="mt-4 text-sm text-tape"
        >
          {mode === "up" ? "已有帳號？登入" : "第一次使用？建立帳號"}
        </button>
        <Link to="/" className="mt-4 block text-sm text-muted">
          回教室大廳
        </Link>
      </div>
    </main>
  );
}
