/** One-time notice set when guest practice could not be fully moved into the new account. */
export const LINK_NOTICE_COOKIE = "day-tycoon-link-notice";
export type LinkNotice = "skipped" | "failed";

export function readLinkNotice(cookieHeader: string): LinkNotice | null {
  for (const part of cookieHeader.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === LINK_NOTICE_COOKIE && (value === "skipped" || value === "failed")) return value;
  }
  return null;
}

export function clearLinkNoticeCookie(): string {
  return `${LINK_NOTICE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
