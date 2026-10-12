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

test("packaged local production requires explicit and consistent loopback settings", () => {
  const local = {
    NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://127.0.0.1:18787", CLASSROOM_LOCAL_ONLY: "true",
    HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: "18787", NITRO_PORT: "18787",
    CLASSROOM_AUTH_ENABLED: "true", CLASSROOM_TRUST_PROXY: "false",
  };
  assert.equal(readAuthConfig(local).secure, false);
  assert.equal(readAuthConfig(local).trustProxy, false);
  for (const override of [
    { HOST: "0.0.0.0" }, { NITRO_HOST: "::" }, { NITRO_HOST: "" },
    { PORT: "8787" }, { NITRO_PORT: "8787" }, { CLASSROOM_TRUST_PROXY: "true" },
    { BETTER_AUTH_URL: "http://192.168.1.20:18787" },
    { BETTER_AUTH_URL: "http://localhost:18787" }, { DATABASE_URL: "postgres://example.invalid/db" },
  ]) assert.throws(() => readAuthConfig({ ...local, ...override }), /CLASSROOM_LOCAL_ONLY/);
  assert.throws(() => readAuthConfig({ ...local, BETTER_AUTH_SECRET: "" }), /BETTER_AUTH_SECRET/);
  assert.throws(() => readAuthConfig({ ...local, CLASSROOM_AUTH_ENABLED: "false" }), /cannot be disabled/);
  assert.throws(() => readAuthConfig({ ...local, CLASSROOM_LOCAL_ONLY: "false" }), /HTTPS/);
});
