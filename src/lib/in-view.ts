// "Is this element in, or one row from, the visible part of its scroll container?" for tables with many rows.
//
// One IntersectionObserver is shared by everything watched inside the same scroll container and margin, so a table
// of 80 rows runs one observer, not 80. The container is the observer's root: only then does the margin (how far
// beyond the container's edge still counts) apply, and a row hidden by the container's own scrolling is out of view.

type Listener = (inView: boolean) => void;
type Hub = { observer: IntersectionObserver; listeners: Map<Element, Listener> };

const hubs = new WeakMap<Element, Map<number, Hub>>();

/**
 * Calls `notify` with whether `target` is within `margin` px (above or below) of the visible part of `root`: once
 * when watching starts (asynchronously, as the browser first measures it), then whenever that changes. Returns the
 * function that stops watching; the shared observer goes with its last watcher.
 */
export function watchInView(target: Element, root: Element, margin: number, notify: Listener): () => void {
  let byMargin = hubs.get(root);
  if (!byMargin) {
    byMargin = new Map();
    hubs.set(root, byMargin);
  }
  const margins = byMargin;
  let hub = margins.get(margin);
  if (!hub) {
    const listeners = new Map<Element, Listener>();
    // Entries of one target arrive oldest first, so the last one decides.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: `${margin}px 0px` },
    );
    hub = { observer, listeners };
    margins.set(margin, hub);
  }
  const shared = hub;
  shared.listeners.set(target, notify);
  shared.observer.observe(target);
  return () => {
    if (shared.listeners.get(target) !== notify) return;
    shared.listeners.delete(target);
    shared.observer.unobserve(target);
    if (!shared.listeners.size) {
      shared.observer.disconnect();
      if (margins.get(margin) === shared) margins.delete(margin);
    }
  };
}
