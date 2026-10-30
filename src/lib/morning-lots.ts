// How many lots a paper order may have, and the quick picks of the 張數 field (design 2026-10-30: XQ's grid, 1–400).
// Pure: the server's order check and the desk's picker both read these.

export const MIN_LOTS = 1;
export const MAX_LOTS = 400;

/** XQ's quick-pick rows, in order; large text wraps each row, keeping the order. */
export const LOT_PICKS: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 5, 6, 7],
  [10, 20, 30, 40, 50, 60, 70],
  [15, 25, 35, 45, 55, 65, 75],
  [100, 150, 200, 250, 300, 350, 400],
];

/** A whole count of lots within 1–400 (fractions dropped; anything not finite is 1). */
export function clampLots(value: number): number {
  if (!Number.isFinite(value)) return MIN_LOTS;
  return Math.min(MAX_LOTS, Math.max(MIN_LOTS, Math.trunc(value)));
}

/** Typed lots: a whole number in half- or full-width digits, clamped to 1–400; null for anything else. */
export function parseLots(text: string): number | null {
  const digits = text.normalize("NFKC").trim();
  return /^\d+$/.test(digits) ? clampLots(Number(digits)) : null;
}
