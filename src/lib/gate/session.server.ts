import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readAuthConfig } from "../auth/config.server.ts";
import { isGateHash } from "./password.server.ts";

const MAX_AGE_SECONDS = 8 * 60 * 60;
export class GateRequiredError extends Error {
  readonly status = 403;
  constructor() { super("Classroom entry required"); this.name = "GateRequiredError"; }
}
function config() {
  const auth = readAuthConfig();
  const hash = process.env.CLASSROOM_GATE_PASSWORD_HASH;
  return { ...auth, hash, cookieName: auth.secure ? "__Host-classroom_gate" : "classroom_gate" };
}
export function gateConfigured(): boolean { return isGateHash(process.env.CLASSROOM_GATE_PASSWORD_HASH); }
function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update("classroom-gate-v1:" + body).digest("base64url");
}
function fingerprint(hash: string): string { return createHash("sha256").update(hash).digest("base64url"); }
function cookieValue(headers: Headers, name: string): string | null {
  const pair = (headers.get("cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return pair ? pair.slice(name.length + 1) : null;
}
export function checkGateSession(input: Request | Headers, now = Date.now()): boolean {
  const headers = input instanceof Headers ? input : input.headers;
  const cfg = config();
  if (!isGateHash(cfg.hash)) return false;
  const value = cookieValue(headers, cfg.cookieName);
  if (!value || value.length > 1024) return false;
  const pieces = value.split(".");
  if (pieces.length !== 2) return false;
  const [body, supplied] = pieces;
  const expected = signature(body, cfg.secret);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return data.v === 1 && Number.isSafeInteger(data.exp) && data.exp > now &&
      data.exp <= now + MAX_AGE_SECONDS * 1000 && data.gate === fingerprint(cfg.hash);
  } catch { return false; }
}
export function requireGateSession(input: Request | Headers): void {
  if (!checkGateSession(input)) throw new GateRequiredError();
}
export function issueGateCookie(now = Date.now()): string {
  const cfg = config();
  if (!isGateHash(cfg.hash)) throw new Error("CLASSROOM_GATE_PASSWORD_HASH is missing or invalid");
  const body = Buffer.from(JSON.stringify({ v: 1, exp: now + MAX_AGE_SECONDS * 1000,
    nonce: randomBytes(16).toString("hex"), gate: fingerprint(cfg.hash) })).toString("base64url");
  return cfg.cookieName + "=" + body + "." + signature(body, cfg.secret) +
    "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + MAX_AGE_SECONDS + (cfg.secure ? "; Secure" : "");
}
export function clearGateCookie(): string {
  const cfg = config();
  return cfg.cookieName + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (cfg.secure ? "; Secure" : "");
}
export function isAllowedGateOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === readAuthConfig().origin;
}
export function isProtectedGatePath(pathname: string): boolean {
  if (pathname === "/api/gate" || pathname === "/api/health" || pathname === "/api/auth/get-session") return false;
  return pathname === "/api" || pathname.startsWith("/api/") ||
    pathname.startsWith("/_serverFn/") || pathname === "/daytrade-tycoon-offline.zip";
}
