import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Blue brokerage-style pane header. Fixed height so every pane lines up. */
export function PaneTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("pane-title flex h-7 shrink-0 items-center gap-1 px-1.5", className)}>
      {children}
    </div>
  );
}

/** Tab button that lives inside a `PaneTitle`. */
export function PaneTab({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-[22px] shrink-0 whitespace-nowrap rounded-xs px-2 text-micro tracking-wide transition-colors duration-100",
        active
          ? "bg-bg/60 text-fg shadow-[inset_0_1px_0_rgb(0_0_0/0.45)]"
          : "text-fg/75 hover:bg-white/10 hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Compact segmented control for exclusive choices (通路、TIF、限價/市價). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  itemClassName,
}: {
  value: T;
  options: { id: T; label: ReactNode; title?: string }[];
  onChange: (id: T) => void;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div
      role="group"
      className={cn(
        "inline-flex h-7 items-stretch overflow-hidden rounded-sm border border-border bg-bg p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "min-w-0 flex-1 rounded-xs px-2 text-2xs transition-colors duration-100",
              on ? "bg-header-2 text-fg" : "text-muted hover:bg-elevated hover:text-fg",
              itemClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Label/value pair used in quote strips and the ticket summary. */
export function KV({
  k,
  v,
  tone,
  className,
  valueClassName,
}: {
  k: ReactNode;
  v: ReactNode;
  tone?: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-2 font-mono", className)}>
      <span className="shrink-0 text-muted">{k}</span>
      <span className={cn("truncate tabular", tone ?? "text-fg", valueClassName)}>{v}</span>
    </div>
  );
}
