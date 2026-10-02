import { randomBytes } from "node:crypto";

export type StandaloneAuthConfig = { secret: string; origin: string; secure: boolean; trustProxy: boolean };
const runtime = globalThis as typeof globalThis & { __classroomDevSecret?: string };

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): StandaloneAuthConfig {
  const production = env.NODE_ENV === "production";
  const configuredSecret = env.BETTER_AUTH_SECRET?.trim();
  if (production && (!configuredSecret || configuredSecret.length < 32))
    throw new Error("Production requires BETTER_AUTH_SECRET with at least 32 characters");
  if (configuredSecret && configuredSecret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const configuredOrigin = env.BETTER_AUTH_URL?.trim();
  if (production && !configuredOrigin) throw new Error("Production requires BETTER_AUTH_URL");
  const url = new URL(configuredOrigin || "http://localhost:8080");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("BETTER_AUTH_URL must be a canonical origin without a path or credentials");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !production))
    throw new Error("BETTER_AUTH_URL must use HTTPS (HTTP is only allowed for local development)");
  if (production && (env.CLASSROOM_AUTH_ENABLED === "false" || env.VITE_AUTH_ENABLED === "false"))
    throw new Error("Authentication cannot be disabled in production");
  runtime.__classroomDevSecret ??= randomBytes(32).toString("hex");
  return {
    secret: configuredSecret || runtime.__classroomDevSecret,
    origin: url.origin,
    secure: url.protocol === "https:",
    trustProxy: env.CLASSROOM_TRUST_PROXY === "true",
  };
}
