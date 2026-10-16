import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./server";
export { authConfigured } from "./server";

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super("Unauthorized"); this.name = "UnauthorizedError"; }
}
export type VerifiedUser = { id: string; email: string | null; emailVerified: boolean };
export async function getSessionUser(_bearerToken?: string): Promise<VerifiedUser | null> {
  const request = getRequest();
  if (!request) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  // Guests can only practice through /api/morning; every other server call treats them as signed out.
  if (!session?.user || session.user.isAnonymous) return null;
  return { id: session.user.id, email: session.user.email ?? null, emailVerified: session.user.emailVerified };
}
export async function requireAuthenticatedUser(): Promise<VerifiedUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
export async function requireUserId(_bearerToken?: string): Promise<string> {
  return (await requireAuthenticatedUser()).id;
}
