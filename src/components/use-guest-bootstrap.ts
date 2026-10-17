import { useEffect, useRef, useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";

/**
 * Practice first, account later: on pages that need an identity, a guest account is created right
 * after classroom entry. "pending" while checking or creating, "failed" when creation failed.
 */
export function useGuestBootstrap(): {
  user: AppUser | null;
  guest: { id: string } | null;
  isPending: boolean;
  status: "ready" | "pending" | "failed";
  retry: () => void;
} {
  const { user, guest, isPending } = useCurrentUserState();
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const attempted = useRef(false);
  const needsGuest = authEnabled && !isPending && !user && !guest;
  useEffect(() => {
    if (!needsGuest || attempted.current) return;
    attempted.current = true;
    setState("pending");
    void authClient.signIn
      .anonymous()
      .then(async ({ error }) => {
        if (!error) return setState("idle");
        // 400: this browser already holds a guest session; refresh it instead of failing.
        if (error.status === 400) {
          await authClient.getSession();
          return setState("idle");
        }
        setState("failed");
      })
      .catch(() => setState("failed"));
  }, [needsGuest, state]);
  const status = isPending || (needsGuest && state !== "failed") ? "pending" : needsGuest ? "failed" : "ready";
  return {
    user,
    guest,
    isPending,
    status,
    retry: () => {
      attempted.current = false;
      setState("idle");
    },
  };
}
