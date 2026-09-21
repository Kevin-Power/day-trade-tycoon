import { createFileRoute } from "@tanstack/react-router";
import { LIVE_ADAPTER_UNWIRED_REASON, LIVE_UNWIRED_REASON } from "@/lib/broker/copy";

/**
 * Live-order hop. Classroom currently always simulates.
 * Later: verify session, map the ticket to the broker wire format, POST to
 * BROKER_BASE_URL with a server-side key. Never put that key in VITE_*.
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
