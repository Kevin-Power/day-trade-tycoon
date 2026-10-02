import { createFileRoute } from "@tanstack/react-router";
import { checkGateSession, clearGateCookie, gateConfigured, isAllowedGateOrigin, issueGateCookie } from "@/lib/gate/session.server";
import { verifyGatePassword } from "@/lib/gate/password.server";
import { GateRateLimiter, gateRateKey } from "@/lib/gate/rate-limit.server";

const limiter = new GateRateLimiter();
const globalLimiter = new GateRateLimiter(300, 60_000, 1);
let verifying = 0;
function reply(body: object, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...extra } });
}
export const Route = createFileRoute("/api/gate")({
  server: { handlers: {
    GET: async ({ request }) => reply({ ok: checkGateSession(request) }),
    DELETE: async ({ request }) => {
      if (!isAllowedGateOrigin(request)) return reply({ ok: false, reason: "來源不符" }, 403);
      return reply({ ok: true }, 200, { "set-cookie": clearGateCookie() });
    },
    POST: async ({ request }) => {
      if (!isAllowedGateOrigin(request)) return reply({ ok: false, reason: "來源不符" }, 403);
      if (!gateConfigured()) return reply({ ok: false, reason: "教室入口尚未完成設定，請聯絡講師" }, 503);
      const key = gateRateKey(request.headers);
      if (!globalLimiter.take("all") || !limiter.take(key) || verifying >= 4)
        return reply({ ok: false, reason: "嘗試太多次，稍後再試" }, 429, { "retry-after": "600" });
      if (Number(request.headers.get("content-length") || "0") > 2048)
        return reply({ ok: false, reason: "輸入內容過長" }, 413);
      let password: unknown;
      try {
        const reader = request.body?.getReader();
        if (!reader) return reply({ ok: false, reason: "請輸入入場密碼" }, 400);
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > 2048) { await reader.cancel(); return reply({ ok: false, reason: "輸入內容過長" }, 413); }
          chunks.push(item.value);
        }
        password = JSON.parse(Buffer.concat(chunks).toString("utf8")).password;
      } catch { return reply({ ok: false, reason: "請輸入入場密碼" }, 400); }
      if (typeof password !== "string" || !password.trim() || password.length > 256)
        return reply({ ok: false, reason: "請輸入有效的入場密碼" }, 400);
      verifying++;
      try {
        if (!await verifyGatePassword(password, process.env.CLASSROOM_GATE_PASSWORD_HASH!))
          return reply({ ok: false, reason: "密碼錯誤" }, 401);
        limiter.clear(key);
        return reply({ ok: true }, 200, { "set-cookie": issueGateCookie() });
      } finally { verifying--; }
    },
  } },
});
