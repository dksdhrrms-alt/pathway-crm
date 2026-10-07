-- ============================================================
-- Per-folder (per-species) Marketing Approvers.
--
-- Before this migration, approval of uploaded files was gated by a
-- single global `marketing_approver` permission (user_permissions
-- menu_item). That meant one person could approve every species's
-- material, with no way to say "Turkey approver can only approve
-- Turkey files". This table fixes that:
--
--   · A row (folder_id, user_id) grants that user approval authority
--     for all files inside that folder OR any of its descendants
--     (ancestor-chain check at approve time).
--   · The app only exposes the "Set approvers" UI on root folders —
--     i.e. the species level — but the schema itself allows a row at
--     any depth for future flexibility.
--   · The global `marketing_approver` permission still works and
--     counts as "can approve every folder" — intended for Admin / CEO.
--
-- No approval workflow on folders / products — this table only
-- affects whether an uploaded FILE can be approved.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_library_folder_approvers (
  folder_id uuid NOT NULL REFERENCES product_library_folders (id) ON DELETE CASCADE,
  user_id   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_approvers_user
  ON product_library_folder_approvers (user_id);
CREATE INDEX IF NOT EXISTS idx_folder_approvers_folder
  ON product_library_folder_approvers (folder_id);

COMMENT ON TABLE product_library_folder_approvers IS
  'Per-folder Marketing Approvers. A user listed on a folder can approve files anywhere under that folder (recursive). The global marketing_approver permission grants cross-folder authority.';

-- RLS mirrors the existing anon-key pattern used elsewhere.
ALTER TABLE product_library_folder_approvers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_library_folder_approvers_all ON product_library_folder_approvers;
CREATE POLICY product_library_folder_approvers_all
  ON product_library_folder_approvers FOR ALL
  USING (true) WITH CHECK (true);
