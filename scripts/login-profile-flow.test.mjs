import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as safeNext from "../src/lib/safe-next.ts";

// Invoke the real route components and submit handlers with controlled hook
// state. Only identity, navigation and server calls are replaced; no browser
// or production account is created by these recovery-path tests.
function fixture({
  user = null,
  saveProfile = async () => ({ ok: true }),
  loadProfile = async () => null,
  search = {},
} = {}) {
  const frames = new Map();
  let current;
  let component;
  let lastChildKey;
  const state = { user, isPending: false };
  const calls = { signIn: [], signUp: [], profiles: [], navigate: [], signOut: [] };
  const verified = { id: "student-a", name: "小安", email: "a@example.test" };
  const navigate = async (target) => {
    calls.navigate.push(target);
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const react = {
    useState(initial) {
      const frame = current;
      const slot = frame.index++;
      if (!(slot in frame.slots)) frame.slots[slot] = initial;
      return [
        frame.slots[slot],
        (value) => {
          frame.slots[slot] = typeof value === "function" ? value(frame.slots[slot]) : value;
        },
      ];
    },
    useRef(initial) {
      const frame = current;
      const slot = frame.index++;
      if (!(slot in frame.slots)) frame.slots[slot] = { current: initial };
      return frame.slots[slot];
    },
    useEffect(effect, deps) {
      const frame = current;
      const slot = frame.index++;
      const previous = frame.slots[slot];
      if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
        frame.effects.push(() => {
          previous?.cleanup?.();
          frame.slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const auth = (kind) => async (data) => {
    calls[kind].push(data);
    return { data: { user: verified }, error: null };
  };
  const dependencies = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@tanstack/react-router": {
      createFileRoute: () => (options) => {
        component = options.component;
        return { ...options, useSearch: () => options.validateSearch(search) };
      },
      Link: "link",
      useNavigate: () => navigate,
    },
    "@/lib/icons": Object.fromEntries(
      ["ArrowLeft", "ArrowRight", "CheckCircle2", "LoaderCircle", "UserRound"].map((name) => [
        name,
        `icon-${name}`,
      ]),
    ),
    "@/lib/auth/client": {
      authEnabled: true,
      authClient: { signIn: { email: auth("signIn") }, signUp: { email: auth("signUp") } },
      signOut: async (target) => {
        calls.signOut.push(target);
      },
    },
    "@/lib/auth/use-current-user": { useCurrentUserState: () => state },
    "@/lib/classroom-db": {
      loadMyProfile: () => loadProfile(),
      upsertMyProfile: async (input) => {
        calls.profiles.push(input.data);
        return saveProfile(input);
      },
    },
    "@/lib/safe-next": safeNext,
    "@/components/classroom-auth-layout": {
      AuthPasswordInput: "password-field",
      ClassroomAuthLayout: "auth-layout",
    },
  };
  const source = readFileSync(new URL("../src/routes/login.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  runInNewContext(compiled, {
    exports: {},
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
    Error,
  });
  function invoke(fn, props, key) {
    const frame = frames.get(key) ?? { slots: [], index: 0, effects: [] };
    frames.set(key, frame);
    frame.index = 0;
    frame.effects = [];
    current = frame;
    const output = fn(props);
    for (const effect of frame.effects) effect();
    return output;
  }
  function render() {
    const root = invoke(component, {}, "root");
    const child = root.props.children;
    if (typeof child.type !== "function") return child;
    const key = `${child.type.name}:${child.key ?? ""}`;
    if (lastChildKey && lastChildKey !== key) {
      for (const slot of frames.get(lastChildKey)?.slots ?? []) slot?.cleanup?.();
      frames.delete(lastChildKey);
    }
    lastChildKey = key;
    return invoke(child.type, child.props, key);
  }
  return {
    render,
    calls,
    state,
    verified,
    ready: async () => {
      render();
      await new Promise(setImmediate);
      return render();
    },
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const field = (tree, id) => nodes(tree).find((node) => node.props.id === id);
const form = (tree) => nodes(tree).find((node) => node.type === "form");
const checkbox = (tree) => nodes(tree).find((node) => node.props.type === "checkbox");
const button = (tree, text) =>
  nodes(tree).find((node) => node.type === "button" && node.props.children === text);
const submit = (tree) => form(tree).props.onSubmit({ preventDefault() {} });
const change = (node, value) => node.props.onChange({ target: { value } });
const user = (id, displayName = "已登入學員") => ({
  id,
  displayName,
  primaryEmail: `${id}@example.test`,
  isDevFallback: false,
});

test("sign-up success followed by profile rejection retries only profile and keeps explicit consent", async () => {
  let attempts = 0;
  const f = fixture({
    saveProfile: async () => {
      if (++attempts === 1) throw new Error("班級代碼不正確");
      return { ok: true };
    },
  });
  button(f.render(), "首次註冊").props.onClick();
  let tree = f.render();
  change(field(tree, "learner-name"), "小安");
  change(field(tree, "learner-email"), "a@example.test");
  change(field(tree, "learner-password"), "classroom-test-pass");
  await submit(f.render());
  assert.equal(f.calls.signUp.length, 1);
  assert.equal(
    f.calls.profiles.length,
    0,
    "authentication does not imply consent or profile completion",
  );
  tree = await f.ready();
  assert.equal(checkbox(tree).props.checked, false);
  assert.equal(field(tree, "learner-password"), undefined);
  await submit(tree);
  assert.equal(
    f.calls.profiles.length,
    0,
    "unchecked consent cannot be bypassed by form submission",
  );
  change(field(tree, "learner-class"), "WRONG");
  checkbox(tree).props.onChange({ target: { checked: true } });
  await submit(f.render());
  tree = f.render();
  assert.equal(f.calls.profiles.length, 1);
  assert.equal(field(tree, "learner-class").props.value, "WRONG");
  assert.ok(nodes(tree).some((node) => node.props.role === "alert"));
  // Better Auth's hook catching up must not remount and erase this retry draft.
  f.state.user = user(f.verified.id, f.verified.name);
  tree = f.render();
  assert.equal(field(tree, "learner-class").props.value, "WRONG");
  assert.equal(checkbox(tree).props.checked, true);
  change(field(tree, "learner-class"), "VALID");
  await submit(f.render());
  assert.equal(f.calls.profiles.length, 2);
  assert.equal(f.calls.profiles[1].classCode, "VALID");
  assert.equal(f.calls.signUp.length, 1);
  assert.equal(f.calls.signIn.length, 0);
  assert.equal(f.calls.navigate.length, 1);
});

test("an already authenticated learner directly completes profile without credentials", async () => {
  const f = fixture({ user: user("student-a", "小安") });
  const tree = await f.ready();
  assert.equal(field(tree, "profile-name").props.value, "小安");
  assert.equal(field(tree, "learner-email"), undefined);
  assert.equal(field(tree, "learner-password"), undefined);
  assert.equal(checkbox(tree).props.checked, false);
  checkbox(tree).props.onChange({ target: { checked: true } });
  await submit(f.render());
  assert.equal(f.calls.profiles.length, 1);
  assert.equal(f.calls.signIn.length + f.calls.signUp.length, 0);
  assert.equal(f.calls.profiles[0].acceptTos, true);
});

test("changing identity discards the former learner profile draft and consent", async () => {
  const f = fixture({ user: user("student-a", "小安") });
  let tree = await f.ready();
  change(field(tree, "learner-class"), "PRIVATE-DRAFT");
  checkbox(tree).props.onChange({ target: { checked: true } });
  f.state.user = user("student-b", "小柏");
  tree = await f.ready();
  assert.equal(field(tree, "profile-name").props.value, "小柏");
  assert.equal(field(tree, "learner-class").props.value, "");
  assert.equal(checkbox(tree).props.checked, false);
});

test("duplicate profile submit is ignored while the first request is pending", async () => {
  let complete;
  const f = fixture({
    user: user("student-a"),
    saveProfile: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  checkbox(await f.ready()).props.onChange({ target: { checked: true } });
  const first = submit(f.render());
  await submit(f.render());
  assert.equal(f.calls.profiles.length, 1);
  complete({ ok: true });
  await first;
  assert.equal(f.calls.navigate.length, 1);
});

test("a returning learner with completed profile enters the classroom without reconfirming consent", async () => {
  const f = fixture({
    user: user("student-a"),
    loadProfile: async () => ({
      user_id: "student-a",
      display_name: "小安",
      tos_accepted_at: "2026-10-04T00:00:00Z",
    }),
  });
  const tree = await f.ready();
  assert.equal(f.calls.navigate.length, 1);
  assert.equal(f.calls.profiles.length, 0);
  assert.equal(checkbox(tree), undefined);
});

test("a failed profile read retries reading without reauthenticating or overwriting a profile", async () => {
  let reads = 0;
  const f = fixture({
    user: user("student-a"),
    loadProfile: async () => {
      if (++reads === 1) throw new Error("offline");
      return {
        user_id: "student-a",
        display_name: "小安",
        tos_accepted_at: "2026-10-04T00:00:00Z",
      };
    },
  });
  const tree = await f.ready();
  assert.equal(checkbox(tree), undefined);
  button(tree, "重試讀取班級資料").props.onClick();
  await f.ready();
  assert.equal(reads, 2);
  assert.equal(f.calls.navigate.length, 1);
  assert.equal(f.calls.profiles.length + f.calls.signIn.length + f.calls.signUp.length, 0);
});

test("a learner sent from practice returns there after completing the profile", async () => {
  const f = fixture({ user: user("student-a", "小安"), search: { next: "/morning?panel=trade" } });
  const tree = await f.ready();
  checkbox(tree).props.onChange({ target: { checked: true } });
  await submit(f.render());
  assert.deepEqual(f.calls.navigate.map((target) => target.href), ["/morning?panel=trade"]);
});

test("an unsafe return path falls back to the lobby and sign-up mode opens the sign-up form", async () => {
  const returning = fixture({ user: user("student-b"), search: { next: "//evil.test" }, loadProfile: async () => ({ user_id: "student-b", tos_accepted_at: "2026-10-01" }) });
  await returning.ready();
  assert.deepEqual(returning.calls.navigate.map((target) => target.href), ["/"]);
  const fresh = fixture({ search: { mode: "up" } });
  assert.ok(field(fresh.render(), "learner-name"), "sign-up mode shows the learner name field");
});
