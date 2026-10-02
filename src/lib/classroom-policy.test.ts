import test from "node:test";
import assert from "node:assert/strict";
import { classroomRole, assertSessionOwner, csvCell } from "./classroom-policy.ts";

test("self-asserted teacher email cannot promote an unverified signup", () => {
  assert.equal(
    classroomRole(
      { id: "student", email: "teacher@example.com", emailVerified: false },
      { teacherEmails: "teacher@example.com" },
    ),
    "student",
  );
  assert.equal(
    classroomRole(
      { id: "student", email: "teacher@example.com", emailVerified: true },
      { teacherEmails: "teacher@example.com" },
    ),
    "teacher",
  );
  assert.equal(classroomRole({ id: "TEACHER", email: null }, {}), "student");
  assert.equal(
    classroomRole({ id: "approved-id", email: null }, { teacherIds: "approved-id" }),
    "teacher",
  );
});
test("session ownership is required even if a caller knows the session ID", () => {
  assert.throws(() => assertSessionOwner("alice", "bob"));
  assert.doesNotThrow(() => assertSessionOwner("alice", "alice"));
});
test("CSV names cannot inject columns, quotes, or spreadsheet formulas", () => {
  assert.equal(csvCell('a,"b'), '"a,""b"');
  assert.equal(
    csvCell('=HYPERLINK("https://example.com")'),
    '"\'=HYPERLINK(""https://example.com"")"',
  );
});
