import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GATE_PUBLIC_PATHS, isGatePublicPath } from "./public-path.ts";

describe("gate public paths", () => {
  it("lets buyers read /license without the classroom password", () => {
    assert.deepEqual([...GATE_PUBLIC_PATHS], ["/license"]);
    assert.equal(isGatePublicPath("/license"), true);
  });

  it("keeps the lobby, manual, and desk behind the gate", () => {
    assert.equal(isGatePublicPath("/"), false);
    assert.equal(isGatePublicPath("/manual"), false);
    assert.equal(isGatePublicPath("/license/extra"), false);
  });
});
