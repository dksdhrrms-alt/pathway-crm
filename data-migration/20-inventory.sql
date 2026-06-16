-- ============================================================
-- Inventory module — Phase 1 (snapshot) + Phase 2 (forecast)
--
-- Replaces the Monday.com board ("what's in stock right now per
-- product × location") AND the per-product Excel workbook (monthly
-- IN/OUT/Balance projection used to decide when to order). Both
-- live on the same product/location dimensions, so the Inventory
-- page can render the current snapshot AND the rolling balance
-- side by side and stay in sync.
--
-- Phase 3 (Opportunity → forecast auto-feed) is deliberately out of
-- scope here; we just shape the schema so Phase 3 can land later
-- without rewriting tables.
-- ============================================================

-- ---------- Products ----------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  sku           text,
  unit          text NOT NULL DEFAULT 'kg',
  cost_per_unit numeric(12, 2),
  display_order int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_products IS
  'Catalog of feed-additive products (Lipidol Ultra, EndoPower Green, etc.). Unit is normally "pallet" — change per product if needed.';

-- ---------- Locations (warehouses) --------------------------------
CREATE TABLE IF NOT EXISTS inventory_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  color       text,
  display_order int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_locations IS
  'Warehouses / 3PL nodes where stock is held (IA-BVS, StormLake, MN, AR, GA, PA...). Color drives the chip color on the inventory grid, mirroring the Monday board.';

-- ---------- Stock lots (Monday-style snapshot rows) --------------
-- Each row = one PO / container worth of stock. Sum across rows for
-- product+location gives the "Stock quantity" the Monday board shows.
CREATE TABLE IF NOT EXISTS inventory_stock_lots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
  location_id   uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  manufacturer  text,         -- 'GNC Bioferm', 'Pathway UK', 'EASYBIO'...
  quantity      numeric(12, 2) NOT NULL,
  unit          text NOT NULL DEFAULT 'kg',
  status        text NOT NULL DEFAULT 'in_stock'
                CHECK (status IN ('in_stock', 'upcoming', 'sold')),
  eta_date      date,         -- For "upcoming" lots; null when already in stock
  container_no  text,
  po_number     text,
  comment       text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_lots_product_location
  ON inventory_stock_lots (product_id, location_id, status);

COMMENT ON TABLE inventory_stock_lots IS
  'One row per PO / container of stock. status=upcoming means in transit (eta_date set); in_stock means landed at the location; sold means depleted. Summing quantity by product_id+location_id reproduces the Monday "Stock quantity" total.';

-- ---------- Monthly forecast (Excel-style IN/OUT projection) -----
-- Excel sheet structure was:
--   IN  <location>  <month1>  <month2>  ...
--   OUT <customer>  <month1>  <month2>  ...
--   Balance         <month1>  <month2>  ...
-- We store each cell as a row keyed by (product, location, month,
-- direction, party). Balance is computed at render time so it never
-- goes stale.
CREATE TABLE IF NOT EXISTS inventory_forecasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  month       date NOT NULL,   -- first day of the month
  direction   text NOT NULL CHECK (direction IN ('in', 'out')),
  party       text,            -- supplier when 'in', customer when 'out'
  quantity    numeric(12, 2) NOT NULL,
  scenario    text NOT NULL DEFAULT 'expected'
              CHECK (scenario IN ('best', 'worst', 'expected')),
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecasts_product_month
  ON inventory_forecasts (product_id, month);

COMMENT ON TABLE inventory_forecasts IS
  'Monthly planned IN (purchases) and OUT (sales) per product × location. Balance is computed in the app: prior balance + ins - outs. Scenario lets you keep Best / Worst rows side by side, matching the Lipidol Gold sheet in the planning workbook.';
