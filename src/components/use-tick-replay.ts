import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MorningState } from "@/lib/morning";
import { liveSession, replayStep, type LiveMorningState } from "@/lib/morning-live";

/** About ten desk updates a second: smooth enough to read as live trading, light enough for phones. */
const FRAME_MS = 100;

/**
 * Plays each newly revealed minute trade by trade over `durationMs`, then rests on the server's session.
 * A minute plays only when the same run moved forward one minute; loading, switching runs or jumping shows
 * the session as it is.
 */
export function useTickReplay(session: MorningState | null, durationMs: number): LiveMorningState | null {
  const [fraction, setFraction] = useState(1);
  const seen = useRef<{ id: string; cursor: number } | null>(null);
  const startedAt = useRef(0);
  const id = session?.id;
  const cursor = session?.cursor;

  // Before paint, so the minute's close never shows for a frame before its first trade.
  useLayoutEffect(() => {
    const step = replayStep(seen.current, session);
    seen.current = id === undefined || cursor === undefined ? null : { id, cursor };
    if (step === "play") {
      startedAt.current = performance.now();
      setFraction(0);
    } else if (step === "rest") setFraction(1);
    // Only a new run or a new minute changes the replay; orders and other updates keep it going.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cursor]);

  useEffect(() => {
    if (fraction >= 1) return;
    const timer = window.setTimeout(() => {
      const next = document.hidden ? 1 : (performance.now() - startedAt.current) / durationMs;
      setFraction(next >= 1 ? 1 : next);
    }, FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [fraction, durationMs]);

  return useMemo(() => (session ? liveSession(session, fraction) : null), [session, fraction]);
}
