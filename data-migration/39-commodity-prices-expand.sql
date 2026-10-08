-- ============================================================
-- Expand `commodity_prices.commodity_key` CHECK constraint to allow
-- the seven new price feeds surfaced on the home dashboard:
--
--   Poultry & Egg Price Watch
--     bs_breast           — USDA AMS National Chicken Breast (B/S)
--     turkey_whole_hen    — USDA AMS Weekly Turkey Markets (whole hen)
--     shell_eggs_layer    — USDA AMS National Shell Eggs
--
--   Red Meat & Dairy Price Watch
--     lean_hogs           — CME Lean Hogs futures (Yahoo HE=F)
--     live_cattle         — CME Live Cattle futures (Yahoo LE=F)
--     class_iii_milk      — CME Class III Milk futures (Yahoo DC=F)
--     class_iv_milk       — USDA AMS Monthly Class IV minimum price
--
-- See lib/commodities.ts for the full config (yahoo symbols + MMN
-- slugs). The 2025-era CHECK constraint only knew about the five
-- original feed inputs; without this migration an insert of any new
-- key fails with "violates check constraint commodity_prices_key_check".
-- ============================================================

ALTER TABLE commodity_prices
  DROP CONSTRAINT IF EXISTS commodity_prices_key_check;

ALTER TABLE commodity_prices
  ADD CONSTRAINT commodity_prices_key_check CHECK (
    commodity_key IN (
      -- Original 5 feed inputs
      'soybean_oil','corn','soybean_meal','ddgs','choice_white_grease',
      -- Poultry & egg protein watch
      'bs_breast','turkey_whole_hen','shell_eggs_layer',
      -- Red meat & dairy watch
      'lean_hogs','live_cattle','class_iii_milk','class_iv_milk'
    )
  );
