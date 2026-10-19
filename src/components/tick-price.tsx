import type { ReactNode } from "react";
import { useTickFlash } from "@/components/use-tick-flash";

/** A live price that flashes red or green for a moment each time a replayed trade moves it. */
export function TickPrice({
  value,
  identity,
  className,
  children,
}: {
  value: number | null | undefined;
  identity: string;
  className?: string;
  children: ReactNode;
}) {
  const tick = useTickFlash(value, identity);
  return (
    <strong key={tick.key} className={className} data-flash={tick.flash}>
      {children}
    </strong>
  );
}
