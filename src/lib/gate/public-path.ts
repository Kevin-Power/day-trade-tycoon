/** Paths that skip the classroom entry password: only the public trial (the course page went on 2026-11-02). */
export const GATE_PUBLIC_PATHS = ["/try"] as const;

export type GatePublicPath = (typeof GATE_PUBLIC_PATHS)[number];

export function isGatePublicPath(pathname: string): boolean {
  return (GATE_PUBLIC_PATHS as readonly string[]).includes(pathname);
}
