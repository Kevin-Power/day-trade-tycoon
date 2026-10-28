import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { watchInView } from "./in-view.ts";

type Entry = { target: Element; isIntersecting: boolean };

class FakeObserver {
  static all: FakeObserver[] = [];
  callback: (entries: Entry[]) => void;
  options: { root: Element; rootMargin: string };
  targets = new Set<Element>();
  disconnected = false;
  constructor(callback: (entries: Entry[]) => void, options: { root: Element; rootMargin: string }) {
    this.callback = callback;
    this.options = options;
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  fire(...entries: Entry[]) {
    this.callback(entries);
  }
}

const element = (name: string) => ({ name }) as unknown as Element;
const original = globalThis.IntersectionObserver;

beforeEach(() => {
  FakeObserver.all = [];
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  globalThis.IntersectionObserver = original;
});

test("rows in one scroll container share one observer, rooted there with the margin of one row", () => {
  const root = element("scroller");
  const [a, b, c] = [element("a"), element("b"), element("c")];
  const seen: string[] = [];
  watchInView(a, root, 28, (inView) => seen.push(`a:${inView}`));
  watchInView(b, root, 28, (inView) => seen.push(`b:${inView}`));
  watchInView(c, root, 28, (inView) => seen.push(`c:${inView}`));
  assert.equal(FakeObserver.all.length, 1);
  const [observer] = FakeObserver.all;
  assert.equal(observer.options.root, root);
  assert.equal(observer.options.rootMargin, "28px 0px");
  assert.deepEqual([...observer.targets], [a, b, c]);
  // Measured together, then one row scrolls out and another in: each hears only about itself.
  observer.fire({ target: a, isIntersecting: true }, { target: b, isIntersecting: true }, { target: c, isIntersecting: false });
  observer.fire({ target: a, isIntersecting: false }, { target: c, isIntersecting: true });
  assert.deepEqual(seen, ["a:true", "b:true", "c:false", "a:false", "c:true"]);
});

test("another container or another margin gets its own observer", () => {
  const first = element("first");
  const second = element("second");
  watchInView(element("x"), first, 28, () => {});
  watchInView(element("y"), second, 28, () => {});
  watchInView(element("z"), first, 52, () => {});
  assert.deepEqual(
    FakeObserver.all.map((observer) => [observer.options.root, observer.options.rootMargin]),
    [
      [first, "28px 0px"],
      [second, "28px 0px"],
      [first, "52px 0px"],
    ],
  );
});

test("when the last watcher stops the shared observer goes, and a later watcher gets a new one", () => {
  const root = element("scroller");
  const [a, b] = [element("a"), element("b")];
  const stopA = watchInView(a, root, 28, () => {});
  const stopB = watchInView(b, root, 28, () => {});
  const [first] = FakeObserver.all;
  stopA();
  assert.deepEqual([...first.targets], [b]);
  assert.equal(first.disconnected, false);
  stopB();
  assert.equal(first.disconnected, true);
  watchInView(a, root, 28, () => {});
  assert.equal(FakeObserver.all.length, 2);
  assert.equal(FakeObserver.all[1].disconnected, false);
});

test("a stopped row hears nothing more, even from a late entry", () => {
  const root = element("scroller");
  const [a, b] = [element("a"), element("b")];
  const seen: string[] = [];
  const stopA = watchInView(a, root, 28, (inView) => seen.push(`a:${inView}`));
  watchInView(b, root, 28, (inView) => seen.push(`b:${inView}`));
  stopA();
  FakeObserver.all[0].fire({ target: a, isIntersecting: true }, { target: b, isIntersecting: true });
  assert.deepEqual(seen, ["b:true"]);
});
