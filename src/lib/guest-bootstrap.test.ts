import test from "node:test";
import assert from "node:assert/strict";
import { GUEST_CONFIRM_DELAYS_MS, guestBootstrapStatus, nextConfirmDelay } from "./guest-bootstrap.ts";

test("a signed-in member or an existing guest is ready; loading the session is pending", () => {
  assert.equal(guestBootstrapStatus({ isPending: false, needsGuest: false, phase: "idle" }), "ready");
  assert.equal(guestBootstrapStatus({ isPending: true, needsGuest: false, phase: "idle" }), "pending");
});

test("while the guest account is created and confirmed the page waits; it fails only when told to", () => {
  for (const phase of ["idle", "signing-in", "confirming"] as const)
    assert.equal(guestBootstrapStatus({ isPending: false, needsGuest: true, phase }), "pending");
  assert.equal(guestBootstrapStatus({ isPending: false, needsGuest: true, phase: "failed" }), "failed");
});

test("after sign-in the session is read again at 1, 2 and 4 seconds, then the page offers 再試一次", () => {
  assert.deepEqual([...GUEST_CONFIRM_DELAYS_MS], [1000, 2000, 4000]);
  assert.equal(nextConfirmDelay(0), 1000);
  assert.equal(nextConfirmDelay(1), 2000);
  assert.equal(nextConfirmDelay(2), 4000);
  // Waiting ends: the learner sees a retry button instead of 「正在準備…」 forever.
  assert.equal(nextConfirmDelay(3), null);
  assert.equal(nextConfirmDelay(10), null);
});
