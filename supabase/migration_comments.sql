-- Comments table for Activities, Tasks, Opportunities
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('activity', 'task', 'opportunity')),
  parent_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_type, parent_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON comments FOR ALL USING (true) WITH CHECK (true);
