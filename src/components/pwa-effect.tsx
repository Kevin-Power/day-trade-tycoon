import { useEffect } from "react";
import { create } from "zustand";
import { shouldRegisterServiceWorker } from "@/lib/install-mode";

/** Chrome's deferred install prompt (not in the DOM typings). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const useInstallPrompt = create<{
  prompt: BeforeInstallPromptEvent | null;
  set: (prompt: BeforeInstallPromptEvent | null) => void;
}>((set) => ({ prompt: null, set: (prompt) => set({ prompt }) }));

/** Mounted once in the root: registers the non-caching worker and keeps Android's install prompt. */
export function PwaEffect() {
  useEffect(() => {
    if (shouldRegisterServiceWorker({ protocol: location.protocol, baseUrl: import.meta.env.BASE_URL }))
      navigator.serviceWorker?.register("/sw.js").catch(() => {
        /* Installing is optional; the site works the same without it. */
      });
    const keep = (event: Event) => {
      event.preventDefault();
      useInstallPrompt.getState().set(event as BeforeInstallPromptEvent);
    };
    const installed = () => useInstallPrompt.getState().set(null);
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return null;
}
