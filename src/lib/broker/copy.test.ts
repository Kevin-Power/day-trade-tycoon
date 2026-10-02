import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANCEL_FAILED_REASON,
  LIVE_ADAPTER_UNWIRED_REASON,
  LIVE_UNWIRED_REASON,
  SIM_ROD_ONLY_REASON,
  rejectUnsupportedTif,
  simAllowsTif,
} from "./copy.ts";

describe("classroom broker copy", () => {
  it("tells students 實盤 will not reach a broker", () => {
    assert.match(LIVE_UNWIRED_REASON, /不會送到券商/);
    assert.match(LIVE_UNWIRED_REASON, /模擬撮合/);
    assert.equal(LIVE_UNWIRED_REASON.includes("即可切換"), false);
    assert.equal(LIVE_UNWIRED_REASON.includes("只換 adapter"), false);
  });

  it("keeps adapter wording off the ticket toast", () => {
    assert.match(LIVE_ADAPTER_UNWIRED_REASON, /adapter/);
    assert.notEqual(LIVE_ADAPTER_UNWIRED_REASON, LIVE_UNWIRED_REASON);
  });

  it("accepts supported simulation time-in-force values and rejects unknown values", () => {
    assert.equal(simAllowsTif("ROD"), true);
    assert.equal(simAllowsTif("IOC"), true);
    assert.equal(simAllowsTif("FOK"), true);
    assert.equal(rejectUnsupportedTif("ROD"), null);
    assert.equal(rejectUnsupportedTif("IOC"), null);
    assert.equal(rejectUnsupportedTif("FOK"), null);
    assert.equal(rejectUnsupportedTif("INVALID" as "ROD"), SIM_ROD_ONLY_REASON);
    assert.match(SIM_ROD_ONLY_REASON, /ROD、IOC、FOK/);
  });

  it("explains a failed cancel instead of staying silent", () => {
    assert.match(CANCEL_FAILED_REASON, /無法刪單/);
  });
});
