CREATE TABLE IF NOT EXISTS article_states (
  article_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('read', 'skip', 'keep')),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_states_status
  ON article_states(status);

CREATE INDEX IF NOT EXISTS idx_article_states_updated_at
  ON article_states(updated_at DESC);
