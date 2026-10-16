import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDisplayPreferences, type ReadingMode } from "@/lib/display-preferences";
import { speakNow, useSpeechSupport } from "@/components/use-speech";
import { SPEECH_TEXT } from "@/lib/speech";
import { cn } from "@/lib/utils";

/** Mounted once outside admission/auth so the saved reading preference applies everywhere. */
export function DisplayPreferencesEffect() {
  const mode = useDisplayPreferences((state) => state.mode);
  const hydrate = useDisplayPreferences((state) => state.hydrate);
  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    document.documentElement.dataset.readingMode = mode;
  }, [mode]);
  return null;
}

const SIZES: readonly { mode: ReadingMode; label: string }[] = [
  { mode: "standard", label: "標準" },
  { mode: "senior", label: "大字" },
];

/**
 * Text size: standard or large ("大字", the former senior mode: larger type and controls, one pane).
 * The full version also carries the read-aloud switch; switching to large text asks about it once.
 */
export function DisplayControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const mode = useDisplayPreferences((state) => state.mode);
  const setMode = useDisplayPreferences((state) => state.setMode);
  const speech = useDisplayPreferences((state) => state.speech);
  const speechAsked = useDisplayPreferences((state) => state.speechAsked);
  const setSpeech = useDisplayPreferences((state) => state.setSpeech);
  const supported = useSpeechSupport();
  const [offer, setOffer] = useState(false);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  function choose(next: ReadingMode) {
    if (next === "senior" && mode !== "senior" && !speechAsked && supported) setOffer(true);
    setMode(next);
  }
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = (index + 1) % SIZES.length;
    choose(SIZES[next].mode);
    options.current[next]?.focus();
  }
  return (
    <div className={cn("display-controls inline-flex min-w-0 flex-wrap items-center gap-2", className)}>
      <div
        role="radiogroup"
        aria-label="文字大小"
        title="大字：放大文字與操作按鈕，交易畫面改成單區操作"
        className="display-size-control inline-flex min-w-0 items-center gap-2"
      >
        {!compact && (
          <span aria-hidden="true" className="text-sm font-semibold">
            文字大小
          </span>
        )}
        <span className="inline-flex overflow-hidden rounded-lg border border-border-strong">
          {SIZES.map((size, index) => {
            const checked = mode === size.mode;
            return (
              <button
                key={size.mode}
                ref={(element) => {
                  options.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => choose(size.mode)}
                onKeyDown={(event) => move(event, index)}
                className={cn(
                  "display-size-option min-h-11 min-w-11 px-2.5 text-sm font-semibold leading-snug",
                  checked ? "bg-brand text-brand-fg" : "bg-surface text-fg",
                )}
              >
                {size.label}
              </button>
            );
          })}
        </span>
      </div>
      {!compact && (
        <span className="inline-flex min-w-0 flex-col items-start">
          <button
            type="button"
            role="switch"
            aria-checked={speech && supported}
            disabled={!supported}
            onClick={() => {
              // Speaking inside the tap also unlocks speech on iPhone for later hints.
              if (!speech) speakNow(SPEECH_TEXT.enabled);
              setSpeech(!speech);
            }}
            className={cn(
              "display-speech-switch inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-55",
              speech && supported ? "border-brand bg-brand text-brand-fg" : "border-border-strong bg-surface text-fg",
            )}
          >
            朗讀提示
            <span className="rounded border border-current/30 px-1.5 text-xs">{speech && supported ? "開" : "關"}</span>
          </button>
          {!supported && <small className="text-xs text-muted">這台設備沒有中文語音</small>}
        </span>
      )}
      {offer && (
        <SpeechOffer
          onAnswer={(on) => {
            if (on) speakNow(SPEECH_TEXT.enabled);
            setSpeech(on);
            setOffer(false);
          }}
        />
      )}
    </div>
  );
}

function SpeechOffer({ onAnswer }: { onAnswer: (on: boolean) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div
      role="dialog"
      aria-labelledby="speech-offer-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onAnswer(false);
      }}
      className="speech-offer fixed inset-x-4 bottom-4 z-[70] mx-auto grid max-w-sm gap-3 rounded-xl border border-border-strong bg-surface p-4 text-fg shadow-[var(--shadow-panel)]"
    >
      <h2 id="speech-offer-title" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
        要開啟朗讀提示嗎？
      </h2>
      <p className="text-base leading-relaxed">成交與教學提示會唸出來。</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="min-h-11 flex-1 rounded-lg bg-brand px-4 text-base font-semibold text-brand-fg"
        >
          開啟朗讀
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="min-h-11 flex-1 rounded-lg border border-border-strong bg-surface px-4 text-base font-semibold"
        >
          不用
        </button>
      </div>
    </div>
  );
}
