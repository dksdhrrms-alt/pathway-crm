-- ============================================================
-- Marketing approval workflow — pulls Product Library management
-- out of the main Admin tab and into a new /admin-marketing area
-- where editors can draft products/files and a Marketing Approver
-- gates what actually shows up in the sidebar + catalog pages.
--
-- Status lifecycle for both products and files:
--   draft    → never shown publicly; initial state for new items
--   pending  → submitted for approval by an editor
--   approved → visible on sidebar + catalog page
--   rejected → hidden; approver left a note
--
-- Existing rows are stamped 'approved' so nothing disappears at
-- deploy time.
-- ============================================================

-- ---------- Products -------------------------------------------
ALTER TABLE product_library_products
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_product_library_products_status
  ON product_library_products (status);

COMMENT ON COLUMN product_library_products.status IS
  'draft | pending | approved | rejected. Only approved rows show on the public sidebar + /products/[slug] pages.';

-- ---------- Files ----------------------------------------------
ALTER TABLE product_library_files
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_product_library_files_status
  ON product_library_files (status);

COMMENT ON COLUMN product_library_files.status IS
  'draft | pending | approved | rejected. Only approved files render in the Sales Tools section on a catalog page.';
