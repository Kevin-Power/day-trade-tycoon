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

/** Reads text aloud only when the learner turned read-aloud on and a Chinese voice exists. */
export function useSay(): (text: string) => void {
  const on = useDisplayPreferences((state) => state.speech);
  const supported = useSpeechSupport();
  return useCallback(
    (text: string) => {
      if (on && supported) speak(text, synth(), (value) => new SpeechSynthesisUtterance(value));
    },
    [on, supported],
  );
}
