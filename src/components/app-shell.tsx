import { useEffect } from "react";
import { Toaster } from "sonner";
import { Lobby } from "@/components/lobby";
import { Terminal } from "@/components/terminal";
import { persistOnHide, useGame } from "@/lib/game/store";

export function AppShell() {
  const phase = useGame((s) => s.phase);
  const hydrate = useGame((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    const onHide = () => {
      if (document.hidden) persistOnHide();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", persistOnHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", persistOnHide);
    };
  }, [hydrate]);

  return (
    <>
      {phase === "lobby" ? <Lobby /> : <Terminal />}
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          className: "font-sans text-sm",
          style: {
            background: "#161d27",
            border: "1px solid #33455c",
            color: "#e6edf5",
          },
        }}
      />
    </>
  );
}
