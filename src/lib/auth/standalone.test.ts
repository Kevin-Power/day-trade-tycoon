import test from "node:test";
import assert from "node:assert/strict";
import { readAuthConfig } from "./config.server.ts";

test("production rejects ephemeral secrets, missing HTTPS origin, and disabled identity", () => {
  assert.throws(() => readAuthConfig({ NODE_ENV: "production" }), /BETTER_AUTH_SECRET/);
  const base = { NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "https://classroom.example" };
  assert.equal(readAuthConfig(base).origin, "https://classroom.example");
  assert.throws(() => readAuthConfig({ ...base, BETTER_AUTH_URL: "" }), /BETTER_AUTH_URL/);
  assert.throws(() => readAuthConfig({ ...base, BETTER_AUTH_URL: "http://localhost:8080" }), /HTTPS/);
  assert.throws(() => readAuthConfig({ ...base, VITE_AUTH_ENABLED: "false" }), /cannot be disabled/);
  assert.throws(() => readAuthConfig({ ...base, BETTER_AUTH_URL: "https://user:password@classroom.example" }), /canonical/);
});
test("development allows only loopback HTTP and keeps one process secret", () => {
  const one = readAuthConfig({ NODE_ENV: "development" });
  const two = readAuthConfig({ NODE_ENV: "development" });
  assert.equal(one.secret, two.secret);
  assert.equal(one.secure, false);
  assert.throws(() => readAuthConfig({ NODE_ENV: "development", BETTER_AUTH_URL: "http://classroom.example" }), /HTTPS/);
});
