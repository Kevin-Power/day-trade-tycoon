import { createFileRoute } from "@tanstack/react-router";
import { checkGateSession } from "@/lib/gate/session.server";

export const Route = createFileRoute("/api/download/offline")({
  server: { handlers: { GET: async ({ request }) => {
    if (!checkGateSession(request)) return Response.json({ ok: false, error: "請先進入教室" }, { status: 403 });
    const { join, resolve } = await import("node:path");
    const { readFile } = await import("node:fs/promises");
    const directory = process.env.CLASSROOM_DOWNLOADS_DIR || resolve("downloads");
    try {
      const file = await readFile(join(directory, "daytrade-tycoon-offline.zip"));
      return new Response(file, { headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="daytrade-tycoon-offline.zip"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch { return Response.json({ ok: false, error: "離線教材尚未準備完成，請洽講師" }, { status: 503 }); }
  } } },
});
