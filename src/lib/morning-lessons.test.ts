import assert from "node:assert/strict";
import test from "node:test";
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
