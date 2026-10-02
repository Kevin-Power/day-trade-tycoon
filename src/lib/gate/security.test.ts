import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createGatePasswordHash, verifyGatePassword } from "./password.server.ts";
import { checkGateSession, clearGateCookie, isProtectedGatePath, issueGateCookie } from "./session.server.ts";
import { GateRateLimiter, gateRateKey } from "./rate-limit.server.ts";
import { readLimitedJson } from "./body.server.ts";

test("server entry session rejects tampering, expiry, password rotation and browser flags", async () => {
  const original = { ...process.env };
  try {
    process.env.NODE_ENV = "test";
    process.env.BETTER_AUTH_URL = "https://classroom.example";
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    const password = randomBytes(18).toString("hex");
    const hash = await createGatePasswordHash(password);
    process.env.CLASSROOM_GATE_PASSWORD_HASH = hash;
    assert.equal(await verifyGatePassword(password, hash), true);
    assert.equal(await verifyGatePassword("not-the-entry-code", hash), false);
    const now = Date.now();
    const issued = issueGateCookie(now);
    assert.match(issued, /HttpOnly/); assert.match(issued, /Secure/);
    const cookie = issued.split(";")[0];
    assert.equal(checkGateSession(new Headers({ cookie }), now + 1000), true);
    assert.equal(checkGateSession(new Headers({ cookie: cookie.slice(0, -1) + "!" }), now), false);
    assert.equal(checkGateSession(new Headers({ cookie }), now + 9 * 60 * 60 * 1000), false);
    assert.equal(checkGateSession(new Headers({ cookie: "day-tycoon-gate-v1=1" }), now), false);
    process.env.CLASSROOM_GATE_PASSWORD_HASH = await createGatePasswordHash(randomBytes(18).toString("hex"));
    assert.equal(checkGateSession(new Headers({ cookie }), now), false);
    assert.match(clearGateCookie(), /Max-Age=0/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
test("failure buckets are bounded and do not trust arbitrary forwarded IP headers", () => {
  const limit = new GateRateLimiter(2, 100, 2);
  assert.equal(limit.take("one", 1), true);
  assert.equal(limit.take("one", 2), true);
  assert.equal(limit.take("one", 3), false);
  assert.equal(limit.take("two", 4), true);
  assert.equal(limit.take("three", 5), false);
  assert.equal(limit.take("three", 200), true);
  assert.equal(limit.size, 1);
  const trust = process.env.CLASSROOM_TRUST_PROXY;
  delete process.env.CLASSROOM_TRUST_PROXY;
  assert.equal(gateRateKey(new Headers({ "x-forwarded-for": "1.2.3.4" })), "direct-origin");
  if (trust === undefined) delete process.env.CLASSROOM_TRUST_PROXY; else process.env.CLASSROOM_TRUST_PROXY = trust;
});
test("API and offline download require entry while health and entry remain public", () => {
  for (const path of ["/api/auth/sign-up/email", "/api/tape", "/api/admin/setup", "/_serverFn/abc", "/daytrade-tycoon-offline.zip"])
    assert.equal(isProtectedGatePath(path), true, path);
  for (const path of ["/api/health", "/api/gate", "/license", "/api/auth/get-session"])
    assert.equal(isProtectedGatePath(path), false, path);
});
test("request body limit works without Content-Length", async () => {
  const small = new Request("https://classroom.example", { method: "POST", body: '{"a":1}' });
  assert.deepEqual(await readLimitedJson(small, 20), { a: 1 });
  const large = new Request("https://classroom.example", { method: "POST", body: JSON.stringify({ a: "x".repeat(100) }) });
  await assert.rejects(readLimitedJson(large, 20), /too large/);
});
