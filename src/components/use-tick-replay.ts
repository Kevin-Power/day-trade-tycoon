import { useEffect, useMemo, useState } from "react";
import type { MorningState } from "@/lib/morning";
import {
  advanceReplay,
  liveSession,
  startReplay,
  type LiveMorningState,
  type ReplayCatalog,
  type ReplayProgress,
} from "@/lib/morning-live";

/** About ten desk updates a second: smooth enough to read as live trading, light enough for phones. */
const FRAME_MS = 100;

/**
 * Plays each newly revealed minute trade by trade over `durationMs`, then rests on the server's session.
 * A minute plays only when the same run moved forward one minute; loading, switching runs or jumping shows
 * the session as it is. A speed change mid-minute only changes the pace.
 */
export function useTickReplay(
  session: MorningState | null,
  catalog: ReplayCatalog | undefined,
  durationMs: number,
): LiveMorningState | null {
  const [progress, setProgress] = useState<ReplayProgress>({ fraction: 1, at: 0 });
  let current = progress;
  // Decided while rendering, so no commit ever pairs a new minute with the old progress: the desk's first
  // frame of a minute already shows its opening trade, and price flashes compare trade with trade.
  if (session?.id !== progress.id || session?.cursor !== progress.cursor) {
    current = startReplay(progress, session, performance.now());
    setProgress(current);
  }

  useEffect(() => {
    if (current.fraction >= 1) return;
    const timer = window.setTimeout(() => {
      setProgress((latest) =>
        document.hidden ? { ...latest, fraction: 1 } : advanceReplay(latest, performance.now(), durationMs),
      );
    }, FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [current, durationMs]);

  const fraction = current.fraction;
  return useMemo(
    () => (session && catalog ? liveSession(session, fraction, catalog) : session),
    [session, catalog, fraction],
  );
}
