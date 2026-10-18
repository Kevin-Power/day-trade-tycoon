import test from "node:test";
import assert from "node:assert/strict";
import {
  celebrationFor,
  dailyLines,
  disciplineSummary,
  levelFor,
  practiceLines,
  type DailyRecord,
  type DisciplineInput,
  type PracticeRecord,
} from "./score.ts";

const MON_1019 = Date.parse("2026-10-19T09:00:00+08:00");
const ids = (lines: { id: string }[]) => lines.map((line) => line.id);
const sum = (lines: { points: number }[]) => lines.reduce((total, line) => total + line.points, 0);
const daily = (issueDate: string, over: Partial<DailyRecord> = {}): DailyRecord => ({
  questionId: issueDate, issueDate, choice: "watch", reason: false, brokeOut: false, ...over,
});
const round = (day: string, over: Partial<PracticeRecord> = {}): PracticeRecord => ({
  id: `${day}-${Math.random()}`, day, reflection: true, onPlan: true, flat: true, ...over,
});
const input = (over: Partial<DisciplineInput> = {}): DisciplineInput => ({
  daily: [], practice: [], issued: [], now: MON_1019, ...over,
});
const badge = (summary: ReturnType<typeof disciplineSummary>, id: string) => summary.badges.find((item) => item.id === id)!;

test("answering is the main daily score; a reason adds 5; the read adds only 3", () => {
  assert.deepEqual(ids(dailyLines(daily("2026-10-19", { choice: "enter", brokeOut: false }))), ["answered"]);
  const best = dailyLines(daily("2026-10-19", { choice: "enter", reason: true, brokeOut: true }));
  assert.deepEqual(best.map((line) => [line.id, line.points, line.kind]), [
    ["answered", 10, "discipline"], ["reason", 5, "discipline"], ["eye", 3, "eye"],
  ]);
});

test("the read counts for entering on a breakout, and for watching or skipping when there was none", () => {
  assert.ok(ids(dailyLines(daily("d", { choice: "skip", brokeOut: false }))).includes("eye"));
  assert.ok(ids(dailyLines(daily("d", { choice: "watch", brokeOut: false }))).includes("eye"));
  assert.ok(!ids(dailyLines(daily("d", { choice: "watch", brokeOut: true }))).includes("eye"));
  assert.ok(!ids(dailyLines(daily("d", { choice: "enter", brokeOut: false }))).includes("eye"));
});

test("a wrong read with a reason scores more than a right read without one", () => {
  const wrongWithReason = sum(dailyLines(daily("d", { choice: "enter", brokeOut: false, reason: true })));
  const rightWithoutReason = sum(dailyLines(daily("d", { choice: "enter", brokeOut: true, reason: false })));
  assert.equal(wrongWithReason, 15);
  assert.equal(rightWithoutReason, 13);
  assert.ok(wrongWithReason > rightWithoutReason);
});

test("a finished round scores 15, plus 5 for staying on the plan's stock and 5 for ending flat", () => {
  assert.equal(sum(practiceLines(round("2026-10-19"))), 25);
  assert.deepEqual(ids(practiceLines(round("2026-10-19", { onPlan: false, flat: false }))), ["completed"]);
  assert.deepEqual(practiceLines(round("2026-10-19", { reflection: false })), []);
});

test("only the best round of each Taipei day counts", () => {
  const sameDay = disciplineSummary(input({ practice: [round("2026-10-19", { onPlan: false, flat: false }), round("2026-10-19")] }));
  assert.equal(sameDay.total, 25);
  assert.equal(sameDay.recent.length, 1);
  const twoDays = disciplineSummary(input({ practice: [round("2026-10-19"), round("2026-10-20", { flat: false })] }));
  assert.equal(twoDays.total, 45);
  assert.deepEqual(twoDays.recent.map((event) => event.key), ["practice:2026-10-20", "practice:2026-10-19"]);
});

test("discipline and the read are totalled separately", () => {
  const summary = disciplineSummary(input({
    daily: [daily("2026-10-19", { choice: "enter", reason: true, brokeOut: true })], issued: ["2026-10-19"], practice: [round("2026-10-19")],
  }));
  assert.deepEqual([summary.total, summary.discipline, summary.eye], [43, 40, 3]);
  assert.deepEqual(summary.recent.map((event) => event.source), ["daily", "practice"]);
});

test("levels follow the published thresholds and never pass Lv10", () => {
  assert.deepEqual(levelFor(0), { no: 1, title: "新手學員", min: 0, next: { no: 2, title: "準時報到", min: 25 } });
  assert.equal(levelFor(24).no, 1);
  assert.deepEqual([levelFor(25).no, levelFor(25).title], [2, "準時報到"]);
  assert.deepEqual([levelFor(160).no, levelFor(160).title], [4, "停損守門員"]);
  assert.deepEqual(levelFor(1800), { no: 10, title: "紀律大師", min: 1800, next: null });
  assert.equal(levelFor(5000).no, 10);
});

test("first badges are dated by the earliest answer and round", () => {
  const summary = disciplineSummary(input({
    daily: [daily("2026-10-20"), daily("2026-10-19")], issued: ["2026-10-19", "2026-10-20"], practice: [round("2026-10-21")],
  }));
  assert.deepEqual([badge(summary, "first-daily").earned, badge(summary, "first-daily").earnedOn], [true, "2026-10-19"]);
  assert.equal(badge(summary, "first-practice").earnedOn, "2026-10-21");
  assert.equal(badge(summary, "daily-20").have, 2);
  assert.equal(badge(summary, "daily-20").earned, false);
});

test("a five-day streak runs across a weekday with no question but breaks on an unanswered one", () => {
  // 10/21 had no question, so it is not in `issued` and does not break the run.
  const issued = ["2026-10-19", "2026-10-20", "2026-10-22", "2026-10-23", "2026-10-26"];
  const across = disciplineSummary(input({ daily: issued.map((date) => daily(date)), issued }));
  assert.deepEqual([badge(across, "streak-5").earned, badge(across, "streak-5").earnedOn], [true, "2026-10-26"]);
  const broken = disciplineSummary(input({ daily: issued.filter((date) => date !== "2026-10-22").map((date) => daily(date)), issued }));
  assert.equal(badge(broken, "streak-5").earned, false);
  assert.equal(badge(broken, "streak-5").have, 2);
});

test("a full week is earned on the fifth answer, or once a holiday week is over", () => {
  const five = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  const full = disciplineSummary(input({ daily: five.map((date) => daily(date)), issued: five, now: Date.parse("2026-10-23T09:00:00+08:00") }));
  assert.deepEqual([badge(full, "full-week").earned, badge(full, "full-week").earnedOn], [true, "2026-10-23"]);
  const four = five.slice(0, 4);
  const during = disciplineSummary(input({ daily: four.map((date) => daily(date)), issued: four, now: Date.parse("2026-10-23T09:00:00+08:00") }));
  assert.equal(badge(during, "full-week").earned, false);
  assert.equal(badge(during, "full-week").have, 4);
  const after = disciplineSummary(input({ daily: four.map((date) => daily(date)), issued: four, now: Date.parse("2026-10-26T07:00:00+08:00") }));
  assert.deepEqual([badge(after, "full-week").earned, badge(after, "full-week").earnedOn], [true, "2026-10-22"]);
});

test("count badges report progress capped at their goal", () => {
  const dates = Array.from({ length: 12 }, (_, index) => `2026-11-${String(index + 2).padStart(2, "0")}`);
  const summary = disciplineSummary(input({
    daily: dates.map((date) => daily(date, { reason: true })), issued: dates, now: Date.parse("2026-11-20T09:00:00+08:00"),
    practice: dates.slice(0, 3).flatMap((date) => [round(date), round(date)]),
  }));
  assert.deepEqual([badge(summary, "reasons-10").have, badge(summary, "reasons-10").need, badge(summary, "reasons-10").earnedOn], [10, 10, "2026-11-11"]);
  assert.deepEqual([badge(summary, "practice-5").have, badge(summary, "practice-5").earned], [3, false]);
  assert.equal(summary.badges.length, 8);
});

test("the first answer celebrates its points and the first badge without a level change", () => {
  const before = input({ issued: ["2026-10-19"] });
  const after = input({ issued: ["2026-10-19"], daily: [daily("2026-10-19", { reason: true })] });
  const celebration = celebrationFor(before, after, "daily");
  assert.deepEqual(ids(celebration.gained), ["answered", "reason", "eye"]);
  assert.deepEqual([celebration.points, celebration.beforeTotal, celebration.total], [18, 0, 18]);
  assert.deepEqual([celebration.before.no, celebration.after.no], [1, 1]);
  assert.deepEqual(celebration.newBadges.map((item) => item.id), ["first-daily"]);
  assert.equal(celebration.alreadyCounted, false);
});

test("answering and then finishing a round crosses into Lv2", () => {
  const answered = input({ issued: ["2026-10-19"], daily: [daily("2026-10-19")] });
  const celebration = celebrationFor(answered, { ...answered, practice: [round("2026-10-19")] }, "practice");
  assert.deepEqual([celebration.before.no, celebration.after.no, celebration.after.title], [1, 2, "準時報到"]);
  assert.deepEqual(celebration.newBadges.map((item) => item.id), ["first-practice"]);
});

test("a second round on the same day adds nothing unless it is better", () => {
  const first = input({ practice: [round("2026-10-19", { onPlan: false })] });
  const worse = celebrationFor(first, { ...first, practice: [...first.practice, round("2026-10-19", { onPlan: false, flat: false })] }, "practice");
  assert.deepEqual([worse.points, worse.alreadyCounted, worse.gained.length], [0, true, 0]);
  const better = celebrationFor(first, { ...first, practice: [...first.practice, round("2026-10-19")] }, "practice");
  assert.deepEqual([better.points, better.alreadyCounted], [5, false]);
  assert.deepEqual(ids(better.gained), ["on-plan"]);
});

test("a holiday week's full-week badge is celebrated with the next answer after the week ends", () => {
  const four = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];
  const monday = Date.parse("2026-10-26T07:00:00+08:00");
  const before = input({ daily: four.map((date) => daily(date)), issued: [...four, "2026-10-26"], now: monday });
  const after = { ...before, daily: [...before.daily, daily("2026-10-26")] };
  // The fifth answer in a row also completes the streak badge.
  assert.deepEqual(celebrationFor(before, after, "daily").newBadges.map((item) => item.id), ["streak-5", "full-week"]);
  // Already celebrated once the learner acted after the week ended.
  const tuesday = Date.parse("2026-10-27T07:00:00+08:00");
  const later = { ...after, issued: [...after.issued, "2026-10-27"], now: tuesday };
  const next = { ...later, daily: [...later.daily, daily("2026-10-27")] };
  assert.deepEqual(celebrationFor(later, next, "daily").newBadges.map((item) => item.id), []);
});
