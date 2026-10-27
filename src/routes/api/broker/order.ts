import { createFileRoute } from "@tanstack/react-router";
import { liveOrderUnavailable } from "@/lib/broker/live-order-response";

/**
 * Live-order hop. Classroom currently always simulates.
 * Live integration requires account authorization, durable idempotent intents,
 * asynchronous broker acknowledgements/fills and reconciliation. See
 * docs/broker-integration.md. A configured URL alone must never enable sends.
 */
export const Route = createFileRoute("/api/broker/order")({
  server: {
    handlers: {
      POST: async () => {
        const configured = Boolean(process.env.BROKER_BASE_URL);
        return Response.json(liveOrderUnavailable(configured), {
          status: 501,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
