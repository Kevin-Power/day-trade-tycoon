import { randomUUID } from "node:crypto";
import { GateRateLimiter, gateRateKey } from "./gate/rate-limit.server.ts";
import {
  courseInquirySchema, courseInquiryListSchema, courseInquiryUpdateSchema,
  COURSE_INQUIRY_PAGE_SIZE,
  type CourseInquiryInput, type CourseInquiryItem, type CourseInquiryPage,
} from "./course-inquiries.ts";
import type { Sql } from "./db.ts";

export const COURSE_INQUIRY_MAX_NEW = 2_000;
export const COURSE_INQUIRY_MAX_TOTAL = 10_000;
export const COURSE_INQUIRY_MAX_BODY = 8 * 1024;
export const COURSE_INQUIRY_BODY_TIMEOUT = 5_000;
export type CourseInquiryViewer = { id: string; emailVerified?: boolean } | null;
export class CourseInquiryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const forbidden = () => new CourseInquiryError(403, "目前帳號無權管理課程詢問");
const unavailable = () => new CourseInquiryError(503, "目前暫停受理新的課程詢問，請稍後再試");

/** No IP or request contents are stored. State remains bounded in this process. */
export class CourseInquiryRateLimits {
  private sources = new GateRateLimiter(5, 10 * 60_000, 2_000);
  private global = new GateRateLimiter(100, 60 * 60_000, 1);
  take(headers: Headers, now = Date.now()): boolean {
    return this.sources.take(gateRateKey(headers), now) && this.global.take("inquiries", now);
  }
}

export function assertInquiryOrigin(request: Request, canonicalOrigin: string, write: boolean): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((write && origin !== canonicalOrigin) || (origin && origin !== canonicalOrigin) ||
    (site && site !== "same-origin" && !(site === "none" && !write))) {
    throw new CourseInquiryError(403, "請從本網站送出課程詢問");
  }
  if (write && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new CourseInquiryError(415, "請使用 JSON 格式送出");
  }
}

/** The shared gate reader has no deadline; public inquiries also cancel slow bodies. */
export async function readCourseInquiryJson(request: Request, timeoutMs = COURSE_INQUIRY_BODY_TIMEOUT): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > COURSE_INQUIRY_MAX_BODY))
    throw new CourseInquiryError(413, "送出的內容過長");
  const reader = request.body?.getReader();
  if (!reader) throw new CourseInquiryError(400, "請填寫詢問內容");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CourseInquiryError(408, "送出逾時，請稍後重試")), timeoutMs);
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > COURSE_INQUIRY_MAX_BODY) throw new CourseInquiryError(413, "送出的內容過長");
      chunks.push(chunk.value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new CourseInquiryError(400, "無法讀取詢問內容"); }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}

/** Only the verified account recorded by one-time owner setup owns unassigned leads. */
async function ownerRecord(sql: Sql): Promise<{ user_id: string } | undefined> {
  const rows = await sql<{ user_id: string }>`
    SELECT setup.user_id FROM classroom_admin_setup setup
    JOIN "user" u ON u.id = setup.user_id
    JOIN classroom_profiles profile ON profile.user_id = setup.user_id
    WHERE setup.id = 1 AND u."emailVerified" = TRUE
      AND profile.role = 'teacher' AND profile.tos_accepted_at IS NOT NULL
    FOR SHARE OF setup, u, profile`;
  return rows[0];
}
export async function requireCourseInquiryOwner(sql: Sql, viewer: CourseInquiryViewer): Promise<void> {
  if (viewer?.emailVerified !== true) throw forbidden();
  const owner = await ownerRecord(sql);
  if (!owner || owner.user_id !== viewer.id) throw forbidden();
}

type InquiryRow = {
  id: string; name: string; contact_type: CourseInquiryInput["contactType"]; contact: string;
  device: CourseInquiryInput["device"]; support: CourseInquiryInput["support"];
  question: string; status: CourseInquiryItem["status"]; created_at: string;
};
function item(row: InquiryRow): CourseInquiryItem {
  return { id: row.id, name: row.name, contactType: row.contact_type, contact: row.contact,
    device: row.device, support: row.support, question: row.question, status: row.status, createdAt: row.created_at };
}
async function capacity(sql: Sql): Promise<{ total: number; fresh: number }> {
  const rows = await sql<{ total: number; fresh: number }>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'new')::int AS fresh FROM course_inquiries`;
  return rows[0];
}

/** Call with a transaction-bound SQL handle. The table lock serializes capacity and idempotency. */
export async function submitCourseInquiry(sql: Sql, input: unknown): Promise<{ ok: true; id: string }> {
  const parsed = courseInquirySchema.safeParse(input);
  if (!parsed.success) throw new CourseInquiryError(400, "請確認稱呼、聯絡方式、詢問內容與同意欄位");
  const data = parsed.data;
  if (!(await ownerRecord(sql))) throw unavailable();
  await sql`LOCK TABLE course_inquiries IN EXCLUSIVE MODE`;
  const existing = await sql<InquiryRow>`
    SELECT id, name, contact_type, contact, device, support, question
    FROM course_inquiries WHERE request_id = ${data.requestId}::uuid`;
  if (existing[0]) {
    const row = existing[0];
    if (row.name !== data.name || row.contact_type !== data.contactType || row.contact !== data.contact ||
      row.device !== data.device || row.support !== data.support || row.question !== data.question)
      throw new CourseInquiryError(409, "這次送出的內容與先前不同，請重新建立詢問");
    return { ok: true, id: row.id };
  }
  const counts = await capacity(sql);
  if (counts.fresh >= COURSE_INQUIRY_MAX_NEW || counts.total >= COURSE_INQUIRY_MAX_TOTAL) throw unavailable();
  const id = randomUUID();
  await sql`
    INSERT INTO course_inquiries (id, request_id, name, contact_type, contact, device, support, question, consent)
    VALUES (${id}::uuid, ${data.requestId}::uuid, ${data.name}, ${data.contactType}, ${data.contact},
      ${data.device}, ${data.support}, ${data.question}, TRUE)`;
  return { ok: true, id };
}

/** Caller supplies the real verified session identity, never a client-sent user id. */
export async function listCourseInquiries(sql: Sql, input: unknown, viewer: CourseInquiryViewer): Promise<CourseInquiryPage> {
  await requireCourseInquiryOwner(sql, viewer);
  const parsed = courseInquiryListSchema.safeParse(input);
  if (!parsed.success) throw new CourseInquiryError(400, "查詢條件不正確");
  const { status, offset } = parsed.data;
  await sql`LOCK TABLE course_inquiries IN SHARE MODE`;
  const counts = await sql<{ total: number }>`
    SELECT count(*)::int AS total FROM course_inquiries WHERE (${status} = 'all' OR status = ${status})`;
  const rows = await sql<InquiryRow>`
    SELECT id, name, contact_type, contact, device, support, question, status,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM course_inquiries WHERE (${status} = 'all' OR status = ${status})
    ORDER BY created_at DESC, id DESC LIMIT ${COURSE_INQUIRY_PAGE_SIZE} OFFSET ${offset}`;
  return { ok: true, items: rows.map(item), total: counts[0].total, hasMore: offset + rows.length < counts[0].total };
}

export async function updateCourseInquiry(sql: Sql, input: unknown, viewer: CourseInquiryViewer): Promise<{ ok: true; id: string; status: CourseInquiryItem["status"] }> {
  await requireCourseInquiryOwner(sql, viewer);
  const parsed = courseInquiryUpdateSchema.safeParse(input);
  if (!parsed.success) throw new CourseInquiryError(400, "更新內容不正確");
  const data = parsed.data;
  await sql`LOCK TABLE course_inquiries IN EXCLUSIVE MODE`;
  const rows = await sql<{ status: string }>`SELECT status FROM course_inquiries WHERE id = ${data.id}::uuid`;
  if (!rows[0]) throw new CourseInquiryError(404, "找不到這筆詢問");
  if (data.status === 'new' && rows[0].status !== 'new' && (await capacity(sql)).fresh >= COURSE_INQUIRY_MAX_NEW) throw unavailable();
  await sql`UPDATE course_inquiries SET status = ${data.status} WHERE id = ${data.id}::uuid`;
  return { ok: true, id: data.id, status: data.status };
}
