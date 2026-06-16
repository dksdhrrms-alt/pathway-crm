-- ============================================================
-- Inventory RLS — open to authenticated users
--
-- The 4 inventory tables (20-inventory.sql) were created with RLS
-- defaulting ON and no policies, which means every read AND every
-- write 403's back to the browser as "permission denied" — that's
-- what made the Settings page error out with [object Object] right
-- after the tables existed.
--
-- Access is already gated at the page/API level (admin tier + COO);
-- the row level only needs to allow authenticated callers through.
-- We use the broad "authenticated" role here. If we later want
-- stricter per-row policies (e.g. read-only for sales reps),
-- replace these with role-aware policies.
-- ============================================================

ALTER TABLE inventory_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_lots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_forecasts   ENABLE ROW LEVEL SECURITY;

-- Drop any prior copies so this migration is idempotent
DROP POLICY IF EXISTS inv_products_all   ON inventory_products;
DROP POLICY IF EXISTS inv_locations_all  ON inventory_locations;
DROP POLICY IF EXISTS inv_stock_lots_all ON inventory_stock_lots;
DROP POLICY IF EXISTS inv_forecasts_all  ON inventory_forecasts;

CREATE POLICY inv_products_all   ON inventory_products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY inv_locations_all  ON inventory_locations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY inv_stock_lots_all ON inventory_stock_lots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY inv_forecasts_all  ON inventory_forecasts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
