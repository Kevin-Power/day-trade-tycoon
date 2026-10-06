import { createFileRoute } from "@tanstack/react-router";
import { checkGateSession } from "@/lib/gate/session.server";

export const Route = createFileRoute("/api/tape")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!checkGateSession(request)) return Response.json({ ok: false, error: "請先進入教室" }, { status: 401 });
        return Response.json({
          ok: false,
          days: [],
          refreshEnabled: false,
          error: "舊行情來源已停用。請從真實 K 線練習逐分鐘讀取已核對行情。",
          practicePath: "/morning",
        }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
      },
    },
  },
});
