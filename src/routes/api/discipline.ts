import { createFileRoute } from "@tanstack/react-router";
import { readAuthConfig } from "@/lib/auth/config.server";
import { checkGateSession } from "@/lib/gate/session.server";
import { GateRateLimiter, gateRateKey } from "@/lib/gate/rate-limit.server";
import { assertInquiryOrigin, CourseInquiryError } from "@/lib/course-inquiries.server";
import { MorningError } from "@/lib/morning-engine";

const sourceRate = new GateRateLimiter(240, 60_000, 2_000);
const userRate = new GateRateLimiter(120, 60_000, 2_000);
let active = 0;
const reply = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie, Origin", ...(status === 429 ? { "Retry-After": "1" } : {}) },
});
/** QA scripts set DAILY_NOW_ISO to pin the week; production never sets it. */
function now(): number {
  const pinned = Date.parse(process.env.DAILY_NOW_ISO ?? "");
  return Number.isFinite(pinned) ? pinned : Date.now();
}
async function handle(request: Request): Promise<Response> {
  let counted = false;
  try {
    if (!checkGateSession(request)) throw new MorningError(403, "請先進入教室");
    assertInquiryOrigin(request, readAuthConfig().origin, false);
    if (!sourceRate.take(gateRateKey(request.headers)) || active >= 12) throw new MorningError(429, "操作較頻繁，請稍候再試");
    active++; counted = true;
    const { auth } = await import("@/lib/auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw new MorningError(401, "請先登入學員帳號");
    if (!userRate.take(session.user.id)) throw new MorningError(429, "操作較頻繁，請稍候再試");
    const [{ withSqlTransaction }, { loadDiscipline }] = await Promise.all([
      import("@/lib/db"), import("@/lib/discipline.server"),
    ]);
    const at = now();
    return reply(await withSqlTransaction(sql => loadDiscipline(sql, session.user.id, at)));
  } catch (error) {
    if (error instanceof CourseInquiryError) return reply({ ok: false, message: "請從本網站重新整理" }, error.status);
    if (error instanceof MorningError) return reply({ ok: false, message: error.message }, error.status);
    return reply({ ok: false, message: "目前無法讀取紀律等級，請稍後再試" }, 503);
  } finally { if (counted) active--; }
}
const unsupported = () => reply({ ok: false, message: "不支援此請求方式" }, 405);
export const Route = createFileRoute("/api/discipline")({
  server: { handlers: {
    GET: ({ request }) => handle(request),
    POST: unsupported, PATCH: unsupported, PUT: unsupported, DELETE: unsupported, OPTIONS: unsupported, HEAD: unsupported,
  } },
});
