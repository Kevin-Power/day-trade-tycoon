/** Where to go after sign-in: only paths inside this site, never back to /login itself. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) return "/";
  const path = value.split(/[?#]/, 1)[0];
  if (path === "/login" || path.startsWith("/login/")) return "/";
  return value;
}

export function loginHref({ next, mode }: { next: string; mode?: "up" }): string {
  const search = new URLSearchParams();
  if (mode) search.set("mode", mode);
  search.set("next", safeNextPath(next));
  return `/login?${search.toString()}`;
}
