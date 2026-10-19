import { useState } from "react";

const STORAGE_KEY = "day-tycoon-replay-notice-v1";

function acknowledged(text: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === text;
  } catch {
    return false;
  }
}

/**
 * The lesson's approved notice about the simulated in-minute replay, shown on entering the desk until the
 * learner dismisses it: floating over the top of the chart on desktops and tablets (so the chart keeps its
 * height), at the top of the page on phones and in large text. Dismissal is remembered on this device for
 * this exact wording: if the notice is revised, it shows again. The text comes from the lesson data verbatim,
 * so nothing here needs its own approval.
 */
export function ReplayNotice({ text, floating = false }: { text: string; floating?: boolean }) {
  // The desk renders after its lesson data arrives in the browser, so storage can be read on first render.
  const [hidden, setHidden] = useState(() => acknowledged(text));
  if (hidden) return null;
  return (
    <aside className="td-notice" data-floating={floating} aria-label="教材說明：模擬逐筆">
      <span className="td-chip" data-kind="sim">
        模擬逐筆
      </span>
      <p>{text}</p>
      <button
        type="button"
        className="td-button"
        onClick={() => {
          try {
            window.localStorage.setItem(STORAGE_KEY, text);
          } catch {
            // Storage blocked: it hides for this visit only.
          }
          setHidden(true);
        }}
      >
        知道了
      </button>
    </aside>
  );
}
