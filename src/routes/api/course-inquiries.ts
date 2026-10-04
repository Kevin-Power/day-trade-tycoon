import { createFileRoute } from "@tanstack/react-router";
import {
  assertInquiryOrigin, CourseInquiryError, CourseInquiryRateLimits,
  listCourseInquiries, readCourseInquiryJson, submitCourseInquiry, updateCourseInquiry,
} from "@/lib/course-inquiries.server";
import { readAuthConfig } from "@/lib/auth/config.server";
import { checkGateSession } from "@/lib/gate/session.server";
import { GateRateLimiter, gateRateKey } from "@/lib/gate/rate-limit.server";

const publicLimits = new CourseInquiryRateLimits();
const ownerSources = new GateRateLimiter(60, 60_000, 2_000);
const ownerGlobal = new GateRateLimiter(300, 60_000, 1);
let activeRequests = 0;
function reply(body: object, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie, Origin", ...extra } });
}
const limited = (seconds: number) => reply({ ok: false, message: "送出次數較多，請稍後再試" }, 429, { "Retry-After": String(seconds) });

async function handle(request: Request): Promise<Response> {
  const submission = request.method === "POST";
  const write = submission || request.method === "PATCH";
  let counted = false;
  try {
    assertInquiryOrigin(request, readAuthConfig().origin, write);
    if (!submission && !checkGateSession(request))
      throw new CourseInquiryError(403, "目前帳號無權管理課程詢問");
    if (submission ? !publicLimits.take(request.headers)
      : !ownerSources.take(gateRateKey(request.headers)) || !ownerGlobal.take("owner-inquiries")) {
      return limited(submission ? 600 : 60);
    }
    if (activeRequests >= 8) return limited(5);
    activeRequests++;
    counted = true;

    // Runtime database access stays server-only and outside the shared schemas.
    const { withSqlTransaction } = await import("@/lib/db");
    if (submission) {
      const input = await readCourseInquiryJson(request);
      return reply(await withSqlTransaction(sql => submitCourseInquiry(sql, input)));
    }
    const { auth } = await import("@/lib/auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    const viewer = session?.user ? { id: session.user.id, emailVerified: session.user.emailVerified } : null;
    if (!viewer) throw new CourseInquiryError(403, "目前帳號無權管理課程詢問");
    if (request.method === "GET") {
      // Preserve unexpected fields so the shared strict query schema rejects them.
      const query = Object.fromEntries(new URL(request.url).searchParams);
      return reply(await withSqlTransaction(sql => listCourseInquiries(sql, query, viewer)));
    }
    const input = await readCourseInquiryJson(request);
    return reply(await withSqlTransaction(sql => updateCourseInquiry(sql, input, viewer)));
  } catch (error) {
    // Never log or echo submitted names, contact details, bodies or database errors.
    if (error instanceof CourseInquiryError) return reply({ ok: false, message: error.message }, error.status);
    return reply({ ok: false, message: "目前暫時無法處理，請稍後再試" }, 503);
  } finally {
    if (counted) activeRequests--;
  }
}
const unsupported = () => reply({ ok: false, message: "不支援此請求方式" }, 405, { "Allow": "GET, POST, PATCH" });

export const Route = createFileRoute("/api/course-inquiries")({
  server: { handlers: {
    POST: ({ request }) => handle(request),
    GET: ({ request }) => handle(request),
    PATCH: ({ request }) => handle(request),
    PUT: unsupported,
    DELETE: unsupported,
    OPTIONS: unsupported,
    HEAD: unsupported,
  } },
});
