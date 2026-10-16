import test from "node:test";
import assert from "node:assert/strict";
import { clearLinkNoticeCookie, readLinkNotice } from "./guest-link.ts";

test("reads the one-time link notice", () => {
  assert.equal(readLinkNotice("a=1; day-tycoon-link-notice=skipped"), "skipped");
  assert.equal(readLinkNotice("day-tycoon-link-notice=failed"), "failed");
  assert.equal(readLinkNotice("day-tycoon-link-notice=other"), null);
  assert.equal(readLinkNotice(""), null);
});

test("clears the notice cookie site-wide", () => {
  assert.equal(clearLinkNoticeCookie(), "day-tycoon-link-notice=; Max-Age=0; Path=/; SameSite=Lax");
});
