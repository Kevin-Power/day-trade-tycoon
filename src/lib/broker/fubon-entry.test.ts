import { test } from "node:test";
import assert from "node:assert/strict";
import { fubonEntryAllowed } from "./fubon-entry.ts";

function deps(role: string | null | Error, probe: boolean | Error = true) {
  const calls: string[] = [];
  return {
    calls,
    loadRole: async () => {
      calls.push("role");
      if (role instanceof Error) throw role;
      return role;
    },
    probe: async () => {
      calls.push("probe");
      if (probe instanceof Error) throw probe;
      return probe;
    },
  };
}

test("guests and signed-out visitors never ask anything", async () => {
  const d = deps("teacher");
  assert.equal(await fubonEntryAllowed({ signedIn: false, ...d }), false);
  assert.deepEqual(d.calls, []);
});

test("a student reads only their own role and never touches the broker route", async () => {
  const d = deps("student");
  assert.equal(await fubonEntryAllowed({ signedIn: true, ...d }), false);
  assert.deepEqual(d.calls, ["role"]);
});

test("a teacher asks the owner check once and sees the entry only when it allows", async () => {
  const allowed = deps("teacher", true);
  assert.equal(await fubonEntryAllowed({ signedIn: true, ...allowed }), true);
  assert.deepEqual(allowed.calls, ["role", "probe"]);
  const refused = deps("teacher", false);
  assert.equal(await fubonEntryAllowed({ signedIn: true, ...refused }), false);
});

test("a missing profile or a failed request hides the entry instead of throwing", async () => {
  const missing = deps(null);
  assert.equal(await fubonEntryAllowed({ signedIn: true, ...missing }), false);
  assert.deepEqual(missing.calls, ["role"]);
  for (const d of [deps(new Error("offline")), deps("teacher", new Error("offline"))])
    assert.equal(await fubonEntryAllowed({ signedIn: true, ...d }), false);
});
