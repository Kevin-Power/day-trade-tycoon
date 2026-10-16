import { useCallback, useSyncExternalStore } from "react";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { speak, speechSupported } from "@/lib/speech";

function synth(): SpeechSynthesis | undefined {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : undefined;
}
function subscribe(changed: () => void): () => void {
  const target = synth();
  // Chrome loads voices after the page; re-check when the list arrives.
  target?.addEventListener?.("voiceschanged", changed);
  return () => target?.removeEventListener?.("voiceschanged", changed);
}

export function useSpeechSupport(): boolean {
  return useSyncExternalStore(subscribe, () => speechSupported(synth()), () => false);
}

/** Speaks right away. Call it inside a tap at least once: iPhone stays silent until then. */
export function speakNow(text: string, interrupt = true): void {
  speak(text, synth(), (value) => new SpeechSynthesisUtterance(value), interrupt);
}

/** Reads text aloud only when the learner turned read-aloud on and a Chinese voice exists. */
export function useSay(): (text: string, interrupt?: boolean) => void {
  const on = useDisplayPreferences((state) => state.speech);
  const supported = useSpeechSupport();
  return useCallback(
    (text: string, interrupt = true) => {
      if (on && supported) speakNow(text, interrupt);
    },
    [on, supported],
  );
}
