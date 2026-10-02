import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: async () => {
    try {
      const { getSql } = await import("@/lib/db");
      const sql = await getSql();
      await sql.query("select 1");
      return Response.json({ ok: true, service: "day-trade-tycoon", mode: "simulation" }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ ok: false, service: "day-trade-tycoon" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  } } },
});
