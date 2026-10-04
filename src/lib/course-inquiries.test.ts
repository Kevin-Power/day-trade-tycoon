import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  courseInquirySchema, courseInquiryListSchema, courseInquiryUpdateSchema,
  type CourseInquiryInput,
} from "./course-inquiries.ts";
import {
  assertInquiryOrigin, CourseInquiryError, CourseInquiryRateLimits,
  readCourseInquiryJson, submitCourseInquiry, listCourseInquiries, updateCourseInquiry,
  COURSE_INQUIRY_MAX_BODY, COURSE_INQUIRY_MAX_NEW, COURSE_INQUIRY_MAX_TOTAL,
} from "./course-inquiries.server.ts";
import type { Sql } from "./db.ts";

const validInput = (): CourseInquiryInput => ({
  requestId: randomUUID(), name: "練習學員", contactType: "email", contact: "learner@example.invalid",
  device: "phone", support: "step-by-step", question: "想了解課程上課方式。", consent: true, website: "",
});
const status = (expected: number) => (error: unknown) => error instanceof CourseInquiryError && error.status === expected;
const canonical = "https://classroom.example.invalid";
function request(body: string | ReadableStream<Uint8Array>, headers: HeadersInit = {}) {
  return new Request(`${canonical}/api/course-inquiries`, {
    method: "POST", headers, body, duplex: "half",
  } as RequestInit);
}
function sqlFor(db: { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, params?: unknown[]) => (await db.query<T>(query, params)).rows;
  return sql;
}

test("inquiry schema normalizes contact and accepts only minimal, consented fields", () => {
  const input = validInput();
  assert.deepEqual(courseInquirySchema.parse({ ...input, requestId: input.requestId.toUpperCase(),
    name: " 練習學員 ", contact: " Learner@Example.Invalid ", question: " 第一行\r\n第二行 " }),
  { ...input, question: "第一行\n第二行" });
  assert.equal(courseInquirySchema.parse({ ...input, contactType: "phone", contact: "+886 (912) 345-678" }).contact, "+886912345678");
  for (const patch of [
    { requestId: "invalid" }, { name: " \n " }, { name: "字".repeat(41) }, { name: "甲\n乙" },
    { contact: "invalid" }, { contact: "a".repeat(255) }, { contactType: "phone", contact: "123" },
    { contactType: "phone", contact: "1234567x" }, { contactType: "phone", contact: "1".repeat(16) },
    { device: "other" }, { support: "other" }, { question: " " }, { question: "字".repeat(601) },
    { question: "abc\u0000def" }, { consent: false }, { website: "bot.example" },
    { role: "teacher" }, { userId: "owner" }, { balance: 1_000_000 }, { age: 50 }, { status: "handled" },
  ]) assert.equal(courseInquirySchema.safeParse({ ...input, ...patch }).success, false);
  assert.equal(courseInquirySchema.safeParse({ ...input, name: "字".repeat(40), question: "字".repeat(600) }).success, true);
  assert.deepEqual(courseInquiryListSchema.parse({}), { status: "all", offset: 0 });
  assert.deepEqual(courseInquiryListSchema.parse({ status: "new", offset: "20" }), { status: "new", offset: 20 });
  for (const input of [{ offset: -1 }, { offset: 0.5 }, { offset: 10_001 }, { status: "deleted" }, { requestId: randomUUID() }])
    assert.equal(courseInquiryListSchema.safeParse(input).success, false);
  assert.equal(courseInquiryUpdateSchema.safeParse({ id: randomUUID(), status: "handled", contact: "forged" }).success, false);
});

test("inquiry writes require exact canonical origin and JSON; reads reject foreign origin", () => {
  assert.doesNotThrow(() => assertInquiryOrigin(request("{}", { Origin: canonical, "Content-Type": "application/json; charset=utf-8", "Sec-Fetch-Site": "same-origin" }), canonical, true));
  const invalidHeaders: HeadersInit[] = [
    { "Content-Type": "application/json" },
    { Origin: "https://other.example.invalid", "Content-Type": "application/json" },
    { Origin: canonical, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    { Origin: canonical, "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" },
  ];
  for (const headers of invalidHeaders) assert.throws(() => assertInquiryOrigin(request("{}", headers), canonical, true), status(403));
  assert.throws(() => assertInquiryOrigin(request("{}", { Origin: canonical, "Content-Type": "text/plain" }), canonical, true), status(415));
  assert.doesNotThrow(() => assertInquiryOrigin(new Request(canonical), canonical, false));
  assert.throws(() => assertInquiryOrigin(new Request(canonical, { headers: { Origin: "https://other.example.invalid" } }), canonical, false), status(403));
});

test("inquiry body reader enforces streamed size, valid UTF-8 JSON and cancellation deadline", async () => {
  assert.deepEqual(await readCourseInquiryJson(request('{"ok":true}')), { ok: true });
  await assert.rejects(readCourseInquiryJson(request("{}", { "Content-Length": String(COURSE_INQUIRY_MAX_BODY + 1) })), status(413));
  await assert.rejects(readCourseInquiryJson(request("x".repeat(COURSE_INQUIRY_MAX_BODY + 1))), status(413));
  await assert.rejects(readCourseInquiryJson(request("not-json")), status(400));
  const badUtf = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.of(0xff)); controller.close(); } });
  await assert.rejects(readCourseInquiryJson(request(badUtf)), status(400));
  let cancelled = false;
  const slow = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(readCourseInquiryJson(request(slow), 10), status(408));
  assert.equal(cancelled, true);
});

test("inquiry rate limit permits five attempts per source per ten minutes and caps global traffic", () => {
  const previous = process.env.CLASSROOM_TRUST_PROXY;
  process.env.CLASSROOM_TRUST_PROXY = "true";
  try {
    const limits = new CourseInquiryRateLimits();
    const headers = new Headers({ "CF-Connecting-IP": "192.0.2.10" });
    for (let i = 0; i < 5; i++) assert.equal(limits.take(headers, 1_000), true);
    assert.equal(limits.take(headers, 1_000), false);
    assert.equal(limits.take(headers, 600_999), false);
    assert.equal(limits.take(headers, 601_000), true);
    const global = new CourseInquiryRateLimits();
    for (let i = 1; i <= 100; i++) assert.equal(global.take(new Headers({ "CF-Connecting-IP": `192.0.2.${i}` }), 1_000), true);
    assert.equal(global.take(new Headers({ "CF-Connecting-IP": "192.0.2.101" }), 1_000), false);
    assert.equal(global.take(new Headers({ "CF-Connecting-IP": "192.0.2.102" }), 3_601_000), true);
    process.env.CLASSROOM_TRUST_PROXY = "false";
    const untrusted = new CourseInquiryRateLimits();
    for (let i = 1; i <= 5; i++) assert.equal(untrusted.take(new Headers({ "CF-Connecting-IP": `192.0.2.${i}` }), 1_000), true);
    assert.equal(untrusted.take(new Headers({ "CF-Connecting-IP": "192.0.2.99" }), 1_000), false);
  } finally {
    if (previous === undefined) delete process.env.CLASSROOM_TRUST_PROXY;
    else process.env.CLASSROOM_TRUST_PROXY = previous;
  }
});

test("real inquiry SQL preserves owner-only access, idempotency, pagination and capacity", async (t) => {
  const db = new PGlite();
  const run = <T>(fn: (sql: Sql) => Promise<T>) => db.transaction(tx => fn(sqlFor(tx)));
  const owner = { id: "inquiry-owner", emailVerified: true };
  const ordinaryTeacher = { id: "inquiry-teacher", emailVerified: true };
  const student = { id: "inquiry-student", emailVerified: true };
  const input = validInput();
  try {
    for (const file of ["0001_auth.sql", "0003_classroom.sql", "0004_admin_setup.sql", "0006_course_inquiries.sql"])
      await db.exec(await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8"));
    await t.test("an initialized verified owner is required before accepting public submissions", async () => {
      await assert.rejects(run(sql => submitCourseInquiry(sql, input)), status(503));
      assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM course_inquiries")).rows[0].count, 0);
    });
    for (const [viewer, role] of [[owner, "teacher"], [ordinaryTeacher, "teacher"], [student, "student"]] as const) {
      await db.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, TRUE)', [viewer.id, `${viewer.id}@example.invalid`]);
      await db.query("INSERT INTO classroom_profiles (user_id, role, class_code, tos_accepted_at) VALUES ($1, $2, 'test', NOW())", [viewer.id, role]);
    }
    await db.query("INSERT INTO classroom_admin_setup (id, user_id) VALUES (1, $1)", [owner.id]);
    const first = await run(sql => submitCourseInquiry(sql, input));
    await t.test("same request id and canonical content return only the same receipt without duplicates", async () => {
      assert.deepEqual(Object.keys(first).sort(), ["id", "ok"]);
      const concurrent = await Promise.all(Array.from({ length: 3 }, () => run(sql => submitCourseInquiry(sql, { ...input, contact: " Learner@Example.Invalid " }))));
      for (const result of concurrent) assert.deepEqual(result, first);
      await assert.rejects(run(sql => submitCourseInquiry(sql, { ...input, question: "改過的詢問" })), status(409));
      assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM course_inquiries")).rows[0].count, 1);
    });
    await t.test("verified ordinary teachers, students, absent sessions and unverified owner sessions cannot list or change records", async () => {
      for (const viewer of [ordinaryTeacher, student, null, { ...owner, emailVerified: false }]) {
        await assert.rejects(run(sql => listCourseInquiries(sql, {}, viewer)), status(403));
        await assert.rejects(run(sql => updateCourseInquiry(sql, { id: first.id, status: "handled" }, viewer)), status(403));
      }
      const record = (await db.query<{ status: string; question: string }>("SELECT status, question FROM course_inquiries WHERE id = $1", [first.id])).rows[0];
      assert.deepEqual(record, { status: "new", question: input.question });
    });
    await t.test("database owner verification, teacher role and accepted terms are checked on each request", async () => {
      const changes = [
        ['UPDATE "user" SET "emailVerified" = FALSE WHERE id = $1', 'UPDATE "user" SET "emailVerified" = TRUE WHERE id = $1'],
        ["UPDATE classroom_profiles SET role = 'student' WHERE user_id = $1", "UPDATE classroom_profiles SET role = 'teacher' WHERE user_id = $1"],
        ["UPDATE classroom_profiles SET tos_accepted_at = NULL WHERE user_id = $1", "UPDATE classroom_profiles SET tos_accepted_at = NOW() WHERE user_id = $1"],
      ];
      for (const [revoke, restore] of changes) {
        await db.query(revoke, [owner.id]);
        try {
          await assert.rejects(run(sql => listCourseInquiries(sql, {}, owner)), status(403));
          await assert.rejects(run(sql => updateCourseInquiry(sql, { id: first.id, status: "handled" }, owner)), status(403));
          await assert.rejects(run(sql => submitCourseInquiry(sql, validInput())), status(503));
        } finally { await db.query(restore, [owner.id]); }
      }
      assert.deepEqual((await db.query<{ status: string; count: number }>("SELECT status, count(*)::int AS count FROM course_inquiries GROUP BY status")).rows, [{ status: "new", count: 1 }]);
    });
    await t.test("owner can page and filter records, mark handled, and stored text remains parameterized", async () => {
      const injection = "'; DROP TABLE course_inquiries; --";
      await run(sql => submitCourseInquiry(sql, { ...validInput(), question: injection }));
      for (let i = 0; i < 20; i++) await run(sql => submitCourseInquiry(sql, validInput()));
      await run(sql => updateCourseInquiry(sql, { id: first.id, status: "handled" }, owner));
      const page = await run(sql => listCourseInquiries(sql, { status: "all", offset: "0" }, owner));
      const next = await run(sql => listCourseInquiries(sql, { status: "all", offset: "20" }, owner));
      assert.equal(page.total, 22); assert.equal(page.items.length, 20); assert.equal(page.hasMore, true);
      assert.equal(next.items.length, 2); assert.equal(next.hasMore, false);
      assert.equal(new Set([...page.items, ...next.items].map(item => item.id)).size, 22);
      assert.ok([...page.items, ...next.items].some(item => item.question === injection));
      assert.match(page.items[0].createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.deepEqual(Object.keys(page.items[0]).sort(), ["contact", "contactType", "createdAt", "device", "id", "name", "question", "status", "support"]);
      const handled = await run(sql => listCourseInquiries(sql, { status: "handled" }, owner));
      assert.equal(handled.total, 1); assert.equal(handled.items[0].id, first.id);
      await assert.rejects(run(sql => listCourseInquiries(sql, { requestId: input.requestId }, owner)), status(400));
      await assert.rejects(run(sql => updateCourseInquiry(sql, { id: randomUUID(), status: "new" }, owner)), status(404));
    });
    await t.test("active and total caps are atomic while exact retries remain available at capacity", async () => {
      await db.exec("DELETE FROM course_inquiries");
      const capped = validInput();
      const receipt = await run(sql => submitCourseInquiry(sql, capped));
      await db.query(`INSERT INTO course_inquiries (id, request_id, name, contact_type, contact, device, support, question, consent)
        SELECT gen_random_uuid(), gen_random_uuid(), 'fixture', 'email', 'fixture@example.invalid', 'desktop', 'standard', 'fixture', TRUE
        FROM generate_series(1, $1::int)`, [COURSE_INQUIRY_MAX_NEW - 1]);
      assert.deepEqual(await run(sql => submitCourseInquiry(sql, capped)), receipt);
      await assert.rejects(run(sql => submitCourseInquiry(sql, validInput())), status(503));
      await run(sql => updateCourseInquiry(sql, { id: receipt.id, status: "handled" }, owner));
      await run(sql => submitCourseInquiry(sql, validInput()));
      await assert.rejects(run(sql => updateCourseInquiry(sql, { id: receipt.id, status: "new" }, owner)), status(503));
      await db.exec("UPDATE course_inquiries SET status = 'handled'");
      await db.query(`INSERT INTO course_inquiries (id, request_id, name, contact_type, contact, device, support, question, consent, status)
        SELECT gen_random_uuid(), gen_random_uuid(), 'fixture', 'email', 'fixture@example.invalid', 'desktop', 'standard', 'fixture', TRUE, 'handled'
        FROM generate_series(1, $1::int)`, [COURSE_INQUIRY_MAX_TOTAL - COURSE_INQUIRY_MAX_NEW - 2]);
      const finalAttempts = await Promise.allSettled([run(sql => submitCourseInquiry(sql, validInput())), run(sql => submitCourseInquiry(sql, validInput()))]);
      assert.equal(finalAttempts.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(finalAttempts.filter(result => result.status === "rejected" && status(503)(result.reason)).length, 1);
      assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM course_inquiries")).rows[0].count, COURSE_INQUIRY_MAX_TOTAL);
      assert.deepEqual(await run(sql => submitCourseInquiry(sql, capped)), receipt);
    });
  } finally { await db.close(); }
});
