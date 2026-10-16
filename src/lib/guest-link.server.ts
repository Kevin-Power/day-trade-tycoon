import type { Sql } from "./db.ts";

export const GUEST_RETENTION_DAYS = 30;
export type GuestLinkResult = { linked: boolean; moved: number; skipped: boolean };

/**
 * Moves a guest's practice into the account it just signed up or signed in as, then deletes the
 * guest. Runs inside the caller's transaction: either everything moves and the guest is gone, or
 * nothing changes. When both own an unfinished run of the same lesson, the account's run wins.
 */
export async function linkGuestRecords(sql: Sql, guestId: string, accountId: string): Promise<GuestLinkResult> {
  const unchanged = { linked: false, moved: 0, skipped: false };
  if (guestId === accountId) return unchanged;
  const users = await sql<{ id: string; isAnonymous: boolean }>`
    SELECT id, "isAnonymous" FROM "user" WHERE id IN (${guestId}, ${accountId}) ORDER BY id FOR UPDATE`;
  const guest = users.find((user) => user.id === guestId);
  const account = users.find((user) => user.id === accountId);
  if (!guest?.isAnonymous || !account || account.isAnonymous) return unchanged;
  await sql`DELETE FROM morning_requests WHERE user_id = ${guestId}`;
  const dropped = await sql<{ id: string }>`
    DELETE FROM morning_sessions g
    WHERE g.user_id = ${guestId} AND NOT g.completed AND EXISTS (
      SELECT 1 FROM morning_sessions a
      WHERE a.user_id = ${accountId} AND a.lesson_id = g.lesson_id AND NOT a.completed)
    RETURNING id`;
  const moved = await sql<{ id: string }>`
    UPDATE morning_sessions SET user_id = ${accountId}, updated_at = NOW() WHERE user_id = ${guestId} RETURNING id`;
  await sql`DELETE FROM "user" WHERE id = ${guestId} AND "isAnonymous"`;
  return { linked: true, moved: moved.length, skipped: dropped.length > 0 };
}

/** Deletes guests that never became accounts; their practice goes with them (ON DELETE CASCADE). */
export async function purgeStaleGuests(sql: Sql, now: Date, limit = 200): Promise<number> {
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_DAYS * 86_400_000);
  const removed = await sql<{ id: string }>`
    DELETE FROM "user" WHERE id IN (
      SELECT id FROM "user"
      WHERE "isAnonymous" AND "createdAt" < ${cutoff}
      ORDER BY "createdAt" LIMIT ${limit})
    RETURNING id`;
  return removed.length;
}
