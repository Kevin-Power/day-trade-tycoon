CREATE TABLE IF NOT EXISTS morning_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  state_json JSONB NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS morning_sessions_one_active
  ON morning_sessions(user_id, lesson_id) WHERE completed = FALSE;
CREATE INDEX IF NOT EXISTS morning_sessions_owner_latest
  ON morning_sessions(user_id, lesson_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS morning_requests (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES morning_sessions(id) ON DELETE CASCADE,
  action_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS morning_requests_session ON morning_requests(session_id);
