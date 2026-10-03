import { useEffect } from "react";
import { Toaster } from "sonner";
import { Lobby } from "@/components/lobby";
import { Terminal } from "@/components/terminal";
import { persistOnHide, useGame } from "@/lib/game/store";
import { setProfileIdentity } from "@/lib/game/persist";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function AppShell() {
  const phase = useGame((s) => s.phase);
  const hydrate = useGame((s) => s.hydrate);
  const profileIdentity = useGame((s) => s.profileIdentity);
  const { user, isPending } = useCurrentUserState();
  const userId = user && !user.isDevFallback ? user.id : null;

  useEffect(() => {
    if (isPending) return;
    setProfileIdentity(userId);
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
  }, [hydrate, userId, isPending]);

  return (
    <>
      {isPending || profileIdentity !== userId ? (
        <main className="min-h-dvh bg-bg p-8 text-fg" role="status">
          正在確認帳號與學習紀錄…
        </main>
      ) : phase === "lobby" ? (
        <Lobby />
      ) : (
        <Terminal />
      )}
      <Toaster
        theme="light"
        position="top-right"
        toastOptions={{
          className: "font-sans text-sm",
          style: {
            background: "var(--color-surface)",
            border: "1px solid var(--color-border-strong)",
            color: "var(--color-fg)",
          },
        }}
      />
    </>
  );
}
