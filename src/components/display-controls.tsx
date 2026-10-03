import { useEffect } from "react";
import { Type } from "lucide-react";
import { useDisplayPreferences } from "@/lib/display-preferences";
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

export function DisplayControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const mode = useDisplayPreferences((state) => state.mode);
  const setMode = useDisplayPreferences((state) => state.setMode);
  const senior = mode === "senior";
  return (
    <button type="button" aria-pressed={senior} aria-label="長輩模式"
      title="大字、高對比、較大的操作按鈕與單區操作"
      onClick={() => setMode(senior ? "standard" : "senior")}
      className={cn("display-mode-control inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold leading-snug", senior ? "border-brand bg-brand text-brand-fg" : "border-border-strong bg-surface text-fg", className)}>
      <Type className="size-5 shrink-0" aria-hidden="true" />
      <span>{compact ? "長輩" : "長輩模式"}</span>
      <span className="rounded border border-current/30 px-1.5 py-0.5 text-xs">{senior ? "開" : "關"}</span>
    </button>
  );
}
