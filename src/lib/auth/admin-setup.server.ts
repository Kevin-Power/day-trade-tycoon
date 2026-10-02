import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { getSql, withSqlTransaction } from "../db";

export const adminSetupInput = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(1).max(40),
  password: z.string().min(10).max(128),
  token: z.string().min(32).max(256),
  acceptTos: z.literal(true),
}).strict();

function settings() {
  const email = process.env.ADMIN_SETUP_EMAIL?.trim().toLowerCase();
  const token = process.env.ADMIN_SETUP_TOKEN?.trim();
  return { email, token, configured: Boolean(email && token && token.length >= 32) };
}
function sameToken(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
export async function adminSetupStatus() {
  const config = settings();
  if (!config.configured) return { configured: false, available: false };
  const sql = await getSql();
  const completed = await sql`SELECT id FROM classroom_admin_setup WHERE id = 1`;
  const existing = await sql`SELECT id FROM "user" WHERE LOWER(email) = ${config.email}`;
  return { configured: true, available: !completed.length && !existing.length, email: config.email };
}
export async function completeAdminSetup(input: unknown): Promise<{ ok: true }> {
  const data = adminSetupInput.parse(input);
  const config = settings();
  if (!config.configured || !config.token || !config.email ||
      data.email.toLowerCase() !== config.email || !sameToken(data.token, config.token)) {
    throw new Error("初始化資料不符或入口已關閉");
  }
  const passwordHash = await hashPassword(data.password);
  const userId = randomUUID();
  const now = new Date().toISOString();
  await withSqlTransaction(async sql => {
    // The singleton insert arbitrates concurrent attempts. Any later failure rolls it back.
    const claimed = await sql<{ id: number }>`
      INSERT INTO classroom_admin_setup (id, user_id, completed_at)
      VALUES (1, ${userId}, ${now}) ON CONFLICT (id) DO NOTHING RETURNING id
    `;
    if (!claimed.length) throw new Error("講師初始化已完成，不能重複使用");
    const existing = await sql`SELECT id FROM "user" WHERE LOWER(email) = ${config.email}`;
    if (existing.length) throw new Error("此帳號已存在，初始化不會取代既有帳號");
    await sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${userId}, ${data.name}, ${config.email}, TRUE, ${now}, ${now})
    `;
    await sql`
      INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, 'credential', ${userId}, ${passwordHash}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO classroom_profiles (user_id, display_name, role, class_code, tos_accepted_at)
      VALUES (${userId}, ${data.name}, 'teacher', ${process.env.CLASSROOM_CODE?.trim() || "GWVGZ"}, ${now})
    `;
  });
  return { ok: true };
}
