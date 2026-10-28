import { useEffect, useState, type RefObject } from "react";
import { watchInView } from "@/lib/in-view";

/**
 * Whether the element is in, or within `margin(element)` px of, the visible part of its nearest ancestor that
 * matches `scroller`. False until the browser has measured it, so a long table paints only the rows it shows.
 * Without an IntersectionObserver, or outside any such ancestor, it is always true.
 */
export function useInView(
  ref: RefObject<HTMLElement | null>,
  scroller: string,
  margin: (element: HTMLElement) => number,
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = element.closest(scroller);
    if (!root || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    return watchInView(element, root, Math.max(0, Math.round(margin(element))), setInView);
    // `margin` is read once, as watching starts: a table's rows keep their height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, scroller]);
  return inView;
}
