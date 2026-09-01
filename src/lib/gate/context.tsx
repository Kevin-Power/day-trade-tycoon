import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { GateScreen } from "@/components/gate-screen";
import { submitPassword } from "@/lib/gate/client";
import { clearUnlocked, readUnlocked, writeUnlocked } from "@/lib/gate/storage";

type GateCtx = {
  lock: () => void;
};

const GateContext = createContext<GateCtx | null>(null);

export function useGate(): GateCtx {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error("useGate");
  return ctx;
}

export function GateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"locked" | "open">("locked");

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

  if (phase === "locked") return <GateScreen onOpen={open} submit={submitPassword} />;
  return <GateContext.Provider value={{ lock }}>{children}</GateContext.Provider>;
}
