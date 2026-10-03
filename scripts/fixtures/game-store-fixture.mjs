import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

// Use the real store, broker, engine, pass rules, schemas and persistence. Only
// browser effects, the Zustand binding and the network boundary are replaced.
export function gameStoreFixture({ userId = null, failWrites = false, rejectRemote = false, remoteGate = null, values = new Map() } = {}) {
  const storage = {
    failWrites,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (storage.failWrites) throw new Error("Storage quota exceeded");
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
  const requests = [];
  const messages = [];
  const dependencies = {
    zod: require("zod"),
    zustand: {
      create: (initialize) => {
        let state;
        const get = () => state;
        const set = (patch) => { state = { ...state, ...patch }; };
        state = initialize(set, get);
        return { getState: get, setState: set };
      },
    },
    "@/lib/game/audio": { unlockAudio: () => {}, playError: () => {}, playFill: () => {} },
    "@/lib/classroom-db": { saveClassroomSession: async ({ data }) => {
      requests.push(data);
      if (remoteGate) await remoteGate;
      if (rejectRemote) throw new Error("Server unavailable");
      return { ok: true };
    } },
    sonner: { toast: Object.assign((text) => messages.push(text), { error: (text) => messages.push(text), success: () => {} }) },
  };
  const modules = new Map();
  function load(id, from = root) {
    if (id in dependencies) return dependencies[id];
    assert.ok(id.startsWith("@/") || id.startsWith("."), `Unexpected dependency: ${id}`);
    const base = id.startsWith("@/") ? resolve(root, "src", id.slice(2)) : resolve(from, id);
    const path = [base, `${base}.ts`, resolve(base, "index.ts")].find((candidate) => existsSync(candidate) && /\.(ts|json)$/.test(candidate));
    assert.ok(path, `Cannot resolve ${id}`);
    if (modules.has(path)) return modules.get(path);
    const source = readFileSync(path, "utf8");
    if (path.endsWith(".json")) {
      const data = JSON.parse(source);
      modules.set(path, data);
      return data;
    }
    const exports = {};
    modules.set(path, exports);
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    runInNewContext(compiled, {
      exports,
      require: (dependency) => load(dependency, dirname(path)),
      window: { localStorage: storage },
      crypto: { randomUUID },
    });
    return exports;
  }
  const store = load("@/lib/game/store").useGame;
  const persistence = load("@/lib/game/persist");
  persistence.setProfileIdentity(userId);
  store.getState().hydrate();
  // A completed session keeps these fixtures outside the first-time tour.
  store.getState().profile.sessions = 1;
  store.getState().start("wed-open");
  store.getState().dismissBeat();
  assert.equal(store.getState().paused, false);
  return { store, load, persistence, storage, values, requests, messages };
}

export function buy(store, code = "2317") {
  store.getState().select(code);
  store.getState().setTicket({ side: "buy", type: "market", lots: 1 });
  store.getState().submit();
  assert.equal(store.getState().engine.positions.get(code)?.lots, 1);
}

export const flushStorePromises = () => new Promise((resolve) => setImmediate(resolve));
