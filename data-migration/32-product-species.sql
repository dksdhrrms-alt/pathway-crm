-- Product catalog — add species grouping (Turkey / Broiler / Swine /
-- Dairy / etc.) so the sidebar can collapse products two levels:
--   Products
--     ▸ Turkey
--         • Lipidol Prime
--         • Lipidol Protect
--     ▸ Broiler
--         • EndoPower Green
--
-- Admin picks the species when creating / editing a product; it's
-- free text (not an enum) so the sales team can introduce new ones
-- without a code change. NULL / empty = "Ungrouped" bucket in the
-- sidebar.

ALTER TABLE product_library_products
  ADD COLUMN IF NOT EXISTS species text;

COMMENT ON COLUMN product_library_products.species IS
  'Top-level group label used by the sidebar — e.g. Turkey, Broiler, Swine, Dairy. NULL falls into an "Ungrouped" bucket.';

CREATE INDEX IF NOT EXISTS idx_product_library_products_species
  ON product_library_products (species, display_order, name);
