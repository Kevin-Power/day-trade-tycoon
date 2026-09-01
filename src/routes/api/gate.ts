import { createFileRoute } from "@tanstack/react-router";
import { GATE_HASH, digest, hashesMatch } from "@/lib/gate/hash";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 12;
const hits = new Map<string, number[]>();

function limited(id: string): boolean {
  const now = Date.now();
  const arr = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_TRIES) {
    hits.set(id, arr);
    return true;
  }
  arr.push(now);
  hits.set(id, arr);
  return false;
}

export const Route = createFileRoute("/api/gate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
        if (limited(ip)) {
          return Response.json({ ok: false, reason: "嘗試太多次，稍後再試" });
        }
        let password = "";
        try {
          const body = (await request.json()) as { password?: unknown };
          password = typeof body?.password === "string" ? body.password : "";
        } catch {
          return Response.json({ ok: false, reason: "請輸入入場密碼" });
        }
        if (!password.trim()) {
          return Response.json({ ok: false, reason: "請輸入入場密碼" });
        }
        const hashed = await digest(password);
        if (!hashesMatch(hashed, GATE_HASH)) {
          return Response.json({ ok: false, reason: "密碼錯誤" });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
