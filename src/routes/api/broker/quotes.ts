import { createFileRoute } from "@tanstack/react-router";
import { readAuthConfig } from "@/lib/auth/config.server";
import { checkGateSession } from "@/lib/gate/session.server";
import { GateRateLimiter, gateRateKey } from "@/lib/gate/rate-limit.server";
import { assertInquiryOrigin, CourseInquiryError, requireCourseInquiryOwner } from "@/lib/course-inquiries.server";
import { watchRequest } from "@/lib/broker/fubon-feed";

const limits = new GateRateLimiter(600, 60_000, 2000);
const reply = (body: object, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "Vary": "Cookie, Origin", ...(status === 429 ? { "Retry-After": "60" } : {}),
} });
async function handle(request: Request) {
  try {
    if (!checkGateSession(request)) return reply({ ok: false, message: "請先進入教室並登入本人帳號" }, 403);
    assertInquiryOrigin(request, readAuthConfig().origin, false);
    if (!limits.take(gateRateKey(request.headers))) return reply({ ok: false, message: "請稍候一分鐘再讀取" }, 429);
    const { auth } = await import("@/lib/auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || session.user.isAnonymous) return reply({ ok: false, message: "請登入行情擁有者帳號" }, 401);
    const { withSqlTransaction } = await import("@/lib/db");
    // A teacher role or matching email alone is insufficient. This binds to the
    // verified singleton owner established by the existing setup workflow.
    await withSqlTransaction(sql => requireCourseInquiryOwner(sql, session.user));
    const query = new URL(request.url).searchParams;
    if (query.get("access") === "1" && query.size === 1) return reply({ ok: true, owner: true });
    const parsed = watchRequest.safeParse({ ...Object.fromEntries(query), symbols: query.get("symbols")?.split(",") });
    if (!parsed.success) return reply({ ok: false, message: "請選擇 1 至 20 檔四位數上市櫃股票" }, 400);
    const { readFubonFeed } = await import("@/lib/broker/fubon-feed.server");
    return reply(readFubonFeed(parsed.data.client, parsed.data.symbols));
  } catch (error) {
    if (error instanceof CourseInquiryError) return reply({ ok: false, message: "僅限已完成設定的本人帳號使用富邦行情" }, error.status);
    if (error instanceof Error && ["CLIENT_CAPACITY", "SYMBOL_CAPACITY"].includes(error.message))
      return reply({ ok: false, message: "開啟的行情分頁或股票過多，請關閉部分分頁，45 秒後重試" }, 409);
    return reply({ ok: false, message: "行情暫時無法讀取，正在等候恢復" }, 503);
  }
}
const unsupported = () => reply({ ok: false, code: "READ_ONLY", message: "此端點僅提供唯讀行情" }, 405);
export const Route = createFileRoute("/api/broker/quotes")({ server: { handlers: {
  GET: ({ request }) => handle(request), POST: unsupported, PUT: unsupported, PATCH: unsupported, DELETE: unsupported, OPTIONS: unsupported, HEAD: unsupported,
} } });
