// The lesson's TAIEX minutes from TWSE's 5-second index file, by the same rule as scripts/lib/taiex-minutes.mjs.
import type { MorningIndexBar, MorningIndexSeries } from "../morning.ts";
import { MORNING_CELLS } from "./trades.ts";

const STEP = 5;
const POINTS_PER_MINUTE = 60 / STEP;
const MORNING_SECONDS = MORNING_CELLS * 60;

/**
 * The 90 morning minutes. Minute m is the twelve points in (m·60, m·60+60] seconds after 09:00: the open is the
 * first of them (09:00:05 for minute 0), the close the last. The 09:00:00 point repeats the previous close, so
 * it is a placeholder and never an open. A missing, repeated, off-grid or unusable point in those 90 minutes is
 * `null`; points after 10:30 are not looked at.
 */
export function taiexMorningSeries(
  previousClose: number,
  points: readonly (readonly [number, number])[],
): MorningIndexSeries | null {
  if (!Number.isFinite(previousClose) || previousClose <= 0) return null;
  const byStep = new Array<number | undefined>(MORNING_SECONDS / STEP + 1);
  for (const [second, value] of points) {
    if (Number.isNaN(second)) return null;
    if (second > MORNING_SECONDS) continue;
    if (second < 0 || !Number.isInteger(second / STEP)) return null;
    if (!Number.isFinite(value) || value <= 0 || byStep[second / STEP] !== undefined) return null;
    byStep[second / STEP] = value;
  }
  const bars: MorningIndexBar[] = [];
  for (let minute = 0; minute < MORNING_CELLS; minute += 1) {
    const p: number[] = [];
    for (let step = 1; step <= POINTS_PER_MINUTE; step += 1) {
      const value = byStep[minute * POINTS_PER_MINUTE + step];
      if (value === undefined) return null;
      p.push(value);
    }
    bars.push({ t: minute * 60, o: p[0], h: Math.max(...p), l: Math.min(...p), c: p[POINTS_PER_MINUTE - 1], p });
  }
  return { code: "TAIEX", name: "加權指數", previousClose, source: "證交所 每 5 秒", bars };
}
