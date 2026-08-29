import { createFileRoute } from "@tanstack/react-router";

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
            reason: configured
              ? "實盤 adapter 尚未接上券商端點"
              : "實盤尚未設定。教室下單走模擬撮合。",
          },
          { status: 501 },
        );
      },
    },
  },
});
