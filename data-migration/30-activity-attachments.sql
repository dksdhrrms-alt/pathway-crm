-- ============================================================
-- Activity attachments — files reps attach when logging a call,
-- meeting, email, or note. Mirrors the pattern used by
-- email-attachments (set up alongside the inbound email webhook)
-- and product-thumbnails (27-product-thumbnails-storage.sql):
--
--   1. Files land in a public Supabase Storage bucket
--      (`activity-attachments`).
--   2. One row per file in `activity_attachments` links the stored
--      object back to its parent activity so the Activity Timeline
--      can list all attachments without having to crawl the bucket.
--
-- Deleting an activity cascades through this table (so attachments
-- vanish from the UI); the Storage objects stay orphaned but a
-- future cleanup cron can prune them (keeping this migration small
-- and reversible).
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  url           text NOT NULL,
  size_bytes    bigint NOT NULL DEFAULT 0,
  content_type  text,
  storage_path  text,            -- used by the (future) cleanup cron
  uploaded_by   text,            -- user id, for audit
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_attachments_activity
  ON activity_attachments (activity_id, created_at);

COMMENT ON TABLE activity_attachments IS
  'Files uploaded alongside an Activity (contracts, meeting photos, proposal PDFs...). Public URL comes from Supabase Storage bucket `activity-attachments`.';

-- RLS — same policy family as product_library_files / inventory
-- (anon-key read + write; UI is gated at the route level).
ALTER TABLE activity_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_attachments_all ON activity_attachments;
CREATE POLICY activity_attachments_all ON activity_attachments
  FOR ALL USING (true) WITH CHECK (true);

-- ── Storage bucket ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('activity-attachments', 'activity-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS activity_attachments_storage_read ON storage.objects;
CREATE POLICY activity_attachments_storage_read ON storage.objects
  FOR SELECT USING (bucket_id = 'activity-attachments');

DROP POLICY IF EXISTS activity_attachments_storage_write ON storage.objects;
CREATE POLICY activity_attachments_storage_write ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'activity-attachments');

DROP POLICY IF EXISTS activity_attachments_storage_update ON storage.objects;
CREATE POLICY activity_attachments_storage_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'activity-attachments')
             WITH CHECK (bucket_id = 'activity-attachments');

DROP POLICY IF EXISTS activity_attachments_storage_delete ON storage.objects;
CREATE POLICY activity_attachments_storage_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'activity-attachments');
