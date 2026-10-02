import { createFileRoute } from "@tanstack/react-router";
import { LIVE_ADAPTER_UNWIRED_REASON, LIVE_UNWIRED_REASON } from "@/lib/broker/copy";

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
        return Response.json(
          {
            ok: false,
            venue: "live",
            reason: configured ? LIVE_ADAPTER_UNWIRED_REASON : LIVE_UNWIRED_REASON,
          },
          { status: 501 },
        );
      },
    },
  },
});
