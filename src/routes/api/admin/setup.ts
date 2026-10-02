import { createFileRoute } from "@tanstack/react-router";
import { adminSetupStatus, completeAdminSetup } from "@/lib/auth/admin-setup.server";
import { checkGateSession, isAllowedGateOrigin } from "@/lib/gate/session.server";
import { GateRateLimiter, gateRateKey } from "@/lib/gate/rate-limit.server";
import { readLimitedJson } from "@/lib/gate/body.server";

const limiter = new GateRateLimiter(5, 600_000);
let settingUp = false;
function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
export const Route = createFileRoute("/api/admin/setup")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!checkGateSession(request)) return reply({ ok: false, message: "請先進入教室" }, 403);
      return reply(await adminSetupStatus());
    },
    POST: async ({ request }) => {
      if (!checkGateSession(request) || !isAllowedGateOrigin(request))
        return reply({ ok: false, message: "請先進入教室" }, 403);
      if (!limiter.take(gateRateKey(request.headers)) || settingUp)
        return reply({ ok: false, message: "初始化嘗試過多，請稍後再試" }, 429);
      settingUp = true;
      try {
        const data = await readLimitedJson(request);
        return reply(await completeAdminSetup(data));
      } catch {
        // No request data, passwords, or tokens are logged or echoed.
        return reply({ ok: false, message: "初始化未完成：請確認資料、一次性憑證及入口狀態" }, 400);
      } finally { settingUp = false; }
    },
  } },
});
