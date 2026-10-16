/** Standalone email/password identity; no platform federation or shared identities. */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { anonymous } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { getPglite, getPostgresPool, getSql, withSqlTransaction } from "../db";
import { checkGateSession } from "../gate/session.server";
import { linkGuestRecords, purgeStaleGuests } from "../guest-link.server";
import { LINK_NOTICE_COOKIE, type LinkNotice } from "../guest-link";
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
      // A whole class often shares one network exit.
      "/sign-in/anonymous": { window: 600, max: 60 },
    },
  },
  hooks: {
    // The /api/auth route already requires classroom entry; this keeps guest creation gated
    // even if the handler is reached another way.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/anonymous" && !(ctx.headers && checkGateSession(ctx.headers)))
        throw new APIError("FORBIDDEN", { message: "請先輸入教室入場碼" });
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/anonymous" || !ctx.context.newSession) return;
      try {
        await purgeStaleGuests(await getSql(), new Date());
      } catch (error) {
        ctx.context.logger.error("Stale guest cleanup failed", error);
      }
    }),
  },
  advanced: {
    useSecureCookies: false,
    ipAddress: { ipAddressHeaders: config.trustProxy ? ["cf-connecting-ip"] : [] },
    defaultCookieAttributes: { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/" },
    cookies: { session_token: { name: SESSION_TOKEN_COOKIE } },
  },
  plugins: [
    anonymous({
      emailDomainName: "guest.invalid",
      generateName: () => "訪客",
      // Deleting the guest happens inside linkGuestRecords' transaction, so a failed move keeps it.
      disableDeleteAnonymousUser: true,
      onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
        let notice: LinkNotice | null = null;
        try {
          const result = await withSqlTransaction((sql) =>
            linkGuestRecords(sql, anonymousUser.user.id, newUser.user.id));
          if (result.skipped) notice = "skipped";
        } catch (error) {
          ctx.context.logger.error("Guest practice was not moved into the account", error);
          notice = "failed";
        }
        if (notice)
          ctx.setCookie(LINK_NOTICE_COOKIE, notice, {
            path: "/", maxAge: 600, sameSite: "lax", httpOnly: false, secure: config.secure,
          });
      },
    }),
    tanstackStartCookies(),
  ],
});
export function readSessionToken(): string | null { return getCookie(SESSION_TOKEN_COOKIE) ?? null; }
export { GROK_PROVIDERS } from "./providers";
