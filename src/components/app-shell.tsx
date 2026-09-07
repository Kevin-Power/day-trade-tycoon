import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { HandbookPage } from "@/components/handbook-page";
import { Lobby } from "@/components/lobby";
import { ManualPage } from "@/components/manual-page";
import { Terminal } from "@/components/terminal";
import { persistOnHide, useGame } from "@/lib/game/store";

/**
 * Document pages are shown as views, not routes, so the offline classroom pack
 * (which mounts this shell with no RouterProvider) can reach them too. The
 * online build still has `/manual` and `/handbook` routes for direct links.
 */
type Doc = "manual" | "handbook";

export function AppShell() {
  const phase = useGame((s) => s.phase);
  const hydrate = useGame((s) => s.hydrate);
  const [doc, setDoc] = useState<Doc | null>(null);

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

  const back = () => setDoc(null);

  return (
    <>
      {doc === "manual" ? (
        <ManualPage onBack={back} />
      ) : doc === "handbook" ? (
        <HandbookPage onBack={back} />
      ) : phase === "lobby" ? (
        <Lobby onOpenManual={() => setDoc("manual")} onOpenHandbook={() => setDoc("handbook")} />
      ) : (
        <Terminal />
      )}
      <Toaster
        theme="dark"
        position="top-center"
        offset="76px"
        duration={2600}
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
