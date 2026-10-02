import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/setup")({ component: AdminSetup });
type SetupStatus = { configured: boolean; available: boolean; email?: string };
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
    if (incoming) { setToken(incoming); setFromLink(true); }
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    void fetch("/api/admin/setup", { cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error("初始化入口暫時無法讀取");
      setStatus(await r.json());
    }).catch(() => setError("初始化入口暫時無法讀取，請重新整理"));
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) { setError("兩次密碼不一致"); return; }
    setBusy(true);
    try {
      const result = await fetch("/api/admin/setup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: status?.email, name, password, token, acceptTos: tos }),
      });
      const payload = await result.json();
      if (!result.ok || !payload.ok) throw new Error(payload.message || "初始化失敗");
      setToken(""); setPassword(""); setConfirmation(""); setDone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "初始化失敗"); }
    finally { setBusy(false); }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-medium">建立講師帳號</h1>
        {done ? <><p>講師帳號已建立，請使用你剛設定的密碼登入。</p><Link to="/login" className="text-tape">前往登入</Link></> :
          status && !status.available ? <p className="text-sm text-muted">初始化入口已關閉或尚未設定。既有講師請直接登入。</p> :
          <form className="space-y-3" onSubmit={submit}>
            <p className="text-sm text-muted">此入口僅建立本教室的第一個講師帳號。</p>
            <p className="break-all text-sm">{status?.email || "讀取帳號設定…"}</p>
            <label className="block text-xs">顯示名稱<input required maxLength={40} value={name} onChange={e => setName(e.target.value)} className="mt-1 h-10 w-full rounded border border-border bg-bg px-3" /></label>
            <label className="block text-xs">設定密碼（至少 10 個字元）<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 h-10 w-full rounded border border-border bg-bg px-3" /></label>
            <label className="block text-xs">再次輸入密碼<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 h-10 w-full rounded border border-border bg-bg px-3" /></label>
            {!fromLink && <label className="block text-xs">一次性初始化憑證<input required type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="mt-1 h-10 w-full rounded border border-border bg-bg px-3" /></label>}
            <label className="flex items-start gap-2 text-xs leading-relaxed text-muted"><input type="checkbox" checked={tos} onChange={e => setTos(e.target.checked)} />我了解教室僅供模擬練習；模擬結果不代表實盤績效。</label>
            <Button className="w-full" disabled={busy || !tos || !status?.available}>{busy ? "建立中…" : "建立講師帳號"}</Button>
          </form>}
        {error && <p role="alert" className="text-sm text-up">{error}</p>}
        {!done && <Link to="/login" className="block text-sm text-muted">回到登入</Link>}
      </div>
    </main>
  );
}
