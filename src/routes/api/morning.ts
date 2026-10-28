import { createFileRoute } from "@tanstack/react-router";
import { readAuthConfig } from "@/lib/auth/config.server";
import { checkGateSession } from "@/lib/gate/session.server";
import { gateRateKey } from "@/lib/gate/rate-limit.server";
import { assertInquiryOrigin, readCourseInquiryJson, CourseInquiryError } from "@/lib/course-inquiries.server";
import { MorningError } from "@/lib/morning-engine";
import { MorningTraffic } from "@/lib/morning-traffic.server";

// Per practiser, with a classroom-wide total per IP and a cap on requests in progress (③ decision Q).
const traffic = new MorningTraffic();
const reply = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie, Origin", ...(status === 429 ? { "Retry-After": "1" } : {}) },
});
async function handle(request: Request): Promise<Response> {
  let counted = false;
  try {
    if (!checkGateSession(request)) throw new MorningError(403, "請先進入教室");
    assertInquiryOrigin(request, readAuthConfig().origin, request.method === "POST");
    if (!traffic.enter(gateRateKey(request.headers))) throw new MorningError(429, "操作較頻繁，請稍候再試");
    counted = true;
    const { auth } = await import("@/lib/auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw new MorningError(401, "請先登入學員帳號");
    if (!traffic.practiser(session.user.id)) throw new MorningError(429, "操作較頻繁，請稍候再試");
    const input = request.method === "POST" ? await readCourseInquiryJson(request) : undefined;
    const [{ withSqlTransaction }, { loadMorningSession, mutateMorningSession }] = await Promise.all([
      import("@/lib/db"), import("@/lib/morning-session.server"),
    ]);
    // The lesson comes from the query (checked there); the market data from MARKET_DATA_DIR, read at run time.
    const params = new URL(request.url).searchParams;
    return reply(await withSqlTransaction(sql => request.method === "POST"
      ? mutateMorningSession(sql, session.user.id, input, { params })
      : loadMorningSession(sql, session.user.id, { params })));
  } catch (error) {
    if (error instanceof CourseInquiryError)
      return reply({ ok: false, message: "請從本網站重試早盤練習操作" }, error.status);
    if (error instanceof MorningError) return reply({ ok: false, message: error.message }, error.status);
    // Source files, lesson data, sessions and submitted plans are never echoed or logged.
    return reply({ ok: false, message: "目前無法讀取早盤練習，請稍後再試" }, 503);
  } finally { if (counted) traffic.leave(); }
}
const unsupported = () => reply({ ok: false, message: "不支援此請求方式" }, 405);
export const Route = createFileRoute("/api/morning")({
  server: { handlers: {
    GET: ({ request }) => handle(request), POST: ({ request }) => handle(request),
    PATCH: unsupported, PUT: unsupported, DELETE: unsupported, OPTIONS: unsupported, HEAD: unsupported,
  } },
});
