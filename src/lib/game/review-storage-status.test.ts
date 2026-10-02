import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewSaveMessage } from "./review-storage-status.ts";

test("only verified local or server writes claim a saved review", () => {
  for (const status of ["local", "saving", "failed", "too-large"] as const) {
    const unsaved = reviewSaveMessage(status, false);
    assert.match(unsaved, /尚未保存/);
    assert.match(unsaved, /重新整理或關閉頁面後會遺失/);
    assert.doesNotMatch(unsaved, /已保存|已儲存/);
    assert.match(reviewSaveMessage(status, true), /完整復盤已保存在這台裝置/);
  }
  assert.match(reviewSaveMessage("saved", false), /已儲存至教室主機/);
  assert.match(reviewSaveMessage("too-large", true), /5,000.*未存入教室主機/);
});
