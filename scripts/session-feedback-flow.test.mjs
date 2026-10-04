import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Exercise the real panel's buttons, effects and async handlers. Hook scheduling,
// server responses and the unused dialog/router boundary are controlled here;
// no copied retry logic, browser, server or real learner record is involved.
function fixture() {
  let frame;
  let previousKey;
  const requests = [];
  let lateWrites = 0;
  const props = { userId: "student-a", sessionId: "practice-a" };
  const jsx = (type, properties, key) => ({ type, props: properties ?? {}, key });
  const react = {
    useState(initial) {
      const owner = frame;
      const slot = owner.index++;
      if (!(slot in owner.slots)) owner.slots[slot] = initial;
      return [owner.slots[slot], (value) => {
        if (!owner.alive) lateWrites += 1;
        owner.slots[slot] = typeof value === "function" ? value(owner.slots[slot]) : value;
      }];
    },
    useRef(initial) {
      const slot = frame.index++;
      if (!(slot in frame.slots)) frame.slots[slot] = { current: initial };
      return frame.slots[slot];
    },
    useId: () => "feedback-panel",
    useEffect(effect, deps) {
      const owner = frame;
      const slot = owner.index++;
      const previous = owner.slots[slot];
      if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
        owner.effects.push(() => {
          previous?.cleanup?.();
          owner.slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const dependencies = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@tanstack/react-router": { useBlocker: () => ({ status: "idle" }) },
    "@radix-ui/react-dialog": Object.fromEntries(
      ["Root", "Portal", "Overlay", "Content", "Title", "Description"].map((name) => [name, `dialog-${name}`]),
    ),
    "@/lib/classroom-db": {
      loadSessionFeedback: ({ data }) => new Promise((resolve, reject) => {
        requests.push({ data: JSON.parse(JSON.stringify(data)), resolve, reject });
      }),
      addSessionFeedback: () => { throw new Error("This read-only flow must not write feedback"); },
    },
    "@/lib/classroom-feedback": {},
  };
  const source = readFileSync(new URL("../src/components/session-feedback.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exported = {};
  runInNewContext(compiled, {
    exports: exported,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  function unmount() {
    if (!frame) return;
    for (const slot of frame.slots) slot?.cleanup?.();
    frame.alive = false;
    previousKey = null;
  }
  function render() {
    const child = exported.SessionFeedbackPanel(props);
    if (previousKey !== child.key) {
      unmount();
      frame = { slots: [], index: 0, effects: [], alive: true };
      previousKey = child.key;
    }
    frame.index = 0;
    frame.effects = [];
    const output = child.type(child.props);
    for (const effect of frame.effects) effect();
    return output;
  }
  return { props, requests, render, unmount, lateWrites: () => lateWrites };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const button = (tree, text) => nodes(tree).find((node) => node.type === "button" && node.props.children === text);
const errors = (tree) => nodes(tree).filter((node) => node.props.role === "alert").map((node) => node.props.children);
const observations = (tree) => nodes(tree).filter((node) => node.type === "p" && String(node.props.children).startsWith("observation-")).map((node) => node.props.children);
const flush = () => new Promise(setImmediate);
const cursor = { id: "00000000-0000-4000-8000-000000000010", createdAt: "2026-10-04T12:00:00.000000Z" };
const item = (id) => ({ id, sessionId: "practice-a", authorName: "課堂講師", observation: `observation-${id}`, nextStep: `next-${id}`, createdAt: "2026-10-04T12:00:00.000000Z" });
const firstPage = { items: Array.from({ length: 10 }, (_, index) => item(String(20 - index))), nextCursor: cursor };

test("an initial load failure retries without a cursor before any page exists", async () => {
  const f = fixture();
  f.render();
  f.requests[0].reject(new Error("initial connection failed"));
  await flush();
  assert.deepEqual(observations(f.render()), []);
  assert.equal(errors(f.render()).length, 1);
  button(f.render(), "重試讀取回饋").props.onClick();
  f.render();
  assert.deepEqual(f.requests[1].data, { sessionId: "practice-a" });
  assert.equal(errors(f.render()).length, 1);
  f.requests[1].resolve(firstPage);
  await flush();
  assert.equal(observations(f.render()).length, 10);
  assert.equal(errors(f.render()).length, 0);
});

test("retrying a failed latest refresh fetches latest even when the retained page has an older cursor", async () => {
  const f = fixture();
  f.render();
  f.requests[0].resolve(firstPage);
  await flush();
  button(f.render(), "更新回饋").props.onClick();
  f.render();
  f.requests[1].reject(new Error("connection interrupted"));
  await flush();
  const previous = observations(f.render());
  assert.equal(previous.length, 10);
  assert.equal(errors(f.render()).length, 1);
  button(f.render(), "重試讀取回饋").props.onClick();
  f.render();
  assert.deepEqual(f.requests[2].data, { sessionId: "practice-a" }, "latest retry must not request an older page");
  assert.deepEqual(observations(f.render()), previous);
  assert.equal(errors(f.render()).length, 1, "keep failure visible until a successful response");
  f.requests[2].resolve({ items: [item("newest"), ...firstPage.items.slice(0, 9)], nextCursor: cursor });
  await flush();
  assert.equal(observations(f.render())[0], "observation-newest");
  assert.equal(errors(f.render()).length, 0);
  assert.equal(f.lateWrites(), 0);
});

test("an older-page retry uses its original cursor, retains visible content and clears the error only on success", async () => {
  const f = fixture();
  f.render();
  f.requests[0].resolve(firstPage);
  await flush();
  button(f.render(), "查看較早回饋").props.onClick();
  assert.deepEqual(f.requests[1].data, { sessionId: "practice-a", before: cursor });
  f.requests[1].reject(new Error("connection interrupted"));
  await flush();
  const previous = observations(f.render());
  button(f.render(), "重試讀取回饋").props.onClick();
  assert.deepEqual(f.requests[2].data, f.requests[1].data);
  assert.deepEqual(observations(f.render()), previous);
  assert.equal(errors(f.render()).length, 1);
  f.requests[2].resolve({ items: [firstPage.items.at(-1), item("older")], nextCursor: null });
  await flush();
  assert.deepEqual(observations(f.render()), [...previous, "observation-older"]);
  assert.equal(errors(f.render()).length, 0);
  assert.equal(button(f.render(), "查看較早回饋"), undefined);
});

test("key changes and unmount discard pending latest and older-page responses", async () => {
  for (const change of [{ userId: "student-b" }, { sessionId: "practice-b" }, { canWrite: true }]) {
    for (const older of [false, true]) {
      const f = fixture();
      f.render();
      if (older) {
        f.requests[0].resolve(firstPage);
        await flush();
        button(f.render(), "查看較早回饋").props.onClick();
      }
      const oldRequest = f.requests.at(-1);
      Object.assign(f.props, change);
      f.render();
      const currentRequest = f.requests.at(-1);
      oldRequest.resolve({ items: [item("PRIVATE-OLD")], nextCursor: null });
      currentRequest.resolve({ items: [item("current")], nextCursor: null });
      await flush();
      assert.deepEqual(observations(f.render()), ["observation-current"]);
      assert.equal(f.lateWrites(), 0);
      button(f.render(), "更新回饋").props.onClick();
      f.render();
      const lastRequest = f.requests.at(-1);
      f.unmount();
      lastRequest.reject(new Error("late failure after unmount"));
      await flush();
      assert.equal(f.lateWrites(), 0);
    }
  }
});
