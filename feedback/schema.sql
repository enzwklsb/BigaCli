CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  content TEXT NOT NULL,
  sender_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_sender_time ON feedback(sender_hash, created_at);
