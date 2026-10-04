import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
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
  const inquiryInput = {
    requestId: randomUUID(), name: "模擬詢問測試者", contactType: "email",
    contact: "qa-inquiry@example.invalid", device: "phone", support: "step-by-step",
    question: "隔離測試：想了解手機操作教學安排。", consent: true, website: "",
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
    for (const name of ["loadMyCareer", "loadTeacherRoster", "upsertMyProfile", "saveClassroomSession", "loadTeacherSessionDetail", "loadSessionFeedback", "addSessionFeedback"]) {
      const match = text.match(new RegExp("var " + name + " = [\\s\\S]*?createSsrRpc\\(\"([a-f0-9]+)\"\\)"));
      if (match) functionIds[name] = match[1];
    }
  }
  async function serverFn(name, method, data, jar, extraHeaders = {}) {
    assert.ok(functionIds[name], "Built server function must be discoverable: " + name);
    const headers = new Headers({ "origin": canonicalOrigin, "sec-fetch-site": "same-origin",
      "x-tsr-serverFn": "true", "accept": "application/json", "content-type": "application/json", ...extraHeaders });
    headers.set("cookie", [...jar].map(([key, value]) => key + "=" + value).join("; "));
    const payload = data === undefined ? undefined : JSON.stringify(await toJSONAsync({ data }));
    const query = method === "GET" && payload !== undefined ? "?payload=" + encodeURIComponent(payload) : "";
    const response = await fetch(base + "/_serverFn/" + functionIds[name] + query, {
      method, headers, body: method === "GET" ? undefined : payload, signal: AbortSignal.timeout(20000),
    });
    absorb(jar, response);
    if (!response.ok) {
      throw Object.assign(new Error("Server function " + name + " returned HTTP " + response.status), { httpStatus: response.status });
    }
    const responsePayload = await response.json();
    const result = response.headers.get("x-tss-serialized") ? fromCrossJSON(responsePayload, { plugins: [] }) : responsePayload;
    if (result?.error) throw result.error;
    return result && Object.hasOwn(result, "result") ? result.result : result;
  }
  try {
    await launch();
    stage = "public experience does not grant classroom admission";
    const publicTrial = await fetch(base + "/try", { signal: AbortSignal.timeout(20000) });
    assert.equal(publicTrial.status, 200);
    assert.match(await publicTrial.text(), /免費操作體驗/);
    assert.equal(publicTrial.headers.getSetCookie().length, 0);
    for (const path of ["/api/admin/setup", "/api/tape", "/api/download/offline", "/_serverFn/public-trial-probe"])
      assert.equal((await request(path)).status, 403, path + " must remain gated after public trial access");
    assert.equal((await request("/api/gate")).body.ok, false);
    assert.equal((await request("/api/auth/get-session")).body, null);
    assert.equal((await request("/api/course-inquiries", { method: "POST", data: inquiryInput,
      headers: { "cf-connecting-ip": "192.0.2.30" } })).status, 503,
      "Uninitialized classrooms must not collect inquiries without an owner");
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
    stage = "teacher read-only classroom review";
    const fixtureReview = {
      rec: { id: "http-teacher-review", scenarioId: "wed-open", scenarioName: "Fixture lesson", endedAt: 1, pnl: 0, pnlPct: 0, trades: 0, wins: 0, fees: 0, maxDrawdown: 0, grade: "C", title: "Fixture lesson" },
      verdicts: [], fills: [], code: "2330", capital: 1000000, equity: 1000000, sessionLabel: "Fixture classroom",
      openPositionsAtEnd: [{ code: "2330", lots: 1, last: 100 }],
      firstTradePlan: {
        plan: { version: 1, code: "2330", side: "buy", lots: 1, simTime: 120, entryCondition: "觀察後確認自己的進場條件", exitCondition: "進場理由不成立時離場", maxLoss: 1000 },
        order: { id: "http-order-1", code: "2330", side: "buy", type: "limit", lots: 1, price: 100, time: 180, tif: "IOC" },
      },
    };
    await assert.rejects(serverFn("saveClassroomSession", "POST", { ...fixtureReview, expectedUserId: ownerId }, student), "Cookie account must match captured practice owner");
    await assert.rejects(serverFn("saveClassroomSession", "POST", fixtureReview, student), "Saving must include the captured owner");
    assert.equal((await serverFn("loadMyCareer", "GET", undefined, student)).count, 0);
    assert.equal((await serverFn("saveClassroomSession", "POST", { ...fixtureReview, expectedUserId: studentSession.user.id }, student)).ok, true);
    const beforeFeedback = await serverFn("loadMyCareer", "GET", undefined, student);
    assert.equal(beforeFeedback.count, 1);
    assert.equal(beforeFeedback.sessions[0].feedback_count, 0);
    assert.equal(beforeFeedback.sessions[0].last_feedback_at, null);
    assert.equal((await serverFn("loadMyCareer", "GET", undefined, owner)).count, 0, "Personal history must not include another account");
    assert.equal((await serverFn("loadTeacherRoster", "GET", undefined, owner)).sessions[0].feedback_count, 0);
    const teacherDetail = await serverFn("loadTeacherSessionDetail", "GET", { id: fixtureReview.rec.id }, owner);
    assert.deepEqual(teacherDetail.bundle, fixtureReview);
    assert.equal(teacherDetail.studentName, "Fixture student");
    await assert.rejects(serverFn("loadTeacherSessionDetail", "GET", { id: fixtureReview.rec.id }, student));
    const gateOnly = new Map([...owner].filter(([key]) => key.includes("classroom_gate")));
    await assert.rejects(serverFn("loadTeacherSessionDetail", "GET", { id: fixtureReview.rec.id }, gateOnly));
    assert.equal(await serverFn("loadTeacherSessionDetail", "GET", { id: "unknown-record" }, owner), null);
    t.diagnostic("HTTP teacher review: first-trade plan, TIF and unclosed-position snapshot survive student save and same-class teacher read; unverified student and gate-only visitor denied");
    stage = "course inquiry public submission and owner-only inbox";
    const inquiryHeaders = { "cf-connecting-ip": "192.0.2.31" };
    for (const path of ["/api/course-inquiries", "/api/course-inquiries/other"])
      assert.equal((await request(path)).status, 403, "Public submission must not expose an inbox");
    for (const jar of [new Map(), gateOnly, student]) {
      assert.ok([401, 403].includes((await request("/api/course-inquiries", { jar })).status));
      assert.ok([401, 403].includes((await request("/api/course-inquiries", {
        method: "PATCH", jar, data: { id: inquiryInput.requestId, status: "handled" },
      })).status));
    }
    for (const origin of ["", "https://attacker.invalid"]) {
      assert.equal((await request("/api/course-inquiries", { method: "POST", data: inquiryInput,
        headers: { ...inquiryHeaders, origin } })).status, 403);
    }
    const wrongType = await fetch(base + "/api/course-inquiries", {
      method: "POST", headers: { origin: canonicalOrigin, "content-type": "text/plain", "cf-connecting-ip": "192.0.2.32" },
      body: JSON.stringify(inquiryInput), signal: AbortSignal.timeout(10000),
    });
    assert.equal(wrongType.status, 415);
    const oversized = await fetch(base + "/api/course-inquiries", {
      method: "POST", headers: { origin: canonicalOrigin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.33" },
      body: JSON.stringify({ ...inquiryInput, question: "a".repeat(9000) }), signal: AbortSignal.timeout(10000),
    });
    assert.equal(oversized.status, 413);
    let badAddress = 40;
    for (const invalid of [{ consent: false }, { website: "bot.invalid" }, { question: " " },
      { contact: "not-an-email" }, { device: "invalid" }, { status: "handled" }]) {
      const rejected = await request("/api/course-inquiries", { method: "POST", data: { ...inquiryInput, ...invalid },
        headers: { "cf-connecting-ip": `192.0.2.${badAddress++}` } });
      assert.equal(rejected.status, 400);
      assert.equal(JSON.stringify(rejected.body).includes(inquiryInput.contact), false);
    }
    assert.equal((await request("/api/course-inquiries", { jar: owner })).body.total, 0);
    const createdInquiry = await request("/api/course-inquiries", { method: "POST", data: inquiryInput, headers: inquiryHeaders });
    assert.ok([200, 201].includes(createdInquiry.status));
    assert.equal(createdInquiry.body.ok, true);
    assert.deepEqual(Object.keys(createdInquiry.body).sort(), ["id", "ok"]);
    assert.equal(createdInquiry.headers.getSetCookie().length, 0, "Inquiry submission does not grant classroom admission");
    assert.match(createdInquiry.headers.get("cache-control"), /no-store/);
    const inquiryId = createdInquiry.body.id;
    for (const retry of await Promise.all([1, 2].map(() => request("/api/course-inquiries", {
      method: "POST", data: inquiryInput, headers: inquiryHeaders,
    })))) assert.deepEqual(retry.body, createdInquiry.body);
    const conflict = await request("/api/course-inquiries", { method: "POST", headers: inquiryHeaders,
      data: { ...inquiryInput, question: "改寫已送出內容" } });
    assert.equal(conflict.status, 409);
    assert.equal(JSON.stringify(conflict.body).includes(inquiryInput.question), false);
    assert.equal((await request("/api/gate")).body.ok, false);
    assert.equal((await request("/api/course-inquiries", { jar: owner })).body.total, 1);
    for (let i = 0; i < 20; i++) {
      const saved = await request("/api/course-inquiries", { method: "POST", headers: { "cf-connecting-ip": `198.51.100.${i + 1}` },
        data: { ...inquiryInput, requestId: randomUUID(), name: `隔離分頁測試 ${i + 1}` } });
      assert.ok([200, 201].includes(saved.status));
    }
    const inquiryPage = await request("/api/course-inquiries?status=all&offset=0", { jar: owner });
    assert.equal(inquiryPage.body.items.length, 20);
    assert.equal(inquiryPage.body.total, 21);
    assert.equal(inquiryPage.body.hasMore, true);
    assert.match(inquiryPage.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Object.keys(inquiryPage.body.items[0]).sort(),
      ["id", "name", "contactType", "contact", "device", "support", "question", "status", "createdAt"].sort());
    const lastInquiryPage = (await request("/api/course-inquiries?status=all&offset=20", { jar: owner })).body;
    assert.equal(lastInquiryPage.items.length, 1);
    assert.equal(lastInquiryPage.hasMore, false);
    assert.equal(new Set([...inquiryPage.body.items, ...lastInquiryPage.items].map(item => item.id)).size, 21);
    for (const query of ["status=unknown", "offset=-1", "offset=1.2"])
      assert.equal((await request("/api/course-inquiries?" + query, { jar: owner })).status, 400);
    const inquiryUpdate = { id: inquiryId, status: "handled" };
    assert.equal((await request("/api/course-inquiries", { method: "PATCH", jar: owner, data: inquiryUpdate,
      headers: { origin: "https://attacker.invalid" } })).status, 403);
    assert.equal((await request("/api/course-inquiries", { method: "PATCH", jar: owner, data: inquiryUpdate })).status, 200);
    const handledInquiry = (await request("/api/course-inquiries?status=handled", { jar: owner })).body;
    assert.equal(handledInquiry.total, 1);
    assert.equal(handledInquiry.items[0].id, inquiryId);
    assert.equal(handledInquiry.items[0].question, inquiryInput.question);
    assert.equal((await request("/api/course-inquiries?status=new", { jar: owner })).body.total, 20);
    for (let i = 0; i < 5; i++) assert.equal((await request("/api/course-inquiries", { method: "POST", data: inquiryInput,
      headers: { "cf-connecting-ip": "203.0.113.70" } })).status, 200);
    const throttled = await request("/api/course-inquiries", { method: "POST", data: inquiryInput,
      headers: { "cf-connecting-ip": "203.0.113.70" } });
    assert.equal(throttled.status, 429);
    assert.ok(Number(throttled.headers.get("retry-after")) > 0);
    t.diagnostic("HTTP inquiries: anonymous same-origin submit; validation and spam rejection; retry without duplicates; owner-only inbox, pagination and handling status; no admission or messages granted");
    stage = "teacher feedback access, identity and request idempotence";
    const feedbackInput = {
      sessionId: fixtureReview.rec.id,
      requestId: randomUUID(),
      observation: "這次有先寫進場與離場條件，首筆委託的商品、方向與張數一致。",
      nextStep: "重練同一課，對照自己寫的離場條件，再說明是否照做。",
    };
    const initialFeedbackPage = await serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, student);
    assert.deepEqual(initialFeedbackPage, { items: [], nextCursor: null });
    for (const jar of [student, gateOnly]) {
      await assert.rejects(serverFn("addSessionFeedback", "POST", feedbackInput, jar));
    }
    await assert.rejects(serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, gateOnly));
    await assert.rejects(serverFn("addSessionFeedback", "POST", feedbackInput, new Map()), { httpStatus: 403 });
    await assert.rejects(serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, new Map()), { httpStatus: 403 });
    assert.deepEqual(await serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, student),
      { items: [], nextCursor: null }, "rejected student and visitor writes must not create any feedback");
    t.diagnostic("HTTP feedback denial: no-gate GET/POST return 403; all rejected writes leave the feedback list empty");
    const feedback = await serverFn("addSessionFeedback", "POST", feedbackInput, owner);
    assert.match(feedback.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(feedback.sessionId, fixtureReview.rec.id);
    assert.equal(feedback.authorName, ownerSession.user.name);
    assert.equal(feedback.observation, feedbackInput.observation);
    assert.equal(feedback.nextStep, feedbackInput.nextStep);
    assert.equal(Number.isFinite(Date.parse(feedback.createdAt)), true);
    assert.deepEqual(Object.keys(feedback).sort(), ["id", "sessionId", "authorName", "observation", "nextStep", "createdAt"].sort());
    const retry = await serverFn("addSessionFeedback", "POST", feedbackInput, owner);
    assert.deepEqual(retry, feedback, "same request and content must return the original note, author and timestamp");
    const concurrentRetries = await Promise.all([
      serverFn("addSessionFeedback", "POST", feedbackInput, owner),
      serverFn("addSessionFeedback", "POST", feedbackInput, owner),
    ]);
    for (const duplicate of concurrentRetries) assert.deepEqual(duplicate, feedback);
    await assert.rejects(serverFn("addSessionFeedback", "POST", { ...feedbackInput, observation: "同一個 requestId 不得改寫已保存原文。" }, owner));
    await assert.rejects(serverFn("addSessionFeedback", "POST", { ...feedbackInput, nextStep: "同一個 requestId 不得改成另一項練習。" }, owner));
    for (const identityClaim of [
      { authorId: studentSession.user.id },
      { authorName: "Forged teacher" },
      { role: "teacher" },
      { createdAt: "1970-01-01T00:00:00.000Z" },
    ]) {
      await assert.rejects(serverFn("addSessionFeedback", "POST", { ...feedbackInput, requestId: randomUUID(), ...identityClaim }, owner));
    }
    await assert.rejects(serverFn("addSessionFeedback", "POST", { ...feedbackInput, requestId: randomUUID(), authorId: ownerId, role: "teacher" }, student));
    for (const invalidContent of [
      { observation: " " }, { observation: "字".repeat(601) },
      { nextStep: " " }, { nextStep: "字".repeat(301) },
      { requestId: "not-a-uuid" },
    ]) {
      await assert.rejects(serverFn("addSessionFeedback", "POST", { ...feedbackInput, requestId: randomUUID(), ...invalidContent }, owner));
    }
    const foreignHeaders = { origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" };
    await assert.rejects(serverFn("addSessionFeedback", "POST", { ...feedbackInput, requestId: randomUUID() }, owner, foreignHeaders));
    await assert.rejects(serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, student, foreignHeaders));
    const studentCareer = await serverFn("loadMyCareer", "GET", undefined, student);
    const rosterAfterFeedback = await serverFn("loadTeacherRoster", "GET", undefined, owner);
    assert.equal(studentCareer.sessions[0].feedback_count, 1);
    assert.match(studentCareer.sessions[0].last_feedback_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(rosterAfterFeedback.sessions[0].feedback_count, 1);
    assert.equal(rosterAfterFeedback.sessions[0].last_feedback_at, studentCareer.sessions[0].last_feedback_at);
    await assert.rejects(serverFn("loadMyCareer", "GET", undefined, gateOnly));
    const expectedFeedbackPage = { items: [feedback], nextCursor: null };
    assert.deepEqual(await serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, student), expectedFeedbackPage);
    assert.deepEqual(await serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, owner), expectedFeedbackPage);
    assert.deepEqual(await serverFn("loadSessionFeedback", "GET", {
      sessionId: fixtureReview.rec.id, before: { createdAt: feedback.createdAt, id: feedback.id },
    }, student), { items: [], nextCursor: null }, "the original precise timestamp/id cursor must exclude the note itself");
    assert.deepEqual((await serverFn("loadTeacherSessionDetail", "GET", { id: fixtureReview.rec.id }, owner)).bundle, fixtureReview,
      "adding or retrying feedback must never rewrite the student's saved review");
    t.diagnostic("HTTP feedback: teacher writes; student reads; student/visitor writes, visitor reads, forged author/role, invalid content and foreign origin rejected; retries keep one immutable note and preserve the review");
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
    assert.deepEqual(await serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, student), expectedFeedbackPage);
    assert.deepEqual(await serverFn("loadSessionFeedback", "GET", { sessionId: fixtureReview.rec.id }, newLogin), expectedFeedbackPage);
    assert.deepEqual(await serverFn("addSessionFeedback", "POST", feedbackInput, newLogin), feedback,
      "a request retried after restart must resolve to its original saved note");
    assert.deepEqual((await serverFn("loadTeacherSessionDetail", "GET", { id: fixtureReview.rec.id }, newLogin)).bundle, fixtureReview);
    t.diagnostic("HTTP restart: prior session, password login, teacher identity and consumed bootstrap marker survived");
    assert.equal((await serverFn("loadMyCareer", "GET", undefined, student)).sessions[0].feedback_count, 1);
    assert.equal((await serverFn("loadTeacherRoster", "GET", undefined, newLogin)).sessions[0].feedback_count, 1);
    t.diagnostic("HTTP feedback restart: teacher/student reads, feedback indexes and same-request retry recover the exact original note; review remains unchanged");
    const persistedInquiries = (await request("/api/course-inquiries?status=handled", { jar: newLogin })).body;
    assert.deepEqual(persistedInquiries, handledInquiry, "Inquiry content and handled status must survive restart");
    assert.deepEqual((await request("/api/course-inquiries", { method: "POST", data: inquiryInput,
      headers: { "cf-connecting-ip": "192.0.2.31" } })).body, createdInquiry.body);
    assert.equal((await request("/api/course-inquiries?status=all", { jar: newLogin })).body.total, 21);
    for (const privateValue of [inquiryInput.contact, inquiryInput.question])
      assert.equal(childLog.includes(privateValue), false, "Inquiry personal data must not appear in app logs");
    t.diagnostic("HTTP inquiry restart: original submission and handling status persist; public retry returns only receipt id");
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
