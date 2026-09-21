import type { ReactNode } from "react";
import {
  AUX_CLASSROOM_SIM,
  BADGE_CLASSROOM,
  BADGE_OFFICIAL,
  COACH_CORNER,
  SIM_CHIP_NOTE,
  type ProvenanceKind,
} from "@/lib/provenance";
import { cn } from "@/lib/utils";

export function ProvenanceBadge({
  kind,
  className,
}: {
  kind: ProvenanceKind;
  className?: string;
}) {
  const official = kind === "official";
  return (
    <span
      className={cn(
        "shrink-0 rounded-xs px-1.5 py-0.5 text-2xs tracking-wide",
        official ? "bg-vwap/15 text-vwap" : "bg-warn/18 text-warn",
        className,
      )}
    >
      {official ? BADGE_OFFICIAL : BADGE_CLASSROOM}
    </span>
  );
}

export function AuxChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-xs border border-border-strong/70 px-1 py-0.5 text-2xs tracking-wide text-fg/75",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProvenanceMicro({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (!text) return null;
  return (
    <div
      className={cn(
        "border-b border-border bg-bg-1 px-2 py-0.5 font-mono text-2xs leading-relaxed text-muted",
        className,
      )}
    >
      {text}
    </div>
  );
}

export function SimChip({
  label = "模擬盤",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const note = label === "模擬盤" ? SIM_CHIP_NOTE : undefined;
  return (
    <span
      className={cn(
        "rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape",
        className,
      )}
      title={note}
    >
      {label}
    </span>
  );
}

export function CoachCorner() {
  return (
    <div
      role="note"
      className="pointer-events-none absolute bottom-20 left-2 z-30 max-w-[min(100%-1rem,26rem)] rounded-sm border border-border bg-surface/94 px-2 py-1 text-2xs leading-relaxed text-muted shadow-[var(--shadow-panel)] sm:bottom-8"
    >
      {COACH_CORNER}
    </div>
  );
}

export function ClassroomSimMark({ className }: { className?: string }) {
  return <AuxChip className={className}>{AUX_CLASSROOM_SIM}</AuxChip>;
}
