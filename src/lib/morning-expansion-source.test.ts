import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyMorningAction, createMorningState, visibleMorningState, type MorningSource } from "./morning-engine.ts";
import { completedBarsInWindow } from "./market/chart-data.ts";

test("both real lesson days preserve all 900 source candles through engine and completed chart inputs", () => {
  let sourceBars = 0;
  for (const date of ["2026-10-05", "2026-10-06"]) {
    const source: MorningSource = JSON.parse(readFileSync(new URL(`../../server/data/morning-${date}.json`, import.meta.url), "utf8"));
    const original = structuredClone(source);
    let state = createMorningState(randomUUID(), { bias: "observe", focusCode: "2330", reason: "核對已完成分鐘", entry: "只依已知資料", stop: "原計畫失效即檢查" }, source, 0);
    assert.ok(Object.values(visibleMorningState(state, source).bars).every(bars => bars.length === 0));
    for (let cursor = 1; cursor <= 90; cursor++) {
      state = applyMorningAction(state, { action: "advance", requestId: randomUUID(), id: state.id, expectedRevision: state.revision }, source, cursor * 1000);
      const revealed = visibleMorningState(state, source);
      assert.equal(Object.hasOwn(state, "bars"), false, "Persisted state must not contain unrevealed source bars");
      for (const symbol of source.catalog.symbols) {
        const originalCompleted = source.bars[symbol.code].slice(0, cursor);
        assert.deepEqual(revealed.bars[symbol.code], originalCompleted);
        assert.deepEqual(completedBarsInWindow(revealed.bars[symbol.code], { start: 0, dataEnd: cursor * 60 }, 60), originalCompleted);
        assert.ok(revealed.bars[symbol.code].every(bar => bar.t + 60 <= cursor * 60));
        sourceBars++;
      }
      if (cursor === 1) state = applyMorningAction(state, { action: "order", requestId: randomUUID(), id: state.id, expectedRevision: state.revision, code: "2330", side: "buy", lots: 1 }, source, 1100);
      if (cursor === 2) assert.equal(state.fills[0].price, source.bars["2330"][1].o);
    }
    assert.deepEqual(source, original, "Replay must not rewrite source prices");
  }
  assert.equal(sourceBars, 900);
});
