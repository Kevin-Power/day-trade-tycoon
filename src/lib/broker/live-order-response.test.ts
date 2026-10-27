import { test } from "node:test";
import assert from "node:assert/strict";
import { liveOrderUnavailable } from "./live-order-response.ts";

test("live-order responses explicitly forbid automatic retries with or without a configured URL", () => {
  for (const configured of [false, true]) {
    const result = liveOrderUnavailable(configured);
    assert.equal(result.ok, false);
    assert.equal(result.code, "LIVE_LOCKED");
    assert.equal(result.retryable, false);
    assert.equal(result.venue, "live");
    assert.ok(result.reason);
  }
});
