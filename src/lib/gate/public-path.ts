/** Paths that skip the classroom entry password. Buyer-facing only. */
export const GATE_PUBLIC_PATHS = ["/license"] as const;

export type GatePublicPath = (typeof GATE_PUBLIC_PATHS)[number];

export function isGatePublicPath(pathname: string): boolean {
  return (GATE_PUBLIC_PATHS as readonly string[]).includes(pathname);
}
