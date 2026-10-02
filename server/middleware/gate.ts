import { checkGateSession, isProtectedGatePath } from "../../src/lib/gate/session.server";
interface GateEvent { url: URL; req: { headers: Headers } }
export default async function classroomGate(event: GateEvent, next: () => unknown | Promise<unknown>): Promise<unknown> {
  if (isProtectedGatePath(event.url.pathname) && !checkGateSession(event.req.headers)) {
    return Response.json({ ok: false, reason: "請先輸入教室入場碼" },
      { status: 403, headers: { "cache-control": "no-store" } });
  }
  return next();
}
