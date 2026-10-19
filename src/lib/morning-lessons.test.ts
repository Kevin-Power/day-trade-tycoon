import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { getMorningSource, morningCatalog, morningLessons, morningSources, selectMorningSource } from "./morning-data.server.ts";

test("lesson selection accepts exactly one approved identifier and preserves the original default", () => {
  assert.deepEqual(morningSources.map(source => source.catalog.date), ["2026-10-05", "2026-10-06"]);
  assert.equal(getMorningSource().catalog.date, "2026-10-06");
  assert.equal(selectMorningSource(new URLSearchParams()).catalog.lessonId, morningCatalog.lessonId);
  assert.equal(new Set(morningSources.map(source => source.catalog.lessonId)).size, morningSources.length);
  for (const source of morningSources) {
    assert.equal(getMorningSource(source.catalog.lessonId), source);
    assert.equal(selectMorningSource(new URLSearchParams({ lesson: source.catalog.lessonId })), source);
    assert.match(source.catalog.lessonId, /^morning-\d{8}-v1-[a-f0-9]{12}$/);
  }
  for (const value of ["", "2026-10-06", "morning-20261007", "__proto__", "../../server/data/morning-2026-10-06.json"])
    assert.throws(() => getMorningSource(value), { status: 400 });
  for (const value of ["lesson=", "date=2026-10-06", "lesson=unknown", "lesson=x&lesson=x", "lesson=x&cursor=90", "cursor=90"])
    assert.throws(() => selectMorningSource(new URLSearchParams(value)), { status: 400 });
  const approved = morningCatalog.lessonId;
  assert.throws(() => selectMorningSource(new URLSearchParams(`lesson=${approved}&lesson=${approved}`)), { status: 400 });
  assert.throws(() => selectMorningSource(new URLSearchParams(`lesson=${approved}&cursor=90`)), { status: 400 });
});

test("available lesson summaries disclose metadata only, never bars, prices or market context", () => {
  assert.equal(morningLessons.length, morningSources.length);
  for (const lesson of morningLessons) {
    assert.deepEqual(Object.keys(lesson).sort(), ["date", "end", "lessonId", "maxCursor", "start", "symbols", "title"]);
    assert.equal(lesson.start, "09:00"); assert.equal(lesson.end, "10:30"); assert.equal(lesson.maxCursor, 90);
    assert.equal(lesson.symbols.length, 5);
    for (const symbol of lesson.symbols) assert.deepEqual(Object.keys(symbol).sort(), ["code", "name"]);
    const source = getMorningSource(lesson.lessonId);
    assert.notEqual(lesson.symbols, source.catalog.symbols);
    assert.ok(lesson.symbols.every((symbol, index) => symbol !== source.catalog.symbols[index]));
  }
  assert.equal(morningLessons.some(lesson => lesson.date === "2026-10-07" || lesson.date === "2026-10-02"), false,
    "Dates with known null minutes must not become selectable by fallback");
});

test("every lesson's notices say each revealed minute is replayed with simulated trades", () => {
  for (const source of morningSources) {
    const notices = source.catalog.notices.join("\n");
    assert.match(notices, /模擬逐筆/, `${source.catalog.date} notices must disclose the simulated replay`);
    assert.doesNotMatch(notices, /沒有合成逐筆/, `${source.catalog.date} notices must not deny the simulated replay`);
  }
});

test("notice edits never change a lesson's identity or its real minute bars", () => {
  // Pinned when the notices were revised (2026-10-20); a change here is a data change, not a copy edit.
  const pinned: Record<string, [string, string]> = {
    "2026-10-05": ["morning-20261005-v1-bd566804b809", "c479585230c4991749abb220b40105e7bc124f9c7869b8511a4169438b859750"],
    "2026-10-06": ["morning-20261006-v1-ce4a95ce69f1", "dccfb8587e20f24045cbcf324965ce967cc7a8eff7c9abf288551c33cc9f9525"],
  };
  for (const source of morningSources) {
    const [lessonId, barsSha256] = pinned[source.catalog.date];
    assert.equal(source.catalog.lessonId, lessonId);
    assert.equal(createHash("sha256").update(JSON.stringify(source.bars)).digest("hex"), barsSha256);
  }
});
