-- Daily question (sub-project B): one question per Fubon data day, the same for everyone, issued
-- on a weekday morning. A data day that yields no question keeps a row with NULL issue_date and
-- payload, so it is never retried. Answers are one per learner per question and never change.
CREATE TABLE IF NOT EXISTS daily_questions (
  id TEXT PRIMARY KEY,
  issue_date DATE UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB
);
CREATE TABLE IF NOT EXISTS daily_answers (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES daily_questions(id) ON DELETE CASCADE,
  choice TEXT NOT NULL CHECK (choice IN ('enter', 'watch', 'skip')),
  stop_price NUMERIC,
  reason TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, question_id),
  CHECK ((choice = 'enter') = (stop_price IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS daily_answers_question ON daily_answers(question_id);
