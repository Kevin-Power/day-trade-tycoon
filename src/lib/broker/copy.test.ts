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

  it("rejects IOC/FOK on sim with the same sentence the ticket toasts", () => {
    assert.equal(simAllowsTif("ROD"), true);
    assert.equal(simAllowsTif("IOC"), false);
    assert.equal(simAllowsTif("FOK"), false);
    assert.equal(rejectUnsupportedTif("ROD"), null);
    assert.equal(rejectUnsupportedTif("IOC"), SIM_ROD_ONLY_REASON);
    assert.equal(rejectUnsupportedTif("FOK"), SIM_ROD_ONLY_REASON);
    assert.match(SIM_ROD_ONLY_REASON, /僅支援 ROD/);
  });

  it("explains a failed cancel instead of staying silent", () => {
    assert.match(CANCEL_FAILED_REASON, /無法刪單/);
  });
});
