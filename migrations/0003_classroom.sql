CREATE TABLE IF NOT EXISTS classroom_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher')),
  class_code TEXT NOT NULL,
  tos_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS classroom_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initial_equity DOUBLE PRECISION NOT NULL,
  final_equity DOUBLE PRECISION NOT NULL,
  max_drawdown_pct DOUBLE PRECISION NOT NULL,
  trades_count INTEGER NOT NULL,
  discipline_violations_json TEXT NOT NULL DEFAULT '[]',
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  paused_fills_count INTEGER NOT NULL DEFAULT 0,
  review_json TEXT NOT NULL DEFAULT 'null'
);
ALTER TABLE classroom_sessions ADD COLUMN IF NOT EXISTS review_json TEXT NOT NULL DEFAULT 'null';
CREATE INDEX IF NOT EXISTS classroom_sessions_user_idx ON classroom_sessions(user_id);
CREATE TABLE IF NOT EXISTS classroom_trades (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES classroom_sessions(id) ON DELETE CASCADE,
  sim_time DOUBLE PRECISION NOT NULL,
  code TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  qty INTEGER NOT NULL CHECK(qty > 0),
  price DOUBLE PRECISION NOT NULL CHECK(price > 0),
  fee DOUBLE PRECISION NOT NULL,
  tax DOUBLE PRECISION NOT NULL,
  filled_while_paused BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS classroom_trades_session_idx ON classroom_trades(session_id);
