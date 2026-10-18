import { useEffect, useRef, useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { guestBootstrapStatus, nextConfirmDelay, type GuestPhase } from "@/lib/guest-bootstrap";

/**
 * Practice first, account later: on pages that need an identity, a guest account is created right
 * after classroom entry. "pending" while checking or creating, "failed" when creation failed or the
 * session never showed the new guest (the page then offers 再試一次 instead of waiting forever).
 */
export function useGuestBootstrap(): {
  user: AppUser | null;
  guest: { id: string } | null;
  isPending: boolean;
  status: "ready" | "pending" | "failed";
  retry: () => void;
} {
  const { user, guest, isPending, refetch } = useCurrentUserState();
  const [phase, setPhase] = useState<GuestPhase>("idle");
  const [attempt, setAttempt] = useState(0);
  const attempted = useRef(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const needsGuest = authEnabled && !isPending && !user && !guest;

  useEffect(() => {
    if (!needsGuest || attempted.current) return;
    attempted.current = true;
    setPhase("signing-in");
    void authClient.signIn
      .anonymous()
      .then(async ({ error }) => {
        // 400: this browser already holds a guest session; read it instead of failing.
        if (error && error.status !== 400) return setPhase("failed");
        if (error) await authClient.getSession();
        setAttempt(0);
        setPhase("confirming");
      })
      .catch(() => setPhase("failed"));
  }, [needsGuest, phase]);

  // Signed in, but the session has not shown the guest yet (its refresh can be refused on a busy
  // shared connection): read it again at 1, 2 and 4 seconds, then let the learner retry. A read in
  // flight reports isPending, which is not an answer yet, so only a shown identity ends the wait.
  const identified = Boolean(user || guest);
  useEffect(() => {
    if (phase !== "confirming") return;
    if (identified) return setPhase("idle");
    if (isPending) return;
    const delay = nextConfirmDelay(attempt);
    if (delay === null) return setPhase("failed");
    const timer = window.setTimeout(() => {
      refetchRef.current();
      setAttempt((value) => value + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [phase, identified, isPending, attempt]);

  return {
    user,
    guest,
    isPending,
    status: guestBootstrapStatus({ isPending, needsGuest, phase }),
    retry: () => {
      attempted.current = false;
      setAttempt(0);
      setPhase("idle");
    },
  };
}
