-- ============================================================
-- Industry News card (#193) — daily-curated 2 items
-- Backing store for the home dashboard's Industry News widget.
-- The 6am cron picks the top 2 articles each morning from industry
-- RSS feeds (filtered by Claude for "would-a-feed-additive-rep-care?")
-- and inserts them with surface_date = today.
-- ============================================================

CREATE TABLE IF NOT EXISTS industry_news (
  id text PRIMARY KEY,
  surface_date date NOT NULL,            -- the date this item is shown on the dashboard
  title text NOT NULL,
  summary text NOT NULL,                 -- 1-2 sentence Claude rewrite
  why_it_matters text,                   -- 1 sentence sales-relevance Claude wrote
  category text,                         -- 'Disease' | 'Regulatory' | 'Market' | 'Customer' | 'Technology'
  source_url text NOT NULL,
  source_name text,
  published_at timestamptz,
  rank integer NOT NULL DEFAULT 0,       -- 1 or 2 — ordering within the day
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_industry_news_surface
  ON industry_news (surface_date DESC, rank ASC);

-- Prevent re-inserting the same article on a later day even if Claude
-- re-picks it. Title is a reasonable natural-key proxy.
CREATE UNIQUE INDEX IF NOT EXISTS uq_industry_news_title
  ON industry_news (lower(title));

ALTER TABLE industry_news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "industry_news_read" ON industry_news;
CREATE POLICY "industry_news_read" ON industry_news
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE industry_news IS
  'Daily-curated industry headlines for the home dashboard. 2 per day.';
