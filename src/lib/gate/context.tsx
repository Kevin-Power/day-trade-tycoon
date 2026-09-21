import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { GateScreen } from "@/components/gate-screen";
import { submitPassword } from "@/lib/gate/client";
import { isGatePublicPath } from "@/lib/gate/public-path";
import { clearUnlocked, readUnlocked, writeUnlocked } from "@/lib/gate/storage";

type GateCtx = {
  lock: () => void;
  unlocked: boolean;
};

const GateContext = createContext<GateCtx | null>(null);

export function useGate(): GateCtx {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error("useGate");
  return ctx;
}

export function GateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"locked" | "open">("locked");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (readUnlocked()) setPhase("open");
  }, []);

  const lock = useCallback(() => {
    clearUnlocked();
    setPhase("locked");
  }, []);

  const open = useCallback(() => {
    writeUnlocked();
    setPhase("open");
  }, []);

  const unlocked = phase === "open";
  if (!unlocked && !isGatePublicPath(pathname)) {
    return <GateScreen onOpen={open} submit={submitPassword} />;
  }
  return <GateContext.Provider value={{ lock, unlocked }}>{children}</GateContext.Provider>;
}
