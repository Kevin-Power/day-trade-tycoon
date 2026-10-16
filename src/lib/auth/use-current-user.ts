import { authClient, authEnabled } from "./client";
export type AppUser = {
  id: string; displayName: string | null; primaryEmail: string | null;
  profileImageUrl: string | null; isDevFallback: boolean;
};
/** Guests (anonymous accounts) count as signed out everywhere except where `guest` is read. */
export type CurrentUserState = { user: AppUser | null; guest: { id: string } | null; isPending: boolean };
export function useCurrentUserState(): CurrentUserState {
  if (!authEnabled) return { user: null, guest: null, isPending: false };
  const { data, isPending } = authClient.useSession();
  const user = data?.user;
  if (user?.isAnonymous) return { user: null, guest: { id: user.id }, isPending };
  return {
    guest: null,
    user: user ? { id: user.id, displayName: user.name ?? null, primaryEmail: user.email ?? null,
      profileImageUrl: user.image ?? null, isDevFallback: false } : null,
    isPending,
  };
}
export function useCurrentUser(): AppUser | null { return useCurrentUserState().user; }
