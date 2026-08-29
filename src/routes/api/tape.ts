import { createFileRoute } from "@tanstack/react-router";
import { pullRecentTape } from "@/lib/market/pull-tape";

export const Route = createFileRoute("/api/tape")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const fresh = new URL(request.url).searchParams.get("fresh") === "1";
          const payload = await pullRecentTape({ fresh });
          return Response.json(payload, {
            headers: {
              "Cache-Control": fresh ? "no-store" : "public, max-age=120",
            },
          });
        } catch (err) {
          return Response.json(
            {
              ok: false,
              source: "TWSE MI_5MINS_INDEX + FinMind TaiwanStockPrice",
              fetchedAt: new Date().toISOString(),
              days: [],
              error: err instanceof Error ? err.message : "抓盤失敗",
            },
            { status: 502 },
          );
        }
      },
    },
  },
});
