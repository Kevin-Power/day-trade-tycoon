import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTeacherWorkspace,
  feedbackState,
  sortTeacherSessions,
  teacherPracticeConditions,
  type TeacherSession,
} from "./teacher-workspace.ts";

function session(id: string, patch: Partial<TeacherSession> = {}): TeacherSession {
  return {
    id,
    user_id: "a",
    lesson_id: "lesson",
    passed: false,
    ended_at: "2026-10-04 10:30:00",
    initial_equity: 100000,
    final_equity: 99000,
    max_drawdown_pct: 0.01,
    discipline_violations_json: "[]",
    ...patch,
  };
}
const roster = [
  { user_id: "a", display_name: "學員甲", role: "student" },
  { user_id: "b", display_name: "學員乙", role: "student" },
  { user_id: "t", display_name: "講師", role: "teacher" },
];

test("teacher workspace counts learners once and excludes teacher and out-of-roster records", () => {
  const rows = [
    session("a1"),
    session("a2", { passed: true }),
    session("t1", { user_id: "t" }),
    session("x", { user_id: "unknown" }),
  ];
  const model = buildTeacherWorkspace(roster, rows, ["lesson"]);
  assert.equal(model.students.length, 2);
  assert.equal(model.sessions.length, 2);
  assert.equal(model.practicedStudents, 1);
  assert.equal(model.lessons[0].learners, 1);
  assert.equal(model.lessons[0].practiceCount, 2);
  assert.equal(model.students[0].practicedLessons, 1);
  assert.equal(model.students[1].latest, null);
});

test("only an explicit zero counts as no recorded feedback; unavailable status stays unknown", () => {
  const model = buildTeacherWorkspace(
    roster,
    [
      session("none", { feedback_count: 0 }),
      session("done", { feedback_count: 2 }),
      session("legacy"),
      session("null", { feedback_count: null }),
    ],
    ["lesson"],
  );
  assert.equal(model.withoutFeedback, 1);
  assert.equal(model.unknownFeedback, 2);
  assert.equal(model.students[0].withoutFeedback, 1);
  assert.equal(feedbackState(undefined), "unknown");
  assert.equal(feedbackState(-1), "unknown");
  assert.equal(feedbackState(0), "none");
  assert.equal(feedbackState(2), "recorded");
});

test("practice counts do not turn unknown courses or a profit into course completion", () => {
  const rows = [
    session("known", { final_equity: 500000 }),
    session("old", { lesson_id: "removed", passed: true }),
  ];
  const model = buildTeacherWorkspace(roster, rows, ["lesson"]);
  assert.equal(model.students[0].practicedLessons, 1);
  assert.equal(model.students[0].passedLessons, 0);
  assert.equal(model.sessions.length, 2);
});

test("recent queue is limited, newest first, with deterministic handling of missing dates", () => {
  const rows = Array.from({ length: 15 }, (_, index) =>
    session(`s${index}`, { ended_at: `2026-10-04 10:${String(index).padStart(2, "0")}:00` }),
  );
  const copy = JSON.stringify(rows);
  const model = buildTeacherWorkspace(
    roster,
    [...rows, session("missing", { ended_at: null })],
    ["lesson"],
  );
  assert.equal(model.recent.length, 12);
  assert.equal(model.recent[0].id, "s14");
  assert.equal(model.recent.at(-1)?.id, "s3");
  assert.equal(model.sessions.at(-1)?.id, "missing");
  assert.equal(JSON.stringify(rows), copy);
  assert.equal(
    sortTeacherSessions([session("tz", { ended_at: "2026-10-04T03:00:00Z" }), session("local")])[0]
      .id,
    "tz",
  );
});

test("malformed condition data is unknown and duplicate conditions count once per session", () => {
  assert.equal(teacherPracticeConditions("bad json"), null);
  assert.equal(teacherPracticeConditions('{"length":0}'), null);
  assert.equal(teacherPracticeConditions('["a",2]'), null);
  const model = buildTeacherWorkspace(
    roster,
    [
      session("a", { discipline_violations_json: '["先核對部位","先核對部位"]' }),
      session("b", { discipline_violations_json: "invalid" }),
    ],
    ["lesson"],
  );
  assert.deepEqual(model.lessons[0].topCondition, ["先核對部位", 1]);
  assert.equal(model.lessons[0].unknownConditions, 1);
});
