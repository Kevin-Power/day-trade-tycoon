/** Standalone email/password identity; no platform federation or shared identities. */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { getPglite, getPostgresPool } from "../db";
import { pgliteDialect } from "./pglite-dialect";
import { readAuthConfig } from "./config.server";

const config = readAuthConfig();
export const authConfigured = true;
export const SESSION_TOKEN_COOKIE = config.secure ? "__Host-classroom.session_token" : "classroom.session_token";

export const auth = betterAuth({
  appName: "當沖大富翁",
  baseURL: config.origin,
  secret: config.secret,
  trustedOrigins: [config.origin],
  database: process.env.DATABASE_URL?.trim()
    ? getPostgresPool()
    : { dialect: pgliteDialect(() => getPglite()), type: "postgres", transaction: true },
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
  account: { accountLinking: { enabled: false } },
  databaseHooks: {
    user: { create: { before: async (user) => {
      const reserved = process.env.ADMIN_SETUP_EMAIL?.trim().toLowerCase();
      if (reserved && user.email.trim().toLowerCase() === reserved) {
        throw new APIError("FORBIDDEN", { message: "此帳號需由講師初始化入口建立" });
      }
      return { data: { ...user, emailVerified: false } };
    } } },
  },
  session: { expiresIn: 7 * 24 * 60 * 60, cookieCache: { enabled: false } },
  rateLimit: {
    enabled: true, window: 60, max: 100,
    customRules: {
      "/sign-in/email": { window: 600, max: 12 },
      "/sign-up/email": { window: 600, max: 8 },
    },
  },
  advanced: {
    useSecureCookies: false,
    ipAddress: { ipAddressHeaders: config.trustProxy ? ["cf-connecting-ip"] : [] },
    defaultCookieAttributes: { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/" },
    cookies: { session_token: { name: SESSION_TOKEN_COOKIE } },
  },
  plugins: [tanstackStartCookies()],
});
export function readSessionToken(): string | null { return getCookie(SESSION_TOKEN_COOKIE) ?? null; }
export { GROK_PROVIDERS } from "./providers";
