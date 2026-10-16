import { useEffect, useRef, type KeyboardEvent } from "react";
import { useDisplayPreferences, type ReadingMode } from "@/lib/display-preferences";
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

/** Text size: standard or large ("大字", the former senior mode: larger type and controls, one pane). */
export function DisplayControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const mode = useDisplayPreferences((state) => state.mode);
  const setMode = useDisplayPreferences((state) => state.setMode);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = (index + 1) % SIZES.length;
    setMode(SIZES[next].mode);
    options.current[next]?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label="文字大小"
      title="大字：放大文字與操作按鈕，交易畫面改成單區操作"
      className={cn("display-size-control inline-flex min-w-0 items-center gap-2", className)}
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
              onClick={() => setMode(size.mode)}
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
  );
}
