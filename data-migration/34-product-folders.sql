-- ============================================================
-- Folders as a first-class entity for the product catalog.
--
-- Before this migration a product's grouping lived only in its
-- `species` text column, which forced "create a product to make a
-- folder". After this migration folders have their own table with
-- a self-referencing parent_id, so admins can:
--   · Build empty folders ahead of time (right-click "New folder").
--   · Nest folders inside folders (Google Drive-style).
--   · Rename / move / delete folders without touching products.
--
-- Products now carry a nullable `folder_id` FK; a null folder_id
-- means the product is at the root of the catalog.
--
-- The existing `species` column stays on products for backward-
-- compatibility (older code / exports still work), but new UI
-- should read folder_id. The data migration below creates one
-- top-level folder per distinct species value and sets folder_id
-- on existing products so nothing disappears from the sidebar.
-- ============================================================

-- ---------- product_library_folders ---------------------------
CREATE TABLE IF NOT EXISTS product_library_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Self-reference. Null = root-level folder. ON DELETE SET NULL
  -- so deleting a parent reparents its children to root instead
  -- of cascading — same mental model as moving items to "root" in
  -- a file browser when their folder goes away.
  parent_id uuid REFERENCES product_library_folders (id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  -- Folders and products do NOT go through the approval workflow —
  -- only uploaded FILES do (see data-migration/33). These columns
  -- stay on the table for schema symmetry / future flexibility, but
  -- the app always writes/reads 'approved' and never prompts the user.
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_library_folders_parent
  ON product_library_folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_product_library_folders_status
  ON product_library_folders (status);

COMMENT ON TABLE product_library_folders IS
  'Hierarchical folders for the product catalog. parent_id = null means a root folder; nest arbitrarily deep.';

-- RLS mirrors the existing anon-key pattern used elsewhere.
ALTER TABLE product_library_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_library_folders_all ON product_library_folders;
CREATE POLICY product_library_folders_all
  ON product_library_folders FOR ALL
  USING (true) WITH CHECK (true);

-- ---------- products.folder_id -------------------------------
ALTER TABLE product_library_products
  ADD COLUMN IF NOT EXISTS folder_id uuid
    REFERENCES product_library_folders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_library_products_folder
  ON product_library_products (folder_id);

COMMENT ON COLUMN product_library_products.folder_id IS
  'Nullable FK to product_library_folders. Null = at the root of the catalog. Replaces the free-text `species` column for grouping; species stays for backward-compat.';

-- ---------- One-time backfill: species → folders -------------
-- For every distinct non-blank species in the existing table we
-- create one root-level folder with that name (if it doesn't
-- already exist) and point every product with that species at it.
-- Products with blank/null species stay at the root (folder_id = null).
DO $$
DECLARE
  sp text;
  new_id uuid;
BEGIN
  FOR sp IN
    SELECT DISTINCT trim(species)
    FROM product_library_products
    WHERE species IS NOT NULL AND trim(species) <> ''
  LOOP
    -- Idempotent: skip if a root folder with this name already exists.
    SELECT id INTO new_id
    FROM product_library_folders
    WHERE parent_id IS NULL AND lower(name) = lower(sp)
    LIMIT 1;

    IF new_id IS NULL THEN
      INSERT INTO product_library_folders (name, parent_id, status)
      VALUES (sp, NULL, 'approved')
      RETURNING id INTO new_id;
    END IF;

    UPDATE product_library_products
       SET folder_id = new_id
     WHERE folder_id IS NULL
       AND species IS NOT NULL
       AND trim(species) = sp;
  END LOOP;
END $$;
