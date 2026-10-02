CREATE TABLE IF NOT EXISTS classroom_session_feedback (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES classroom_sessions(id) ON DELETE RESTRICT,
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  observation TEXT NOT NULL CHECK (char_length(btrim(observation)) BETWEEN 1 AND 600),
  next_step TEXT NOT NULL CHECK (char_length(btrim(next_step)) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id UUID NOT NULL,
  UNIQUE(author_user_id, request_id)
);

CREATE INDEX IF NOT EXISTS classroom_feedback_session_page_idx
  ON classroom_session_feedback(session_id, created_at DESC, id DESC);

-- Feedback is additional teaching evidence; prior observations cannot be rewritten.
CREATE OR REPLACE FUNCTION reject_classroom_feedback_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Classroom feedback is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER classroom_feedback_append_only
  BEFORE UPDATE OR DELETE ON classroom_session_feedback
  FOR EACH ROW EXECUTE FUNCTION reject_classroom_feedback_mutation();
