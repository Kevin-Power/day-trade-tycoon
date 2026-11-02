import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GATE_PUBLIC_PATHS, isGatePublicPath } from "./public-path.ts";

describe("gate public paths", () => {
  it("lets visitors try the separate public experience and nothing else", () => {
    assert.deepEqual([...GATE_PUBLIC_PATHS], ["/try"]);
    assert.equal(isGatePublicPath("/try"), true);
  });

  it("keeps classroom, account, download and server function paths behind the gate", () => {
    for (const path of [
      "/", "/manual", "/login", "/setup", "/teacher", "/session/example/review", "/license",
      "/api", "/api/download/offline", "/api/auth/sign-in/email", "/_serverFn/try",
      "/daytrade-tycoon-offline.zip",
    ]) assert.equal(isGatePublicPath(path), false, path);
  });

  it("does not turn the public experience into a prefix or normalized-path bypass", () => {
    for (const path of [
      "/try/", "/try/extra", "/try/api/download/offline", "/try-private", "/TRY",
      "/try%2Fextra", "/try/../teacher", "/license/extra",
    ]) assert.equal(isGatePublicPath(path), false, path);
  });
});
