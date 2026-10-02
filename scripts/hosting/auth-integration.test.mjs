import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, access } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONAsync, fromCrossJSON } from "seroval";

const releaseEntry = process.env.CLASSROOM_TEST_RELEASE;
const here = dirname(fileURLToPath(import.meta.url));
const canonicalOrigin = "https://classroom-test.invalid";
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

test("real HTTP standalone auth, owner bootstrap, role isolation and durable restart", {
  skip: !releaseEntry ? "Set CLASSROOM_TEST_RELEASE to an immutable built server/index.mjs" : false,
  timeout: 120000,
}, async t => {
  await access(releaseEntry);
  const port = Number(process.env.CLASSROOM_TEST_PORT || 18792);
  assert.notEqual(port, 8790, "Never use the production listener");
  const vacant = createServer();
  await new Promise((resolveVacant, reject) => { vacant.once("error", reject); vacant.listen(port, "127.0.0.1", resolveVacant); });
  await new Promise(resolveClosed => vacant.close(resolveClosed));
  const runtime = await mkdtemp(join(tmpdir(), "classroom-auth-http-test-"));
  const base = "http://127.0.0.1:" + port;
  const ownerEmail = "owner@example.invalid";
  const studentEmail = "student@example.invalid";
  const password = randomBytes(20).toString("base64url");
  const entryCode = randomBytes(18).toString("hex");
  const token = randomBytes(32).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const gateHash = ["scrypt", salt, scryptSync(entryCode, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")].join("$");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: String(port), NITRO_PORT: String(port),
    BETTER_AUTH_URL: canonicalOrigin, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    DATABASE_URL: "", PGLITE_DATA_DIR: join(runtime, "pglite"),
    VITE_AUTH_ENABLED: "true", CLASSROOM_AUTH_ENABLED: "true", CLASSROOM_TRUST_PROXY: "true",
    CLASSROOM_GATE_PASSWORD_HASH: gateHash,
    CLASSROOM_CODE: "HTTPTEST", CLASSROOM_TEACHER_IDS: "",
    // Student allowlisted by email still MUST fail until a trusted administrator verifies it.
    TEACHER_EMAILS: ownerEmail + "," + studentEmail,
    ADMIN_SETUP_EMAIL: ownerEmail, ADMIN_SETUP_TOKEN: token,
    GROK_PROJECT_ID: "", GROK_AUTH_CLIENT_ID: "", GROK_AUTH_CLIENT_SECRET: "",
  };
  let app;
  let stage = "startup";
  let childLog = "";
  const absorb = (jar, response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) jar.set(name, value); else jar.delete(name);
    }
  };
  const request = async (path, { method = "GET", data, jar = new Map(), headers = {} } = {}) => {
    const outgoing = new Headers({ origin: canonicalOrigin, "cf-connecting-ip": "192.0.2.1", ...headers });
    if (jar.size) outgoing.set("cookie", [...jar].map(([key, value]) => key + "=" + value).join("; "));
    if (data !== undefined) outgoing.set("content-type", "application/json");
    const response = await fetch(base + path, {
      method, headers: outgoing, body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    });
    absorb(jar, response);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: response.status, body, headers: response.headers };
  };
  async function launch() {
    app = fork(join(here, "app-runner.mjs"), [releaseEntry], {
      cwd: runtime, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    app.stdout.on("data", chunk => { childLog += chunk.toString(); });
    app.stderr.on("data", chunk => { childLog += chunk.toString(); });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (app.exitCode !== null) throw new Error("Isolated app exited during startup");
      try {
        const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(3000) });
        if (response.ok && (await response.json()).ok) return;
      } catch { /* startup only */ }
      await wait(150);
    }
    throw new Error("Isolated app readiness timed out");
  }
  async function close() {
    if (!app || app.exitCode !== null) return;
    const owned = app;
    const closed = new Promise(resolveClosed => owned.once("exit", resolveClosed));
    const acknowledged = new Promise((resolveAck, reject) => {
      const timer = setTimeout(() => reject(new Error("Database shutdown was not acknowledged")), 25000);
      owned.on("message", message => {
        if (message?.type === "shutdown-complete") { clearTimeout(timer); resolveAck(); }
        if (message?.type === "shutdown-error") { clearTimeout(timer); reject(new Error("Database shutdown failed")); }
      });
    });
    owned.send({ type: "shutdown" });
    try { await acknowledged; } finally { owned.kill(); await closed; app = undefined; }
  }
  const functionIds = {};
  for (const file of await readdir(join(dirname(releaseEntry), "_ssr"))) {
    if (!file.endsWith(".mjs")) continue;
    const text = await readFile(join(dirname(releaseEntry), "_ssr", file), "utf8");
    for (const name of ["loadTeacherRoster", "upsertMyProfile"]) {
      const match = text.match(new RegExp("var " + name + " = [\\s\\S]*?createSsrRpc\\(\"([a-f0-9]+)\"\\)"));
      if (match) functionIds[name] = match[1];
    }
  }
  async function serverFn(name, method, data, jar) {
    assert.ok(functionIds[name], "Built server function must be discoverable: " + name);
    const headers = new Headers({ "origin": canonicalOrigin, "sec-fetch-site": "same-origin",
      "x-tsr-serverFn": "true", "accept": "application/json", "content-type": "application/json" });
    headers.set("cookie", [...jar].map(([key, value]) => key + "=" + value).join("; "));
    const body = data === undefined ? undefined : JSON.stringify(await toJSONAsync({ data }));
    const response = await fetch(base + "/_serverFn/" + functionIds[name], {
      method, headers, body, signal: AbortSignal.timeout(20000),
    });
    absorb(jar, response);
    const payload = await response.json();
    const result = response.headers.get("x-tss-serialized") ? fromCrossJSON(payload, { plugins: [] }) : payload;
    if (result?.error) throw result.error;
    return result?.result ?? result;
  }
  try {
    await launch();
    stage = "public experience does not grant classroom admission";
    const publicTrial = await fetch(base + "/try", { signal: AbortSignal.timeout(20000) });
    assert.equal(publicTrial.status, 200);
    assert.match(await publicTrial.text(), /三分鐘操作體驗/);
    assert.equal(publicTrial.headers.getSetCookie().length, 0);
    for (const path of ["/api/admin/setup", "/api/tape", "/api/download/offline", "/_serverFn/public-trial-probe"])
      assert.equal((await request(path)).status, 403, path + " must remain gated after public trial access");
    assert.equal((await request("/api/gate")).body.ok, false);
    assert.equal((await request("/api/auth/get-session")).body, null);
    t.diagnostic("HTTP public trial: readable without admission; classroom APIs and downloads remain gated");
    stage = "gate origin, forgery and password";
    assert.equal((await request("/api/gate")).body.ok, false);
    assert.equal((await request("/api/auth/get-session")).body, null);
    assert.equal((await request("/api/admin/setup", { headers: { cookie: "__Host-classroom_gate=forged" } })).status, 403);
    assert.equal((await request("/api/gate", { method: "POST", data: { password: entryCode }, headers: { origin: "https://attacker.invalid" } })).status, 403);
    assert.equal((await request("/api/gate", { method: "POST", data: { password: "incorrect-code" } })).status, 401);
    const owner = new Map();
    const admitted = await request("/api/gate", { method: "POST", data: { password: entryCode }, jar: owner });
    assert.equal(admitted.status, 200);
    assert.ok(admitted.headers.getSetCookie().every(value => /HttpOnly/.test(value) && /Secure/.test(value)));
    assert.equal((await request("/api/gate", { jar: owner })).body.ok, true);
    t.diagnostic("HTTP gate: incorrect password, forged cookie and foreign origin rejected");
    stage = "reserved email and bootstrap";
    const reserved = await request("/api/auth/sign-up/email", { method: "POST", data: { email: ownerEmail, password, name: "Reserved attempt" }, jar: owner });
    assert.equal(reserved.status, 403, "Reserved owner email must not be registered publicly");
    assert.equal((await request("/api/admin/setup", { jar: owner })).body.available, true);
    const setupBody = { name: "Fixture owner", email: ownerEmail, password, token, acceptTos: true };
    assert.equal((await request("/api/admin/setup", { method: "POST", jar: owner, data: { ...setupBody, token: randomBytes(32).toString("hex") } })).status, 400);
    assert.equal((await request("/api/admin/setup", { method: "POST", jar: owner, data: setupBody })).status, 200);
    assert.equal((await request("/api/admin/setup", { method: "POST", jar: owner, data: setupBody })).status, 400);
    assert.equal((await request("/api/admin/setup", { jar: owner })).body.available, false);
    stage = "owner sign in and teacher server function";
    assert.equal((await request("/api/auth/sign-in/email", { method: "POST", jar: owner, data: { email: ownerEmail, password } })).status, 200);
    const ownerSession = (await request("/api/auth/get-session", { jar: owner })).body;
    assert.equal(ownerSession.user.emailVerified, true);
    assert.equal(ownerSession.user.email, ownerEmail);
    const ownerId = ownerSession.user.id;
    const roster = await serverFn("loadTeacherRoster", "GET", undefined, owner);
    assert.equal(roster.ok, true);
    t.diagnostic("HTTP owner bootstrap: reserved signup rejected; setup single-use; verified owner signs in and reads own roster");
    stage = "unverified student privilege";
    const student = new Map([...owner].filter(([key]) => key.includes("classroom_gate")));
    assert.equal((await request("/api/auth/sign-up/email", { method: "POST", jar: student, data: { email: studentEmail, password, name: "Fixture student", emailVerified: true } })).status, 200);
    const studentSession = (await request("/api/auth/get-session", { jar: student })).body;
    assert.equal(studentSession.user.emailVerified, false);
    const profile = await serverFn("upsertMyProfile", "POST", { displayName: "Fixture student", classCode: "HTTPTEST", acceptTos: true }, student);
    assert.equal(profile.role, "student");
    assert.equal((await serverFn("loadTeacherRoster", "GET", undefined, student)).ok, false);
    await assert.rejects(serverFn("upsertMyProfile", "POST", { displayName: "Fixture student", classCode: "TEACHER", acceptTos: true }, student));
    t.diagnostic("HTTP student: claiming verified status or teacher code cannot grant teacher privilege");
    stage = "gate limiter";
    let last;
    for (let i = 0; i < 13; i++) last = await request("/api/gate", {
      method: "POST", data: { password: "incorrect-code" }, headers: { "cf-connecting-ip": "192.0.2.2" },
    });
    assert.equal(last.status, 429);
    stage = "graceful restart and persisted identity";
    await close();
    await launch();
    const afterRestart = (await request("/api/auth/get-session", { jar: owner })).body;
    assert.equal(afterRestart.user.id, ownerId);
    const newLogin = new Map([...owner].filter(([key]) => key.includes("classroom_gate")));
    assert.equal((await request("/api/auth/sign-in/email", { method: "POST", jar: newLogin, data: { email: ownerEmail, password } })).status, 200);
    assert.equal((await request("/api/auth/get-session", { jar: newLogin })).body.user.id, ownerId);
    assert.equal((await request("/api/admin/setup", { jar: newLogin })).body.available, false);
    assert.equal((await request("/api/admin/setup", { method: "POST", jar: newLogin, data: setupBody })).status, 400);
    t.diagnostic("HTTP restart: prior session, password login, teacher identity and consumed bootstrap marker survived");
    for (const secret of [password, entryCode, token, env.BETTER_AUTH_SECRET, ...owner.values()])
      assert.equal(childLog.includes(secret), false, "Child logs must not contain generated credentials");
  } catch (error) {
    t.diagnostic("Failure stage: " + stage);
    throw error;
  } finally {
    await close();
    if (resolve(runtime).startsWith(resolve(tmpdir()) + sep) && dirname(env.PGLITE_DATA_DIR) === runtime)
      await rm(runtime, { recursive: true, force: true });
  }
});
