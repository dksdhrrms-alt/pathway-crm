-- ============================================================
-- Product Library links — sidebar shortcuts to specific Pathway USA
-- Library pages.
--
-- The library itself lives at https://pathway-library-flame.vercel.app/,
-- and reps kept complaining that "one big link" made them dig through
-- the library to find the product doc they wanted. Instead of hard-
-- coding a list in the sidebar, admins now curate a per-product list
-- from Admin → Product Library and it renders under a new expandable
-- "Products" group next to R&D / Marketing.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_library_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  url           text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE product_library_links IS
  'Sidebar shortcuts under the "Products" group. Curated by admin (Admin → Product Library). Each row is one clickable link that opens in a new tab.';

CREATE INDEX IF NOT EXISTS idx_product_library_links_order
  ON product_library_links (display_order, label);

-- RLS: everyone can read (needed to render the sidebar); only writes
-- happen from the admin panel via the anon key with server-side gating
-- (Admin page already blocks non-admin roles from opening the panel).
-- Matches the pattern used for inventory / other admin-curated tables.
ALTER TABLE product_library_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_library_links_all ON product_library_links;
CREATE POLICY product_library_links_all ON product_library_links
  FOR ALL USING (true) WITH CHECK (true);
