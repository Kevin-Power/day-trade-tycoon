import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function toneClass(n: number, flat = "text-fg") {
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return flat;
}

export function Signed({
  value,
  children,
  className,
}: {
  value: number;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("tabular", toneClass(value), className)}>{children}</span>;
}

export function Arrow({ n }: { n: number }) {
  if (n > 0) return <span className="text-up">▲</span>;
  if (n < 0) return <span className="text-down">▼</span>;
  return <span className="text-muted">–</span>;
}
