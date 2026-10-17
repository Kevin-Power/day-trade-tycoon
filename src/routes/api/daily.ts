import { createFileRoute } from "@tanstack/react-router";
import { readAuthConfig } from "@/lib/auth/config.server";
import { checkGateSession } from "@/lib/gate/session.server";
import { GateRateLimiter, gateRateKey } from "@/lib/gate/rate-limit.server";
import { assertInquiryOrigin, readCourseInquiryJson, CourseInquiryError } from "@/lib/course-inquiries.server";
import { MorningError } from "@/lib/morning-engine";

const sourceRate = new GateRateLimiter(240, 60_000, 2_000);
const userRate = new GateRateLimiter(120, 60_000, 2_000);
let active = 0;
const reply = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie, Origin", ...(status === 429 ? { "Retry-After": "1" } : {}) },
});
/** QA scripts set DAILY_NOW_ISO to pin the issue day; production never sets it. */
function now(): number {
  const pinned = Date.parse(process.env.DAILY_NOW_ISO ?? "");
  return Number.isFinite(pinned) ? pinned : Date.now();
}
async function handle(request: Request): Promise<Response> {
  let counted = false;
  try {
    if (!checkGateSession(request)) throw new MorningError(403, "請先進入教室");
    assertInquiryOrigin(request, readAuthConfig().origin, request.method === "POST");
    if (!sourceRate.take(gateRateKey(request.headers)) || active >= 12) throw new MorningError(429, "操作較頻繁，請稍候再試");
    active++; counted = true;
    const { auth } = await import("@/lib/auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw new MorningError(401, "請先登入學員帳號");
    if (!userRate.take(session.user.id)) throw new MorningError(429, "操作較頻繁，請稍候再試");
    const input = request.method === "POST" ? await readCourseInquiryJson(request) : undefined;
    const [{ withSqlTransaction }, { loadDaily, answerDaily }, { classroomRole }] = await Promise.all([
      import("@/lib/db"), import("@/lib/daily-question.server"), import("@/lib/classroom-policy"),
    ]);
    const dir = process.env.MARKET_DATA_DIR?.trim() ?? "";
    const teacherReveal = new URL(request.url).searchParams.get("reveal") === "1" &&
      !session.user.isAnonymous &&
      classroomRole(session.user, { teacherIds: process.env.CLASSROOM_TEACHER_IDS, teacherEmails: process.env.TEACHER_EMAILS }) === "teacher";
    const at = now();
    return reply(await withSqlTransaction(sql => request.method === "POST"
      ? answerDaily(sql, session.user.id, input, dir, at)
      : loadDaily(sql, session.user.id, dir, at, { teacherReveal })));
  } catch (error) {
    if (error instanceof CourseInquiryError) return reply({ ok: false, message: "請從本網站重新作答" }, error.status);
    if (error instanceof MorningError) return reply({ ok: false, message: error.message }, error.status);
    // Market files, questions and answers are never echoed or logged.
    return reply({ ok: false, message: "目前無法讀取每日一題，請稍後再試" }, 503);
  } finally { if (counted) active--; }
}
const unsupported = () => reply({ ok: false, message: "不支援此請求方式" }, 405);
export const Route = createFileRoute("/api/daily")({
  server: { handlers: {
    GET: ({ request }) => handle(request), POST: ({ request }) => handle(request),
    PATCH: unsupported, PUT: unsupported, DELETE: unsupported, OPTIONS: unsupported, HEAD: unsupported,
  } },
});
