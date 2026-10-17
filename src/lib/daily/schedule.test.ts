import test from "node:test";
import assert from "node:assert/strict";
import { dataDayForIssue, issueDayFor, taipeiParts, weekDates } from "./schedule.ts";

const at = (iso: string) => Date.parse(iso);
const day = (date: string, publishedAt: string, coverage = "full-market") => ({ date, coverage, symbols: 1000, publishedAt });

// This file also runs under TZ=America/New_York: none of these may depend on the process time zone.
test("weekday mornings after 06:00 issue that day; before it, the previous weekday", () => {
  assert.equal(issueDayFor(at("2026-10-19T06:00:00+08:00")), "2026-10-19");
  assert.equal(issueDayFor(at("2026-10-19T05:59:00+08:00")), "2026-10-16");
  assert.equal(issueDayFor(at("2026-10-17T12:00:00+08:00")), "2026-10-16");
  assert.equal(issueDayFor(at("2026-10-18T23:59:00+08:00")), "2026-10-16");
  assert.equal(issueDayFor(at("2026-10-20T00:30:00+08:00")), "2026-10-19");
});

test("Friday's data is issued on Monday; only full-market data published before 06:00 counts", () => {
  const days = [day("2026-10-15", "2026-10-15T18:10:00+08:00"), day("2026-10-16", "2026-10-16T18:14:17+08:00"),
    day("2026-10-19", "2026-10-19T18:00:00+08:00"), day("2026-10-14", "2026-10-14T18:00:00+08:00", "selected")];
  assert.equal(dataDayForIssue(days, "2026-10-19"), "2026-10-16");
  assert.equal(dataDayForIssue(days, "2026-10-16"), "2026-10-15");
  assert.equal(dataDayForIssue(days, "2026-10-15"), null);
  const late = [day("2026-10-15", "2026-10-15T18:10:00+08:00"), day("2026-10-16", "2026-10-19T07:00:00+08:00")];
  assert.equal(dataDayForIssue(late, "2026-10-19"), "2026-10-15");
});

test("schedule does not depend on the process time zone", () => {
  assert.deepEqual(taipeiParts(at("2026-10-19T23:30:00+08:00")), { date: "2026-10-19", weekday: 1, minutes: 23 * 60 + 30 });
  assert.deepEqual(taipeiParts(at("2026-10-18T16:30:00Z")), { date: "2026-10-19", weekday: 1, minutes: 30 });
  assert.deepEqual(weekDates(at("2026-10-18T20:00:00+08:00")), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.deepEqual(weekDates(at("2026-10-19T00:01:00+08:00")), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
});
