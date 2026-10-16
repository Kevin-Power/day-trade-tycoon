import test from "node:test";
import assert from "node:assert/strict";
import { openingRevealDelay, OPENING_REVEAL_MS } from "./opening-reveal.ts";
import { MORNING_ADVANCE_INTERVAL } from "./morning-engine.ts";

test("the 09:00 reveal waits a full server interval after the start reply, whatever the phone clock says", () => {
  // The server sets nextAdvanceAt = its own time + interval before replying, so waiting a full
  // interval (plus margin) from receiving the reply is always late enough; nextAdvanceAt is not used.
  assert.ok(OPENING_REVEAL_MS > MORNING_ADVANCE_INTERVAL);
  assert.equal(openingRevealDelay(10_000, 10_000), OPENING_REVEAL_MS);
  assert.equal(openingRevealDelay(10_000, 10_400), OPENING_REVEAL_MS - 400);
  assert.equal(openingRevealDelay(10_000, 20_000), 0);
});
