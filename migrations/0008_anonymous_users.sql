-- Guest (anonymous) accounts: practice first, sign up later. Guests never get a classroom
-- profile; they accept the teaching statement by pressing start, recorded in guest_consents.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS user_anonymous_created ON "user"("createdAt") WHERE "isAnonymous";
CREATE TABLE IF NOT EXISTS guest_consents (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
