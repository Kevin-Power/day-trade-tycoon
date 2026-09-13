CREATE TABLE IF NOT EXISTS classroom_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'student',
  class_code TEXT NOT NULL DEFAULT '',
  tos_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classroom_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  initial_equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  final_equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  trades_count INTEGER NOT NULL DEFAULT 0,
  discipline_violations_json TEXT NOT NULL DEFAULT '[]',
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  paused_fills_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS classroom_sessions_user_idx ON classroom_sessions (user_id);
CREATE INDEX IF NOT EXISTS classroom_sessions_lesson_idx ON classroom_sessions (lesson_id);

CREATE TABLE IF NOT EXISTS classroom_trades (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sim_time DOUBLE PRECISION NOT NULL DEFAULT 0,
  code TEXT NOT NULL,
  side TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax DOUBLE PRECISION NOT NULL DEFAULT 0,
  slippage_ticks INTEGER NOT NULL DEFAULT 0,
  pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  filled_while_paused BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS classroom_trades_session_idx ON classroom_trades (session_id);
