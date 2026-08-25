-- ============================================================
-- Product catalog — replaces the flat product_library_links table
-- with a proper (product → files-by-category) structure.
--
-- Sidebar behavior stays the same (admin curates a list of product
-- names). Difference: clicking a product now opens an in-app
-- catalog page (/products/<slug>) instead of an external URL.
-- The catalog mirrors the "Product sheet on CRM" PPT the sales
-- team already uses:
--   - hero: name + tagline + description
--   - product information table (rows × N metric columns)
--   - Sales Tools grouped by category (presentation, flyer,
--     calculator, technical bulletin, document) with per-file
--     download links pointing at the Pathway Library site.
--
-- Old data path: any rows already in product_library_links are
-- imported as bare products (name=label, no description, no files)
-- so nothing disappears from the sidebar during migration.
-- ============================================================

-- ---------- Products --------------------------------------------
CREATE TABLE IF NOT EXISTS product_library_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,   -- URL-safe: 'lipidol-prime'
  name          text NOT NULL,           -- display: 'Lipidol Prime'
  tagline       text,                    -- 'The First Absorption Accelerator'
  description   text,                    -- long paragraph
  product_info  jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Shape:
    --   { "columns": ["Imperial", "Metric"],
    --     "rows": [
    --       { "label": "Inclusion rate",     "values": ["0.6 lb/ton", "300 g/MT"] },
    --       { "label": "Matrix value",       "values": ["150,000 kcal/lb", "330,000 kcal/kg"] },
    --       { "label": "Energy contribution", "values": ["45 kcal/lb of feed", "100 kcal/kg of feed"] }
    --     ] }
    -- Empty {} = "hide the table on the catalog page".
  display_order int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_library_products_order
  ON product_library_products (display_order, name);

COMMENT ON TABLE product_library_products IS
  'One row per catalog product. Metadata (name/tagline/description/product_info) is edited by admin from Admin → Product Library. Files live in product_library_files.';

-- ---------- Files (grouped by category) --------------------------
CREATE TABLE IF NOT EXISTS product_library_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES product_library_products(id) ON DELETE CASCADE,
  -- 5 categories match the PPT sections. Kept as text (not enum) so
  -- adding a new category later is a code-only change.
  category      text NOT NULL CHECK (category IN (
                  'presentation', 'flyer', 'calculator',
                  'technical_bulletin', 'document'
                )),
  label         text NOT NULL,           -- 'Lipidol Prime_Flyer_Swine_07 2026.pdf'
  url           text NOT NULL,           -- Pathway Library download URL
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_library_files_product
  ON product_library_files (product_id, category, display_order, label);

COMMENT ON TABLE product_library_files IS
  'Individual file entries shown under Sales Tools on each product catalog page. Clicking the label opens the URL in a new tab; browsers download based on the file server''s Content-Disposition.';

-- ---------- RLS ---------------------------------------------------
-- Same policy as product_library_links (which used the CRM anon key
-- for reads). Writes go through the admin panel with the same anon
-- key but are gated in the UI.
ALTER TABLE product_library_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_library_files    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_library_products_all ON product_library_products;
CREATE POLICY product_library_products_all ON product_library_products
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_library_files_all ON product_library_files;
CREATE POLICY product_library_files_all ON product_library_files
  FOR ALL USING (true) WITH CHECK (true);

-- ---------- Backfill from the old flat table ---------------------
-- Any rows already in product_library_links (added on the previous
-- iteration) become bare products with a single 'document' file
-- pointing at the old URL. Admin can flesh them out afterwards.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public'
             AND table_name = 'product_library_links') THEN
    INSERT INTO product_library_products (slug, name, display_order)
    SELECT
      regexp_replace(lower(label), '[^a-z0-9]+', '-', 'g'),
      label,
      display_order
    FROM product_library_links
    ON CONFLICT (slug) DO NOTHING;

    INSERT INTO product_library_files (product_id, category, label, url, display_order)
    SELECT
      p.id, 'document', l.label, l.url, l.display_order
    FROM product_library_links l
    JOIN product_library_products p
      ON p.slug = regexp_replace(lower(l.label), '[^a-z0-9]+', '-', 'g')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
