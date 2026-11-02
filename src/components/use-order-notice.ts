import { useEffect, useRef, useState } from "react";
import { orderNotices, type OrderNotice, type OrderNoticeView } from "@/lib/morning-notices";

/** How long a notice stays on screen. */
export const ORDER_NOTICE_MS = 6000;

/**
 * The newest 成交／未成交 of a run, for ORDER_NOTICE_MS. `view` is the run at rest: null while a minute plays, so a
 * fill is said once the replay has reached it (as 快訊 waits), never ahead of the tape.
 */
export function useOrderNotice(
  view: OrderNoticeView | null,
  names: Readonly<Record<string, string>>,
): OrderNotice | null {
  const last = useRef<OrderNoticeView | null>(null);
  const [notice, setNotice] = useState<OrderNotice | null>(null);
  useEffect(() => {
    if (!view) return;
    const fresh = orderNotices(last.current, view, names);
    last.current = view;
    if (fresh.length) setNotice(fresh[fresh.length - 1]);
  }, [view, names]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), ORDER_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return notice;
}
