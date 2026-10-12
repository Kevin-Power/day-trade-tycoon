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
  const localOnly = env.CLASSROOM_LOCAL_ONLY === "true";
  if (localOnly && (
    url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
    env.HOST !== "127.0.0.1" || env.NITRO_HOST !== "127.0.0.1" ||
    !url.port || env.PORT !== url.port || env.NITRO_PORT !== url.port ||
    env.CLASSROOM_TRUST_PROXY === "true" || Boolean(env.DATABASE_URL?.trim())
  )) throw new Error("CLASSROOM_LOCAL_ONLY requires matching loopback listeners, local HTTP, local storage and no trusted proxy");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && (!production || localOnly)))
    throw new Error("BETTER_AUTH_URL must use HTTPS (HTTP requires local development or explicit local-only mode)");
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
