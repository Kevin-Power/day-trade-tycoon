import test from "node:test";
import assert from "node:assert/strict";
import { loginHref, safeNextPath } from "./safe-next.ts";

test("keeps in-site paths with their query", () => {
  assert.equal(safeNextPath("/morning?panel=trade"), "/morning?panel=trade");
  assert.equal(safeNextPath("/"), "/");
});

test("rejects loops, encoded and backslash tricks", () => {
  for (const value of ["//evil.test", "/\\evil.test", "https://evil.test", "", " /morning", "/login", "/login?next=/",
    "/%2F%2Fevil.test", "/%5Cevil.test", "/morning\\x", "/morning\n", undefined, 42, "/" + "a".repeat(600)])
    assert.equal(safeNextPath(value), "/", String(value));
});

test("builds a sign-up link that returns to practice", () => {
  assert.equal(loginHref({ next: "/morning?panel=trade", mode: "up" }), "/login?mode=up&next=%2Fmorning%3Fpanel%3Dtrade");
  assert.equal(loginHref({ next: "//evil" }), "/login?next=%2F");
});
