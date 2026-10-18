/** Distributed static lessons have no remote identity or remote storage. */
export function useCurrentUserState() { return { user: null, guest: null, isPending: false, refetch: () => {} }; }
export function useCurrentUser() { return null; }
