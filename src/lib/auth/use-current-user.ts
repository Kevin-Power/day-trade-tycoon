import { authClient, authEnabled } from "./client";
export type AppUser = {
  id: string; displayName: string | null; primaryEmail: string | null;
  profileImageUrl: string | null; isDevFallback: boolean;
};
export type CurrentUserState = { user: AppUser | null; isPending: boolean };
export function useCurrentUserState(): CurrentUserState {
  if (!authEnabled) return { user: null, isPending: false };
  const { data, isPending } = authClient.useSession();
  const user = data?.user;
  return {
    user: user ? { id: user.id, displayName: user.name ?? null, primaryEmail: user.email ?? null,
      profileImageUrl: user.image ?? null, isDevFallback: false } : null,
    isPending,
  };
}
export function useCurrentUser(): AppUser | null { return useCurrentUserState().user; }
