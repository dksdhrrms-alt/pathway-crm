-- ============================================================
-- Inventory RLS — match the project-wide "anon role with USING (true)"
-- pattern.
--
-- This app uses NextAuth, NOT Supabase Auth. The browser Supabase
-- client always connects with the anon key and is therefore the
-- `anon` Postgres role. Any policy created `TO authenticated` will
-- silently block it — which is exactly what happened with
-- inventory_products on the first attempt (the original commit of
-- this file used `TO authenticated` and produced
-- "new row violates row-level security policy ... 42501").
--
-- Same fix that was already used for commodity_prices and
-- industry_news in 15-fix-public-cards-rls.sql: drop the role
-- restriction, just USING (true) / WITH CHECK (true). Access is
-- already gated at the page/API layer.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE inventory_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_lots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_forecasts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_products_all   ON inventory_products;
DROP POLICY IF EXISTS inv_locations_all  ON inventory_locations;
DROP POLICY IF EXISTS inv_stock_lots_all ON inventory_stock_lots;
DROP POLICY IF EXISTS inv_forecasts_all  ON inventory_forecasts;

CREATE POLICY inv_products_all   ON inventory_products
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY inv_locations_all  ON inventory_locations
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY inv_stock_lots_all ON inventory_stock_lots
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY inv_forecasts_all  ON inventory_forecasts
  FOR ALL USING (true) WITH CHECK (true);
