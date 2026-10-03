import type { Bar } from "../game/types.ts";

export type ConfirmedSwingHigh = {
  /** Start of the one-minute interval containing the high, not its exact tick. */
  t: number;
  p: number;
  /** The second following minute must close before this high is confirmed. */
  confirmedAt: number;
};

export type SwingHighResult = {
  confirmed: ConfirmedSwingHigh[];
  comparison: "higher" | "lower" | "equal" | null;
  candidate?: { t: number; p: number };
};

/**
 * A confirmed high is strictly above two contiguous completed minutes on each
 * side. Equal-price plateaus are never confirmed. The two newest confirmed
 * highs are returned in chronological order; display ranges do not change them.
 *
 * A candidate is only an observed high after the latest confirmed high, with
 * an adjacent rising pair supporting it. It is not a forecast or a confirmed
 * pivot: a plateau can remain a candidate without ever being confirmed.
 *
 * Even candidates use completed bars only. A caller may supply a full historical
 * bar for the current minute, so its eventual high is unsafe to inspect at now.
 */
export function deriveSwingHighs(
  bars: readonly Bar[],
  now: number,
  startT: number,
  endT: number,
): SwingHighResult {
  const empty: SwingHighResult = { confirmed: [], comparison: null };
  if (![now, startT, endT].every(Number.isFinite) || endT <= startT) return empty;

  const cutoff = Math.min(now, endT);
  const eligible = bars
    .filter(
      (bar) =>
        Number.isFinite(bar.t) &&
        Number.isFinite(bar.h) &&
        bar.h > 0 &&
        bar.t >= startT &&
        bar.t + 60 <= cutoff,
    )
    .slice()
    .sort((a, b) => a.t - b.t);

  // Ambiguous duplicate minutes must not create extra left/right observations.
  // Removing every copy also leaves a gap, so confirmation fails closed.
  const completed = eligible.filter(
    (bar, index) => eligible[index - 1]?.t !== bar.t && eligible[index + 1]?.t !== bar.t,
  );
  const allConfirmed: ConfirmedSwingHigh[] = [];
  let lastConfirmedIndex = -1;
  for (let index = 2; index < completed.length - 2; index++) {
    const middle = completed[index]!;
    const offsets = [-2, -1, 1, 2];
    if (
      offsets.every((offset) => {
        const neighbor = completed[index + offset]!;
        return neighbor.t === middle.t + offset * 60 && neighbor.h < middle.h;
      })
    ) {
      allConfirmed.push({ t: middle.t, p: middle.h, confirmedAt: middle.t + 180 });
      lastConfirmedIndex = index;
    }
  }

  let candidate: SwingHighResult["candidate"];
  // The first point of a new sequence cannot provide its own rising evidence.
  // For an equal maximum, retain the first observed interval deterministically.
  for (let index = Math.max(1, lastConfirmedIndex + 2); index < completed.length; index++) {
    const previous = completed[index - 1]!;
    const bar = completed[index]!;
    if (previous.t + 60 === bar.t && previous.h < bar.h && (!candidate || bar.h > candidate.p)) {
      candidate = { t: bar.t, p: bar.h };
    }
  }

  const confirmed = allConfirmed.slice(-2);
  const [earlier, later] = confirmed;
  const comparison =
    earlier && later
      ? later.p > earlier.p
        ? "higher"
        : later.p < earlier.p
          ? "lower"
          : "equal"
      : null;
  return candidate ? { confirmed, comparison, candidate } : { confirmed, comparison };
}
