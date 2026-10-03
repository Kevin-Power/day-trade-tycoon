import { useSyncExternalStore } from "react";

export type TerminalLayout = "phone" | "tablet" | "desktop" | "senior";
type ViewportLayout = Exclude<TerminalLayout, "senior">;

const TABLET_QUERY = "(min-width: 768px)";
const DESKTOP_QUERY = "(min-width: 1200px)";

function subscribe(listener: () => void) {
  const queries = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)];
  for (const query of queries) query.addEventListener("change", listener);
  return () => {
    for (const query of queries) query.removeEventListener("change", listener);
  };
}

function getSnapshot(): ViewportLayout {
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  return window.matchMedia(TABLET_QUERY).matches ? "tablet" : "phone";
}

function getServerSnapshot(): ViewportLayout {
  return "phone";
}

/** Render one layout at a time; CSS-hidden trading panels must not stay active. */
export function useTerminalLayout(senior = false): TerminalLayout {
  const viewport = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return senior ? "senior" : viewport;
}
