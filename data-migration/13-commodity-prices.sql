-- ============================================================
-- Today's Market — daily commodity prices (#191)
-- 5 feed inputs tracked on the home dashboard:
--   soybean_oil, corn, soybean_meal  (CBOT futures via Yahoo Finance)
--   ddgs, choice_white_grease        (USDA AMS scraping)
-- One row per commodity per date. Unit + source recorded so we can mix
-- futures and cash references on the same widget without ambiguity.
-- ============================================================

CREATE TABLE IF NOT EXISTS commodity_prices (
  id text PRIMARY KEY,
  commodity_key text NOT NULL,
  date date NOT NULL,
  price numeric(12,4) NOT NULL,
  unit text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commodity_prices_key_check CHECK (
    commodity_key IN ('soybean_oil','corn','soybean_meal','ddgs','choice_white_grease')
  ),
  CONSTRAINT commodity_prices_source_check CHECK (
    source IN ('cbot','usda-ams','manual')
  ),
  CONSTRAINT commodity_prices_key_date_unique UNIQUE (commodity_key, date)
);

CREATE INDEX IF NOT EXISTS idx_commodity_prices_key_date
  ON commodity_prices (commodity_key, date DESC);

-- RLS: every authenticated user can read; only service role writes
-- (the cron uses SUPABASE_SERVICE_ROLE_KEY, RLS doesn't apply).
ALTER TABLE commodity_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commodity_prices_read" ON commodity_prices;
CREATE POLICY "commodity_prices_read" ON commodity_prices
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE commodity_prices IS
  'Daily feed-input prices powering the Today''s Market home card.';
