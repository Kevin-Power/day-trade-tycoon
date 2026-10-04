-- Public course inquiries are separate from classroom accounts and class rosters.
CREATE TABLE IF NOT EXISTS course_inquiries (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'phone')),
  contact TEXT NOT NULL CHECK (char_length(contact) BETWEEN 1 AND 254),
  device TEXT NOT NULL CHECK (device IN ('phone', 'tablet', 'desktop')),
  support TEXT NOT NULL CHECK (support IN ('standard', 'large-text', 'step-by-step')),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 600),
  consent BOOLEAN NOT NULL CHECK (consent = TRUE),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS course_inquiries_status_created_idx
  ON course_inquiries(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS course_inquiries_created_idx
  ON course_inquiries(created_at DESC, id DESC);
