import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { GateScreen } from "@/components/gate-screen";
import { submitPassword } from "@/lib/gate/client";
import { isGatePublicPath } from "@/lib/gate/public-path";

type GateCtx = { lock: () => void; unlocked: boolean };
const GateContext = createContext<GateCtx | null>(null);
export function useGate(): GateCtx {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error("useGate");
  return ctx;
}
export function GateProvider({ children }: { children: ReactNode }) {
  // A distributed offline simulation has no protected remote data or credentials.
  if (import.meta.env.BASE_URL === "./")
    return <GateContext.Provider value={{ lock: () => undefined, unlocked: true }}>{children}</GateContext.Provider>;
  return <OnlineGate>{children}</OnlineGate>;
}
function OnlineGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"checking" | "locked" | "open">("checking");
  const pathname = useRouterState({ select: s => s.location.pathname });
  useEffect(() => {
    let active = true;
    void fetch("/api/gate", { cache: "no-store" }).then(r => r.json())
      .then(data => { if (active) setPhase(data.ok ? "open" : "locked"); })
      .catch(() => { if (active) setPhase("locked"); });
    return () => { active = false; };
  }, []);
  const lock = useCallback(() => {
    void fetch("/api/gate", { method: "DELETE" }).then(response => {
      if (!response.ok) throw new Error("登出教室失敗");
      setPhase("locked");
    }).catch(() => window.alert("教室入口暫時連不上，尚未登出。請再試一次。"));
  }, []);
  const open = useCallback(() => setPhase("open"), []);
  if (!isGatePublicPath(pathname)) {
    if (phase === "checking") return <div className="min-h-dvh bg-bg p-8 text-muted">確認教室入場狀態…</div>;
    if (phase !== "open") return <GateScreen onOpen={open} submit={submitPassword} />;
  }
  return <GateContext.Provider value={{ lock, unlocked: phase === "open" }}>{children}</GateContext.Provider>;
}
