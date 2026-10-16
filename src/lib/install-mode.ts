/** Which "add to home screen" help a phone gets; desktops and installed apps get none. */
export type InstallMode = "android-prompt" | "ios-guide" | "ios-open-safari" | "none";
export const INSTALL_DISMISSED_KEY = "day-tycoon-install-v1";

export function installMode(input: { userAgent: string; hasPrompt: boolean; standalone: boolean }): InstallMode {
  if (input.standalone) return "none";
  // LINE, Facebook and Instagram open links in their own browser, which cannot add to the home screen.
  if (/iPhone|iPad|iPod/.test(input.userAgent))
    return /\bLine\/|FBAN|FBAV|Instagram/.test(input.userAgent) ? "ios-open-safari" : "ios-guide";
  if (/Android/.test(input.userAgent) && input.hasPrompt) return "android-prompt";
  return "none";
}

/** Only the hosted HTTPS site registers the (non-caching) worker; offline copies never do. */
export function shouldRegisterServiceWorker(input: { protocol: string; baseUrl: string }): boolean {
  return input.protocol === "https:" && input.baseUrl === "/";
}
