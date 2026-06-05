-- ============================================================
-- Fix RLS for the two home-dashboard public cards.
-- Run in Supabase SQL Editor. Idempotent.
--
-- Problem: migrations 13 (commodity_prices) and 14 (industry_news)
-- created their SELECT policy with `TO authenticated`. This app uses
-- next-auth, NOT Supabase Auth — so the browser-side Supabase client
-- always connects with the ANON key and is therefore treated as the
-- `anon` Postgres role, not `authenticated`. The two cards then
-- silently received empty result sets while the cron jobs (which
-- use the service-role key) wrote rows successfully — hence the
-- "ok but card is empty" symptom on /dashboard.
--
-- Fix: drop the role-scoped policies and recreate them without a
-- TO clause, matching the "Allow all read" pattern used by every
-- other public table in this project (projects, rnd_*, budget_teams).
-- ============================================================

DROP POLICY IF EXISTS "commodity_prices_read" ON commodity_prices;
CREATE POLICY "commodity_prices_read" ON commodity_prices
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "industry_news_read" ON industry_news;
CREATE POLICY "industry_news_read" ON industry_news
  FOR SELECT
  USING (true);
