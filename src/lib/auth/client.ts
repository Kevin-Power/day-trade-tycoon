import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";
import { GROK_PROVIDERS } from "./providers";

export const authClient = createAuthClient({ plugins: [anonymousClient()] });
/** Offline simulation has no identity service. Online identity is always verified. */
export const authEnabled = import.meta.env.BASE_URL !== "./";
export { GROK_PROVIDERS };
export function getBearerToken(): null { return null; }
export async function signIn(_providerId?: string, _options?: { callbackURL?: string; errorCallbackURL?: string }): Promise<void> {
  window.location.assign("/login");
}
export async function signOut(redirectTo = "/"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "登出失敗，請再試一次");
  window.location.assign(redirectTo);
}
