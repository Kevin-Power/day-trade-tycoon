import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { ensureDbReady } from "@/lib/db";
import { checkGateSession } from "@/lib/gate/session.server";

async function handle(request: Request): Promise<Response> {
  if (!checkGateSession(request)) {
    // Session discovery is read-only and returns signed out before classroom admission.
    if (request.method === "GET" && new URL(request.url).pathname === "/api/auth/get-session")
      return Response.json(null, { headers: { "cache-control": "no-store" } });
    return Response.json({ code: "CLASSROOM_ENTRY_REQUIRED", message: "請先輸入教室入場碼" },
      { status: 403, headers: { "cache-control": "no-store" } });
  }
  await ensureDbReady();
  return auth.handler(request);
}
export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
});
