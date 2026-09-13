import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { upsertMyProfile } from "@/lib/classroom-db";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [classCode, setClassCode] = useState("");
  const [tos, setTos] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function afterAuth() {
    await upsertMyProfile({
      data: {
        displayName: name.trim() || email.split("@")[0] || "學員",
        classCode: classCode.trim() || "GWVGZ",
        acceptTos: tos,
      },
    });
    nav({ to: "/" });
  }

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!tos) {
      setErr("請先勾選同意模擬教學免責。");
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await authClient.signUp.email({ email, password, name: name || email });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) throw new Error(error.message);
      }
      await afterAuth();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "登入失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-5">
        <p className="text-micro tracking-[0.22em] text-muted">DAY TRADE TYCOON</p>
        <h1 className="text-xl font-medium">登入教室</h1>
        <p className="text-sm text-muted">戰績寫在伺服器。換裝置、清快取都還在。老師用班級代碼看進度。</p>

        <form className="space-y-3" onSubmit={onEmail}>
          {mode === "up" && (
            <label className="block text-xs">
              顯示名稱
              <input
                className="mt-1 h-10 w-full rounded-sm border border-border-strong bg-bg px-3 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="block text-xs">
            Email
            <input
              type="email"
              required
              className="mt-1 h-10 w-full rounded-sm border border-border-strong bg-bg px-3 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            密碼
            <input
              type="password"
              required
              minLength={8}
              className="mt-1 h-10 w-full rounded-sm border border-border-strong bg-bg px-3 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            班級代碼（老師請填 TEACHER）
            <input
              className="mt-1 h-10 w-full rounded-sm border border-border-strong bg-bg px-3 font-mono text-sm"
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
              placeholder="GWVGZ"
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} className="mt-0.5" />
            我了解本站為模擬教學環境，行情為歷史或延遲資料，不構成投資建議；模擬績效不代表實盤結果。
          </label>
          {err && <p className="text-xs text-up">{err}</p>}
          <Button className="w-full" disabled={busy || !authEnabled}>
            {mode === "up" ? "註冊並進入" : "登入"}
          </Button>
        </form>

        <button type="button" className="text-xs text-tape" onClick={() => setMode(mode === "up" ? "in" : "up")}>
          {mode === "up" ? "已有帳號？改登入" : "沒有帳號？註冊"}
        </button>

        {authEnabled ? (
          <div className="space-y-2 border-t border-border pt-3">
            {GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                onClick={() => void signIn(p.providerId, { callbackURL: "/" })}
                className="w-full rounded-sm border border-border-strong bg-elevated px-4 py-2 text-sm hover:bg-header-2"
              >
                使用 {p.label} 繼續
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">登入未開啟。</p>
        )}

        <Link to="/" className="block text-center text-xs text-muted hover:text-fg">
          先逛大廳
        </Link>
      </div>
    </main>
  );
}
