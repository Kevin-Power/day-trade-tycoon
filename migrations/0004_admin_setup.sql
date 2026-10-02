-- Singleton ledger: replacing a deployment token never reopens initial setup.
CREATE TABLE IF NOT EXISTS classroom_admin_setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
