export const authEnabled = false;
export const GROK_PROVIDERS: never[] = [];
export function getBearerToken() { return null; }
export async function signIn() { throw new Error("離線教室使用本機訪客練習，沒有線上登入。"); }
export async function signOut() { return; }
export const authClient = { useSession: () => ({ data: null, isPending: false }), signOut };
