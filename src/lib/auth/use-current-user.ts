import { authClient, authEnabled } from "./client";
export type AppUser = {
  id: string; displayName: string | null; primaryEmail: string | null;
  profileImageUrl: string | null; isDevFallback: boolean;
};
/** Guests (anonymous accounts) count as signed out everywhere except where `guest` is read. */
export type CurrentUserState = {
  user: AppUser | null; guest: { id: string } | null; isPending: boolean;
  /** Reads the session again (after a guest sign-in whose refresh was refused). */
  refetch: () => void;
};
const noRefetch = () => {};
export function useCurrentUserState(): CurrentUserState {
  if (!authEnabled) return { user: null, guest: null, isPending: false, refetch: noRefetch };
  const { data, isPending, refetch: refetchSession } = authClient.useSession();
  const refetch = () => void refetchSession();
  const user = data?.user;
  if (user?.isAnonymous) return { user: null, guest: { id: user.id }, isPending, refetch };
  return {
    refetch,
    guest: null,
    user: user ? { id: user.id, displayName: user.name ?? null, primaryEmail: user.email ?? null,
      profileImageUrl: user.image ?? null, isDevFallback: false } : null,
    isPending,
  };
}
export function useCurrentUser(): AppUser | null { return useCurrentUserState().user; }
